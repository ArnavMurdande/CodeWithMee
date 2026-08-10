import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import axios from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { getUserStorageKey } from '../lib/cache-isolation';
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
            {roadmaps.map((roadmap, index) => {
              const cardKey = String(roadmap.id || roadmap._id || roadmap.title || `roadmap_${index}`);
              return (
                <div key={cardKey} className="saved-roadmap-card">
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
                      onClick={() => onDelete(roadmap.id || roadmap._id)}
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
              );
            })}
          </div>
        )}
      </div>
    </AccessibleDialog>
  );
};

const Pathways = () => {
  const { isAuthenticated, user } = useContext(AuthContext);
  const [language, setLanguage] = useState('Python');
  const [level, setLevel] = useState('Beginner');
  const [activeRoadmap, setActiveRoadmap] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState('');

  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const [savedRoadmaps, setSavedRoadmaps] = useState([]);
  const [showSavedSidebar, setShowSavedSidebar] = useState(false);

  const handleViewRoadmapsClick = () => setShowSavedSidebar(true);

  const getStorageKey = () => getUserStorageKey(user?.id, 'saved_roadmaps');

  const getLocalRoadmaps = () => {
    try {
      const keys = [
        getUserStorageKey(user?.id, 'saved_roadmaps'),
        'cwm_saved_roadmaps',
        'cwm_anon_saved_roadmaps',
        'saved_roadmaps',
      ];
      const all = [];
      keys.forEach((k) => {
        try {
          const raw = localStorage.getItem(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) all.push(...parsed);
          }
        } catch {
          // Ignore parse errors
        }
      });

      const map = new Map();
      all.forEach((r) => {
        if (!r) return;
        const normId = String(r.id || r._id || '').trim();
        const normTitle = String(r.title || '').trim().toLowerCase();
        const key = normId && normId !== 'undefined' ? normId : normTitle;
        if (key && key !== 'undefined') {
          const existing = map.get(key);
          if (!existing || (r.topics?.length || 0) >= (existing.topics?.length || 0)) {
            map.set(key, {
              ...r,
              id: r.id || r._id || key,
              _id: r._id || r.id || key,
            });
          }
        }
      });
      return Array.from(map.values());
    } catch {
      return [];
    }
  };

  const saveLocalRoadmaps = (list) => {
    try {
      const key = getStorageKey();
      localStorage.setItem(key, JSON.stringify(list));
      localStorage.setItem('cwm_saved_roadmaps', JSON.stringify(list));
    } catch (err) {
      console.error('Could not cache roadmaps to localStorage', err);
    }
  };

  const fetchSavedRoadmaps = async () => {
    const local = getLocalRoadmaps();
    if (local.length > 0) {
      setSavedRoadmaps(local);
    }
    if (!isAuthenticated) return;
    try {
      const res = await axios.get('/api/v1/roadmaps/my-roadmaps');
      if (Array.isArray(res.data)) {
        const map = new Map();
        local.forEach((r) => {
          if (!r) return;
          const normId = String(r.id || r._id || '').trim();
          const normTitle = String(r.title || '').trim().toLowerCase();
          const key = normId && normId !== 'undefined' ? normId : normTitle;
          if (key && key !== 'undefined') {
            map.set(key, { ...r, id: r.id || r._id || key, _id: r._id || r.id || key });
          }
        });
        res.data.forEach((r) => {
          if (!r) return;
          const normId = String(r.id || r._id || '').trim();
          const normTitle = String(r.title || '').trim().toLowerCase();
          const key = normId && normId !== 'undefined' ? normId : normTitle;
          if (key && key !== 'undefined') {
            map.set(key, { ...r, id: r.id || r._id || key, _id: r._id || r.id || key });
          }
        });
        const merged = Array.from(map.values());
        setSavedRoadmaps(merged);
        saveLocalRoadmaps(merged);
      }
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

    const targetTitle = customPrompt
      ? customPrompt.trim()
      : `${language} (${level})`;

    // INSTANT OPTIMISTIC SKELETON (0ms latency!)
    setActiveRoadmap({
      id: 'generating_temp',
      _id: 'generating_temp',
      title: targetTitle,
      isGenerating: true,
      topics: [
        { topic: `Building ${targetTitle}...`, description: 'Mee is curating your personalized step-by-step pathway...', completed: false },
        { topic: 'Structuring key concepts & setup guides...', description: 'Preparing practical coding lessons...', completed: false },
        { topic: 'Linking hands-on video tutorials...', description: 'Formatting exercises and queries...', completed: false }
      ]
    });

    const requestBody = customPrompt ? { customPrompt } : { language, level };

    if (customPrompt) setIsAiLoading(true);

    try {
      const res = await axios.post('/api/v1/roadmaps/generate', requestBody);
      const generated = res.data;
      const rdmId = generated.id || generated._id || 'rdm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      generated.id = rdmId;
      generated._id = rdmId;

      setActiveRoadmap(generated);

      const genKey = String(generated.id || generated._id).trim();
      const currentList = getLocalRoadmaps();
      const exists = currentList.some(
        (r) => String(r.id || r._id).trim() === genKey
      );
      const updatedList = exists
        ? currentList.map((r) => String(r.id || r._id).trim() === genKey ? generated : r)
        : [generated, ...currentList];

      saveLocalRoadmaps(updatedList);
      setSavedRoadmaps(updatedList);
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

  const handleContinueRoadmap = (roadmap) => {
    setActiveRoadmap(roadmap);
    setShowSavedSidebar(false);
  };

  // --- INSTANT OPTIMISTIC DELETE ---
  const handleDeleteRoadmap = async (roadmapId) => {
    const targetId = roadmapId || (activeRoadmap && (activeRoadmap._id || activeRoadmap.id));
    if (!targetId || String(targetId) === 'undefined') {
      alert('Could not identify roadmap to delete.');
      return;
    }

    if (
      window.confirm('Are you sure you want to delete this roadmap? This action cannot be undone.')
    ) {
      // 1. Optimistically clear active roadmap and update UI state instantly (0ms delay)
      if (
        activeRoadmap &&
        String(activeRoadmap._id || activeRoadmap.id || activeRoadmap.title) === String(targetId)
      ) {
        setActiveRoadmap(null);
      }

      setSavedRoadmaps((prev) => {
        const filtered = prev.filter(
          (r) => String(r._id || r.id) !== String(targetId) && String(r.title) !== String(targetId)
        );
        saveLocalRoadmaps(filtered);
        return filtered;
      });

      // 2. Perform backend API delete non-blocking in background
      try {
        await axios.delete(`/api/v1/roadmaps/${targetId}`);
      } catch (err) {
        console.warn('Backend delete error:', err);
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

        {activeRoadmap && (
          <div className="roadmap-display">
            <div className="roadmap-display-header">
              <h2>Current Roadmap: {activeRoadmap.title}</h2>
              <span className="roadmap-completion-count">
                {activeRoadmap.topics?.filter((t) => t.completed).length || 0} / {activeRoadmap.topics?.length || 0} completed
              </span>
            </div>
            <ul>
              {activeRoadmap.topics.map((item, index) => (
                <li key={index} className={`roadmap-item ${item.completed ? 'completed' : ''}`}>
                  <div className="roadmap-item-status">
                    {item.completed ? (
                      <span className="status-badge completed" title="Completed in Sandbox by watching tutorial video">
                        ✓ Completed
                      </span>
                    ) : (
                      <span className="status-badge pending" title="Watch full tutorial video in Sandbox to complete">
                        In Progress
                      </span>
                    )}
                  </div>
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
    </div>
  );
};

export default Pathways;
