import { useState, useEffect, useContext, useRef } from 'react';
import defaultAvatarUrl from '../assets/images/default-avatar.svg';
import axios, { assetUrl } from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import AppDropdown from '../components/AppDropdown';
import ScrollTrackRow from '../components/ScrollTrackRow';
import { AsyncState } from '../components/ui/AsyncState';
import { AccessibleMedia } from '../components/ui/AccessibleMedia';
import { AccessibleDialog } from '../components/ui/AccessibleDialog';
const timeAgo = (date) => {
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

const awardIcons = {
  star: { icon: '⭐', label: 'Star' },
  fire: { icon: '🔥', label: 'Fire' },
  heart: { icon: '❤️', label: 'Heart' },
  rocket: { icon: '🚀', label: 'Rocket' },
  diamond: { icon: '💎', label: 'Diamond' },
};

const SpaceComment = ({ comment, postId, token, onAction, depth = 0 }) => {
  const { user } = useContext(AuthContext);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showAwardPicker, setShowAwardPicker] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const hasUpvoted = comment.likes?.includes(user?._id);
  const hasDownvoted = comment.dislikes?.includes(user?._id);
  const authorName = comment.author?.username || comment.author?.companyName || 'Unknown';
  const authorInitial = authorName.charAt(0).toUpperCase();

  const profilePic =
    comment.author?.profilePictureUrl?.startsWith('/uploads') ||
    comment.author?.logo?.startsWith('/uploads')
      ? assetUrl(comment.author.profilePictureUrl || comment.author.logo)
      : comment.author?.profilePictureUrl || comment.author?.logo;

  const handleVote = async (isLike) => {
    const route = isLike ? 'like' : 'dislike';
    try {
      const res = await axios.post(
        `/api/space/posts/${postId}/comment/${comment._id}/${route}`,
        {},
      );
      onAction(postId, res.data); // backend route needs to return updated comments array or we refresh posts
    } catch {
      console.error('Failed to vote on comment');
    }
  };

  const handleReplySubmit = async (e) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    try {
      const res = await axios.post(`/api/space/posts/${postId}/comment/${comment._id}/reply`, {
        text: replyText,
      });
      setReplyText('');
      setShowReply(false);
      onAction(postId, res.data);
    } catch {
      console.error('Failed to post reply');
    }
  };

  const handleAward = async (awardType) => {
    try {
      const res = await axios.post(`/api/space/posts/${postId}/comment/${comment._id}/award`, {
        awardType,
      });
      setShowAwardPicker(false);
      onAction(postId, res.data);
    } catch {
      console.error('Failed to award comment');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this comment? This cannot be undone.')) return;
    try {
      const res = await axios.delete(`/api/space/posts/${postId}/comment/${comment._id}`);
      onAction(postId, res.data);
    } catch {
      console.error('Failed to delete comment');
    }
  };

  // Fix context logic for auth checks - matching Space feed logic
  const isCompany = user?.accountType === 'company';
  const isAuthor = user?._id === (comment.author?._id || comment.author);
  const canDelete =
    isAuthor || (!isCompany && (user?.role === 'superadmin' || user?.role === 'moderator'));

  const awardCounts = {};
  (comment.awards || []).forEach((a) => {
    const t = a.type || 'star';
    awardCounts[t] = (awardCounts[t] || 0) + 1;
  });

  return (
    <div className={`reddit-comment ${depth > 0 ? 'nested' : ''}`} id={`comment-${comment._id}`}>
      <div className="comment-left-col">
        {profilePic ? (
          <img src={profilePic} alt="" className="comment-avatar" />
        ) : (
          <div className="comment-avatar-placeholder">{authorInitial}</div>
        )}
        {comment.replies?.length > 0 && !collapsed && (
          <button
            aria-label="Collapse comment replies"
            className="thread-line-container"
            onClick={() => setCollapsed(!collapsed)}
            type="button"
          >
            <span className="thread-line" />
          </button>
        )}
      </div>

      <div className="comment-right-col">
        <div className="comment-meta">
          <button
            className="comment-username cwm-text-button"
            onClick={() => window.openProfileModal && window.openProfileModal(comment.author?._id)}
            type="button"
          >
            {authorName}
          </button>
          {comment.author?.companyName && (
            <span
              className="company-badge"
              style={{ marginLeft: '0.4rem', fontSize: '0.55rem', padding: '0.1rem 0.3rem' }}
            >
              COMPANY
            </span>
          )}
          {comment.author?.role === 'superadmin' && (
            <span
              className="admin-badge"
              style={{ marginLeft: '0.4rem', fontSize: '0.55rem', padding: '0.1rem 0.3rem' }}
            >
              ADMIN
            </span>
          )}
          {comment.author?.role === 'moderator' && (
            <span
              className="mod-badge"
              style={{ marginLeft: '0.4rem', fontSize: '0.55rem', padding: '0.1rem 0.3rem' }}
            >
              MOD
            </span>
          )}
          <span className="comment-separator" style={{ marginLeft: '0.4rem' }}>
            •
          </span>
          <span className="comment-time">{timeAgo(comment.createdAt)}</span>
          {Object.keys(awardCounts).length > 0 && (
            <span className="comment-awards-inline">
              {Object.entries(awardCounts).map(([type, count]) => (
                <span
                  key={type}
                  className="award-badge"
                  title={`${awardIcons[type]?.label} x${count}`}
                >
                  {awardIcons[type]?.icon}
                  {count > 1 && <span className="award-count">{count}</span>}
                </span>
              ))}
            </span>
          )}
        </div>

        {!collapsed ? (
          <>
            {/* the feed models call text 'content', let's support both */}
            <div className="comment-text">{comment.content || comment.text}</div>
            <div className="comment-action-bar">
              <button
                className="action-btn collapse-btn"
                onClick={() => setCollapsed(true)}
                title="Collapse thread"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </button>
              <button
                className={`action-btn vote-up ${hasUpvoted ? 'voted-up' : ''}`}
                onClick={() => handleVote(true)}
                title="Upvote"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                >
                  <path d="M12 5l-7 7h4.5v7h5v-7H19z" />
                </svg>
                <span className="upvote-count">{comment.likes?.length || 0}</span>
              </button>
              <button
                className={`action-btn vote-down ${hasDownvoted ? 'voted-down' : ''}`}
                onClick={() => handleVote(false)}
                title="Downvote"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                >
                  <path d="M12 19l7-7h-4.5V5h-5v7H5z" />
                </svg>
                <span className="downvote-count">{comment.dislikes?.length || 0}</span>
              </button>
              <button className="action-btn" onClick={() => setShowReply(!showReply)}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
                Reply
              </button>
              <button className="action-btn" onClick={() => setShowAwardPicker(!showAwardPicker)}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <circle cx="12" cy="8" r="6" />
                  <path d="M8.5 14L7 22l5-3 5 3-1.5-8" />
                </svg>
                Award
              </button>
              <button
                className={`action-btn ${comment.saves?.includes(user?._id) ? 'active-save' : ''}`}
                onClick={async () => {
                  try {
                    const res = await axios.post(
                      `/api/space/posts/${postId}/comment/${comment._id}/save`,
                      {},
                    );
                    onAction(postId, res.data);
                  } catch {
                    // Preserve the current UI; the user may retry the save action.
                  }
                }}
              >
                🔖 {comment.saves?.includes(user?._id) ? 'Unsave' : 'Save'}
              </button>
              {canDelete && (
                <>
                  <div className="action-spacer" />
                  <button
                    className="action-btn delete-btn"
                    onClick={handleDelete}
                    title="Delete comment"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                      <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                    Delete
                  </button>
                </>
              )}
            </div>

            {showAwardPicker && (
              <div className="award-picker">
                {Object.entries(awardIcons).map(([type, { icon, label }]) => (
                  <button
                    key={type}
                    onClick={() => handleAward(type)}
                    title={label}
                    className="award-option"
                  >
                    <span className="award-icon-large">{icon}</span>
                    <span className="award-label-text">{label}</span>
                  </button>
                ))}
              </div>
            )}

            {showReply && (
              <form onSubmit={handleReplySubmit} className="reply-form">
                <textarea
                  aria-label={`Reply to ${authorName}`}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${authorName}...`}
                  autoFocus
                />
                <div className="reply-form-actions">
                  <button type="button" className="cancel-btn" onClick={() => setShowReply(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="submit-reply-btn" disabled={!replyText.trim()}>
                    Reply
                  </button>
                </div>
              </form>
            )}

            {comment.replies && comment.replies.length > 0 && (
              <div className="comment-replies">
                {comment.replies.map((reply) => (
                  <SpaceComment
                    key={reply._id}
                    comment={reply}
                    postId={postId}
                    token={token}
                    onAction={onAction}
                    depth={depth + 1}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <button className="collapsed-indicator" onClick={() => setCollapsed(false)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            {comment.replies?.length || 0} more{' '}
            {comment.replies?.length === 1 ? 'reply' : 'replies'}
          </button>
        )}
      </div>
    </div>
  );
};

const Space = () => {
  const { token, user } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('feed'); // 'feed', 'leaderboards', 'projects', 'profile'

  // Data State
  const [leaderboard, setLeaderboard] = useState([]);
  const [posts, setPosts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Draft State
  const [draftContent, setDraftContent] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isPosting, setIsPosting] = useState(false);
  const [expandedComments, setExpandedComments] = useState({});
  const [commentText, setCommentText] = useState({});
  const fileInputRef = useRef(null);

  // Project Draft State
  const [projectDraft, setProjectDraft] = useState({
    title: '',
    description: '',
    techStack: '',
    visibility: 'public',
    milestones: '',
  });
  const [creatingProject, setCreatingProject] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);

  const isCompany = user?.accountType === 'company';
  const isBanned = user?.isBanned;

  // Filtering & Sorting State
  const [feedType, setFeedType] = useState('public');
  const [feedSort, setFeedSort] = useState('newest');
  const [feedTime, setFeedTime] = useState('all');

  const [lbTime, setLbTime] = useState('all');
  const [lbFilter, setLbFilter] = useState('points');

  const [myProfileData, setMyProfileData] = useState({
    profile: null,
    posts: [],
    comments: [],
    savedPosts: [],
    savedComments: [],
  });
  const [profileSubTab, setProfileSubTab] = useState('mine'); // 'mine', 'saved', 'requests'

  // User Profile Modal State
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [viewingProfile, setViewingProfile] = useState(null);
  const [localFollowing, setLocalFollowing] = useState([]);
  const [localPending, setLocalPending] = useState([]);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [chatFabPos, setChatFabPos] = useState(() => {
    try {
      const s = localStorage.getItem('spaceChatFabPos');
      return s ? JSON.parse(s) : { bottom: 90, right: 86 };
    } catch {
      return { bottom: 90, right: 86 };
    }
  });

  const handleChatFabMouseDown = (e) => {
    if (e.button && e.button !== 0) return;
    const startX = e.clientX || e.touches?.[0]?.clientX;
    const startY = e.clientY || e.touches?.[0]?.clientY;
    const startPos = { ...chatFabPos };
    let moved = false;
    const onMove = (ev) => {
      const cx = ev.clientX || ev.touches?.[0]?.clientX;
      const cy = ev.clientY || ev.touches?.[0]?.clientY;
      if (Math.abs(cx - startX) > 8 || Math.abs(cy - startY) > 8) moved = true;
      if (moved) {
        setChatFabPos({
          right: Math.max(0, startPos.right - (cx - startX)),
          bottom: Math.max(0, startPos.bottom - (cy - startY)),
        });
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      if (!moved) {
        setShowChatMenu((prev) => !prev);
      }
      setChatFabPos((prev) => {
        localStorage.setItem('spaceChatFabPos', JSON.stringify(prev));
        return prev;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  };

  useEffect(() => {
    if (user && user.following) setLocalFollowing(user.following);
    if (user && user.sentFollowRequests) setLocalPending(user.sentFollowRequests);
  }, [user]);

  // Make global helper for SpaceComment to use since we can't easily pass it
  window.openProfileModal = (id) => {
    if (id) setSelectedUserId(id);
  };

  // Re-fetch posts when feed filters change
  useEffect(() => {
    if (!token) return;
    fetchPosts();
  }, [feedType, feedSort, feedTime]);

  // Re-fetch leaderboard when LB filters change
  useEffect(() => {
    if (!token) return;
    fetchLeaderboard();
  }, [lbTime, lbFilter]);

  useEffect(() => {
    if (!token) return;
    fetchAllData();
  }, [token]);

  const fetchPosts = async () => {
    try {
      const res = await axios.get(
        `/api/space/posts?feedType=${feedType}&sort=${feedSort}&timeframe=${feedTime}`,
      );
      setPosts(res.data);
    } catch {
      console.error('Failed to fetch posts');
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const res = await axios.get(`/api/space/leaderboard?timeframe=${lbTime}&filter=${lbFilter}`);
      setLeaderboard(res.data);
    } catch {
      console.error('Failed to fetch leaderboard');
    }
  };

  const fetchMyProfile = async () => {
    try {
      const res = await axios.get('/api/space/profile/me');
      setMyProfileData({
        profile: res.data.profile,
        posts: res.data.posts,
        comments: res.data.userComments,
        savedPosts: res.data.savedPosts || [],
        savedComments: res.data.savedComments || [],
      });
    } catch {
      console.error('Failed to fetch my profile');
    }
  };

  const handleFollowRequest = async (userId, action) => {
    try {
      await axios.post(`/api/space/network/follow-request/${userId}/${action}`, {});
      setMyProfileData((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          pendingFollowRequests: prev.profile.pendingFollowRequests.filter((r) => r._id !== userId),
        },
      }));
      fetchPosts();
    } catch {
      alert('Failed to process request');
    }
  };

  useEffect(() => {
    if (activeTab === 'profile') fetchMyProfile();
  }, [activeTab]);

  useEffect(() => {
    if (selectedUserId) {
      axios
        .get(`/api/space/profile/${selectedUserId}`)
        .then((res) => {
          if (res.data.isCompany) {
            // Set viewingProfile with the company flag so the modal can handle it
            setViewingProfile({
              ...res.data,
              profile: { ...res.data.profile, accountType: 'company' },
            });
          } else {
            setViewingProfile(res.data);
          }
        })
        .catch(() => {
          alert('Companies are not allowed to maintain a Social Profile.');
          setSelectedUserId(null);
        });
    } else {
      setViewingProfile(null);
    }
  }, [selectedUserId]);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const [leaderboardResponse, postsResponse, projectsResponse] = await Promise.all([
        axios.get(`/api/space/leaderboard?timeframe=${lbTime}&filter=${lbFilter}`),
        axios.get(`/api/space/posts?feedType=${feedType}&sort=${feedSort}&timeframe=${feedTime}`),
        axios.get('/api/space/projects'),
      ]);
      setLeaderboard(leaderboardResponse.data);
      setPosts(postsResponse.data);
      setProjects(projectsResponse.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  // ===================================
  // NETWORK
  // ===================================
  const toggleFollow = async (userId) => {
    try {
      const res = await axios.post(`/api/space/network/follow/${userId}`, {});
      setLocalFollowing(res.data.following || []);
      setLocalPending(res.data.sentFollowRequests || []);
      fetchPosts();
      if (selectedUserId === userId) {
        axios.get(`/api/space/profile/${selectedUserId}`).then((r) => setViewingProfile(r.data));
      }
    } catch (err) {
      alert(err.response?.data?.msg || 'Action failed');
    }
  };

  const toggleBlock = async (userId) => {
    if (!window.confirm('Block this user? Their posts will be hidden from your feed.')) return;
    try {
      const res = await axios.post(`/api/space/network/block/${userId}`, {});
      alert(res.data.isBlocked ? 'User Blocked' : 'User Unblocked');
      fetchPosts(); // refresh feed
    } catch {
      alert('Action failed');
    }
  };

  // ===================================
  // PROJECTS
  // ===================================
  const submitProject = async (e) => {
    e.preventDefault();
    if (!projectDraft.title.trim() || !projectDraft.description.trim()) return;
    setCreatingProject(true);
    try {
      const milestones = projectDraft.milestones
        ? projectDraft.milestones
            .split('\n')
            .filter((m) => m.trim())
            .map((m) => ({ title: m.trim() }))
        : [];
      const res = await axios.post('/api/space/projects', {
        title: projectDraft.title,
        description: projectDraft.description,
        techStack: projectDraft.techStack,
        visibility: projectDraft.visibility,
        milestones,
      });
      setProjects([res.data, ...projects]);
      setProjectDraft({
        title: '',
        description: '',
        techStack: '',
        visibility: 'public',
        milestones: '',
      });
      setShowProjectForm(false);
    } catch (err) {
      alert(err.response?.data?.msg || 'Failed to create project');
    }
    setCreatingProject(false);
  };

  const deleteProject = async (id) => {
    if (!window.confirm('Delete this project?')) return;
    try {
      await axios.delete(`/api/space/projects/${id}`);
      setProjects(projects.filter((p) => p._id !== id));
    } catch {
      alert('Failed to delete project');
    }
  };

  const toggleMilestone = async (projectId, milestoneId) => {
    try {
      const res = await axios.put(`/api/space/projects/${projectId}/milestone/${milestoneId}`, {});
      setProjects(projects.map((p) => (p._id === projectId ? res.data : p)));
    } catch {
      alert('Failed to update milestone');
    }
  };

  const likeProject = async (projectId) => {
    try {
      const res = await axios.put(`/api/space/projects/${projectId}/like`, {});
      setProjects(projects.map((p) => (p._id === projectId ? { ...p, likes: res.data.likes } : p)));
    } catch {
      alert('Failed');
    }
  };

  // ===================================
  // POSTING & MEDIA
  // ===================================
  const handleFileChange = (e) => {
    if (e.target.files) {
      setAttachments(Array.from(e.target.files));
    }
  };

  const submitPost = async (e) => {
    e.preventDefault();
    if (!draftContent.trim() && attachments.length === 0) return;

    setIsPosting(true);
    const formData = new FormData();
    formData.append('content', draftContent);
    attachments.forEach((file) => formData.append('files', file));

    try {
      const res = await axios.post('/api/space/posts', formData);
      setPosts([res.data, ...posts]);
      setDraftContent('');
      setAttachments([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      alert('Failed to create post');
    }
    setIsPosting(false);
  };

  // ===================================
  // MODERATOR / ACTIONS
  // ===================================
  const deletePost = async (postId) => {
    if (!window.confirm('Delete this post?')) return;
    try {
      await axios.delete(`/api/space/posts/${postId}`);
      setPosts(posts.filter((p) => p._id !== postId));
    } catch {
      alert('Delete failed');
    }
  };

  const likePost = async (postId) => {
    try {
      const res = await axios.put(`/api/space/posts/${postId}/like`, {});
      setPosts(
        posts.map((p) =>
          p._id === postId ? { ...p, likes: res.data.likes, dislikes: res.data.dislikes } : p,
        ),
      );
    } catch {
      alert('Action failed');
    }
  };

  const dislikePost = async (postId) => {
    try {
      const res = await axios.put(`/api/space/posts/${postId}/dislike`, {});
      setPosts(
        posts.map((p) =>
          p._id === postId ? { ...p, likes: res.data.likes, dislikes: res.data.dislikes } : p,
        ),
      );
    } catch {
      alert('Action failed');
    }
  };

  const submitAward = async (postId) => {
    try {
      const res = await axios.post(`/api/space/posts/${postId}/award`, { awardType: 'diamond' });
      setPosts(posts.map((p) => (p._id === postId ? { ...p, awards: res.data } : p)));
    } catch {
      alert('Action failed');
    }
  };

  const copyPostLink = (postId) => {
    navigator.clipboard.writeText(`${window.location.origin}/space#post-${postId}`);
    alert('Post link copied to clipboard!');
  };

  const savePost = async (postId) => {
    try {
      const res = await axios.put(`/api/space/posts/${postId}/save`, {});
      setPosts(posts.map((p) => (p._id === postId ? { ...p, saves: res.data.saves } : p)));
    } catch {
      alert('Action failed');
    }
  };

  // ===================================
  // COMMENTS & AWARDS
  // ===================================
  const toggleComments = (postId) => {
    setExpandedComments((prev) => ({ ...prev, [postId]: !prev[postId] }));
  };

  const submitComment = async (postId) => {
    if (!commentText[postId] || commentText[postId].trim() === '') return;
    try {
      const res = await axios.post(`/api/space/posts/${postId}/comment`, {
        content: commentText[postId],
      });
      setPosts(posts.map((p) => (p._id === postId ? { ...p, comments: res.data } : p)));
      setCommentText((prev) => ({ ...prev, [postId]: '' }));
    } catch {
      alert('Failed to post comment');
    }
  };

  const deleteComment = async (postId, commentId) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      const res = await axios.delete(`/api/space/posts/${postId}/comment/${commentId}`);
      setPosts(posts.map((p) => (p._id === postId ? { ...p, comments: res.data } : p)));
    } catch {
      alert('Failed to delete comment');
    }
  };

  // ===================================
  // UI Helpers
  // ===================================
  const isLiked = (post) => post.likes.includes(user?._id);
  const isSaved = (post) => post.saves.includes(user?._id);
  const hasAwarded = (post) => post.awards?.some((a) => a.user === user?._id);

  // Check if the current user has permission to delete a post or comment
  const canManageContext = (authorId) => {
    if (authorId === user?._id) return true;
    if (!isCompany && (user?.role === 'moderator' || user?.role === 'superadmin')) return true;
    return false;
  };

  const canDelete = (post) => canManageContext(post.author?._id);

  const renderMedia = (attachment) => {
    const url = assetUrl(attachment.url);
    if (attachment.type === 'video')
      return (
        <AccessibleMedia
          className="post-media"
          key={attachment._id}
          src={url}
          title="Post video attachment"
          transcript={attachment.transcript}
        />
      );
    if (attachment.type === 'audio')
      return (
        <AccessibleMedia
          className="post-audio"
          key={attachment._id}
          kind="audio"
          src={url}
          title="Post audio attachment"
          transcript={attachment.transcript}
        />
      );
    return (
      <img src={url} alt="attachment" className="post-media" key={attachment._id} loading="lazy" />
    );
  };

  if (loading)
    return <AsyncState label="Loading The Space" title="Loading The Space…" type="loading" />;

  if (loadError) {
    return (
      <AsyncState
        action={
          <button className="cwm-button" onClick={fetchAllData} type="button">
            Try again
          </button>
        }
        description="The social workspace could not be loaded. Nothing was posted or changed."
        label="The Space loading error"
        title="The Space is temporarily unavailable"
        type="error"
      />
    );
  }

  return (
    <div className="space-page neo-container">
      <header className="space-header">
        <div>
          <h1 className="neo-title">🌌 The Space</h1>
          <p className="subtitle">Compete, share projects, attach media, and connect globally.</p>
        </div>
        <ScrollTrackRow className="space-tabs" contentRole="group" label="The Space sections">
          <button
            aria-pressed={activeTab === 'feed'}
            className={activeTab === 'feed' ? 'active' : ''}
            onClick={() => setActiveTab('feed')}
            type="button"
          >
            📰 Hub Feed
          </button>
          <button
            aria-pressed={activeTab === 'leaderboards'}
            className={activeTab === 'leaderboards' ? 'active' : ''}
            onClick={() => setActiveTab('leaderboards')}
            type="button"
          >
            🏆 Leaderboards
          </button>
          <button
            aria-pressed={activeTab === 'projects'}
            className={activeTab === 'projects' ? 'active' : ''}
            onClick={() => setActiveTab('projects')}
            type="button"
          >
            🛠️ Creative Space
          </button>
          <button
            aria-pressed={activeTab === 'profile'}
            className={activeTab === 'profile' ? 'active' : ''}
            onClick={() => setActiveTab('profile')}
            type="button"
          >
            👤 My Profile
          </button>
        </ScrollTrackRow>
      </header>

      {isBanned && (
        <div className="ban-warning-box">
          🚫 <strong>Your account has been suspended.</strong> You cannot create posts, comments, or
          projects until the ban is lifted.
        </div>
      )}

      <div className="space-content">
        {/* ======================================= */}
        {/* TAB: FEED                               */}
        {/* ======================================= */}
        {activeTab === 'feed' && (
          <div className="space-feed">
            <ScrollTrackRow className="feed-filters-bar">
              <AppDropdown
                label="Space feed audience"
                options={[
                  { label: '🌍 Public Feed', value: 'public' },
                  { label: '👥 Your Feed (Following)', value: 'following' },
                ]}
                value={feedType}
                onChange={(val) => setFeedType(val)}
              />
              <AppDropdown
                label="Space feed sort order"
                options={[
                  { label: '🕒 Newest', value: 'newest' },
                  { label: '🔥 Trending', value: 'trending' },
                  { label: '❤️ Most Liked', value: 'liked' },
                ]}
                value={feedSort}
                onChange={(val) => setFeedSort(val)}
              />
              <AppDropdown
                label="Space feed time range"
                options={[
                  { label: 'All Time', value: 'all' },
                  { label: 'Today', value: 'daily' },
                  { label: 'This Week', value: 'weekly' },
                  { label: 'This Month', value: 'monthly' },
                  { label: 'This Year', value: 'yearly' },
                ]}
                value={feedTime}
                onChange={(val) => setFeedTime(val)}
              />
            </ScrollTrackRow>

            {!isBanned && (
              <div className="create-post-prompt">
                <form onSubmit={submitPost} className="post-form">
                  <textarea
                    aria-label="Create a post"
                    className="post-textarea"
                    placeholder="What is happening?! Start interacting and following interests..."
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    rows={3}
                  />
                  <div className="post-form-footer">
                    <input
                      type="file"
                      multiple
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="file-input"
                      accept="image/*,video/*,audio/*"
                      id="media-upload"
                    />
                    <label htmlFor="media-upload" className="neo-button outline small media-label">
                      📎 Attach Media ({attachments.length})
                    </label>
                    <button type="submit" className="neo-button primary" disabled={isPosting}>
                      {isPosting ? 'Posting...' : '🚀 Publish Post'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="posts-container">
              {posts.length === 0 ? (
                <p className="empty-text">
                  No posts exactly match. Be the first to share something!
                </p>
              ) : (
                posts.map((post) => {
                  const authorImage =
                    post.author?.profilePictureUrl?.startsWith('/uploads') ||
                    post.author?.logo?.startsWith('/uploads')
                      ? assetUrl(post.author.profilePictureUrl || post.author.logo)
                      : post.author?.profilePictureUrl || post.author?.logo || defaultAvatarUrl;

                  return (
                    <div key={post._id} className="feed-post-card">
                      <div className="post-header">
                        <button
                          className="post-author cwm-text-button"
                          onClick={() => setSelectedUserId(post.author?._id)}
                          type="button"
                        >
                          <img src={authorImage} alt="Avatar" className="author-avatar" />
                          <span>
                            <span className="author-name-row">
                              <strong>
                                {post.author?.username ||
                                  post.author?.companyName ||
                                  'Unknown User'}
                              </strong>
                              {post.authorType === 'Company' && (
                                <span className="company-badge">COMPANY</span>
                              )}
                              {post.author?.role === 'superadmin' && (
                                <span className="admin-badge">ADMIN</span>
                              )}
                              {post.author?.role === 'moderator' && (
                                <span className="mod-badge">MOD</span>
                              )}
                            </span>
                            <span className="post-time">
                              {new Date(post.createdAt).toLocaleString()}
                            </span>
                          </span>
                        </button>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          {canDelete(post) && (
                            <button
                              className="mod-delete-btn"
                              onClick={() => deletePost(post._id)}
                              title="Delete Post"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="post-body">
                        <p>{post.content}</p>
                        {post.attachments && post.attachments.length > 0 && (
                          <div className="post-media-grid">{post.attachments.map(renderMedia)}</div>
                        )}
                      </div>

                      <div className="post-actions">
                        <div className="vote-group">
                          <button
                            className={`action-btn vote-up ${isLiked(post) ? 'voted-up' : ''}`}
                            onClick={() => likePost(post._id)}
                            title="Upvote"
                          >
                            <svg
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinejoin="round"
                            >
                              <path d="M12 5l-7 7h4.5v7h5v-7H19z" />
                            </svg>
                            <span className="upvote-count">{post.likes?.length || 0}</span>
                          </button>
                          <div className="vote-divider" />
                          <button
                            className={`action-btn vote-down ${post.dislikes?.includes(user?._id) ? 'voted-down' : ''}`}
                            onClick={() => dislikePost(post._id)}
                            title="Downvote"
                          >
                            <svg
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinejoin="round"
                            >
                              <path d="M12 19l7-7h-4.5V5h-5v7H5z" />
                            </svg>
                            <span className="downvote-count">{post.dislikes?.length || 0}</span>
                          </button>
                        </div>
                        <button
                          className={`action-btn ${isSaved(post) ? 'active-save' : ''}`}
                          onClick={() => savePost(post._id)}
                        >
                          🔖 {isSaved(post) ? 'Unsave' : 'Save'}
                        </button>
                        <button className="action-btn" onClick={() => copyPostLink(post._id)}>
                          🔗 Share
                        </button>
                        <button
                          className={`action-btn ${hasAwarded(post) ? 'active-award' : ''}`}
                          onClick={() => submitAward(post._id)}
                        >
                          💎 Award ({post.awards?.length || 0})
                        </button>
                        <button
                          className={`action-btn ${expandedComments[post._id] ? 'active-comment' : ''}`}
                          onClick={() => toggleComments(post._id)}
                        >
                          💬 {post.comments?.length || 0}
                        </button>
                      </div>

                      {/* EXPANDABLE COMMENTS SECTION */}
                      {expandedComments[post._id] && (
                        <div className="space-comments-section">
                          <div className="comment-input-area">
                            <input
                              aria-label="Add a comment"
                              type="text"
                              placeholder="Add a comment..."
                              value={commentText[post._id] || ''}
                              onChange={(e) =>
                                setCommentText((prev) => ({ ...prev, [post._id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitComment(post._id);
                              }}
                            />
                            <button className="neo-button" onClick={() => submitComment(post._id)}>
                              Reply
                            </button>
                          </div>
                          <div className="comment-replies" style={{ marginTop: '1rem' }}>
                            {post.comments?.map((comment) => (
                              <SpaceComment
                                key={comment._id}
                                comment={comment}
                                postId={post._id}
                                token={token}
                                onAction={(pId, updatedComments) => {
                                  setPosts(
                                    posts.map((p) =>
                                      p._id === pId ? { ...p, comments: updatedComments } : p,
                                    ),
                                  );
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ======================================= */}
        {/* TAB: LEADERBOARD                        */}
        {/* ======================================= */}
        {activeTab === 'leaderboards' && (
          <div className="space-leaderboard">
            <ScrollTrackRow className="feed-filters-bar">
              <AppDropdown
                label="Leaderboard ranking metric"
                options={[
                  { label: '🏆 Sort By Points', value: 'points' },
                  { label: '💻 Sort By Challenges Completed', value: 'challenges' },
                  { label: '📝 Sort By Posts Made', value: 'posts' },
                ]}
                value={lbFilter}
                onChange={(val) => setLbFilter(val)}
              />
              <AppDropdown
                label="Leaderboard time range"
                options={[
                  { label: 'All Time', value: 'all' },
                  { label: 'Today', value: 'daily' },
                  { label: 'This Week', value: 'weekly' },
                  { label: 'This Month', value: 'monthly' },
                  { label: 'This Year', value: 'yearly' },
                ]}
                value={lbTime}
                onChange={(val) => setLbTime(val)}
              />
            </ScrollTrackRow>
            {isCompany && (
              <div className="company-warning-box">
                <strong>Note:</strong> Companies do not participate on the leaderboard but are
                viewing the top global learners.
              </div>
            )}
            <div className="arena-header">
              <h2>🏆 Top Global Learners</h2>
            </div>
            <div className="leaderboard-list">
              {leaderboard.length === 0 ? (
                <p className="empty-text">No points earned yet. Start learning!</p>
              ) : (
                leaderboard.map((u, idx) => (
                  <div
                    key={u._id}
                    className={`leaderboard-item ${u._id === user?._id ? 'is-me' : ''}`}
                  >
                    <div className="rank">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                    </div>
                    <button
                      aria-label={`Open ${u.username}'s profile`}
                      className="cwm-image-button"
                      onClick={() => setSelectedUserId(u._id)}
                      type="button"
                    >
                      <img
                        src={
                          u.profilePictureUrl?.startsWith('/uploads')
                            ? assetUrl(u.profilePictureUrl)
                            : u.profilePictureUrl || defaultAvatarUrl
                        }
                        alt=""
                        className="lb-avatar"
                      />
                    </button>
                    <div className="lb-info">
                      <button
                        className="lb-name cwm-text-button"
                        onClick={() => setSelectedUserId(u._id)}
                        type="button"
                      >
                        {u.username}
                        {u.role === 'superadmin' && <span className="admin-badge">ADMIN</span>}
                        {u.role === 'moderator' && <span className="mod-badge">MOD</span>}
                      </button>
                      <div className="lb-score">
                        {lbFilter === 'challenges'
                          ? `${u.score} Challenges`
                          : lbFilter === 'posts'
                            ? `${u.score} Posts`
                            : `${u.score} XP`}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ======================================= */}
        {/* TAB: CREATIVE SPACE (PROJECTS)           */}
        {/* ======================================= */}
        {activeTab === 'projects' && (
          <div className="space-projects">
            {!isBanned && (
              <>
                {!showProjectForm ? (
                  <button
                    className="neo-button primary create-project-btn"
                    onClick={() => setShowProjectForm(true)}
                  >
                    ➕ Create New Project
                  </button>
                ) : (
                  <div className="create-post-prompt" style={{ marginBottom: '2rem' }}>
                    <form onSubmit={submitProject} className="post-form">
                      <input
                        aria-label="Project title"
                        type="text"
                        className="post-textarea"
                        placeholder="Project Title"
                        value={projectDraft.title}
                        onChange={(e) =>
                          setProjectDraft((prev) => ({ ...prev, title: e.target.value }))
                        }
                        style={{ minHeight: 'auto', padding: '0.75rem 1rem' }}
                      />
                      <textarea
                        aria-label="Project description"
                        className="post-textarea"
                        placeholder="Describe your project idea, goals, and what you're building..."
                        value={projectDraft.description}
                        onChange={(e) =>
                          setProjectDraft((prev) => ({ ...prev, description: e.target.value }))
                        }
                        rows={4}
                      />
                      <input
                        aria-label="Project technology stack"
                        type="text"
                        className="post-textarea"
                        placeholder="Tech Stack (comma-separated, e.g. React, Node.js, MongoDB)"
                        value={projectDraft.techStack}
                        onChange={(e) =>
                          setProjectDraft((prev) => ({ ...prev, techStack: e.target.value }))
                        }
                        style={{ minHeight: 'auto', padding: '0.75rem 1rem' }}
                      />
                      <textarea
                        aria-label="Project milestones"
                        className="post-textarea"
                        placeholder="Milestones (one per line, e.g.&#10;Setup project structure&#10;Build authentication&#10;Deploy to production)"
                        value={projectDraft.milestones}
                        onChange={(e) =>
                          setProjectDraft((prev) => ({ ...prev, milestones: e.target.value }))
                        }
                        rows={3}
                      />
                      <div className="post-form-footer">
                        <select
                          aria-label="Project visibility"
                          value={projectDraft.visibility}
                          onChange={(e) =>
                            setProjectDraft((prev) => ({ ...prev, visibility: e.target.value }))
                          }
                          className="role-select"
                        >
                          <option value="public">🌍 Public</option>
                          <option value="private">🔒 Private</option>
                        </select>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="neo-button outline small"
                            onClick={() => setShowProjectForm(false)}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="neo-button primary"
                            disabled={creatingProject}
                          >
                            {creatingProject ? 'Creating...' : '🚀 Create Project'}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                )}
              </>
            )}

            <div className="posts-container">
              {projects.length === 0 ? (
                <p className="empty-text">No projects yet. Be the first to build something!</p>
              ) : (
                projects.map((project) => {
                  const projAuthorImg =
                    project.author?.profilePictureUrl?.startsWith('/uploads') ||
                    project.author?.logo?.startsWith('/uploads')
                      ? assetUrl(project.author.profilePictureUrl || project.author.logo)
                      : project.author?.profilePictureUrl ||
                        project.author?.logo ||
                        defaultAvatarUrl;
                  const isOwner = project.author?._id === user?._id;
                  const canDel =
                    isOwner || user?.role === 'superadmin' || user?.role === 'moderator';
                  const completedCount = project.milestones?.filter((m) => m.completed).length || 0;
                  const totalMilestones = project.milestones?.length || 0;

                  return (
                    <div key={project._id} className="feed-post-card project-card">
                      <div className="post-header">
                        <div className="post-author">
                          <img src={projAuthorImg} alt="Avatar" className="author-avatar" />
                          <div>
                            <div className="author-name-row">
                              <strong>
                                {project.author?.username ||
                                  project.author?.companyName ||
                                  'Unknown'}
                              </strong>
                              {project.authorType === 'Company' && (
                                <span className="company-badge">COMPANY</span>
                              )}
                              {project.author?.role === 'superadmin' && (
                                <span className="admin-badge">ADMIN</span>
                              )}
                              {project.author?.role === 'moderator' && (
                                <span className="mod-badge">MOD</span>
                              )}
                            </div>
                            <span className="post-time">
                              {new Date(project.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        {canDel && (
                          <button
                            className="mod-delete-btn"
                            onClick={() => deleteProject(project._id)}
                            title="Delete Project"
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        )}
                      </div>

                      <h3 className="project-title">{project.title}</h3>
                      <p className="post-body" style={{ marginBottom: '1rem' }}>
                        {project.description}
                      </p>

                      {project.techStack && project.techStack.length > 0 && (
                        <div className="tech-stack-tags">
                          {project.techStack.map((tech, i) => (
                            <span key={i} className="tech-tag">
                              {tech}
                            </span>
                          ))}
                        </div>
                      )}

                      {totalMilestones > 0 && (
                        <div className="milestones-section">
                          <div className="milestone-header">
                            <span className="milestone-label">Milestones</span>
                            <span className="milestone-progress">
                              {completedCount}/{totalMilestones}
                            </span>
                          </div>
                          <div className="milestone-bar">
                            <div
                              className="milestone-bar-fill"
                              style={{
                                width: `${totalMilestones > 0 ? (completedCount / totalMilestones) * 100 : 0}%`,
                              }}
                            ></div>
                          </div>
                          <div className="milestone-list">
                            {project.milestones.map((ms) => (
                              <div
                                key={ms._id}
                                className={`milestone-item ${ms.completed ? 'completed' : ''}`}
                              >
                                {isOwner ? (
                                  <button
                                    className="milestone-toggle"
                                    onClick={() => toggleMilestone(project._id, ms._id)}
                                  >
                                    {ms.completed ? '✅' : '⬜'}
                                  </button>
                                ) : (
                                  <span>{ms.completed ? '✅' : '⬜'}</span>
                                )}
                                <span className={ms.completed ? 'completed-text' : ''}>
                                  {ms.title}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="post-actions">
                        <button
                          className={`action-btn ${project.likes?.includes(user?._id) ? 'active-like' : ''}`}
                          onClick={() => likeProject(project._id)}
                        >
                          ❤️ {project.likes?.length || 0}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ======================================= */}
        {/* TAB: MY PROFILE                         */}
        {/* ======================================= */}
        {activeTab === 'profile' && (
          <div className="space-profile">
            <div className="profile-stats-card" style={{ marginBottom: '2rem' }}>
              <h2>My Space Profile</h2>
              <p className="profile-subtext">View your contributions and total ecosystem XP.</p>

              <div className="stats-grid">
                <div className="stat-box">
                  <h3>{user?.points || 0} XP</h3>
                  <span>Total Rewards</span>
                </div>
                <div className="stat-box">
                  <h3>{myProfileData.posts.length}</h3>
                  <span>Total Posts</span>
                </div>
                <div className="stat-box">
                  <h3>{myProfileData.comments.length}</h3>
                  <span>Total Comments</span>
                </div>
              </div>
            </div>

            <div className="profile-section-card">
              <div
                className="space-profile-tabs"
                style={{
                  display: 'flex',
                  gap: '1rem',
                  marginBottom: '2rem',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  paddingBottom: '1rem',
                }}
              >
                <button
                  className={`profile-tab-btn ${profileSubTab === 'mine' ? 'active' : ''}`}
                  onClick={() => setProfileSubTab('mine')}
                >
                  My Contributions
                </button>
                <button
                  className={`profile-tab-btn ${profileSubTab === 'saved' ? 'active' : ''}`}
                  onClick={() => setProfileSubTab('saved')}
                >
                  Saved Content
                </button>
                {user?.privacySettings?.whoCanFollow === 'request_required' && (
                  <button
                    className={`profile-tab-btn ${profileSubTab === 'requests' ? 'active' : ''}`}
                    onClick={() => setProfileSubTab('requests')}
                  >
                    Follow Requests
                  </button>
                )}
              </div>

              {profileSubTab === 'mine' && (
                <>
                  <h3>My Posts ({myProfileData.posts.length})</h3>
                  <div className="posts-container" style={{ marginBottom: '2rem' }}>
                    {myProfileData.posts.length === 0 ? (
                      <p className="empty-text">You haven't posted anything yet.</p>
                    ) : (
                      myProfileData.posts.map((post) => (
                        <div key={post._id} className="my-item-card">
                          <div className="my-item-content">
                            <span className="date">
                              {new Date(post.createdAt).toLocaleString()}
                            </span>
                            <div className="my-item-text">
                              {post.content || (
                                <span style={{ fontStyle: 'italic', color: '#aaa' }}>
                                  [Media Post]
                                </span>
                              )}
                            </div>
                          </div>
                          <button className="mod-delete-btn" onClick={() => deletePost(post._id)}>
                            Delete
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <h3>My Comments ({myProfileData.comments.length})</h3>
                  <div className="posts-container">
                    {myProfileData.comments.length === 0 ? (
                      <p className="empty-text">You haven't commented yet.</p>
                    ) : (
                      myProfileData.comments.map((c) => (
                        <div key={c._id} className="my-item-card">
                          <div className="my-item-content">
                            <span className="date">{new Date(c.createdAt).toLocaleString()}</span>
                            <div className="title-ref">On: {c.postTitle}</div>
                            <div className="my-item-text">{c.content || c.text}</div>
                          </div>
                          <button
                            className="mod-delete-btn"
                            onClick={() => deleteComment(c.postId, c._id)}
                          >
                            Delete
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}

              {profileSubTab === 'saved' && (
                <>
                  <h3>Saved Posts ({myProfileData.savedPosts.length})</h3>
                  <div className="posts-container" style={{ marginBottom: '2rem' }}>
                    {myProfileData.savedPosts.length === 0 ? (
                      <p className="empty-text">No saved posts.</p>
                    ) : (
                      myProfileData.savedPosts.map((post) => (
                        <div key={post._id} className="my-item-card hover-glow">
                          <div className="my-item-content">
                            <span className="date">
                              Saved on {new Date(post.createdAt).toLocaleDateString()}
                            </span>
                            <div className="my-item-text">
                              {post.content || (
                                <span style={{ fontStyle: 'italic', color: '#aaa' }}>
                                  [Media Post]
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            className="neo-button outline small"
                            onClick={() => {
                              setActiveTab('feed');
                              setTimeout(() => window.scrollTo(0, 0), 100);
                            }}
                          >
                            View in Feed
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <h3>Saved Comments ({myProfileData.savedComments.length})</h3>
                  <div className="posts-container">
                    {myProfileData.savedComments.length === 0 ? (
                      <p className="empty-text">No saved comments.</p>
                    ) : (
                      myProfileData.savedComments.map((c) => (
                        <div key={c._id} className="my-item-card hover-glow">
                          <div className="my-item-content">
                            <span className="date">Comment by User</span>
                            <div className="title-ref">On: {c.postTitle}</div>
                            <div className="my-item-text">{c.content || c.text}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}

              {profileSubTab === 'requests' && (
                <>
                  <h3>
                    Pending Follow Requests (
                    {myProfileData.profile?.pendingFollowRequests?.length || 0})
                  </h3>
                  <div className="posts-container" style={{ marginBottom: '2rem' }}>
                    {!myProfileData.profile?.pendingFollowRequests?.length ? (
                      <p className="empty-text">You have no pending follow requests.</p>
                    ) : (
                      myProfileData.profile.pendingFollowRequests.map((reqUser) => (
                        <div
                          key={reqUser._id}
                          className="my-item-card"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '1rem 1.2rem',
                          }}
                        >
                          <button
                            className="cwm-text-button"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '1rem',
                            }}
                            onClick={() => setSelectedUserId(reqUser._id)}
                            type="button"
                          >
                            <img
                              src={
                                reqUser.profilePictureUrl
                                  ? assetUrl(reqUser.profilePictureUrl)
                                  : defaultAvatarUrl
                              }
                              style={{
                                width: '44px',
                                height: '44px',
                                borderRadius: '50%',
                                border: '2px solid rgba(255,255,255,0.15)',
                              }}
                              alt="User"
                            />
                            <span>
                              <span
                                style={{
                                  display: 'block',
                                  fontWeight: '600',
                                  color: '#fff',
                                  fontSize: '1rem',
                                }}
                              >
                                {reqUser.username}
                              </span>
                              <span
                                style={{
                                  display: 'block',
                                  fontSize: '0.8rem',
                                  color: '#aaa',
                                  marginTop: '2px',
                                }}
                              >
                                {reqUser.accountType === 'company'
                                  ? reqUser.companyName
                                  : reqUser.role === 'superadmin'
                                    ? 'Administrator'
                                    : reqUser.role === 'moderator'
                                      ? 'Moderator'
                                      : 'Learner'}
                              </span>
                            </span>
                          </button>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              className="neo-button small"
                              style={{
                                background: '#28a745',
                                color: '#fff',
                                fontWeight: '600',
                                padding: '0.5rem 1rem',
                              }}
                              onClick={() => handleFollowRequest(reqUser._id, 'accept')}
                            >
                              Accept
                            </button>
                            <button
                              className="neo-button outline small"
                              style={{
                                borderColor: '#dc3545',
                                color: '#dc3545',
                                fontWeight: '600',
                                padding: '0.5rem 1rem',
                              }}
                              onClick={() => handleFollowRequest(reqUser._id, 'reject')}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <h3>Your Followers ({myProfileData.profile?.followers?.length || 0})</h3>
                  <div className="posts-container">
                    {!myProfileData.profile?.followers?.length ? (
                      <p className="empty-text">You don't have any followers yet.</p>
                    ) : (
                      myProfileData.profile.followers
                        .filter((f) => f && f._id)
                        .map((follower) => (
                          <div
                            key={follower._id}
                            className="my-item-card"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '1rem 1.2rem',
                            }}
                          >
                            <button
                              className="cwm-text-button"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                              }}
                              onClick={() => setSelectedUserId(follower._id)}
                              type="button"
                            >
                              <img
                                src={
                                  follower.profilePictureUrl
                                    ? assetUrl(follower.profilePictureUrl)
                                    : defaultAvatarUrl
                                }
                                style={{
                                  width: '44px',
                                  height: '44px',
                                  borderRadius: '50%',
                                  border: '2px solid rgba(255,255,255,0.15)',
                                }}
                                alt="User"
                              />
                              <span>
                                <span
                                  style={{
                                    display: 'block',
                                    fontWeight: '600',
                                    color: '#fff',
                                    fontSize: '1rem',
                                  }}
                                >
                                  {follower.username}
                                </span>
                                <span
                                  style={{
                                    display: 'block',
                                    fontSize: '0.8rem',
                                    color: '#aaa',
                                    marginTop: '2px',
                                  }}
                                >
                                  {follower.role === 'superadmin'
                                    ? 'Administrator'
                                    : follower.role === 'moderator'
                                      ? 'Moderator'
                                      : 'Learner'}
                                </span>
                              </span>
                            </button>
                            <button
                              className="neo-button outline small"
                              style={{
                                borderColor: '#ff6b6b',
                                color: '#ff6b6b',
                                fontWeight: '600',
                                padding: '0.5rem 1rem',
                              }}
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    `Remove ${follower.username} from your followers?`,
                                  )
                                )
                                  return;
                                try {
                                  await axios.post(
                                    `/api/space/network/remove-follower/${follower._id}`,
                                    {},
                                  );
                                  setMyProfileData((prev) => ({
                                    ...prev,
                                    profile: {
                                      ...prev.profile,
                                      followers: prev.profile.followers.filter(
                                        (f) => f._id !== follower._id,
                                      ),
                                    },
                                  }));
                                } catch {
                                  alert('Failed to remove follower');
                                }
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* OTHERS PROFILE MODAL */}
      {viewingProfile && selectedUserId && (
        <AccessibleDialog
          label="Member profile"
          onClose={() => setSelectedUserId(null)}
          overlayClassName="profile-modal-overlay"
          surfaceClassName="profile-modal-content"
        >
          {viewingProfile.profile.accountType === 'company' ||
          viewingProfile.profile.role === 'company' ||
          viewingProfile.isCompany ? (
            <div style={{ textAlign: 'center', padding: '3rem 2rem' }}>
              <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🏢</div>
              <h2
                style={{
                  color: '#fff',
                  fontSize: '1.6rem',
                  fontWeight: '700',
                  marginBottom: '0.75rem',
                }}
              >
                Company Profile
              </h2>
              <p
                style={{
                  color: '#ccc',
                  fontSize: '1.05rem',
                  lineHeight: '1.6',
                  maxWidth: '320px',
                  margin: '0 auto 1.5rem',
                }}
              >
                Companies are <strong style={{ color: '#ff6b6b' }}>not allowed</strong> to maintain
                a Social Profile on Space.
              </p>
              <button
                onClick={() => setSelectedUserId(null)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  color: '#fff',
                  padding: '0.7rem 2rem',
                  borderRadius: '10px',
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                }}
              >
                Close
              </button>
            </div>
          ) : (
            (() => {
              const pSets = viewingProfile.profile.privacySettings || {};
              const isOwner = user?._id === viewingProfile.profile._id;
              const isFollower = localFollowing.includes(viewingProfile.profile._id);

              const canViewProfile =
                isOwner ||
                pSets.whoCanViewProfileInfo === 'everyone' ||
                !pSets.whoCanViewProfileInfo ||
                (pSets.whoCanViewProfileInfo === 'followers_only' && isFollower);
              const canViewPosts =
                isOwner ||
                pSets.whoCanViewPosts === 'everyone' ||
                !pSets.whoCanViewPosts ||
                (pSets.whoCanViewPosts === 'followers_only' && isFollower);
              const canViewComments =
                isOwner ||
                pSets.whoCanViewComments === 'everyone' ||
                !pSets.whoCanViewComments ||
                (pSets.whoCanViewComments === 'followers_only' && isFollower);
              const pendingBlock = localPending.includes(viewingProfile.profile._id);

              return (
                <>
                  <div className="profile-modal-header">
                    <div className="profile-modal-user">
                      <img
                        src={
                          viewingProfile.profile.profilePictureUrl
                            ? assetUrl(viewingProfile.profile.profilePictureUrl)
                            : defaultAvatarUrl
                        }
                        alt="Avatar"
                        className="profile-modal-avatar"
                      />
                      <div className="profile-modal-info">
                        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {viewingProfile.profile.username}
                          {viewingProfile.profile.role === 'superadmin' && (
                            <span className="admin-badge" style={{ fontSize: '0.6rem' }}>
                              ADMIN
                            </span>
                          )}
                          {viewingProfile.profile.role === 'moderator' && (
                            <span className="mod-badge" style={{ fontSize: '0.6rem' }}>
                              MOD
                            </span>
                          )}
                        </h2>
                        {canViewProfile ? (
                          <div className="profile-modal-stats">
                            <span>🏆 {viewingProfile.profile.points} Rewards</span>
                            <span>
                              👥 {viewingProfile.profile.followers?.length || 0} Followers
                            </span>
                            <span>
                              🚶 {viewingProfile.profile.following?.length || 0} Following
                            </span>
                          </div>
                        ) : (
                          <div
                            style={{
                              color: '#aaa',
                              fontStyle: 'italic',
                              fontSize: '0.9rem',
                              margin: '0.5rem 0',
                            }}
                          >
                            User has not accepted the request or profile is private.
                          </div>
                        )}
                        {user?._id !== viewingProfile.profile._id && (
                          <div className="profile-modal-actions">
                            <button
                              className={isFollower || pendingBlock ? 'btn-unfollow' : 'btn-follow'}
                              onClick={() => toggleFollow(viewingProfile.profile._id)}
                            >
                              {isFollower
                                ? 'Unfollow User'
                                : pendingBlock
                                  ? '⏳ Pending Request'
                                  : '+ Follow User'}
                            </button>
                            <button
                              className="btn-block"
                              onClick={() => toggleBlock(viewingProfile.profile._id)}
                            >
                              🚫 Block
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <button className="modal-close-btn" onClick={() => setSelectedUserId(null)}>
                      ✖
                    </button>
                  </div>

                  <div style={{ marginBottom: '1.5rem' }}>
                    <h3
                      style={{
                        color: '#fff',
                        borderBottom: '1px solid #333',
                        paddingBottom: '0.5rem',
                        marginBottom: '1rem',
                      }}
                    >
                      Recent Posts ({viewingProfile.posts.length})
                    </h3>
                    {!canViewPosts ? (
                      <div
                        style={{
                          color: '#aaa',
                          fontStyle: 'italic',
                          padding: '1rem',
                          background: 'rgba(0,0,0,0.2)',
                          borderRadius: '8px',
                        }}
                      >
                        🔒 User has not accepted the request or posts are private.
                      </div>
                    ) : viewingProfile.posts.length === 0 ? (
                      <p style={{ color: '#666' }}>No posts yet.</p>
                    ) : (
                      viewingProfile.posts.slice(0, 5).map((p) => (
                        <div key={p._id} className="my-item-card" style={{ padding: '1rem' }}>
                          <div className="my-item-content">
                            <span className="date">
                              {new Date(p.createdAt).toLocaleDateString()}
                            </span>
                            <div className="my-item-text">{p.content || '[Media]'}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div>
                    <h3
                      style={{
                        color: '#fff',
                        borderBottom: '1px solid #333',
                        paddingBottom: '0.5rem',
                        marginBottom: '1rem',
                      }}
                    >
                      Recent Comments ({viewingProfile.userComments.length})
                    </h3>
                    {!canViewComments ? (
                      <div
                        style={{
                          color: '#aaa',
                          fontStyle: 'italic',
                          padding: '1rem',
                          background: 'rgba(0,0,0,0.2)',
                          borderRadius: '8px',
                        }}
                      >
                        🔒 User has not accepted the request or comments are private.
                      </div>
                    ) : viewingProfile.userComments.length === 0 ? (
                      <p style={{ color: '#666' }}>No comments yet.</p>
                    ) : (
                      viewingProfile.userComments.slice(0, 5).map((c) => (
                        <div key={c._id} className="my-item-card" style={{ padding: '1rem' }}>
                          <div className="my-item-content">
                            <div className="title-ref">On: {c.postTitle}</div>
                            <div className="my-item-text">{c.content || c.text}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              );
            })()
          )}
        </AccessibleDialog>
      )}
      {showChatMenu && (
        <div
          style={{
            position: 'fixed',
            bottom: chatFabPos.bottom + 62 + 'px',
            right: chatFabPos.right + 'px',
            width: '320px',
            background: '#111822',
            borderRadius: '16px',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 10000,
            padding: '1rem',
            color: '#fff',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem',
              borderBottom: '1px solid #333',
              paddingBottom: '0.5rem',
            }}
          >
            <h3 style={{ margin: 0 }}>Friends Chat</h3>
            <button
              onClick={() => setShowChatMenu(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '1.2rem',
              }}
            >
              ✖
            </button>
          </div>
          <div
            style={{ textAlign: 'center', padding: '2rem 0', color: '#aaa', fontStyle: 'italic' }}
          >
            Live instant messaging with friends will be activated in the next big update!
            <br />
            <br />
            For now, you can keep finding connections on the Space Feed.
          </div>
        </div>
      )}
      <div
        title="Chat with Friends"
        className="space-chat-fab"
        style={{
          position: 'fixed',
          bottom: chatFabPos.bottom,
          right: chatFabPos.right,
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #a855f7, #6366f1)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 4px 15px rgba(99, 102, 241, 0.4)',
          zIndex: 9999,
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'box-shadow 0.2s ease',
          userSelect: 'none',
        }}
        onMouseDown={handleChatFabMouseDown}
        onTouchStart={handleChatFabMouseDown}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </div>
    </div>
  );
};

export default Space;
