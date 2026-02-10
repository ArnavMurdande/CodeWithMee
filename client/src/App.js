import React, { useState, useContext, Component } from 'react';
import { Route, Routes, useLocation, Navigate } from 'react-router-dom';
import { AuthContext } from './context/AuthContext';
// Import Components
import AnimatedBackground from './components/AnimatedBackground';
import CustomCursor from './components/CustomCursor';
import ScrollProgress from './components/ScrollProgress';
import Header from './components/Header';

// Import Pages
import HomePage from './pages/HomePage';
import Auth from './pages/Auth';
import Sandbox from './pages/Sandbox';
import Pathways from './pages/Pathways';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Challenges from './pages/Challenges';
import CreateChallenge from './pages/CreateChallenge';
import ChallengeSolver from './pages/ChallengeSolver';

// Import Styles
import './App.css';

// --- FIX FOR RESIZE OBSERVER ERROR ---
// This component catches specific, non-critical errors and prevents the app from crashing.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    // Check if it's the specific ResizeObserver error
    if (error.message && error.message.includes('ResizeObserver loop completed with undelivered notifications')) {
      // It's the error we want to ignore, so we don't update state to show a fallback UI
      console.warn('Ignored ResizeObserver loop error.');
      return { hasError: false };
    }
    // For other errors, trigger the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log other errors, but not the ResizeObserver one
    if (!error.message.includes('ResizeObserver loop completed with undelivered notifications')) {
      console.error("Uncaught error:", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return <h1>Something went wrong. Please refresh the page.</h1>;
    }
    return this.props.children;
  }
}


const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useContext(AuthContext);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'white' }}>
        <h2>Loading...</h2>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/auth" />;
};

function App() {
  const location = useLocation();
  const { isAuthenticated } = useContext(AuthContext);

  const [viewRoadmapsHandler, setViewRoadmapsHandler] = useState(null);
  const [pageTitle, setPageTitle] = useState('');

  const showHeader = location.pathname !== '/auth';

  return (
    <div className="app-container">
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>

      <CustomCursor />
      <ScrollProgress />
      <AnimatedBackground />

      {showHeader && <Header onViewRoadmapsClick={viewRoadmapsHandler} pageTitle={pageTitle} />}

      <main className={!showHeader ? 'no-header-padding' : ''}>
        <Routes>
            <Route path="/" element={<HomePage />} />
            <Route
              path="/auth"
              element={isAuthenticated ? <Navigate to="/dashboard" /> : <Auth />}
            />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route
              path="/pathways"
              element={
                <ProtectedRoute>
                  <Pathways setViewRoadmapsHandler={setViewRoadmapsHandler} />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sandbox"
              element={
                <ProtectedRoute>
                  <ErrorBoundary>
                    <Sandbox setPageTitle={setPageTitle} />
                  </ErrorBoundary>
                </ProtectedRoute>
              }
            />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/challenges" element={<ProtectedRoute><Challenges /></ProtectedRoute>} />
            <Route path="/challenges/new" element={<ProtectedRoute><CreateChallenge /></ProtectedRoute>} />
            <Route path="/challenges/:id" element={<ProtectedRoute><ChallengeSolver /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
      </main>
      
      {/* Moved Cursor to bottom to ensure z-index stacking works best */}
      <CustomCursor />
    </div>
  );
}

export default App;