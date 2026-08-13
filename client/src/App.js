import { lazy, Suspense, useContext, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import AppErrorBoundary from './components/AppErrorBoundary';
import AppShell from './components/AppShell';
import { AsyncState } from './components/ui/AsyncState';
import { AuthContext } from './context/AuthContext';
import { ThemeContext } from './context/ThemeContext';
import './styles/route-styles.css';
import './styles/responsive.css';

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const Auth = lazy(() => import('./pages/Auth'));
const Challenges = lazy(() => import('./pages/Challenges'));
const ChallengeSolver = lazy(() => import('./pages/ChallengeSolver'));
const Courses = lazy(() => import('./pages/Courses'));
const CreateChallenge = lazy(() => import('./pages/CreateChallenge'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const HomePage = lazy(() => import('./pages/HomePage'));
const Pathways = lazy(() => import('./pages/Pathways'));
const ProviderCenter = lazy(() => import('./pages/ProviderCenter'));
const Profile = lazy(() => import('./pages/Profile'));
const Sandbox = lazy(() => import('./pages/Sandbox'));
const Settings = lazy(() => import('./pages/Settings'));
const Space = lazy(() => import('./pages/Space'));

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading, user } = useContext(AuthContext);

  if (loading) {
    return (
      <AsyncState
        description="Restoring your secure session."
        label="Restoring session"
        title="Opening your workspace…"
        type="loading"
      />
    );
  }

  if (!isAuthenticated) return <Navigate replace to="/auth" />;
  if (user?.emailVerified !== true) {
    return <Navigate replace to="/auth?mode=verify-pending" />;
  }
  return children;
};

const NotFoundRoute = () => (
  <AsyncState
    action={
      <Link className="cwm-button cwm-button--primary" to="/">
        Return home
      </Link>
    }
    description="The link may be outdated, or the page has moved to a versioned workspace."
    label="Page not found"
    title="This page is not available"
    type="empty"
  />
);

const RouteLoadingState = () => (
  <AsyncState
    description="Loading only the code needed for this page."
    label="Loading page"
    title="Opening this page…"
    type="loading"
  />
);

function App() {
  const location = useLocation();
  const { isAuthenticated, user } = useContext(AuthContext);
  const { theme } = useContext(ThemeContext);
  const [viewRoadmapsHandler, setViewRoadmapsHandler] = useState(null);
  const [pageTitle, setPageTitle] = useState('');
  const showHeader = location.pathname !== '/auth';
  const hasWorkspaceAccess = isAuthenticated && user?.emailVerified === true;

  return (
    <AppErrorBoundary>
      <AppShell
        headerProps={{ onViewRoadmapsClick: viewRoadmapsHandler, pageTitle }}
        isAuthenticated={hasWorkspaceAccess}
        showHeader={showHeader}
        theme={theme}
      >
        <Suspense fallback={<RouteLoadingState />}>
          <Routes>
            <Route element={<HomePage />} path="/" />
            <Route
              element={
                isAuthenticated && user?.emailVerified === true ? (
                  <Navigate replace to="/dashboard" />
                ) : (
                  <Auth />
                )
              }
              path="/auth"
            />
            <Route
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
              path="/dashboard"
            />
            <Route
              element={
                <ProtectedRoute>
                  <Pathways setViewRoadmapsHandler={setViewRoadmapsHandler} />
                </ProtectedRoute>
              }
              path="/pathways"
            />
            <Route
              element={
                <ProtectedRoute>
                  <Sandbox setPageTitle={setPageTitle} />
                </ProtectedRoute>
              }
              path="/sandbox"
            />
            <Route
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
              path="/profile"
            />
            <Route
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
              path="/settings"
            />
            <Route
              element={
                <ProtectedRoute>
                  <ProviderCenter />
                </ProtectedRoute>
              }
              path="/provider"
            />
            <Route
              element={
                <ProtectedRoute>
                  <Challenges />
                </ProtectedRoute>
              }
              path="/challenges"
            />
            <Route
              element={
                <ProtectedRoute>
                  <CreateChallenge />
                </ProtectedRoute>
              }
              path="/challenges/new"
            />
            <Route
              element={
                <ProtectedRoute>
                  <ChallengeSolver />
                </ProtectedRoute>
              }
              path="/challenges/:id"
            />
            <Route
              element={
                <ProtectedRoute>
                  <Courses />
                </ProtectedRoute>
              }
              path="/courses"
            />
            <Route
              element={
                <ProtectedRoute>
                  <Space />
                </ProtectedRoute>
              }
              path="/space"
            />
            <Route element={<Navigate replace to="/dashboard" />} path="/company/dashboard" />
            <Route
              element={
                <ProtectedRoute>
                  {user?.platformRole === 'superadmin' ? (
                    <AdminDashboard />
                  ) : (
                    <Navigate replace to="/dashboard" />
                  )}
                </ProtectedRoute>
              }
              path="/admin"
            />
            <Route element={<NotFoundRoute />} path="*" />
          </Routes>
        </Suspense>
      </AppShell>
    </AppErrorBoundary>
  );
}

export default App;
