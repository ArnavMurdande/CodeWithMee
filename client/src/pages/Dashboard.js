import { useContext, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AsyncState } from '../components/ui/AsyncState';
import { AuthContext } from '../context/AuthContext';

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

const RoadmapCard = ({ roadmaps }) => {
  const navigate = useNavigate();
  return (
    <div className="dashboard-card roadmaps">
      <div className="card-header">
        <h3>My Roadmaps</h3>
        <span className="card-icon">🗺️</span>
      </div>
      <div className={`card-content ${!roadmaps || roadmaps.length === 0 ? 'empty' : ''}`}>
        {roadmaps && roadmaps.length > 0 ? (
          <>
            <p className="stat-number">{roadmaps.length}</p>
            <p className="stat-label">learning paths created</p>
            <div className="progress-list">
              {roadmaps.slice(0, 3).map((roadmap, index) => (
                <button
                  className="progress-item"
                  key={index}
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

const NotesCard = ({ notes }) => {
  return (
    <div className="dashboard-card notes">
      <div className="card-header">
        <h3>My Notes</h3>
        <span className="card-icon">📝</span>
      </div>
      <div className={`card-content ${!notes || notes.length === 0 ? 'empty' : ''}`}>
        {notes && notes.length > 0 ? (
          <>
            <p className="stat-number">{notes.length}</p>
            <p className="stat-label">notes taken</p>
            <div className="notes-list">
              {notes.slice(0, 4).map((note, index) => (
                <p className="note-item" key={index}>
                  {note.title}
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
            {/* You can add more details about challenges here if you want */}
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

// --- Main Dashboard Component ---

const Dashboard = () => {
  const { user } = useContext(AuthContext);

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
        <RoadmapCard roadmaps={user.roadmaps} />
        <NotesCard notes={user.notes} />
        <ChallengesCard challenges={user.challenges} />
      </div>
    </div>
  );
};

export default Dashboard;
