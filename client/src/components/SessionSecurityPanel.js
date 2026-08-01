import { useCallback, useContext, useEffect, useState } from 'react';

import { AuthContext } from '../context/AuthContext';

const SessionSecurityPanel = () => {
  const {
    listSessions,
    logout,
    logoutAll,
    requestEmailVerification,
    requestPasswordReset,
    revokeSession,
    user,
  } = useContext(AuthContext);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await listSessions());
      setMessage('');
    } catch {
      setMessage('Sessions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [listSessions]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const requestVerification = async () => {
    try {
      await requestEmailVerification();
      setMessage('If verification is needed, instructions have been queued.');
    } catch {
      setMessage('Verification instructions could not be requested.');
    }
  };

  const requestReset = async () => {
    try {
      await requestPasswordReset(user.email);
      setMessage('If eligible, password-reset instructions have been queued.');
    } catch {
      setMessage('Password-reset instructions could not be requested.');
    }
  };

  const revoke = async (session) => {
    try {
      await revokeSession(session.id);
      if (session.current) {
        await logout();
        return;
      }
      await loadSessions();
      setMessage('Session revoked.');
    } catch {
      setMessage('That session could not be revoked.');
    }
  };

  return (
    <div className="settings-section active-section">
      <div className="section-header">
        <div className="section-icon security-icon" aria-hidden="true">
          SEC
        </div>
        <div>
          <h2>Account security</h2>
          <p>Email verification, password recovery, and signed-in devices</p>
        </div>
      </div>
      <div className="section-content security-panel">
        <div className="security-summary">
          <div>
            <strong>{user.email}</strong>
            <p>{user.emailVerified ? 'Email verified' : 'Email verification required'}</p>
          </div>
          {!user.emailVerified && (
            <button className="reset-btn" onClick={requestVerification} type="button">
              Send verification email
            </button>
          )}
          <button className="reset-btn" onClick={requestReset} type="button">
            Reset password
          </button>
        </div>

        <h3 className="subsection-title">Active sessions</h3>
        {loading ? (
          <p>Loading sessions...</p>
        ) : sessions.length ? (
          <div className="session-list">
            {sessions.map((session) => (
              <div className="session-row" key={session.id}>
                <div>
                  <strong>
                    {session.current ? 'This device' : session.client || 'Web session'}
                  </strong>
                  <p>
                    {session.userAgent || 'Unknown browser'} - Last used{' '}
                    {new Date(session.lastUsedAt).toLocaleString()}
                  </p>
                </div>
                <button className="reset-btn" onClick={() => revoke(session)} type="button">
                  Revoke
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p>No active sessions were returned.</p>
        )}
        <button className="reset-btn" onClick={logoutAll} type="button">
          Sign out every device
        </button>
        {message && (
          <p className="security-message" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

export default SessionSecurityPanel;
