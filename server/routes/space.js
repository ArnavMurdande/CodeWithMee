const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Company = require('../models/Company');
const Post = require('../models/Post');
const Project = require('../models/Project');
const authMiddleware = require('../middleware/authMiddleware');
const { evaluateRequestPermission } = require('../middleware/policyMiddleware');
const { PERMISSION } = require('../modules/policies/permissions');
const requireLocalUploadCompatibility = require('../middleware/localUploadCompatibility');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createLegacyLogger } = require('../utils/legacyLogger');

const legacyLogger = createLegacyLogger('space');

const uploadDir = path.join(__dirname, '../uploads/space');

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    fs.mkdir(uploadDir, { recursive: true }, (error) => cb(error, uploadDir));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, 'post-' + Date.now() + ext);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max limit to allow video/audio
});

// Middleware to conditionally hydrate the req.author and req.authorType based on token
const parseAuthor = async (req, res, next) => {
  try {
    const u = await User.findById(req.user.id);
    if (!u) return res.status(404).json({ msg: 'User not found' });
    req.feedAuthor = u;
    req.feedAuthorType = 'User';
    next();
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// ===========================================
// LEADERBOARD
// ===========================================
// @route   GET api/space/leaderboard
router.get('/leaderboard', authMiddleware, async (req, res) => {
  try {
    const { timeframe, filter } = req.query; // filter: points, challenges, posts

    // Time filter setup
    let startDate = null;
    if (timeframe && timeframe !== 'all') {
      const now = new Date();
      startDate = new Date();
      if (timeframe === 'daily') startDate.setDate(now.getDate() - 1);
      if (timeframe === 'weekly') startDate.setDate(now.getDate() - 7);
      if (timeframe === 'monthly') startDate.setMonth(now.getMonth() - 1);
      if (timeframe === 'yearly') startDate.setFullYear(now.getFullYear() - 1);
    }

    // Default fast path for 'all time' + 'points'
    if (!startDate && (!filter || filter === 'points')) {
      const topUsers = await User.find({ role: { $in: ['learner', 'moderator'] } })
        .sort({ points: -1 })
        .limit(20)
        .select('username profilePictureUrl points role solvedChallenges');
      return res.json(topUsers.map((u) => ({ ...u._doc, score: u.points })));
    }

    // Dynamic processing for filtering
    const allUsers = await User.find({ role: { $in: ['learner', 'moderator'] } }).select(
      'username profilePictureUrl points role solvedChallenges',
    );

    // Fetch posts in timeframe to count per user
    const postQuery = startDate ? { createdAt: { $gte: startDate } } : {};
    const posts = await Post.find(postQuery).select('author');
    const postCounts = {};
    posts.forEach((p) => {
      if (p.author) {
        const id = p.author.toString();
        postCounts[id] = (postCounts[id] || 0) + 1;
      }
    });

    let leader = allUsers.map((u) => {
      // Filter solved challenges by date
      let validChallenges = u.solvedChallenges || [];
      if (startDate) {
        validChallenges = validChallenges.filter(
          (sc) => new Date(sc.solvedAt || new Date(0)) >= startDate,
        );
      }
      const cCount = validChallenges.length;
      const pCount = postCounts[u._id.toString()] || 0;

      let score = 0;
      if (filter === 'challenges') score = cCount;
      else if (filter === 'posts') score = pCount;
      else score = !startDate && filter === 'points' ? u.points : cCount * 20 + pCount * 5; // Fallback: estimated points earned in period

      return { ...u._doc, score, challengesCount: cCount, postsCount: pCount };
    });

    leader.sort((a, b) => b.score - a.score);
    res.json(leader.slice(0, 20));
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// ===========================================
// COMMENTS (RECURSIVE HELPERS)
// ===========================================

const findComment = (comments, commentId) => {
  for (const comment of comments) {
    if (comment._id.toString() === commentId) return comment;
    if (comment.replies && comment.replies.length > 0) {
      const found = findComment(comment.replies, commentId);
      if (found) return found;
    }
  }
  return null;
};

const removeComment = (comments, commentId) => {
  for (let i = 0; i < comments.length; i++) {
    if (comments[i]._id.toString() === commentId) {
      comments.splice(i, 1);
      return true;
    }
    if (comments[i].replies && comments[i].replies.length > 0) {
      if (removeComment(comments[i].replies, commentId)) return true;
    }
  }
  return false;
};

const deepPopulateSpaceComments = async (postId) => {
  const post = await Post.findById(postId).populate(
    'author',
    'username companyName profilePictureUrl logo role',
  );
  if (!post) return null;

  const collectRefs = (comments) => {
    const users = new Set(),
      companies = new Set();
    for (const c of comments) {
      if (c.author) {
        if (c.authorType === 'Company') companies.add(c.author.toString());
        else users.add(c.author.toString());
      }
      if (c.awards)
        c.awards.forEach((a) => {
          if (a.user) users.add(a.user.toString());
        });
      if (c.replies && c.replies.length > 0) {
        const nested = collectRefs(c.replies);
        nested.users.forEach((id) => users.add(id));
        nested.companies.forEach((id) => companies.add(id));
      }
    }
    return { users, companies };
  };

  const refs = collectRefs(post.comments);

  const [fetchedUsers, fetchedCompanies] = await Promise.all([
    User.find({ _id: { $in: [...refs.users] } }).select('username profilePictureUrl role'),
    Company.find({ _id: { $in: [...refs.companies] } }).select('companyName logo'),
  ]);

  const entityMap = {};
  fetchedUsers.forEach((u) => {
    entityMap[u._id.toString()] = {
      _id: u._id,
      username: u.username,
      profilePictureUrl: u.profilePictureUrl,
      role: u.role,
    };
  });
  fetchedCompanies.forEach((c) => {
    entityMap[c._id.toString()] = { _id: c._id, companyName: c.companyName, logo: c.logo };
  });

  const assignAuthors = (comments) => {
    for (const c of comments) {
      if (c.author && typeof c.author !== 'object') {
        c.author = entityMap[c.author.toString()] || { username: 'Deleted' };
      } else if (c.author && c.author._id && !(c.author.username || c.author.companyName)) {
        c.author = entityMap[c.author._id.toString()] || { username: 'Deleted' };
      }
      if (c.awards) {
        c.awards.forEach((a) => {
          if (a.user && typeof a.user !== 'object') {
            a.user = entityMap[a.user.toString()] || { username: 'Unknown' };
          }
        });
      }
      if (c.replies && c.replies.length > 0) assignAuthors(c.replies);
    }
  };

  const postObj = post.toObject();
  assignAuthors(postObj.comments);
  return postObj;
};

// ===========================================
// POSTS CRUD & FEED
// ===========================================
// @route   GET api/space/posts
// @desc    Get feed posts
router.get('/posts', authMiddleware, async (req, res) => {
  try {
    const { feedType, sort, timeframe } = req.query;

    let query = {};
    const currentUser = await User.findById(req.user.id);

    // Follow filter
    if (feedType === 'following' && currentUser) {
      query.author = { $in: currentUser.following };
    } else if (currentUser && currentUser.blockedUsers && currentUser.blockedUsers.length > 0) {
      // Even in public feed, hide blocked users
      query.author = { $nin: currentUser.blockedUsers };
    }

    // Timeframe filter
    if (timeframe && timeframe !== 'all') {
      const now = new Date();
      let startDate = new Date();
      if (timeframe === 'daily') startDate.setDate(now.getDate() - 1);
      if (timeframe === 'weekly') startDate.setDate(now.getDate() - 7);
      if (timeframe === 'monthly') startDate.setMonth(now.getMonth() - 1);
      if (timeframe === 'yearly') startDate.setFullYear(now.getFullYear() - 1);
      query.createdAt = { $gte: startDate };
    }

    let posts = await Post.find(query);

    // Sort logic in-memory for simpler array length sorting
    if (sort === 'liked') {
      posts.sort((a, b) => b.likes.length - a.likes.length);
    } else if (sort === 'trending') {
      posts.sort(
        (a, b) =>
          b.likes.length +
          (b.comments ? b.comments.length : 0) -
          (a.likes.length + (a.comments ? a.comments.length : 0)),
      );
    } else {
      // newest (default)
      posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    posts = posts.slice(0, 100); // slightly larger pool before privacy filter

    // Privacy filter: hide posts from users whose settings restrict visibility
    const authorIds = [...new Set(posts.map((p) => p.author?.toString()).filter(Boolean))];
    const authors = await User.find({ _id: { $in: authorIds } }).select(
      'privacySettings followers',
    );
    const authorMap = {};
    authors.forEach((a) => {
      authorMap[a._id.toString()] = a;
    });

    posts = posts
      .filter((p) => {
        const authorId = p.author?.toString();
        if (!authorId) return true;
        // Always show your own posts
        if (authorId === req.user.id) return true;

        const author = authorMap[authorId];
        if (!author) return true;

        const pSetting = author.privacySettings?.whoCanViewPosts || 'everyone';
        if (pSetting === 'nobody') return false;
        if (pSetting === 'followers_only') {
          const followerIds = (author.followers || []).map((f) => f.toString());
          return followerIds.includes(req.user.id);
        }
        return true; // 'everyone'
      })
      .slice(0, 50);

    // Deep populate each post individually using the helper we created
    const populatedPosts = await Promise.all(
      posts.map(async (p) => await deepPopulateSpaceComments(p._id)),
    );

    // Comment-level privacy filter: hide comments from users whose settings restrict visibility
    // Collect all comment author IDs across all posts
    const commentAuthorIds = new Set();
    const collectCommentAuthors = (comments) => {
      for (const c of comments) {
        if (c.author?._id) commentAuthorIds.add(c.author._id.toString());
        else if (c.author && typeof c.author === 'string') commentAuthorIds.add(c.author);
        if (c.replies && c.replies.length > 0) collectCommentAuthors(c.replies);
      }
    };
    populatedPosts.forEach((p) => {
      if (p && p.comments) collectCommentAuthors(p.comments);
    });

    // Fetch privacy settings for all comment authors
    const commentAuthors = await User.find({ _id: { $in: [...commentAuthorIds] } }).select(
      'privacySettings followers',
    );
    const commentAuthorMap = {};
    commentAuthors.forEach((a) => {
      commentAuthorMap[a._id.toString()] = a;
    });

    // Recursively filter comments
    const filterComments = (comments) => {
      return comments
        .filter((c) => {
          const cAuthorId =
            c.author?._id?.toString() || (typeof c.author === 'string' ? c.author : null);
          if (!cAuthorId) return true;
          // Always show your own comments
          if (cAuthorId === req.user.id) return true;

          const cAuthor = commentAuthorMap[cAuthorId];
          if (!cAuthor) return true; // Company comments or deleted users — show

          const cSetting = cAuthor.privacySettings?.whoCanViewComments || 'everyone';
          if (cSetting === 'nobody') return false;
          if (cSetting === 'followers_only') {
            const followerIds = (cAuthor.followers || []).map((f) => f.toString());
            return followerIds.includes(req.user.id);
          }
          return true;
        })
        .map((c) => {
          if (c.replies && c.replies.length > 0) {
            return { ...c, replies: filterComments(c.replies) };
          }
          return c;
        });
    };

    const filteredPosts = populatedPosts.map((p) => {
      if (!p || !p.comments) return p;
      return { ...p, comments: filterComments(p.comments) };
    });

    res.json(filteredPosts);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route   POST api/space/posts
// @desc    Create a post with attachments
router.post(
  '/posts',
  [authMiddleware, requireLocalUploadCompatibility, parseAuthor, upload.array('files', 5)],
  async (req, res) => {
    try {
      // Ban check
      if (req.feedAuthorType === 'User' && req.feedAuthor.isBanned) {
        return res.status(403).json({ msg: 'Your account is banned. You cannot create posts.' });
      }
      const { content } = req.body;

      let attachments = [];
      if (req.files && req.files.length > 0) {
        attachments = req.files.map((f) => {
          let type = 'image';
          if (f.mimetype.startsWith('video/')) type = 'video';
          if (f.mimetype.startsWith('audio/')) type = 'audio';
          return { type, url: `/uploads/space/${f.filename}` };
        });
      }

      const newPost = new Post({
        authorType: req.feedAuthorType,
        author: req.feedAuthor._id,
        content: content || '',
        attachments,
      });

      // Award points if author is User (Gamification)
      if (req.feedAuthorType === 'User') {
        req.feedAuthor.points += 5; // 5 XP for posting
        await req.feedAuthor.save();
      }

      const savedPost = await newPost.save();

      // Populate before returning so frontend can show it instantly
      await savedPost.populate({
        path: 'author',
        select: 'username companyName profilePictureUrl logo role',
      });
      res.json(savedPost);
    } catch (err) {
      legacyLogger.error('request_failed', err);
      res.status(500).send('Server error');
    }
  },
);

// @route   DELETE api/space/posts/:id
// @desc    Delete post by author, moderator, or superadmin
router.delete('/posts/:id', [authMiddleware, parseAuthor], async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const isOwner = post.author.toString() === req.user.id;
    const isAdmin = evaluateRequestPermission(req, PERMISSION.MODERATION_ACTION_CREATE).allowed;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ msg: 'Not authorized to delete post' });
    }

    await Post.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Post deleted' });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// ===========================================
// LIKES, DISLIKES, SAVES, AWARDS
// ===========================================
router.put('/posts/:id/:action', authMiddleware, async (req, res) => {
  try {
    const { action } = req.params; // 'like', 'dislike', 'save'
    if (!['like', 'dislike', 'save'].includes(action))
      return res.status(400).json({ msg: 'Invalid action' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ msg: 'Post not found' });
    const userIdStr = req.user.id.toString();

    if (action === 'save') {
      if (post.saves.includes(userIdStr)) post.saves = post.saves.filter((id) => id !== userIdStr);
      else post.saves.push(req.user.id);
      await post.save();
      return res.json({ saves: post.saves });
    }

    if (action === 'like') {
      if (post.likes.includes(userIdStr)) {
        post.likes = post.likes.filter((id) => id !== userIdStr);
      } else {
        post.likes.push(req.user.id);
        post.dislikes = post.dislikes.filter((id) => id !== userIdStr);
        if (post.authorType === 'User')
          await User.findByIdAndUpdate(post.author, { $inc: { points: 1 } });
      }
    } else if (action === 'dislike') {
      if (post.dislikes.includes(userIdStr)) {
        post.dislikes = post.dislikes.filter((id) => id !== userIdStr);
      } else {
        post.dislikes.push(req.user.id);
        post.likes = post.likes.filter((id) => id !== userIdStr);
      }
    }

    await post.save();
    res.json({ likes: post.likes, dislikes: post.dislikes });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

router.post('/posts/:id/award', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const existingAwardIndex = post.awards.findIndex(
      (a) => a.user.toString() === req.user.id.toString(),
    );

    if (existingAwardIndex > -1) {
      post.awards.splice(existingAwardIndex, 1);
      if (post.authorType === 'User')
        await User.findByIdAndUpdate(post.author, { $inc: { points: -5 } });
    } else {
      post.awards.push({ user: req.user.id, type: req.body.awardType || 'diamond' });
      if (post.authorType === 'User')
        await User.findByIdAndUpdate(post.author, { $inc: { points: 5 } });
    }

    await post.save();
    res.json(post.awards);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// ===========================================
// COMMENTS
// ===========================================

// @route POST /api/space/posts/:id/comment
router.post('/posts/:id/comment', [authMiddleware, parseAuthor], async (req, res) => {
  try {
    // Ban check
    if (req.feedAuthorType === 'User' && req.feedAuthor.isBanned) {
      return res.status(403).json({ msg: 'Your account is banned. You cannot comment.' });
    }
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    post.comments.push({
      authorType: req.feedAuthorType,
      author: req.feedAuthor._id,
      content: req.body.content,
    });

    if (req.feedAuthorType === 'User') {
      req.feedAuthor.points += 2;
      await req.feedAuthor.save();
    }

    await post.save();
    const updated = await deepPopulateSpaceComments(req.params.id);
    res.json(updated.comments);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route POST /api/space/posts/:id/comment/:commentId/reply
router.post(
  '/posts/:id/comment/:commentId/reply',
  [authMiddleware, parseAuthor],
  async (req, res) => {
    try {
      // Ban check
      if (req.feedAuthorType === 'User' && req.feedAuthor.isBanned) {
        return res.status(403).json({ msg: 'Your account is banned. You cannot reply.' });
      }
      const post = await Post.findById(req.params.id);
      const parentComment = findComment(post.comments, req.params.commentId);
      if (!parentComment) return res.status(404).json({ msg: 'Comment not found' });

      parentComment.replies.push({
        authorType: req.feedAuthorType,
        author: req.feedAuthor._id,
        content: req.body.text,
      });

      if (req.feedAuthorType === 'User') {
        req.feedAuthor.points += 2;
        await req.feedAuthor.save();
      }

      await post.save();
      const updated = await deepPopulateSpaceComments(req.params.id);
      res.json(updated.comments);
    } catch (err) {
      res.status(500).send('Server Error');
    }
  },
);

router.post('/posts/:id/comment/:commentId/like', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const comment = findComment(post.comments, req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    // String arrays
    const userId = req.user.id.toString();
    comment.dislikes = comment.dislikes.filter((id) => id !== userId);

    if (comment.likes.includes(userId)) {
      comment.likes = comment.likes.filter((id) => id !== userId);
    } else {
      comment.likes.push(userId);
    }

    await post.save();
    const updated = await deepPopulateSpaceComments(req.params.id);
    res.json(updated.comments);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

router.post('/posts/:id/comment/:commentId/dislike', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const comment = findComment(post.comments, req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    const userId = req.user.id.toString();
    comment.likes = comment.likes.filter((id) => id !== userId);

    if (comment.dislikes.includes(userId)) {
      comment.dislikes = comment.dislikes.filter((id) => id !== userId);
    } else {
      comment.dislikes.push(userId);
    }

    await post.save();
    const updated = await deepPopulateSpaceComments(req.params.id);
    res.json(updated.comments);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

router.post('/posts/:id/comment/:commentId/save', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const comment = findComment(post.comments, req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    const userId = req.user.id.toString();
    if (!comment.saves) comment.saves = [];
    if (comment.saves.includes(userId)) {
      comment.saves = comment.saves.filter((id) => id !== userId);
    } else {
      comment.saves.push(userId);
    }

    await post.save();
    const updated = await deepPopulateSpaceComments(req.params.id);
    res.json(updated.comments);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

router.post('/posts/:id/comment/:commentId/award', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    const comment = findComment(post.comments, req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    const existingIdx = comment.awards.findIndex((a) => a.user.toString() === req.user.id);
    if (existingIdx > -1) {
      comment.awards.splice(existingIdx, 1);
    } else {
      comment.awards.push({ user: req.user.id, type: req.body.awardType || 'star' });
    }
    await post.save();
    const updated = await deepPopulateSpaceComments(req.params.id);
    res.json(updated.comments);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

router.delete('/posts/:id/comment/:commentId', [authMiddleware, parseAuthor], async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ msg: 'Post not found' });

    const comment = findComment(post.comments, req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    const isOwner = comment.author.toString() === req.user.id;
    const isPostOwner = post.author.toString() === req.user.id;
    const isAdmin = evaluateRequestPermission(req, PERMISSION.MODERATION_ACTION_CREATE).allowed;

    if (!isOwner && !isPostOwner && !isAdmin) {
      return res.status(403).json({ msg: 'Unauthorized' });
    }

    removeComment(post.comments, req.params.commentId);
    await post.save();
    const updated = await deepPopulateSpaceComments(req.params.id);
    res.json(updated.comments);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// ===========================================
// PROJECTS (Creative Space)
// ===========================================

// @route GET /api/space/projects
router.get('/projects', authMiddleware, async (req, res) => {
  try {
    const projects = await Project.find({ visibility: 'public' })
      .sort({ createdAt: -1 })
      .populate({ path: 'author', select: 'username companyName profilePictureUrl logo role' });
    res.json(projects);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route GET /api/space/projects/mine
router.get('/projects/mine', [authMiddleware, parseAuthor], async (req, res) => {
  try {
    const projects = await Project.find({ author: req.feedAuthor._id })
      .sort({ createdAt: -1 })
      .populate({ path: 'author', select: 'username companyName profilePictureUrl logo role' });
    res.json(projects);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route POST /api/space/projects
router.post('/projects', [authMiddleware, parseAuthor], async (req, res) => {
  try {
    if (req.feedAuthorType === 'User' && req.feedAuthor.isBanned) {
      return res.status(403).json({ msg: 'Your account is banned. You cannot create projects.' });
    }
    const { title, description, techStack, visibility, milestones } = req.body;
    if (!title || !description)
      return res.status(400).json({ msg: 'Title and description are required' });

    const project = new Project({
      title,
      description,
      techStack: Array.isArray(techStack)
        ? techStack
        : techStack
          ? techStack.split(',').map((s) => s.trim())
          : [],
      visibility: visibility || 'public',
      authorType: req.feedAuthorType,
      author: req.feedAuthor._id,
      milestones: Array.isArray(milestones) ? milestones : [],
    });

    await project.save();

    // Award XP
    if (req.feedAuthorType === 'User') {
      req.feedAuthor.points += 10;
      await req.feedAuthor.save();
    }

    await project.populate({
      path: 'author',
      select: 'username companyName profilePictureUrl logo role',
    });
    res.json(project);
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// @route PUT /api/space/projects/:id/milestone/:milestoneId
router.put(
  '/projects/:id/milestone/:milestoneId',
  [authMiddleware, parseAuthor],
  async (req, res) => {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ msg: 'Project not found' });
      if (project.author.toString() !== req.feedAuthor._id.toString())
        return res.status(403).json({ msg: 'Not authorized' });

      const milestone = project.milestones.id(req.params.milestoneId);
      if (!milestone) return res.status(404).json({ msg: 'Milestone not found' });

      milestone.completed = !milestone.completed;
      milestone.completedAt = milestone.completed ? new Date() : null;
      project.updatedAt = new Date();
      await project.save();
      await project.populate({
        path: 'author',
        select: 'username companyName profilePictureUrl logo role',
      });
      res.json(project);
    } catch (err) {
      res.status(500).send('Server Error');
    }
  },
);

// @route PUT /api/space/projects/:id/like
router.put('/projects/:id/like', authMiddleware, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ msg: 'Project not found' });
    const uid = req.user.id.toString();
    if (project.likes.map((l) => l.toString()).includes(uid)) {
      project.likes = project.likes.filter((l) => l.toString() !== uid);
    } else {
      project.likes.push(req.user.id);
    }
    await project.save();
    res.json({ likes: project.likes });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route DELETE /api/space/projects/:id
router.delete('/projects/:id', [authMiddleware, parseAuthor], async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ msg: 'Project not found' });
    const isOwner = project.author.toString() === req.feedAuthor._id.toString();
    const isAdmin = evaluateRequestPermission(req, PERMISSION.MODERATION_ACTION_CREATE).allowed;
    if (!isOwner && !isAdmin) return res.status(403).json({ msg: 'Not authorized' });
    await Project.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Project deleted' });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// ===========================================
// PROFILE & NETWORKING (Follow, Block)
// ===========================================

// @route GET /api/space/profile/me
router.get('/profile/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .populate('pendingFollowRequests', 'username profilePictureUrl companyName accountType role')
      .populate('followers', 'username profilePictureUrl companyName accountType role');
    const posts = await Post.find({ author: req.user.id }).sort({ createdAt: -1 });

    const savedPosts = await Post.find({ saves: req.user.id }).sort({ createdAt: -1 });

    // Find comments user made AND comments user saved inside ALL space posts
    const allPosts = await Post.find({
      $or: [
        { 'comments.author': req.user.id },
        { 'comments.saves': req.user.id }, // Note: nested replies with saves won't hit this outer query strictly, but for simplicity we fetch all and filter in JS if needed. Actually it's better to fetch all posts that either user interacted with or just process all if the DB isn't huge.
      ],
    });

    let userComments = [];
    let savedComments = [];

    // Let's just grab from entire collection if we want to be safe about deeply nested saves
    const allSystemPosts = await Post.find({});
    allSystemPosts.forEach((p) => {
      const processComments = (commentList) => {
        commentList.forEach((c) => {
          if (c.author.toString() === req.user.id) {
            userComments.push({
              postTitle: p.content.substring(0, 30) + '...',
              postId: p._id,
              ...c._doc,
            });
          }
          if (c.saves && c.saves.includes(req.user.id.toString())) {
            savedComments.push({
              postTitle: p.content.substring(0, 30) + '...',
              postId: p._id,
              ...c._doc,
            });
          }
          if (c.replies && c.replies.length > 0) processComments(c.replies);
        });
      };
      processComments(p.comments);
    });

    res.json({ profile: user, posts, userComments, savedPosts, savedComments });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route GET /api/space/profile/:id
router.get('/profile/:id', authMiddleware, async (req, res) => {
  try {
    let user = await User.findById(req.params.id).select('-password');

    // If not found in Users, check if it's a Company
    if (!user) {
      const company = await Company.findById(req.params.id).select('companyName logo');
      if (company) {
        return res.json({
          isCompany: true,
          profile: {
            _id: company._id,
            companyName: company.companyName,
            logo: company.logo,
            accountType: 'company',
          },
          posts: [],
          userComments: [],
        });
      }
      return res.status(404).json({ msg: 'User not found' });
    }

    const isOwner = req.user.id === req.params.id;
    const pSets = user.privacySettings || {};
    const isFollower = (user.followers || []).map((f) => f.toString()).includes(req.user.id);

    // Helper: check if viewer has access based on a privacy setting value
    const hasAccess = (setting) => {
      if (isOwner) return true;
      if (!setting || setting === 'everyone') return true;
      if (setting === 'followers_only') return isFollower;
      return false; // 'nobody'
    };

    const canViewPosts = hasAccess(pSets.whoCanViewPosts);
    const canViewComments = hasAccess(pSets.whoCanViewComments);
    const canViewProfile = hasAccess(pSets.whoCanViewProfileInfo);

    // Fetch posts only if allowed
    let posts = [];
    if (canViewPosts) {
      posts = await Post.find({ author: req.params.id }).sort({ createdAt: -1 });
    }

    // Fetch comments only if allowed
    let userComments = [];
    if (canViewComments) {
      const allPosts = await Post.find({ 'comments.author': req.params.id });
      allPosts.forEach((p) => {
        const processComments = (commentList) => {
          commentList.forEach((c) => {
            if (c.author.toString() === req.params.id) {
              userComments.push({
                postTitle: p.content.substring(0, 30) + '...',
                postId: p._id,
                ...c._doc,
              });
            }
            if (c.replies && c.replies.length > 0) processComments(c.replies);
          });
        };
        processComments(p.comments);
      });
    }

    // Redact profile info if not allowed
    let profileData = user.toObject();
    if (!canViewProfile) {
      profileData.points = undefined;
      profileData.followers = undefined;
      profileData.following = undefined;
    }

    res.json({ profile: profileData, posts, userComments });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route POST /api/space/network/follow/:id
router.post('/network/follow/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.id === req.params.id)
      return res.status(400).json({ msg: 'Cannot follow yourself' });

    const currentUser = await User.findById(req.user.id);
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ msg: 'User not found' });

    const isFollowing = currentUser.following.includes(req.params.id);
    const isPending = currentUser.sentFollowRequests.includes(req.params.id);

    let action = '';

    if (isFollowing) {
      // Unfollow
      currentUser.following.pull(req.params.id);
      targetUser.followers.pull(req.user.id);
      action = 'unfollowed';
    } else if (isPending) {
      // Cancel request
      currentUser.sentFollowRequests.pull(req.params.id);
      targetUser.pendingFollowRequests.pull(req.user.id);
      action = 'cancelled';
    } else {
      // Check privacy setting
      const whoCanFollow = targetUser.privacySettings?.whoCanFollow || 'everyone';
      if (whoCanFollow === 'nobody') {
        return res.status(403).json({ msg: 'This user does not accept followers.' });
      }

      if (whoCanFollow === 'request_required') {
        currentUser.sentFollowRequests.push(req.params.id);
        targetUser.pendingFollowRequests.push(req.user.id);
        action = 'requested';
      } else {
        currentUser.following.push(req.params.id);
        targetUser.followers.push(req.user.id);
        action = 'followed';
      }
    }

    await currentUser.save();
    await targetUser.save();

    res.json({
      action,
      following: currentUser.following,
      sentFollowRequests: currentUser.sentFollowRequests,
    });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route POST /api/space/network/follow-request/:id/:status
router.post('/network/follow-request/:id/:status', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    const sourceUser = await User.findById(req.params.id);

    if (!sourceUser) return res.status(404).json({ msg: 'User not found' });

    const { status } = req.params; // 'accept' or 'reject'

    if (!currentUser.pendingFollowRequests.includes(sourceUser._id)) {
      return res.status(400).json({ msg: 'No pending request from this user.' });
    }

    currentUser.pendingFollowRequests.pull(sourceUser._id);
    sourceUser.sentFollowRequests.pull(currentUser._id);

    if (status === 'accept') {
      currentUser.followers.push(sourceUser._id);
      sourceUser.following.push(currentUser._id);
    }

    await currentUser.save();
    await sourceUser.save();

    res.json({
      msg: `Request ${status}ed successfully.`,
      pendingFollowRequests: currentUser.pendingFollowRequests,
    });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route POST /api/space/network/block/:id
router.post('/network/block/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.id === req.params.id)
      return res.status(400).json({ msg: 'Cannot block yourself' });

    const currentUser = await User.findById(req.user.id);
    const isBlocked = currentUser.blockedUsers.includes(req.params.id);
    if (isBlocked) {
      currentUser.blockedUsers.pull(req.params.id);
    } else {
      currentUser.blockedUsers.push(req.params.id);
      // Optionally, remove from following/followers if blocking
      currentUser.following.pull(req.params.id);
      currentUser.followers.pull(req.params.id);
    }

    await currentUser.save();
    res.json({ isBlocked: !isBlocked, blockedUsers: currentUser.blockedUsers });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// @route POST /api/space/network/remove-follower/:id
// @desc Remove a user from your followers list
router.post('/network/remove-follower/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.id === req.params.id)
      return res.status(400).json({ msg: 'Cannot remove yourself' });

    const currentUser = await User.findById(req.user.id);
    const followerUser = await User.findById(req.params.id);

    if (!followerUser) return res.status(404).json({ msg: 'User not found' });

    if (!currentUser.followers.includes(req.params.id)) {
      return res.status(400).json({ msg: 'This user is not your follower.' });
    }

    // Remove them from my followers
    currentUser.followers.pull(req.params.id);
    // Remove me from their following
    followerUser.following.pull(req.user.id);

    await currentUser.save();
    await followerUser.save();

    res.json({ msg: 'Follower removed successfully.' });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

module.exports = router;
