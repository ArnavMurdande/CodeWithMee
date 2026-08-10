import { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AsyncState } from '../components/ui/AsyncState';
import { AuthContext } from '../context/AuthContext';
import { getUserStorageKey } from '../lib/cache-isolation';
import axios from '../lib/api';

// --- Helper Functions and Data ---

const motivationalQuotes = [
  'The journey of a thousand miles begins with a single step.',
  'The secret of getting ahead is getting started.',
  "Don't watch the clock; do what it does. Keep going.",
  'The only way to do great work is to love what you do.',
  "Believe you can and you're halfway there.",
  'The future belongs to those who believe in the beauty of their dreams.',
  'Success is not final, failure is not fatal: it is the courage to continue that counts.',
  'It does not matter how slowly you go as long as you do not stop.',
  'Start where you are. Use what you have. Do what you can.',
  'The expert in anything was once a beginner.',
  'A little progress each day adds up to big results.',
];

// Gets a different quote each time
const getMotivationalQuote = (() => {
  let lastIndex = -1;
  return () => {
    let newIndex;
    do {
      newIndex = Math.floor(Math.random() * motivationalQuotes.length);
    } while (newIndex === lastIndex);
    lastIndex = newIndex;
    return motivationalQuotes[newIndex];
  };
})();

const calculateRoadmapProgress = (roadmap) => {
  if (!roadmap || !roadmap.topics || roadmap.topics.length === 0) return 0;
  const completedTopics = roadmap.topics.filter((t) => t.completed).length;
  const totalTopics = roadmap.topics.length;
  return Math.round((completedTopics / totalTopics) * 100);
};

// --- Sub-components for Dashboard Cards ---

const RoadmapCard = ({ roadmaps, loading }) => {
  const navigate = useNavigate();
  return (
    <div className="dashboard-card roadmaps">
      <div className="card-header">
        <h3>My Roadmaps</h3>
        <span className="card-icon">🗺️</span>
      </div>
      <div
        className={`card-content ${!loading && (!roadmaps || roadmaps.length === 0) ? 'empty' : ''}`}
      >
        {loading ? (
          <div style={{ opacity: 0.6, padding: '1rem 0' }}>
            <p className="stat-label">Loading your learning pathways…</p>
          </div>
        ) : roadmaps && roadmaps.length > 0 ? (
          <>
            <p className="stat-number">{roadmaps.length}</p>
            <p className="stat-label">learning paths created</p>
            <div className="progress-list">
              {roadmaps.slice(0, 3).map((roadmap, index) => (
                <button
                  className="progress-item"
                  key={roadmap._id || index}
                  onClick={() => navigate('/pathways')}
                  type="button"
                >
                  <span className="progress-title">{roadmap.title}</span>
                  <span
                    aria-label={`${roadmap.title} progress`}
                    aria-valuemax="100"
                    aria-valuemin="0"
                    aria-valuenow={calculateRoadmapProgress(roadmap)}
                    className="progress-bar-container"
                    role="progressbar"
                  >
                    <span
                      className="progress-bar"
                      style={{ width: `${calculateRoadmapProgress(roadmap)}%` }}
                    />
                  </span>
                  <span className="progress-percent">{calculateRoadmapProgress(roadmap)}%</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="motivational-quote">"{getMotivationalQuote()}"</p>
            <Link to="/pathways" className="card-button">
              Create a Pathway
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

const CoursesCard = ({ courses, loading }) => {
  const navigate = useNavigate();
  return (
    <div className="dashboard-card courses">
      <div className="card-header">
        <h3>My Courses</h3>
        <span className="card-icon">🎓</span>
      </div>
      <div
        className={`card-content ${!loading && (!courses || courses.length === 0) ? 'empty' : ''}`}
      >
        {loading ? (
          <div style={{ opacity: 0.6, padding: '1rem 0' }}>
            <p className="stat-label">Loading courses…</p>
          </div>
        ) : courses && courses.length > 0 ? (
          <>
            <p className="stat-number">{courses.length}</p>
            <p className="stat-label">courses enrolled</p>
            <div className="notes-list">
              {courses.slice(0, 3).map((enrollment, index) => {
                const course = enrollment.course || enrollment;
                return (
                  <button
                    className="note-item"
                    key={enrollment._id || index}
                    onClick={() => navigate('/courses')}
                    style={{ cursor: 'pointer', display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: 'inherit' }}
                    type="button"
                  >
                    <strong>{course.title || 'Untitled Course'}</strong>
                    {course.company?.companyName && (
                      <span style={{ fontSize: '0.8rem', color: '#aaa', marginLeft: '8px' }}>
                        ({course.company.companyName})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="motivational-quote">"{getMotivationalQuote()}"</p>
            <Link to="/courses" className="card-button">
              Explore Courses
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

const NotesCard = ({ notes, loading }) => {
  return (
    <div className="dashboard-card notes">
      <div className="card-header">
        <h3>My Notes</h3>
        <span className="card-icon">📝</span>
      </div>
      <div
        className={`card-content ${!loading && (!notes || notes.length === 0) ? 'empty' : ''}`}
      >
        {loading ? (
          <div style={{ opacity: 0.6, padding: '1rem 0' }}>
            <p className="stat-label">Loading notes…</p>
          </div>
        ) : notes && notes.length > 0 ? (
          <>
            <p className="stat-number">{notes.length}</p>
            <p className="stat-label">notes taken</p>
            <div className="notes-list">
              {notes.slice(0, 4).map((note, index) => (
                <p className="note-item" key={note._id || index}>
                  {note.title || 'Untitled Note'}
                </p>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="motivational-quote">"{getMotivationalQuote()}"</p>
            <p className="card-guidance">Open Notes from the note button in the app shell.</p>
          </>
        )}
      </div>
    </div>
  );
};

const ChallengesCard = ({ challenges }) => {
  return (
    <div className="dashboard-card challenges">
      <div className="card-header">
        <h3>Challenges</h3>
        <span className="card-icon">🏆</span>
      </div>
      <div className={`card-content ${!challenges || challenges.length === 0 ? 'empty' : ''}`}>
        {challenges && challenges.length > 0 ? (
          <>
            <p className="stat-number">{challenges.length}</p>
            <p className="stat-label">challenges solved</p>
          </>
        ) : (
          <>
            <p className="motivational-quote">"{getMotivationalQuote()}"</p>
            <Link to="/challenges" className="card-button">
              Start a Challenge
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

const mergeRoadmaps = (listA = [], listB = []) => {
  const map = new Map();
  [...listA, ...listB].forEach((r) => {
    if (!r) return;
    const key = String(r._id || r.id || r.title || '');
    if (key && key !== 'undefined') {
      const existing = map.get(key);
      if (!existing || (r.topics && r.topics.length >= (existing.topics?.length || 0))) {
        map.set(key, r);
      }
    }
  });
  return Array.from(map.values());
};

// --- Main Dashboard Component ---

const Dashboard = () => {
  const { user } = useContext(AuthContext);

  const getStorageKey = () => getUserStorageKey(user?.id, 'saved_roadmaps');
  const getNotesStorageKey = () => getUserStorageKey(user?.id, 'saved_notes');

  const getInitialRoadmaps = () => {
    try {
      const cached = localStorage.getItem(getStorageKey());
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      /* ignore */
    }
    return user?.roadmaps && Array.isArray(user.roadmaps) ? user.roadmaps : [];
  };

  const getInitialNotes = () => {
    try {
      const cached = localStorage.getItem(getNotesStorageKey());
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      /* ignore */
    }
    return user?.notes && Array.isArray(user.notes) ? user.notes : [];
  };

  const initialRoadmaps = getInitialRoadmaps();
  const initialNotes = getInitialNotes();

  const [roadmaps, setRoadmaps] = useState(initialRoadmaps);
  const [courses, setCourses] = useState(() => user?.enrolledCourses || []);
  const [notes, setNotes] = useState(initialNotes);
  const [loading, setLoading] = useState(
    () => initialRoadmaps.length === 0 && initialNotes.length === 0,
  );

  useEffect(() => {
    let active = true;

    if (user?.roadmaps && Array.isArray(user.roadmaps) && user.roadmaps.length > 0) {
      setRoadmaps((prev) => (prev.length === 0 ? user.roadmaps : prev));
    }

    if (user?.notes && Array.isArray(user.notes) && user.notes.length > 0) {
      setNotes((prev) => (prev.length === 0 ? user.notes : prev));
    }

    const fetchDashboardData = async () => {
      try {
        const [roadmapsRes, coursesRes, notesRes] = await Promise.allSettled([
          axios.get('/api/v1/roadmaps/my-roadmaps'),
          axios.get('/api/v1/courses/me/enrollments'),
          axios.get('/api/v1/learning/notes'),
        ]);

        if (!active) return;

        if (roadmapsRes.status === 'fulfilled' && Array.isArray(roadmapsRes.value.data)) {
          const freshRoadmaps = roadmapsRes.value.data;
          const merged = mergeRoadmaps(initialRoadmaps, freshRoadmaps);
          setRoadmaps(merged);
          try {
            localStorage.setItem(getStorageKey(), JSON.stringify(merged));
          } catch {
            /* ignore */
          }
        } else if (user?.roadmaps) {
          const merged = mergeRoadmaps(initialRoadmaps, user.roadmaps);
          setRoadmaps(merged);
        }

        if (coursesRes.status === 'fulfilled') {
          setCourses(coursesRes.value.data?.enrollments || []);
        }

        if (notesRes.status === 'fulfilled' && Array.isArray(notesRes.value.data)) {
          const freshNotes = notesRes.value.data;
          setNotes(freshNotes);
          try {
            localStorage.setItem(getNotesStorageKey(), JSON.stringify(freshNotes));
          } catch {
            /* ignore */
          }
        } else if (user?.notes) {
          setNotes(user.notes);
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchDashboardData();

    return () => {
      active = false;
    };
  }, [user]);

  const welcomeMessage = useMemo(() => {
    const hour = new Date().getHours();
    const name = user?.username ? user.username.split(' ')[0] : 'Coder';
    if (hour < 12) return `Good morning, ${name}!`;
    if (hour < 18) return `Good afternoon, ${name}!`;
    return `Good evening, ${name}!`;
  }, [user]);

  if (!user) {
    return <AsyncState label="Loading dashboard" title="Loading your dashboard…" type="loading" />;
  }

  return (
    <div className="dashboard-container">
      <h1 className="dashboard-welcome">{welcomeMessage}</h1>
      <div className="dashboard-grid">
        <RoadmapCard roadmaps={roadmaps} loading={loading} />
        <CoursesCard courses={courses} loading={loading} />
        <NotesCard notes={notes} loading={loading} />
        <ChallengesCard challenges={user?.challenges} />
      </div>
    </div>
  );
};
export default Dashboard;
