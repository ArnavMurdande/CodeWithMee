import React, { useContext, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import './Dashboard.css';

// --- Helper Functions and Data ---

const motivationalQuotes = [
  "The journey of a thousand miles begins with a single step.",
  "The secret of getting ahead is getting started.",
  "Don't watch the clock; do what it does. Keep going.",
  "The only way to do great work is to love what you do.",
  "Believe you can and you're halfway there.",
  "The future belongs to those who believe in the beauty of their dreams.",
  "Success is not final, failure is not fatal: it is the courage to continue that counts.",
  "It does not matter how slowly you go as long as you do not stop.",
  "Start where you are. Use what you have. Do what you can.",
  "The expert in anything was once a beginner.",
  "A little progress each day adds up to big results."
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
    const completedTopics = roadmap.topics.filter(t => t.completed).length;
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
                                <div className="progress-item" key={index} onClick={() => navigate('/pathways')}>
                                    <span className="progress-title">{roadmap.title}</span>
                                    <div className="progress-bar-container">
                                        <div className="progress-bar" style={{ width: `${calculateRoadmapProgress(roadmap)}%` }}></div>
                                    </div>
                                    <span className="progress-percent">{calculateRoadmapProgress(roadmap)}%</span>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <p className="motivational-quote">"{getMotivationalQuote()}"</p>
                        <Link to="/pathways" className="card-button">Create a Pathway</Link>
                    </>
                )}
            </div>
        </div>
    );
};

const JobSimsCard = ({ jobSims }) => {
    const navigate = useNavigate();
    return (
        <div className="dashboard-card job-sims">
            <div className="card-header">
                <h3>Job Sims</h3>
                 <span className="card-icon">💼</span>
            </div>
            <div className={`card-content ${!jobSims || jobSims.length === 0 ? 'empty' : ''}`}>
                 {jobSims && jobSims.length > 0 ? (
                    <>
                        <p className="stat-number">{jobSims.length}</p>
                        <p className="stat-label">simulations enrolled</p>
                        <div className="progress-list">
                            {jobSims.slice(0, 3).map((sim, index) => (
                                <div className="progress-item" key={index} onClick={() => navigate('/simulations')}>
                                    <span className="progress-title">{sim.title}</span>
                                    <div className="progress-bar-container">
                                        <div className="progress-bar" style={{ width: `${sim.progress}%` }}></div>
                                    </div>
                                    <span className="progress-percent">{sim.progress}%</span>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <p className="motivational-quote">"{getMotivationalQuote()}"</p>
                         <Link to="/simulations" className="card-button">Coming Soon</Link>
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
                                <p className="note-item" key={index}>{note.title}</p>
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <p className="motivational-quote">"{getMotivationalQuote()}"</p>
                        <Link to="/notes" className="card-button">Coming Soon</Link>
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
                         <Link to="/challenges" className="card-button">Start a Challenge</Link>
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
    return <div className="dashboard-container"><h2>Loading dashboard...</h2></div>;
  }

  // NOTE: For demonstration, I'm passing empty arrays to the new cards.
  // When you build out those features, this will automatically populate with user data.
  return (
    <div className="dashboard-container">
      <h1 className="dashboard-welcome">{welcomeMessage}</h1>
      <div className="dashboard-grid">
        <RoadmapCard roadmaps={user.roadmaps} />
        <JobSimsCard jobSims={user.jobSims} />
        <NotesCard notes={user.notes} />
        <ChallengesCard challenges={user.challenges} />
      </div>
    </div>
  );
};

export default Dashboard;

