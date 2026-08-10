'use strict';

const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded = (value, max) => String(value || '').trim().slice(0, max);

function createPostgresSpaceRouter({ pool, fileService = null }) {
  if (!pool) throw new Error('PostgreSQL pool is required for The Space.');
  const router = express.Router();
  router.use(authMiddleware);

  const authentication = (req) => req.identityAuthentication;
  async function userSummary(userId) {
    const result = await pool.query(
      `SELECT id,username,display_name,avatar_url,platform_role FROM users
       WHERE id=$1 AND status='active' AND deleted_at IS NULL`, [userId]);
    const row = result.rows[0];
    return row ? { _id: row.id, id: row.id, username: row.username || row.display_name, displayName: row.display_name,
      profilePictureUrl: row.avatar_url, avatarUrl: row.avatar_url, role: row.platform_role } : null;
  }

  async function commentDtos(postId) {
    const [comments, reactions, saves] = await Promise.all([
      pool.query(`SELECT sc.*,u.username,u.display_name,u.avatar_url,u.platform_role FROM social_comments sc
        LEFT JOIN users u ON u.id=sc.author_user_id WHERE sc.post_id=$1 ORDER BY sc.created_at`, [postId]),
      pool.query('SELECT comment_id,user_id,kind,award_type FROM social_comment_reactions WHERE comment_id IN (SELECT id FROM social_comments WHERE post_id=$1)', [postId]),
      pool.query('SELECT comment_id,user_id FROM social_comment_saves WHERE comment_id IN (SELECT id FROM social_comments WHERE post_id=$1)', [postId]),
    ]);
    const byId = new Map(comments.rows.map((row) => [row.id, { _id: row.id, content: row.content, text: row.content,
      createdAt: row.created_at, author: { _id: row.author_user_id, username: row.username || row.display_name,
        profilePictureUrl: row.avatar_url, role: row.platform_role }, likes: [], dislikes: [], saves: [], awards: [], replies: [] }]));
    for (const row of reactions.rows) {
      const dto = byId.get(row.comment_id); if (!dto) continue;
      if (row.kind === 'like') dto.likes.push(row.user_id);
      else if (row.kind === 'dislike') dto.dislikes.push(row.user_id);
      else if (row.kind === 'award') dto.awards.push({ user: row.user_id, type: row.award_type || 'star' });
    }
    for (const row of saves.rows) byId.get(row.comment_id)?.saves.push(row.user_id);
    const roots = [];
    for (const row of comments.rows) {
      const dto = byId.get(row.id);
      if (row.parent_id && byId.has(row.parent_id)) byId.get(row.parent_id).replies.push(dto); else roots.push(dto);
    }
    return roots;
  }

  async function postDto(row, req) {
    const [reactions, saves, media, comments] = await Promise.all([
      pool.query('SELECT user_id,kind,award_type FROM social_post_reactions WHERE post_id=$1', [row.id]),
      pool.query('SELECT user_id FROM social_post_saves WHERE post_id=$1', [row.id]),
      pool.query('SELECT id,file_id,kind,legacy_url FROM social_post_media WHERE post_id=$1 ORDER BY position', [row.id]),
      commentDtos(row.id),
    ]);
    const attachments = [];
    for (const item of media.rows) {
      let url = item.legacy_url;
      if (!url && item.file_id && fileService) {
        try { url = (await fileService.createDownload(authentication(req), item.file_id)).url; } catch { url = null; }
      }
      if (url) attachments.push({ _id: item.id, type: item.kind, url });
    }
    return { _id: row.id, id: row.id, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at,
      authorType: 'User', author: { _id: row.author_user_id, username: row.username || row.display_name,
        displayName: row.display_name, profilePictureUrl: row.avatar_url, role: row.platform_role },
      attachments, comments, likes: reactions.rows.filter((x) => x.kind === 'like').map((x) => x.user_id),
      dislikes: reactions.rows.filter((x) => x.kind === 'dislike').map((x) => x.user_id),
      awards: reactions.rows.filter((x) => x.kind === 'award').map((x) => ({ user: x.user_id, type: x.award_type || 'star' })),
      saves: saves.rows.map((x) => x.user_id) };
  }

  async function getPostRow(postId) {
    if (!UUID.test(postId)) return null;
    const result = await pool.query(`SELECT sp.*,u.username,u.display_name,u.avatar_url,u.platform_role
      FROM social_posts sp JOIN users u ON u.id=sp.author_user_id WHERE sp.id=$1`, [postId]);
    return result.rows[0] || null;
  }

  router.get('/leaderboard', async (_req, res, next) => {
    try {
      const result = await pool.query(`SELECT u.id AS _id,u.username,u.display_name,u.avatar_url AS profile_picture_url,
        COALESCE(lp.points,0)::int AS score FROM users u LEFT JOIN learning_profiles lp ON lp.user_id=u.id
        WHERE u.status='active' AND u.deleted_at IS NULL ORDER BY COALESCE(lp.points,0) DESC,u.created_at LIMIT 20`);
      res.json(result.rows);
    } catch (error) { next(error); }
  });

  router.get('/posts', async (req, res, next) => {
    try {
      const userId = req.user.id;
      const params = [userId];
      let feed = '';
      if (req.query.feedType === 'following') feed = "AND EXISTS (SELECT 1 FROM social_relationships sr WHERE sr.source_user_id=$1 AND sr.target_user_id=sp.author_user_id AND sr.status='following')";
      const result = await pool.query(`SELECT sp.*,u.username,u.display_name,u.avatar_url,u.platform_role
        FROM social_posts sp JOIN users u ON u.id=sp.author_user_id LEFT JOIN social_profiles spr ON spr.user_id=sp.author_user_id
        WHERE NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=sp.author_user_id) OR (b.blocker_user_id=sp.author_user_id AND b.blocked_user_id=$1))
        AND (sp.author_user_id=$1 OR COALESCE(spr.privacy_settings->>'whoCanViewPosts','everyone')='everyone'
          OR (COALESCE(spr.privacy_settings->>'whoCanViewPosts','everyone')='followers' AND EXISTS (SELECT 1 FROM social_relationships sr WHERE sr.source_user_id=$1 AND sr.target_user_id=sp.author_user_id AND sr.status='following'))
          OR (COALESCE(spr.privacy_settings->>'whoCanViewPosts','everyone')='friends' AND EXISTS (SELECT 1 FROM social_relationships sr WHERE sr.source_user_id=$1 AND sr.target_user_id=sp.author_user_id AND sr.status='following') AND EXISTS (SELECT 1 FROM social_relationships sr2 WHERE sr2.source_user_id=sp.author_user_id AND sr2.target_user_id=$1 AND sr2.status='following')))
        ${feed} ORDER BY sp.created_at DESC LIMIT 50`, params);
      res.json(await Promise.all(result.rows.map((row) => postDto(row, req))));
    } catch (error) { next(error); }
  });

  router.post('/posts', async (req, res, next) => {
    const content = bounded(req.body?.content, 20000);
    const fileIds = [...new Set(Array.isArray(req.body?.fileIds) ? req.body.fileIds.slice(0, 8) : [])];
    if (!content && !fileIds.length) return res.status(400).json({ error: { code: 'post_empty' } });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (fileIds.length) {
        const valid = await client.query(`SELECT COUNT(*)::int AS count FROM files WHERE id=ANY($1::uuid[])
          AND owner_user_id=$2 AND purpose='social_image' AND state='ready' AND scan_status='clean' AND visibility='public'`, [fileIds, req.user.id]);
        if (valid.rows[0].count !== fileIds.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: { code: 'post_media_not_ready' } });
        }
      }
      const created = await client.query('INSERT INTO social_posts (author_user_id,content) VALUES ($1,$2) RETURNING *', [req.user.id, content]);
      for (let i = 0; i < fileIds.length; i += 1) await client.query(
        `INSERT INTO social_post_media (post_id,file_id,kind,position) VALUES ($1,$2,'image',$3)`, [created.rows[0].id, fileIds[i], i]);
      await client.query('COMMIT');
      const row = await getPostRow(created.rows[0].id);
      res.status(201).json(await postDto(row, req));
    } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
  });

  router.delete('/posts/:postId', async (req, res, next) => {
    try {
      const role = req.identityAuthentication?.user?.platformRole;
      const result = await pool.query(`DELETE FROM social_posts WHERE id=$1 AND (author_user_id=$2 OR $3 IN ('moderator','superadmin')) RETURNING id`, [req.params.postId, req.user.id, role || '']);
      if (!result.rowCount) return res.status(404).json({ error: { code: 'post_not_found' } });
      res.json({ msg: 'Post deleted' });
    } catch (error) { next(error); }
  });

  router.put('/posts/:postId/:action', async (req, res, next) => {
    const { action } = req.params;
    if (!['like','dislike','save'].includes(action)) return res.status(400).json({ error: { code: 'invalid_action' } });
    try {
      if (action === 'save') {
        const removed = await pool.query('DELETE FROM social_post_saves WHERE post_id=$1 AND user_id=$2 RETURNING post_id', [req.params.postId, req.user.id]);
        if (!removed.rowCount) await pool.query('INSERT INTO social_post_saves (post_id,user_id) VALUES ($1,$2)', [req.params.postId, req.user.id]);
      } else {
        const removed = await pool.query('DELETE FROM social_post_reactions WHERE post_id=$1 AND user_id=$2 AND kind=$3 RETURNING post_id', [req.params.postId, req.user.id, action]);
        if (!removed.rowCount) await pool.query(`INSERT INTO social_post_reactions (post_id,user_id,kind) VALUES ($1,$2,$3)
          ON CONFLICT (post_id,user_id,kind) DO NOTHING`, [req.params.postId, req.user.id, action]);
        await pool.query('DELETE FROM social_post_reactions WHERE post_id=$1 AND user_id=$2 AND kind=$3', [req.params.postId, req.user.id, action === 'like' ? 'dislike' : 'like']);
      }
      const [likes, dislikes, saves] = await Promise.all([
        pool.query("SELECT user_id FROM social_post_reactions WHERE post_id=$1 AND kind='like'", [req.params.postId]),
        pool.query("SELECT user_id FROM social_post_reactions WHERE post_id=$1 AND kind='dislike'", [req.params.postId]),
        pool.query('SELECT user_id FROM social_post_saves WHERE post_id=$1', [req.params.postId]),
      ]);
      res.json({ likes: likes.rows.map((x) => x.user_id), dislikes: dislikes.rows.map((x) => x.user_id), saves: saves.rows.map((x) => x.user_id) });
    } catch (error) { next(error); }
  });

  router.post('/posts/:postId/award', async (req, res, next) => {
    try {
      await pool.query(`INSERT INTO social_post_reactions (post_id,user_id,kind,award_type) VALUES ($1,$2,'award',$3)
        ON CONFLICT (post_id,user_id,kind) DO UPDATE SET award_type=EXCLUDED.award_type`, [req.params.postId, req.user.id, bounded(req.body?.awardType || 'diamond', 32)]);
      const result = await pool.query("SELECT user_id AS user,award_type AS type FROM social_post_reactions WHERE post_id=$1 AND kind='award'", [req.params.postId]);
      res.json(result.rows);
    } catch (error) { next(error); }
  });

  router.post('/posts/:postId/comment', async (req, res, next) => {
    const content = bounded(req.body?.content || req.body?.text, 10000);
    if (!content) return res.status(400).json({ error: { code: 'comment_empty' } });
    try {
      await pool.query('INSERT INTO social_comments (post_id,author_user_id,content) VALUES ($1,$2,$3)', [req.params.postId, req.user.id, content]);
      res.status(201).json(await commentDtos(req.params.postId));
    } catch (error) { next(error); }
  });

  router.post('/posts/:postId/comment/:commentId/reply', async (req, res, next) => {
    const content = bounded(req.body?.content || req.body?.text, 10000);
    if (!content) return res.status(400).json({ error: { code: 'comment_empty' } });
    try {
      const result = await pool.query(`INSERT INTO social_comments (post_id,parent_id,author_user_id,content)
        SELECT $1,id,$3,$4 FROM social_comments WHERE id=$2 AND post_id=$1 RETURNING id`, [req.params.postId, req.params.commentId, req.user.id, content]);
      if (!result.rowCount) return res.status(404).json({ error: { code: 'comment_not_found' } });
      res.status(201).json(await commentDtos(req.params.postId));
    } catch (error) { next(error); }
  });

  router.post('/posts/:postId/comment/:commentId/:action', async (req, res, next) => {
    const { action } = req.params;
    if (!['like','dislike','save','award'].includes(action)) return res.status(400).json({ error: { code: 'invalid_action' } });
    try {
      if (action === 'save') {
        const removed = await pool.query('DELETE FROM social_comment_saves WHERE comment_id=$1 AND user_id=$2 RETURNING comment_id', [req.params.commentId, req.user.id]);
        if (!removed.rowCount) await pool.query('INSERT INTO social_comment_saves (comment_id,user_id) VALUES ($1,$2)', [req.params.commentId, req.user.id]);
      } else {
        const awardType = action === 'award' ? bounded(req.body?.awardType || 'star', 32) : null;
        await pool.query(`INSERT INTO social_comment_reactions (comment_id,user_id,kind,award_type) VALUES ($1,$2,$3,$4)
          ON CONFLICT (comment_id,user_id,kind) DO UPDATE SET award_type=EXCLUDED.award_type`, [req.params.commentId, req.user.id, action, awardType]);
        if (action === 'like' || action === 'dislike') await pool.query('DELETE FROM social_comment_reactions WHERE comment_id=$1 AND user_id=$2 AND kind=$3', [req.params.commentId, req.user.id, action === 'like' ? 'dislike' : 'like']);
      }
      res.json(await commentDtos(req.params.postId));
    } catch (error) { next(error); }
  });

  router.delete('/posts/:postId/comment/:commentId', async (req, res, next) => {
    try {
      const role = req.identityAuthentication?.user?.platformRole;
      const result = await pool.query(`DELETE FROM social_comments WHERE id=$1 AND post_id=$2
        AND (author_user_id=$3 OR $4 IN ('moderator','superadmin')) RETURNING id`, [req.params.commentId, req.params.postId, req.user.id, role || '']);
      if (!result.rowCount) return res.status(404).json({ error: { code: 'comment_not_found' } });
      res.json(await commentDtos(req.params.postId));
    } catch (error) { next(error); }
  });

  async function profileDto(targetUserId, req) {
    const profile = await userSummary(targetUserId); if (!profile) return null;
    const [following, followers, pending, sent] = await Promise.all([
      pool.query("SELECT target_user_id AS id FROM social_relationships WHERE source_user_id=$1 AND status='following'", [targetUserId]),
      pool.query("SELECT source_user_id AS id FROM social_relationships WHERE target_user_id=$1 AND status='following'", [targetUserId]),
      pool.query("SELECT source_user_id AS id FROM social_relationships WHERE target_user_id=$1 AND status='requested'", [targetUserId]),
      pool.query("SELECT target_user_id AS id FROM social_relationships WHERE source_user_id=$1 AND status='requested'", [targetUserId]),
    ]);
    const currentFollows = await pool.query("SELECT 1 FROM social_relationships WHERE source_user_id=$1 AND target_user_id=$2 AND status='following'", [req.user.id, targetUserId]);
    return { ...profile, following: following.rows.map((x) => x.id), followers: await Promise.all(followers.rows.map((x) => userSummary(x.id))),
      pendingFollowRequests: await Promise.all(pending.rows.map((x) => userSummary(x.id))), sentFollowRequests: sent.rows.map((x) => x.id),
      isFollowing: currentFollows.rowCount > 0 };
  }

  async function profilePayload(targetUserId, req) {
    const profile = await profileDto(targetUserId, req); if (!profile) return null;
    const own = targetUserId === req.user.id;
    const privacyResult = await pool.query('SELECT privacy_settings FROM social_profiles WHERE user_id=$1', [targetUserId]);
    const privacy = privacyResult.rows[0]?.privacy_settings || {};
    const currentFollows = profile.isFollowing;
    const targetFollows = profile.following.includes(req.user.id);
    const allowed = (policy = 'everyone') => own || policy === 'everyone' || (policy === 'followers' && currentFollows) || (policy === 'friends' && currentFollows && targetFollows);
    if (!allowed(privacy.whoCanViewProfileInfo)) return null;
    const postRows = allowed(privacy.whoCanViewPosts) ? await pool.query(`SELECT sp.*,u.username,u.display_name,u.avatar_url,u.platform_role FROM social_posts sp
      JOIN users u ON u.id=sp.author_user_id WHERE sp.author_user_id=$1 ORDER BY sp.created_at DESC LIMIT 50`, [targetUserId]) : { rows: [] };
    const posts = await Promise.all(postRows.rows.map((row) => postDto(row, req)));
    const comments = allowed(privacy.whoCanViewComments) ? await pool.query('SELECT id AS _id,post_id,content,created_at AS "createdAt" FROM social_comments WHERE author_user_id=$1 ORDER BY created_at DESC LIMIT 100', [targetUserId]) : { rows: [] };
    const savedRows = own ? await pool.query(`SELECT sp.*,u.username,u.display_name,u.avatar_url,u.platform_role FROM social_post_saves s
      JOIN social_posts sp ON sp.id=s.post_id JOIN users u ON u.id=sp.author_user_id WHERE s.user_id=$1 ORDER BY s.created_at DESC`, [targetUserId]) : { rows: [] };
    return { profile, posts, userComments: comments.rows, savedPosts: await Promise.all(savedRows.rows.map((row) => postDto(row, req))), savedComments: [] };
  }

  router.get('/profile/me', async (req, res, next) => { try { res.json(await profilePayload(req.user.id, req)); } catch (error) { next(error); } });
  router.get('/profile/:userId', async (req, res, next) => { try { const value = await profilePayload(req.params.userId, req); if (!value) return res.status(404).json({ error: { code: 'profile_not_found' } }); res.json(value); } catch (error) { next(error); } });

  router.post('/network/follow/:userId', async (req, res, next) => {
    if (req.params.userId === req.user.id) return res.status(400).json({ error: { code: 'cannot_follow_self' } });
    try {
      const blocked = await pool.query('SELECT 1 FROM user_blocks WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1)', [req.user.id, req.params.userId]);
      if (blocked.rowCount) return res.status(403).json({ error: { code: 'relationship_blocked' } });
      const removed = await pool.query('DELETE FROM social_relationships WHERE source_user_id=$1 AND target_user_id=$2 RETURNING status', [req.user.id, req.params.userId]);
      if (!removed.rowCount) {
        const privacy = await pool.query('SELECT privacy_settings FROM social_profiles WHERE user_id=$1', [req.params.userId]);
        const policy = privacy.rows[0]?.privacy_settings?.whoCanFollow || 'everyone';
        if (policy === 'nobody') return res.status(403).json({ error: { code: 'follow_not_permitted' } });
        const status = policy === 'everyone' ? 'following' : 'requested';
        await pool.query(`INSERT INTO social_relationships (source_user_id,target_user_id,status) VALUES ($1,$2,$3)`, [req.user.id, req.params.userId, status]);
      }
      const profile = await profileDto(req.user.id, req); res.json(profile);
    } catch (error) { next(error); }
  });
  router.post('/network/follow-request/:userId/:action', async (req, res, next) => {
    try {
      if (req.params.action === 'accept') await pool.query(`UPDATE social_relationships SET status='following',updated_at=NOW() WHERE source_user_id=$1 AND target_user_id=$2 AND status='requested'`, [req.params.userId, req.user.id]);
      else if (req.params.action === 'reject') await pool.query(`DELETE FROM social_relationships WHERE source_user_id=$1 AND target_user_id=$2 AND status='requested'`, [req.params.userId, req.user.id]);
      else return res.status(400).json({ error: { code: 'invalid_action' } });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  router.post('/network/block/:userId', async (req, res, next) => {
    try {
      const removed = await pool.query('DELETE FROM user_blocks WHERE blocker_user_id=$1 AND blocked_user_id=$2 RETURNING blocked_user_id', [req.user.id, req.params.userId]);
      if (!removed.rowCount) {
        await pool.query('INSERT INTO user_blocks (blocker_user_id,blocked_user_id) VALUES ($1,$2)', [req.user.id, req.params.userId]);
        await pool.query('DELETE FROM social_relationships WHERE (source_user_id=$1 AND target_user_id=$2) OR (source_user_id=$2 AND target_user_id=$1)', [req.user.id, req.params.userId]);
      }
      res.json({ isBlocked: !removed.rowCount });
    } catch (error) { next(error); }
  });
  router.delete('/network/remove-follower/:userId', async (req, res, next) => { try { await pool.query('DELETE FROM social_relationships WHERE source_user_id=$1 AND target_user_id=$2', [req.params.userId, req.user.id]); res.json({ ok: true }); } catch (error) { next(error); } });
  router.post('/network/remove-follower/:userId', async (req, res, next) => { try { await pool.query('DELETE FROM social_relationships WHERE source_user_id=$1 AND target_user_id=$2', [req.params.userId, req.user.id]); res.json({ ok: true }); } catch (error) { next(error); } });

  async function projectDto(row) {
    const [author, milestones, reactions] = await Promise.all([userSummary(row.author_user_id), pool.query('SELECT id AS _id,title,description,completed,completed_at AS "completedAt" FROM idea_milestones WHERE idea_id=$1 ORDER BY position', [row.id]), pool.query("SELECT user_id FROM idea_reactions WHERE idea_id=$1 AND kind='like'", [row.id])]);
    return { _id: row.id, id: row.id, title: row.title, description: row.description, techStack: Array.isArray(row.tech_stack) ? row.tech_stack.join(', ') : row.tech_stack, visibility: row.visibility, createdAt: row.created_at, author, milestones: milestones.rows, likes: reactions.rows.map((x) => x.user_id) };
  }
  router.get('/projects', async (req, res, next) => { try { const result = await pool.query(`SELECT * FROM ideas WHERE visibility='public' OR author_user_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.user.id]); res.json(await Promise.all(result.rows.map(projectDto))); } catch (error) { next(error); } });
  router.post('/projects', async (req, res, next) => {
    const title = bounded(req.body?.title, 255), description = bounded(req.body?.description, 50000);
    if (!title || !description) return res.status(400).json({ error: { code: 'invalid_project' } });
    const client = await pool.connect(); try { await client.query('BEGIN'); const created = await client.query(`INSERT INTO ideas (author_user_id,title,description,tech_stack,visibility) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *`, [req.user.id,title,description,JSON.stringify(String(req.body?.techStack || '').split(',').map((x) => x.trim()).filter(Boolean)),req.body?.visibility === 'private' ? 'private' : 'public']); for (let i=0;i<(req.body?.milestones || []).slice(0,100).length;i+=1) await client.query('INSERT INTO idea_milestones (idea_id,title,position) VALUES ($1,$2,$3)',[created.rows[0].id,bounded(req.body.milestones[i].title,255),i]); await client.query('COMMIT'); res.status(201).json(await projectDto(created.rows[0])); } catch(error){await client.query('ROLLBACK');next(error);}finally{client.release();}
  });
  router.delete('/projects/:projectId', async (req,res,next)=>{try{const result=await pool.query('DELETE FROM ideas WHERE id=$1 AND author_user_id=$2 RETURNING id',[req.params.projectId,req.user.id]);if(!result.rowCount)return res.status(404).json({error:{code:'project_not_found'}});res.json({ok:true});}catch(error){next(error);}});
  router.put('/projects/:projectId/milestone/:milestoneId', async (req,res,next)=>{try{const result=await pool.query(`UPDATE idea_milestones m SET completed=NOT completed,completed_at=CASE WHEN NOT completed THEN NOW() END FROM ideas i WHERE m.id=$1 AND m.idea_id=$2 AND i.id=m.idea_id AND i.author_user_id=$3 RETURNING i.*`,[req.params.milestoneId,req.params.projectId,req.user.id]);if(!result.rowCount)return res.status(404).json({error:{code:'milestone_not_found'}});res.json(await projectDto(result.rows[0]));}catch(error){next(error);}});
  router.put('/projects/:projectId/like', async (req,res,next)=>{try{const removed=await pool.query("DELETE FROM idea_reactions WHERE idea_id=$1 AND user_id=$2 AND kind='like' RETURNING idea_id",[req.params.projectId,req.user.id]);if(!removed.rowCount)await pool.query("INSERT INTO idea_reactions (idea_id,user_id,kind) VALUES ($1,$2,'like')",[req.params.projectId,req.user.id]);const likes=await pool.query("SELECT user_id FROM idea_reactions WHERE idea_id=$1 AND kind='like'",[req.params.projectId]);res.json({likes:likes.rows.map((x)=>x.user_id)});}catch(error){next(error);}});

  return router;
}

module.exports = { createPostgresSpaceRouter };
