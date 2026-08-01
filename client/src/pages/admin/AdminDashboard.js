import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AppDropdown from '../../components/AppDropdown';
import { AsyncState } from '../../components/ui/AsyncState';
import { AuthContext } from '../../context/AuthContext';
import axios, { apiProblemCode } from '../../lib/api';

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
  };
  return messages[code] || 'The authority change could not be completed.';
}

function requestReason(promptText) {
  const reason = window.prompt(`${promptText}\n\nEnter an audit reason (at least 12 characters):`);
  if (reason == null) return null;
  if (reason.trim().length < 12) {
    window.alert('An audit reason of at least 12 characters is required.');
    return null;
  }
  return reason.trim();
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
    const reason = requestReason(
      `${status === 'approved' ? 'Approve' : 'Reject'} ${review.organization?.name || 'provider'}?`,
    );
    if (!reason) return;
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
  };

  const updateRole = async (target, platformRole) => {
    if (platformRole === target.platformRole) return;
    const reason = requestReason(
      `Change ${target.displayName || target.email} from ${target.platformRole} to ${platformRole}?`,
    );
    if (!reason) return;
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
  };

  const updateStatus = async (target, status) => {
    if (status === target.status) return;
    const reason = requestReason(
      `Change ${target.displayName || target.email} from ${target.status} to ${status}?`,
    );
    if (!reason) return;
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
          {message}
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
                        <td className="admin-actions">
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
                      <td>{review.organization?.name || review.organizationId}</td>
                      <td>{review.decisionReason || 'Approved'}</td>
                      <td>{new Date(review.reviewedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {activeTab === 'users' && (
        <section className="admin-section">
          <div className="section-header">
            <h2>Platform users</h2>
          </div>
          <div className="admin-search-wrapper">
            <input
              aria-label="Search platform users"
              className="admin-search-input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, role, or status"
              type="search"
              value={search}
            />
          </div>
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
                  return (
                    <tr
                      className={entry.platformRole === 'superadmin' ? 'superadmin-row' : ''}
                      key={entry.id}
                    >
                      <td>
                        <strong>{entry.displayName || entry.username || entry.email}</strong>
                        <br />
                        <small>{entry.email}</small>
                      </td>
                      <td>{entry.emailVerified ? 'Verified' : 'Unverified'}</td>
                      <td>
                        <span className={`role-pill ${entry.status}`}>{entry.status}</span>
                      </td>
                      <td>
                        {isSelf ? (
                          <span className="frozen-text">
                            {entry.platformRole} (current account)
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
                      <td className="admin-actions">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'audit' && (
        <section className="admin-section">
          <div className="section-header">
            <h2>Append-only authority audit</h2>
          </div>
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
                    <td>{event.action.replaceAll('_', ' ')}</td>
                    <td>{event.actorUserId || event.operatorReference || 'bootstrap'}</td>
                    <td>{event.targetUserId}</td>
                    <td>{event.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default AdminDashboard;
