import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AppDropdown from '../../components/AppDropdown';
import { AccessibleDialog } from '../../components/ui/AccessibleDialog';
import { AsyncState } from '../../components/ui/AsyncState';
import { AuthContext } from '../../context/AuthContext';
import axios, { apiProblemCode } from '../../lib/api';
import './AdminDashboard.css';

const roleOptions = [
  { label: 'Learner', value: 'learner' },
  { label: 'Moderator', value: 'moderator' },
  { label: 'Support', value: 'support' },
  { label: 'Superadmin', value: 'superadmin' },
];

function authorityError(error) {
  const code = apiProblemCode(error);
  const messages = {
    authority_revision_conflict: 'This record changed. Refresh before trying again.',
    authority_target_ineligible: 'The target must be active and verified for that authority.',
    last_active_superadmin_required: 'At least one active superadmin must remain.',
    recent_authentication_required: 'Sign in again before changing authority.',
    self_authority_change_denied: 'You cannot change your own platform authority here.',
    user_has_dependent_records:
      'This user owns protected records. Transfer or remove those records before permanently deleting the account.',
  };
  return messages[code] || 'The authority change could not be completed.';
}

function getInitials(name, email) {
  const str = (name || email || '?').trim();
  const parts = str.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return str.slice(0, 2).toUpperCase();
}

const AdminDashboard = () => {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('providers');
  const [pendingReviews, setPendingReviews] = useState([]);
  const [approvedReviews, setApprovedReviews] = useState([]);
  const [platformUsers, setPlatformUsers] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [auditAction, setAuditAction] = useState(null);
  const [auditReason, setAuditReason] = useState('');
  const [auditReasonError, setAuditReasonError] = useState('');
  const [auditSubmitting, setAuditSubmitting] = useState(false);

  const requestAuditAction = (action) => {
    setAuditReason('');
    setAuditReasonError('');
    setAuditAction(action);
  };

  const closeAuditAction = () => {
    if (auditSubmitting) return;
    setAuditAction(null);
    setAuditReason('');
    setAuditReasonError('');
  };

  const submitAuditAction = async (event) => {
    event.preventDefault();
    const reason = auditReason.trim();
    if (reason.length < 12) {
      setAuditReasonError('Enter at least 12 characters explaining why this action is required.');
      return;
    }
    setAuditSubmitting(true);
    try {
      await auditAction.run(reason);
      setAuditAction(null);
      setAuditReason('');
    } finally {
      setAuditSubmitting(false);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, approved, users, audits] = await Promise.all([
        axios.get('/api/v1/admin/provider-verifications?status=pending_review'),
        axios.get('/api/v1/admin/provider-verifications?status=approved'),
        axios.get('/api/v1/admin/users?limit=100'),
        axios.get('/api/v1/admin/audit-events?limit=50'),
      ]);
      setPendingReviews(pending.data.reviews || []);
      setApprovedReviews(approved.data.reviews || []);
      setPlatformUsers(users.data.users || []);
      setAuditEvents(audits.data.events || []);
      setMessage('');
    } catch (error) {
      setMessage(authorityError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || user.platformRole !== 'superadmin') {
      navigate('/dashboard', { replace: true });
      return;
    }
    loadData();
  }, [loadData, navigate, user]);

  const decideProvider = async (review, status) => {
    const providerName = review.organization?.name || 'provider';
    requestAuditAction({
      confirmLabel: status === 'approved' ? 'Approve provider' : 'Reject provider',
      description: `${status === 'approved' ? 'Approve' : 'Reject'} ${providerName}?`,
      destructive: status === 'rejected',
      title: 'Provider verification decision',
      run: async (reason) => {
        try {
          await axios.post(`/api/v1/admin/provider-verifications/${review.id}/decision`, {
            reason,
            status,
          });
          setMessage(`Provider ${status}.`);
          await loadData();
        } catch (error) {
          setMessage(authorityError(error));
        }
      },
    });
  };

  const updateRole = async (target, platformRole) => {
    if (platformRole === target.platformRole) return;
    requestAuditAction({
      confirmLabel: 'Change role',
      description: `Change ${target.displayName || target.email} from ${target.platformRole} to ${platformRole}?`,
      title: 'Change platform role',
      run: async (reason) => {
        try {
          const response = await axios.patch(`/api/v1/admin/users/${target.id}/platform-role`, {
            platformRole,
            reason,
            revision: target.authorityRevision,
          });
          setPlatformUsers((current) =>
            current.map((entry) => (entry.id === target.id ? response.data.user : entry)),
          );
          setAuditEvents((current) => [response.data.auditEvent, ...current].slice(0, 50));
          setMessage('Platform role updated; the target sessions were revoked.');
        } catch (error) {
          setMessage(authorityError(error));
        }
      },
    });
  };

  const updateStatus = async (target, status) => {
    if (status === target.status) return;
    requestAuditAction({
      confirmLabel: 'Update account',
      description: `Change ${target.displayName || target.email} from ${target.status} to ${status}?`,
      destructive: status === 'banned',
      title: 'Change account status',
      run: async (reason) => {
        try {
          const response = await axios.patch(`/api/v1/admin/users/${target.id}/status`, {
            reason,
            revision: target.authorityRevision,
            status,
          });
          setPlatformUsers((current) =>
            current.map((entry) => (entry.id === target.id ? response.data.user : entry)),
          );
          setAuditEvents((current) => [response.data.auditEvent, ...current].slice(0, 50));
          setMessage('Account status updated; active target sessions were revoked when required.');
        } catch (error) {
          setMessage(authorityError(error));
        }
      },
    });
  };

  const deleteUser = (target) => {
    requestAuditAction({
      confirmLabel: 'Permanently delete',
      description: `Permanently delete ${target.displayName || target.email} and all database records configured to cascade? This cannot be undone.`,
      destructive: true,
      title: 'Permanently delete platform user',
      run: async (reason) => {
        try {
          const response = await axios.delete(`/api/v1/admin/users/${target.id}`, {
            data: { reason, revision: target.authorityRevision },
          });
          setPlatformUsers((current) => current.filter((entry) => entry.id !== target.id));
          setAuditEvents((current) => [response.data.auditEvent, ...current].slice(0, 50));
          setMessage('User and cascade-owned database records permanently deleted; the action was audited.');
        } catch (error) {
          setMessage(authorityError(error));
        }
      },
    });
  };

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return platformUsers;
    return platformUsers.filter((entry) =>
      [entry.displayName, entry.email, entry.username, entry.platformRole, entry.status]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [platformUsers, search]);

  if (loading) {
    return (
      <AsyncState
        label="Loading administration controls"
        title="Loading audited administration controls…"
        type="loading"
      />
    );
  }

  return (
    <div className="admin-dashboard neo-container">
      <header className="admin-header">
        <div>
          <h1 className="neo-title">Sentinel Command</h1>
          <p className="subtitle">Audited provider and platform authority workflows</p>
        </div>
        <div className="admin-tabs" aria-label="Administration sections" role="group">
          <button
            aria-pressed={activeTab === 'providers'}
            className={activeTab === 'providers' ? 'active' : ''}
            onClick={() => setActiveTab('providers')}
            type="button"
          >
            Providers
          </button>
          <button
            aria-pressed={activeTab === 'users'}
            className={activeTab === 'users' ? 'active' : ''}
            onClick={() => setActiveTab('users')}
            type="button"
          >
            Users
          </button>
          <button
            aria-pressed={activeTab === 'audit'}
            className={activeTab === 'audit' ? 'active' : ''}
            onClick={() => setActiveTab('audit')}
            type="button"
          >
            Audit
          </button>
        </div>
      </header>

      {message && (
        <p className="admin-status-message" role="status">
          <span>ℹ️</span> {message}
        </p>
      )}

      {activeTab === 'providers' && (
        <>
          <section className="admin-section">
            <div className="section-header">
              <h2>Verification queue</h2>
              <span className="badge pending-badge">{pendingReviews.length} pending</span>
            </div>
            {pendingReviews.length === 0 ? (
              <div className="empty-state-card">
                <span className="empty-icon">✓</span>
                <h3>Queue clear</h3>
                <p>No provider review needs a decision.</p>
              </div>
            ) : (
              <div className="admin-table-container">
                <table className="admin-table hoverable">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Statement</th>
                      <th>Submitted</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingReviews.map((review) => (
                      <tr key={review.id}>
                        <td>
                          <strong>{review.organization?.name || review.organizationId}</strong>
                        </td>
                        <td>{review.statement}</td>
                        <td>{new Date(review.submittedAt).toLocaleDateString()}</td>
                        <td className="admin-actions-cell">
                          <div className="admin-actions">
                            <button
                              className="neo-button primary small"
                              onClick={() => decideProvider(review, 'approved')}
                              type="button"
                            >
                              Approve
                            </button>
                            <button
                              className="neo-button danger outline small"
                              onClick={() => decideProvider(review, 'rejected')}
                              type="button"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="admin-section">
            <div className="section-header">
              <h2>Approved providers</h2>
              <span className="badge approved-badge">{approvedReviews.length} approved</span>
            </div>
            {approvedReviews.length === 0 ? (
              <div className="empty-state-card">
                <span className="empty-icon">📂</span>
                <h3>No approved providers</h3>
                <p>Approved providers will appear here once verified.</p>
              </div>
            ) : (
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Decision reason</th>
                      <th>Reviewed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvedReviews.map((review) => (
                      <tr key={review.id}>
                        <td>
                          <strong>{review.organization?.name || review.organizationId}</strong>
                        </td>
                        <td>{review.decisionReason || 'Approved'}</td>
                        <td>{new Date(review.reviewedAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === 'users' && (
        <section className="admin-section">
          <div className="section-header">
            <h2>Platform users</h2>
            <span className="badge approved-badge">{filteredUsers.length} users</span>
          </div>
          <div className="admin-search-wrapper">
            <span className="admin-search-icon">
              <svg fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" x2="16.65" y1="21" y2="16.65" />
              </svg>
            </span>
            <input
              aria-label="Search platform users"
              className="admin-search-input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, role, or status…"
              type="search"
              value={search}
            />
            {search && (
              <button
                aria-label="Clear search"
                className="admin-search-clear"
                onClick={() => setSearch('')}
                type="button"
              >
                ✕
              </button>
            )}
          </div>

          {filteredUsers.length === 0 ? (
            <div className="empty-state-card">
              <span className="empty-icon">🔍</span>
              <h3>No matching users</h3>
              <p>No user accounts matched your search criteria.</p>
            </div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-table hoverable">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Verified</th>
                    <th>Status</th>
                    <th>Role</th>
                    <th>Account actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((entry) => {
                    const isSelf = entry.id === user.id;
                    const displayName = entry.displayName || entry.username || entry.email;
                    const initials = getInitials(displayName, entry.email);
                    return (
                      <tr
                        className={entry.platformRole === 'superadmin' ? 'superadmin-row' : ''}
                        key={entry.id}
                      >
                        <td>
                          <div className="user-cell">
                            <div className="user-avatar">{initials}</div>
                            <div className="user-info">
                              <strong>{displayName}</strong>
                              <small>{entry.email}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`verified-pill ${
                              entry.emailVerified ? 'verified' : 'unverified'
                            }`}
                          >
                            {entry.emailVerified ? '✓ Verified' : '• Unverified'}
                          </span>
                        </td>
                        <td>
                          <span className={`role-pill ${entry.status}`}>
                            <span className="status-dot" />
                            {entry.status}
                          </span>
                        </td>
                        <td>
                          {isSelf ? (
                            <span className="frozen-text">
                              Superadmin <span className="frozen-tag">current account</span>
                            </span>
                          ) : (
                            <AppDropdown
                              label={`Platform role for ${entry.username}`}
                              options={roleOptions}
                              value={entry.platformRole}
                              onChange={(value) => updateRole(entry, value)}
                            />
                          )}
                        </td>
                        <td className="admin-actions-cell">
                          <div className="admin-actions">
                            {!isSelf && entry.status === 'active' && (
                              <>
                                <button
                                  className="neo-button warning outline small"
                                  onClick={() => updateStatus(entry, 'suspended')}
                                  type="button"
                                >
                                  Suspend
                                </button>
                                <button
                                  className="neo-button danger outline small"
                                  onClick={() => updateStatus(entry, 'banned')}
                                  type="button"
                                >
                                  Ban
                                </button>
                              </>
                            )}
                            {!isSelf && entry.status !== 'active' && (
                              <button
                                className="neo-button primary small"
                                onClick={() => updateStatus(entry, 'active')}
                                type="button"
                              >
                                Restore
                              </button>
                            )}
                            {!isSelf && (
                              <button
                                className="neo-button danger small"
                                onClick={() => deleteUser(entry)}
                                type="button"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'audit' && (
        <section className="admin-section">
          <div className="section-header">
            <h2>Append-only authority audit</h2>
            <span className="badge approved-badge">{auditEvents.length} events</span>
          </div>
          {auditEvents.length === 0 ? (
            <div className="empty-state-card">
              <span className="empty-icon">📋</span>
              <h3>No audit logs</h3>
              <p>Authority change events will be logged here in order.</p>
            </div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-table hoverable">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Target</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{new Date(event.occurredAt).toLocaleString()}</td>
                      <td>
                        <strong>{event.action.replaceAll('_', ' ')}</strong>
                      </td>
                      <td>{event.actorUserId || event.operatorReference || 'bootstrap'}</td>
                      <td>{event.targetUserId}</td>
                      <td>{event.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {auditAction && (
        <AccessibleDialog
          label={auditAction.title}
          onClose={closeAuditAction}
          overlayClassName="admin-audit-dialog-backdrop"
          surfaceClassName="admin-audit-dialog"
        >
          <form onSubmit={submitAuditAction}>
            <div className="admin-audit-dialog-heading">
              <div>
                <p className="admin-audit-kicker">Audited action</p>
                <h2>{auditAction.title}</h2>
              </div>
              <button
                aria-label="Close audit reason dialog"
                className="admin-audit-close"
                disabled={auditSubmitting}
                onClick={closeAuditAction}
                type="button"
              >
                ×
              </button>
            </div>
            <p className="admin-audit-description">{auditAction.description}</p>
            <label className="admin-audit-label" htmlFor="admin-audit-reason">
              Audit reason
            </label>
            <textarea
              aria-describedby="admin-audit-help admin-audit-error"
              autoFocus
              id="admin-audit-reason"
              maxLength="500"
              onChange={(event) => {
                setAuditReason(event.target.value);
                if (auditReasonError) setAuditReasonError('');
              }}
              placeholder="Explain why this administrative action is required"
              rows="4"
              value={auditReason}
            />
            <div className="admin-audit-field-meta">
              <span id="admin-audit-help">Minimum 12 characters</span>
              <span>{auditReason.trim().length}/500</span>
            </div>
            {auditReasonError && (
              <p className="admin-audit-error" id="admin-audit-error" role="alert">
                {auditReasonError}
              </p>
            )}
            <div className="admin-audit-dialog-actions">
              <button
                className="neo-button"
                disabled={auditSubmitting}
                onClick={closeAuditAction}
                type="button"
              >
                Cancel
              </button>
              <button
                className={`neo-button ${auditAction.destructive ? 'danger' : 'primary'}`}
                disabled={auditSubmitting}
                type="submit"
              >
                {auditSubmitting ? 'Saving…' : auditAction.confirmLabel}
              </button>
            </div>
          </form>
        </AccessibleDialog>
      )}
    </div>
  );
};

export default AdminDashboard;
