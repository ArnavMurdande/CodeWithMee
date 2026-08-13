import { useState, useEffect, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import AppDropdown from '../components/AppDropdown';
import { AsyncState } from '../components/ui/AsyncState';

const DeleteIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="delete-icon"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const SaveIcon = ({ saved }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={saved ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="save-icon"
  >
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
  </svg>
);

const CustomDropdown = ({ label, options, selectedValue, onSelect }) => (
  <AppDropdown
    className="custom-dropdown"
    label={label}
    onChange={onSelect}
    options={options.map((option) => ({ label: option, value: option }))}
    value={selectedValue}
  />
);

// --- Main Component ---
const Challenges = () => {
  const [challenges, setChallenges] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const { user, setUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const fetchChallenges = async ({ append = false, cursor = null } = {}) => {
    if (!append) setIsLoading(true);
    if (!append) setLoadError(false);
    try {
      const [challengesRes, leaderboardRes] = await Promise.allSettled([
        axios.get('/api/v1/challenges', { params: { cursor, limit: 20 } }),
        axios.get('/api/v1/challenges/leaderboard'),
      ]);

      const challengesData = challengesRes.status === 'fulfilled'
        ? (Array.isArray(challengesRes.value.data)
            ? challengesRes.value.data
            : (challengesRes.value.data.challenges || []))
        : [];
      if (challengesRes.status === 'rejected') {
        throw challengesRes.reason;
      }

      const challengesWithStatus = challengesData.map((c) => {
        const id = c.id || c._id;
        return {
          ...c,
          _id: id,
          id,
          isSaved: c.isSaved || user?.savedChallenges?.includes(id),
        };
      });

      setChallenges((current) => append
        ? [...current, ...challengesWithStatus.filter((entry) => !current.some((existing) => existing.id === entry.id))]
        : challengesWithStatus);
      if (challengesRes.status === 'fulfilled') {
        setNextCursor(challengesRes.value.data.nextCursor || null);
        setHasMore(Boolean(challengesRes.value.data.hasMore));
      }
      if (leaderboardRes.status === 'fulfilled' && Array.isArray(leaderboardRes.value.data)) {
        setLeaderboard(leaderboardRes.value.data);
      }
    } catch {
      setLoadError(true);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (user) {
      fetchChallenges();
    }
  }, [user]);

  const handleSelectChallenge = (challengeId) => {
    navigate(`/challenges/${challengeId}`);
  };

  const handleDeleteChallenge = async (challengeId) => {
    if (
      window.confirm(
        'Are you sure you want to delete this challenge? This action cannot be undone.',
      )
    ) {
      try {
        await axios.delete(`/api/v1/challenges/${challengeId}`);
        setChallenges((prevChallenges) => prevChallenges.filter((c) => c._id !== challengeId));
      } catch (error) {
        console.error('Error deleting challenge:', error);
        alert('Failed to delete challenge. You may not be the author.');
      }
    }
  };

  const handleSaveChallenge = async (challengeId) => {
    try {
      const res = await axios.put(`/api/v1/challenges/${challengeId}/bookmark`, {});

      setUser((prevUser) => ({
        ...prevUser,
        savedChallenges: res.data.savedChallenges,
      }));
      setChallenges((prev) =>
        prev.map((c) => (c._id === challengeId ? { ...c, isSaved: !c.isSaved } : c)),
      );
    } catch (err) {
      console.error('Error saving challenge:', err);
      alert('Failed to save challenge.');
    }
  };

  const handleVote = async (challengeId, voteType) => {
    const userId = user?.id || user?._id;
    let previous;
    setChallenges((current) =>
      current.map((challenge) => {
        if (challenge._id !== challengeId) return challenge;
        previous = challenge;
        const likes = (challenge.likes || []).filter((id) => id !== userId);
        const dislikes = (challenge.dislikes || []).filter((id) => id !== userId);
        const wasActive = (voteType === 'like' ? challenge.likes : challenge.dislikes)?.includes(userId);
        if (!wasActive) (voteType === 'like' ? likes : dislikes).push(userId);
        return { ...challenge, likes, dislikes };
      }),
    );
    try {
      const res = await axios.post(`/api/v1/challenges/${challengeId}/reactions/${voteType}`, {});

      setChallenges((prevChallenges) =>
        prevChallenges.map((c) =>
          c._id === challengeId ? { ...c, likes: res.data.likes, dislikes: res.data.dislikes } : c,
        ),
      );
    } catch (err) {
      if (previous) setChallenges((current) => current.map((challenge) => challenge._id === challengeId ? previous : challenge));
      console.error(`Error ${voteType}ing challenge:`, err);
      alert(`Failed to ${voteType} challenge.`);
    }
  };

  if (isLoading) {
    return <AsyncState label="Loading challenges" title="Loading challenges…" type="loading" />;
  }

  if (loadError) {
    return (
      <AsyncState
        action={
          <button className="cwm-button" onClick={fetchChallenges} type="button">
            Try again
          </button>
        }
        description="The challenge catalog could not be loaded. Your saved work was not changed."
        label="Challenge catalog error"
        title="Challenges are temporarily unavailable"
        type="error"
      />
    );
  }

  return (
    <div className="challenges-container">
      <ChallengeList
        challenges={challenges}
        leaderboard={leaderboard}
        onSelectChallenge={handleSelectChallenge}
        onDeleteChallenge={handleDeleteChallenge}
        onSaveChallenge={handleSaveChallenge}
        onVote={handleVote}
        onCreateChallenge={() => navigate('/challenges/new')}
        hasMore={hasMore}
        onLoadMore={() => fetchChallenges({ append: true, cursor: nextCursor })}
        user={user}
      />
    </div>
  );
};

// --- Challenge List ---
const ChallengeList = ({
  challenges,
  leaderboard,
  onSelectChallenge,
  onCreateChallenge,
  onDeleteChallenge,
  onSaveChallenge,
  onVote,
  user,
  hasMore,
  onLoadMore,
}) => {
  const [activeTab, setActiveTab] = useState('problems');
  const [searchTerm, setSearchTerm] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('All Difficulties');
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [sortFilter, setSortFilter] = useState('Newest');

  const difficultyOptions = ['All Difficulties', 'Easy', 'Medium', 'Hard'];
  const statusOptions = ['All Statuses', 'Solved', 'Unsolved', 'Saved'];
  const sortOptions = ['Newest', 'Oldest', 'Score', 'Difficulty', 'Most Liked', 'Most Disliked'];

  const filteredAndSortedChallenges = useMemo(() => {
    return [...challenges]
      .filter((c) => {
        const searchMatch =
          c.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (c.tags && c.tags.some((t) => t.toLowerCase().includes(searchTerm.toLowerCase())));
        const difficultyMatch =
          difficultyFilter === 'All Difficulties' || c.difficulty === difficultyFilter;

        let statusMatch = true;
        if (statusFilter === 'Solved') {
          statusMatch = c.isSolved;
        } else if (statusFilter === 'Unsolved') {
          statusMatch = !c.isSolved;
        } else if (statusFilter === 'Saved') {
          statusMatch = c.isSaved;
        }

        return searchMatch && difficultyMatch && statusMatch;
      })
      .sort((a, b) => {
        switch (sortFilter) {
          case 'Score':
            return b.score - a.score;
          case 'Oldest':
            return new Date(a.createdAt) - new Date(b.createdAt);
          case 'Difficulty': {
            const difficultyOrder = { Easy: 1, Medium: 2, Hard: 3 };
            return difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty];
          }
          case 'Most Liked':
            return (b.likes?.length || 0) - (a.likes?.length || 0);
          case 'Most Disliked':
            return (b.dislikes?.length || 0) - (a.dislikes?.length || 0);
          case 'Newest':
          default:
            return new Date(b.createdAt) - new Date(a.createdAt);
        }
      });
  }, [challenges, searchTerm, difficultyFilter, statusFilter, sortFilter]);

  const difficultyColor = {
    Easy: 'text-green-400',
    Medium: 'text-yellow-400',
    Hard: 'text-red-400',
  };

  return (
    <>
      <div className="challenges-header">
        <h1>Coding Challenges</h1>
        <div className="header-actions">
          <button className="create-challenge-btn" onClick={onCreateChallenge}>
            + Create Challenge
          </button>
        </div>
      </div>

      <div className="filters-bar">
        <div className="filter-group">
          <input
            aria-label="Search challenges by title or tag"
            type="search"
            placeholder="Search by title or tag..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <CustomDropdown
            label="Difficulty filter"
            options={difficultyOptions}
            selectedValue={difficultyFilter}
            onSelect={setDifficultyFilter}
          />
          <CustomDropdown
            label="Status filter"
            options={statusOptions}
            selectedValue={statusFilter}
            onSelect={setStatusFilter}
          />
          <CustomDropdown
            label="Sort challenges"
            options={sortOptions}
            selectedValue={sortFilter}
            onSelect={setSortFilter}
          />
        </div>
      </div>

      <div aria-label="Challenge sections" className="tabs" role="group">
        <button
          aria-pressed={activeTab === 'problems'}
          className={`tab ${activeTab === 'problems' ? 'active' : ''}`}
          onClick={() => setActiveTab('problems')}
          type="button"
        >
          Problems
        </button>
        <button
          aria-pressed={activeTab === 'leaderboard'}
          className={`tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('leaderboard')}
          type="button"
        >
          Leaderboard
        </button>
      </div>

      <div className="list-container">
        {activeTab === 'problems' ? (
          <table>
            <thead>
              <tr>
                <th className="status-col">Status</th>
                <th className="title-col">Title</th>
                <th className="author-col">Author</th>
                <th className="difficulty-col">Difficulty</th>
                <th className="score-col">Score</th>
                <th className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedChallenges.map((challenge) => {
                const currentUserId = user?.id || user?._id;
                const isAuthor = Boolean(currentUserId && currentUserId === challenge.createdByUserId);
                return (
                  <tr key={challenge._id} className={challenge.isSolved ? 'solved' : ''}>
                    <td className="status-col">
                      {challenge.isSolved ? (
                        <span className="solved-check">✔ Solved</span>
                      ) : (
                        <span className="unsolved-status">Unsolved</span>
                      )}
                    </td>
                    <td className="challenge-title-cell title-col">
                      <button
                        className="challenge-title-button"
                        onClick={() => onSelectChallenge(challenge._id)}
                        type="button"
                      >
                        {challenge.title}
                      </button>
                    </td>
                    <td className="author-col">{isAuthor ? 'You' : 'Community'}</td>
                    <td className="difficulty-col">
                      <span className={difficultyColor[challenge.difficulty]}>
                        {challenge.difficulty}
                      </span>
                    </td>
                    <td className="score-col">{challenge.score}</td>
                    <td className="actions-cell-td actions-col">
                      <div className="actions-cell">
                        <div className="vote-group-pill">
                          <button
                            className={`action-btn like-btn ${(challenge.likes || []).includes(user?.id || user?._id) ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onVote(challenge._id, 'like');
                            }}
                          >
                            <span>👍</span>
                            <span>{(challenge.likes || []).length}</span>
                          </button>

                          <div className="pill-divider"></div>

                          <button
                            className={`action-btn dislike-btn ${(challenge.dislikes || []).includes(user?.id || user?._id) ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onVote(challenge._id, 'dislike');
                            }}
                          >
                            <span>👎</span>
                            <span>{(challenge.dislikes || []).length}</span>
                          </button>
                        </div>

                        <button
                          aria-label={challenge.isSaved ? 'Remove saved challenge' : 'Save challenge'}
                          className={`action-btn save-btn ${challenge.isSaved ? 'saved' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSaveChallenge(challenge._id);
                          }}
                        >
                          <SaveIcon saved={challenge.isSaved} />
                        </button>

                        <button
                          className="action-btn delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isAuthor) {
                              onDeleteChallenge(challenge._id);
                            }
                          }}
                          disabled={!isAuthor}
                          title={
                            isAuthor ? 'Delete challenge' : 'You can only delete your own challenges'
                          }
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>User</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((u, index) => (
                <tr key={u._id} className={u._id === user?._id ? 'current-user-rank' : ''}>
                  <td>{index + 1}</td>
                  <td>{u.username}</td>
                  <td>{u.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {activeTab === 'problems' && hasMore && (
        <button className="load-more-btn" onClick={onLoadMore} type="button">Load more challenges</button>
      )}
    </>
  );
};

export default Challenges;
