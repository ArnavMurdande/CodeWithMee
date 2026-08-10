import { useState, useEffect, useContext, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios, { assetUrl } from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { AsyncState } from '../components/ui/AsyncState';
import AppDropdown from '../components/AppDropdown';
import { AccessibleDialog } from '../components/ui/AccessibleDialog';
import Editor from '../components/CodeEditor';
import { getUserStorageKey } from '../lib/cache-isolation';

// --- Custom Dropdown Component ---
const CustomDropdown = ({ options, selected, onSelect }) => {
  const selectedOption = options.find(
    (option) => option.value === selected || option.label === selected,
  );
  return (
    <AppDropdown
      className="custom-dropdown"
      label="Programming language"
      onChange={(value) => onSelect(options.find((option) => option.value === value))}
      options={options}
      value={selectedOption?.value}
    />
  );
};

// Helper: relative time
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

// --- Reddit-style Comment Component ---
const Comment = ({ comment, challengeId, token, onAction, depth = 0 }) => {
  const { user } = useContext(AuthContext);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showAwardPicker, setShowAwardPicker] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const netScore = (comment.likes?.length || 0) - (comment.dislikes?.length || 0);
  const currentUserId = user?.id || user?._id;
  const hasUpvoted = comment.likes?.includes(currentUserId);
  const hasDownvoted = comment.dislikes?.includes(currentUserId);
  const authorName = comment.author?.username || 'Unknown';
  const authorInitial = authorName.charAt(0).toUpperCase();
  const profilePic = comment.author?.profilePictureUrl;

  const handleVote = async (isLike) => {
    const route = isLike ? 'like' : 'dislike';
    try {
      await axios.post(`/api/v1/challenges/${challengeId}/comments/${comment._id}/reactions/${route}`, {});
      onAction();
    } catch (error) {
      console.error('Failed to vote on comment', error);
    }
  };

  const handleReplySubmit = async (e) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    try {
      await axios.post(`/api/v1/challenges/${challengeId}/comments/${comment._id}/reply`, {
        text: replyText,
      });
      setReplyText('');
      setShowReply(false);
      onAction();
    } catch (error) {
      console.error('Failed to post reply', error);
    }
  };

  const handleAward = async (awardType) => {
    try {
      await axios.post(`/api/v1/challenges/${challengeId}/comments/${comment._id}/award`, {
        awardType,
      });
      setShowAwardPicker(false);
      onAction();
    } catch (error) {
      console.error('Failed to award comment', error);
    }
  };

  const handleShare = () => {
    const url = `${window.location.origin}/challenges/${challengeId}#comment-${comment._id}`;
    navigator.clipboard.writeText(url);
    alert('Comment link copied to clipboard!');
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this comment? This cannot be undone.')) return;
    try {
      await axios.delete(`/api/v1/challenges/${challengeId}/comments/${comment._id}`);
      onAction();
    } catch (error) {
      console.error('Failed to delete comment', error);
      alert(error.response?.data?.msg || 'Failed to delete comment');
    }
  };

  const isAuthor = currentUserId === (comment.author?._id || comment.author?.id || comment.author);
  const canDelete = isAuthor || user?.role === 'superadmin' || user?.role === 'moderator';

  // Count awards by type
  const awardCounts = {};
  (comment.awards || []).forEach((a) => {
    const t = a.type || 'star';
    awardCounts[t] = (awardCounts[t] || 0) + 1;
  });

  return (
    <div className={`reddit-comment ${depth > 0 ? 'nested' : ''}`} id={`comment-${comment._id}`}>
      {/* LEFT: Avatar + Thread Line Column */}
      <div className="comment-left-col">
        {profilePic ? (
          <img src={assetUrl(profilePic)} alt="" className="comment-avatar" />
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

      {/* RIGHT: Content Column */}
      <div className="comment-right-col">
        <div className="comment-meta">
          <span className="comment-username">{authorName}</span>
          <span className="comment-separator">•</span>
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
            <div className="comment-text">{comment.text}</div>
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
                aria-label="Upvote"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                >
                  <path d="M12 5l-7 7h4.5v7h5v-7H19z" />
                </svg>
              </button>
              <span
                className={`vote-count ${netScore > 0 ? 'positive' : netScore < 0 ? 'negative' : ''}`}
              >
                {netScore}
              </span>
              <button
                className={`action-btn vote-down ${hasDownvoted ? 'voted-down' : ''}`}
                onClick={() => handleVote(false)}
                aria-label="Downvote"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                >
                  <path d="M12 19l7-7h-4.5V5h-5v7H5z" />
                </svg>
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
              <button className="action-btn" onClick={handleShare}>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                Share
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
                  <Comment
                    key={reply._id}
                    comment={reply}
                    challengeId={challengeId}
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

const ChallengeSolver = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, user } = useContext(AuthContext);

  const [challenge, setChallenge] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('python');
  const [output, setOutput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);

  const languageOptions = [
    { value: 'python', label: 'Python' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'java', label: 'Java' },
    { value: 'cpp', label: 'C++' },
    { value: 'c', label: 'C' },
    { value: 'rust', label: 'Rust' },
    { value: 'ruby', label: 'Ruby' },
    { value: 'go', label: 'Go' },
    { value: 'kotlin', label: 'Kotlin' },
    { value: 'swift', label: 'Swift' },
    { value: 'scala', label: 'Scala' },
    { value: 'dart', label: 'Dart' },
    { value: 'php', label: 'PHP' },
    { value: 'perl', label: 'Perl' },
    { value: 'r', label: 'R' },
    { value: 'elixir', label: 'Elixir' },
    { value: 'bash', label: 'Bash' },
  ];

  const boilerplate = {
    python: 'def solve(nums, target):\n  # Your code here\n  return False',
    javascript: 'function solve(nums, target) {\n  // Your code here\n  return false;\n}',
    java: 'class Solution {\n    public boolean solve(int[] nums, int target) {\n        // Your code here\n        return false;\n    }\n}',
    cpp: 'bool solve(std::vector<int>& nums, int target) {\n    // Your code here\n    return false;\n}',
    c: 'bool solve(int nums[], int numsSize, int target) {\n    // Your code here\n    return false;\n}',
  };

  const fetchChallenge = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await axios.get(`/api/v1/challenges/${id}`);
      setChallenge(res.data);
    } catch {
      setLoadError(true);
      setOutput('Error: Could not load the challenge.');
    } finally {
      setIsLoading(false);
    }
  }, [id, token]);

  const fetchSubmissions = useCallback(async () => {
    if (!user) return;
    try {
      const response = await axios.get(`/api/v1/challenges/${id}/submissions?limit=20`);
      setSubmissions(response.data.submissions || response.data.items || []);
    } catch {
      setSubmissions([]);
    }
  }, [id, user]);

  useEffect(() => {
    fetchChallenge();
    fetchSubmissions();
  }, [fetchChallenge, fetchSubmissions]);

  useEffect(() => {
    const userId = user?.id || user?._id;
    const key = getUserStorageKey(userId, `challenge_draft_${id}_${language}`);
    setCode(localStorage.getItem(key) || challenge?.starterTemplates?.[language] || boilerplate[language] || '');
  }, [challenge, language, id, user]);

  const updateCode = (value) => {
    const next = value || '';
    setCode(next);
    const userId = user?.id || user?._id;
    localStorage.setItem(getUserStorageKey(userId, `challenge_draft_${id}_${language}`), next);
  };

  const handleLanguageSelect = (option) => {
    setLanguage(option.value);
  };

  const handleLikeChallenge = async (isLike) => {
    if (!user) return;
    const route = isLike ? 'like' : 'dislike';
    try {
      const res = await axios.post(`/api/v1/challenges/${id}/reactions/${route}`, {});
      setChallenge((prev) => ({ ...prev, likes: res.data.likes, dislikes: res.data.dislikes }));
    } catch (error) {
      console.error('Failed to vote on challenge', error);
    }
  };

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      await axios.post(`/api/v1/challenges/${id}/comments`, { text: newComment });
      setNewComment('');
      fetchChallenge();
    } catch (error) {
      console.error('Failed to post comment', error);
    }
  };

  const handleCodeExecution = async (isRunAction) => {
    setIsSubmitting(true);
    setOutput(isRunAction ? 'Running on example cases...' : 'Submitting solution...');
    try {
      const endpoint = isRunAction
        ? `/api/v1/challenges/${id}/run`
        : `/api/v1/challenges/${id}/submit`;

      const res = await axios.post(endpoint, {
        code,
        language,
      });

      const { status, results = [], passCount, totalCount } = res.data;
      let formattedOutput = isRunAction
        ? 'Visible test results\n'
        : `Submission: ${status}\nPassed: ${passCount ?? 0}/${totalCount ?? 0}\n`;
      results.forEach((result, index) => {
        formattedOutput += `\nTest ${index + 1}: ${result.status || (result.passed ? 'PASSED' : 'FAILED')}\n`;
        if (isRunAction && result.actualOutput != null) formattedOutput += `Output: ${result.actualOutput}\n`;
        if (isRunAction && result.errorOutput) formattedOutput += `Error: ${result.errorOutput}\n`;
      });
      setOutput(formattedOutput);
      if (!isRunAction) await fetchSubmissions();
    } catch (error) {
      setOutput(`Execution Error: ${error.response?.data?.error?.code || error.response?.data?.message || error.message}`);
    }
    setIsSubmitting(false);
  };

  const openSubmission = async (submissionId) => {
    try {
      const response = await axios.get(`/api/v1/challenges/${id}/submissions/${submissionId}`);
      setSelectedSubmission(response.data);
    } catch (error) {
      setOutput(`Submission Error: ${error.response?.data?.error?.code || error.message}`);
    }
  };

  if (isLoading) {
    return (
      <AsyncState label="Loading challenge" title="Loading challenge workspace…" type="loading" />
    );
  }

  if (loadError || !challenge) {
    return (
      <AsyncState
        action={
          <button className="cwm-button" onClick={fetchChallenge} type="button">
            Try again
          </button>
        }
        description="The challenge could not be opened. No code was submitted."
        label="Challenge loading error"
        title="Challenge unavailable"
        type="error"
      />
    );
  }

  return (
    <div className="solver-page-container">
      <div className="solver-container">
        {selectedSubmission && (
          <AccessibleDialog label="Submission details" onClose={() => setSelectedSubmission(null)} overlayClassName="modal-overlay" surfaceClassName="modal-content">
            <h2>Submission details</h2>
            <p>{selectedSubmission.status} · {selectedSubmission.passCount}/{selectedSubmission.totalCount} tests</p>
            <pre className="terminal-content">{selectedSubmission.code}</pre>
            <button onClick={() => setSelectedSubmission(null)} type="button">Close</button>
          </AccessibleDialog>
        )}
        <div className="problem-pane">
          <div className="problem-header">
            <button onClick={() => navigate('/challenges')} className="back-button">
              ← Back
            </button>
          </div>
          <h1>{challenge.title}</h1>
          <p className="description">{challenge.statement}</p>

          {challenge.constraintsText && (
            <>
              <h3>Constraints</h3>
              <pre className="constraints-list">{challenge.constraintsText}</pre>
            </>
          )}

          <h3>Examples</h3>
          <div className="test-cases">
            {(challenge.testCases || [])
              .map((tc, i) => (
                <div key={i} className="test-case">
                  <strong>Input:</strong> <pre>{tc.input}</pre>
                  <strong>Output:</strong> <pre>{tc.expectedOutput ?? tc.output}</pre>
                </div>
              ))}
          </div>

          <div className="challenge-feedback">
            <button
              onClick={() => handleLikeChallenge(true)}
              className={(challenge.likes || []).includes(user?.id || user?._id) ? 'active' : ''}
            >
              👍 {challenge.likes.length}
            </button>
            <button
              onClick={() => handleLikeChallenge(false)}
              className={(challenge.dislikes || []).includes(user?.id || user?._id) ? 'active' : ''}
            >
              👎 {challenge.dislikes.length}
            </button>
          </div>
        </div>

        <div className="code-pane">
          <div className="code-pane-container">
            <div className="editor-header">
              <CustomDropdown
                options={languageOptions}
                selected={languageOptions.find((opt) => opt.value === language)?.label}
                onSelect={handleLanguageSelect}
              />
            </div>
            <div className="editor-wrapper">
              <Editor
                height="400px"
                theme="vs-dark"
                language={language}
                value={code}
                onChange={updateCode}
                options={{
                  ariaLabel: 'Challenge code editor',
                  fontSize: 16,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
            <div className="terminal">
              <div className="terminal-header">Output</div>
              <pre className="terminal-content">{output}</pre>
            </div>
            <div className="action-buttons">
              <button
                className="run-btn"
                onClick={() => handleCodeExecution(true)}
                disabled={isSubmitting}
              >
                Run
              </button>
              <button
                className="submit-btn"
                onClick={() => handleCodeExecution(false)}
                disabled={isSubmitting}
              >
                {isSubmitting ? '...' : 'Submit'}
              </button>
            </div>
            <section className="submission-history" aria-labelledby="submission-history-title">
              <h3 id="submission-history-title">Submission history</h3>
              {submissions.length === 0 ? (
                <p>No submissions yet.</p>
              ) : (
                <div className="table-scroll" tabIndex="0">
                  <table>
                    <thead><tr><th>Status</th><th>Language</th><th>Passed</th><th>Submitted</th></tr></thead>
                    <tbody>
                      {submissions.map((submission) => (
                        <tr key={submission.id}>
                          <td><button onClick={() => openSubmission(submission.id)} type="button">{submission.status}</button></td>
                          <td>{submission.language}</td>
                          <td>{submission.passCount}/{submission.totalCount}</td>
                          <td>{new Date(submission.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      <div className="comments-section">
        <h3>Comments ({(challenge.comments || []).length})</h3>
        <form onSubmit={handleCommentSubmit} className="comment-form">
          <textarea
            aria-label="Add a challenge comment"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a public comment..."
          />
          <button type="submit" disabled={!newComment.trim()}>
            Post
          </button>
        </form>
        <div className="comment-list">
          {(challenge.comments || []).map((comment) => (
            <Comment
              key={comment._id}
              comment={comment}
              challengeId={id}
              token={token}
              onAction={fetchChallenge}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ChallengeSolver;
