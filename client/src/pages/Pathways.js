import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import axios from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import AppDropdown from '../components/AppDropdown';
import { AccessibleDialog } from '../components/ui/AccessibleDialog';

const SavedRoadmapsOverlay = ({ roadmaps, onClose, onContinue, onDelete, isOpen }) => {
  const calculateProgress = (roadmap) => {
    if (!roadmap.topics || roadmap.topics.length === 0) return 0;
    const completedTopics = roadmap.topics.filter((t) => t.completed).length;
    return (completedTopics / roadmap.topics.length) * 100;
  };

  if (!isOpen) return null;

  return (
    <AccessibleDialog
      label="Saved learning pathways"
      onClose={onClose}
      overlayClassName="roadmaps-overlay-backdrop open"
      surfaceClassName="saved-roadmaps-overlay open"
    >
      <div className="overlay-header">
        <h2>📚 My Pathways</h2>
        <button
          aria-label="Close saved pathways"
          className="overlay-close-button"
          onClick={onClose}
          type="button"
        >
          <span className="close-icon">✕</span>
        </button>
      </div>
      <div className="overlay-content">
        {!roadmaps || roadmaps.length === 0 ? (
          <div className="no-roadmaps-message">
            <span className="empty-icon">🗺️</span>
            <p>You haven't generated any roadmaps yet.</p>
            <p className="empty-subtitle">Create your first AI-powered learning pathway above!</p>
          </div>
        ) : (
          <div className="roadmaps-grid">
            {roadmaps.map((roadmap) => (
              <div key={roadmap._id} className="saved-roadmap-card">
                <div className="roadmap-card-header">
                  <h3>{roadmap.title}</h3>
                  <span className="roadmap-topics-count">{roadmap.topics?.length || 0} topics</span>
                </div>
                <div className="roadmap-progress-section">
                  <div className="progress-bar-bg">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${calculateProgress(roadmap)}%` }}
                    ></div>
                  </div>
                  <span className="progress-percentage">
                    {Math.round(calculateProgress(roadmap))}%
                  </span>
                </div>
                <div className="roadmap-card-actions">
                  <button
                    onClick={() => onContinue(roadmap)}
                    className="continue-btn"
                    type="button"
                  >
                    Continue Learning →
                  </button>
                  <button
                    onClick={() => onDelete(roadmap._id)}
                    className="delete-btn"
                    title="Delete roadmap"
                    type="button"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      <line x1="10" y1="11" x2="10" y2="17"></line>
                      <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AccessibleDialog>
  );
};

const Pathways = ({ setViewRoadmapsHandler }) => {
  const { isAuthenticated } = useContext(AuthContext);
  const [language, setLanguage] = useState('Python');
  const [level, setLevel] = useState('Beginner');
  const [activeRoadmap, setActiveRoadmap] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const [savedRoadmaps, setSavedRoadmaps] = useState([]);
  const [showSavedSidebar, setShowSavedSidebar] = useState(false);

  // ... (rest of the component logic remains unchanged) ...

  const handleViewRoadmapsClick = () => {
    fetchSavedRoadmaps();
    setShowSavedSidebar(true);
  };

  useEffect(() => {
    if (setViewRoadmapsHandler) {
      setViewRoadmapsHandler(() => handleViewRoadmapsClick);
    }
    return () => {
      if (setViewRoadmapsHandler) {
        setViewRoadmapsHandler(null);
      }
    };
  }, [setViewRoadmapsHandler]);

  useEffect(() => {
    ScrollTrigger.refresh();
  }, [activeRoadmap]);

  const fetchSavedRoadmaps = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await axios.get('/api/roadmap/my-roadmaps');
      setSavedRoadmaps(res.data);
    } catch (err) {
      console.error('Could not fetch saved roadmaps', err);
    }
  };

  useEffect(() => {
    fetchSavedRoadmaps();
  }, [isAuthenticated]);

  const generateRoadmap = async (customPrompt = null) => {
    setIsLoading(true);
    setError('');
    setActiveRoadmap(null);

    const requestBody = customPrompt ? { customPrompt } : { language, level };

    if (customPrompt) setIsAiLoading(true);

    try {
      const res = await axios.post('/api/roadmap/generate', requestBody);
      setActiveRoadmap(res.data);
      await fetchSavedRoadmaps();
    } catch (err) {
      const errorMessage = 'Failed to generate roadmap. The AI may be busy, please try again.';
      setError(errorMessage);
      console.error(err);
    }
    setIsLoading(false);
    setIsAiLoading(false);
    setChatInput('');
  };

  const handleChatSubmit = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || isAiLoading || isLoading) return;
    generateRoadmap(chatInput);
  };

  const handleTopicCompletion = async (topicTitle, isCompleted) => {
    if (!activeRoadmap || !isAuthenticated) return;

    try {
      await axios.put('/api/roadmap/progress', {
        roadmapId: activeRoadmap._id,
        topic: topicTitle,
        completed: isCompleted,
      });

      const updatedTopics = activeRoadmap.topics.map((t) =>
        t.topic === topicTitle ? { ...t, completed: isCompleted } : t,
      );
      setActiveRoadmap({ ...activeRoadmap, topics: updatedTopics });

      setSavedRoadmaps((prev) =>
        prev.map((r) => (r._id === activeRoadmap._id ? { ...r, topics: updatedTopics } : r)),
      );
    } catch (err) {
      console.error('Failed to update progress', err);
    }
  };

  const handleContinueRoadmap = (roadmap) => {
    setActiveRoadmap(roadmap);
    setShowSavedSidebar(false);
  };

  // --- NEW DELETE FUNCTION ---
  const handleDeleteRoadmap = async (roadmapId) => {
    if (
      window.confirm('Are you sure you want to delete this roadmap? This action cannot be undone.')
    ) {
      try {
        await axios.delete(`/api/roadmap/${roadmapId}`);
        // If the deleted roadmap was the active one, clear it
        if (activeRoadmap && activeRoadmap._id === roadmapId) {
          setActiveRoadmap(null);
        }
        // Update the state to remove the roadmap from the sidebar
        setSavedRoadmaps((prev) => prev.filter((r) => r._id !== roadmapId));
      } catch (err) {
        console.error('Failed to delete roadmap', err);
        alert('Could not delete the roadmap. Please try again.');
      }
    }
  };

  return (
    <div className="pathways-container">
      <SavedRoadmapsOverlay
        roadmaps={savedRoadmaps}
        isOpen={showSavedSidebar}
        onClose={() => setShowSavedSidebar(false)}
        onContinue={handleContinueRoadmap}
        onDelete={handleDeleteRoadmap}
      />

      <div className="pathways-main-content">
        <div className="roadmap-generator-card">
          <div className="card-header">
            <h1 className="pathways-title">Create Your AI-Powered Roadmap</h1>
            <button className="view-roadmaps-btn" onClick={handleViewRoadmapsClick}>
              <span className="btn-icon">📂</span>
              <span className="btn-text">View Roadmaps</span>
            </button>
          </div>
          <p className="pathways-subtitle">
            Select a language or chat with Mee to generate a personalized plan.
          </p>

          <div className="generator-options">
            <div className="form-group">
              <label htmlFor="language">I want to learn:</label>
              <AppDropdown
                label="Learning pathway language"
                options={[
                  { label: 'Python', value: 'Python' },
                  { label: 'JavaScript', value: 'JavaScript' },
                  { label: 'Java', value: 'Java' },
                  { label: 'C++', value: 'C++' },
                  { label: 'SQL', value: 'SQL' },
                  { label: 'Go', value: 'Go' },
                  { label: 'Ruby', value: 'Ruby' },
                ]}
                value={language}
                onChange={(val) => setLanguage(val)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="level">My level is:</label>
              <AppDropdown
                label="Learning pathway level"
                options={[
                  { label: 'Beginner', value: 'Beginner' },
                  { label: 'Intermediate', value: 'Intermediate' },
                  { label: 'Advanced', value: 'Advanced' },
                ]}
                value={level}
                onChange={(val) => setLevel(val)}
              />
            </div>
            <button
              className="generate-button"
              onClick={() => generateRoadmap()}
              disabled={isLoading}
            >
              {isLoading && !isAiLoading ? 'Generating...' : 'Generate My Roadmap'}
            </button>
          </div>
        </div>

        <div className="ai-chat-box">
          <p className="ai-chat-prefix">Or... Talk to Mee</p>
          <form className="chat-input-form-pathways" onSubmit={handleChatSubmit}>
            <input
              aria-label="Ask a follow-up about this learning pathway"
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Make me a plan for learning web scraping with Python..."
              disabled={isAiLoading || isLoading}
            />
            <button type="submit" disabled={isAiLoading || isLoading}>
              {isAiLoading ? '...' : 'Send'}
            </button>
          </form>
        </div>

        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </div>

      {activeRoadmap && (
        <div className="roadmap-display">
          <h2>Current Roadmap: {activeRoadmap.title}</h2>
          <ul>
            {activeRoadmap.topics.map((item, index) => (
              <li key={index} className={`roadmap-item ${item.completed ? 'completed' : ''}`}>
                <input
                  aria-label={`Mark ${item.topic} complete`}
                  type="checkbox"
                  className="progress-checkbox"
                  checked={item.completed}
                  onChange={(e) => handleTopicCompletion(item.topic, e.target.checked)}
                />
                <div className="roadmap-item-content">
                  <h3>
                    {index + 1}. {item.topic}
                  </h3>
                  <p>{item.description}</p>
                </div>
                <Link
                  to={`/sandbox?topic=${encodeURIComponent(item.topic)}&q=${encodeURIComponent(item.youtube_query)}&pathway=${encodeURIComponent(activeRoadmap.title)}`}
                  className="start-learning-link"
                >
                  Start Learning →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default Pathways;
