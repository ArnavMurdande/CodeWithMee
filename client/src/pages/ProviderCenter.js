import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../context/AuthContext';
import apiClient, { apiProblemCode } from '../lib/api';
import { uploadSecureFile } from '../lib/secure-file-upload';

const emptyOrganization = { name: '', slug: '', description: '', industry: '' };
const emptyCourse = { title: '', description: '', visibility: 'public', pricing: 'free', priceMinor: '', currency: 'INR', category: '' };

function readVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const element = document.createElement('video');
    const url = URL.createObjectURL(file);
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      const duration = Math.ceil(element.duration);
      URL.revokeObjectURL(url);
      if (!Number.isInteger(duration) || duration < 1 || duration > 86_400) reject(new Error('invalid_video_duration'));
      else resolve(duration);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('invalid_video_file'));
    };
    element.src = url;
  });
}

function ProviderCenter() {
  const { user, requestEmailVerification } = useContext(AuthContext);
  const [organizations, setOrganizations] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [organizationForm, setOrganizationForm] = useState(emptyOrganization);
  const [courseForm, setCourseForm] = useState(emptyCourse);
  const [courses, setCourses] = useState([]);
  const [statement, setStatement] = useState('');
  const [invite, setInvite] = useState({ email: '', role: 'instructor' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [roster, setRoster] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [grading, setGrading] = useState([]);
  const [quizGrading, setQuizGrading] = useState([]);
  const [payments, setPayments] = useState([]);
  const [members, setMembers] = useState([]);
  const [courseInviteEmail, setCourseInviteEmail] = useState('');
  const [structureJson, setStructureJson] = useState('[{"title":"Module 1","contents":[]}]');
  const [structureVersion, setStructureVersion] = useState(null);
  const [resourceFileId, setResourceFileId] = useState('');
  const [uploadedVideo, setUploadedVideo] = useState(null);
  const [paymentSettings, setPaymentSettings] = useState({ qrFileId: '', instructions: '' });

  const selected = organizations.find((entry) => entry.organization.id === selectedId) || null;

  const loadOrganizations = useCallback(async () => {
    const response = await apiClient.get('/api/v1/organizations');
    const items = response.data.organizations || [];
    setOrganizations(items);
    setSelectedId((current) => current || items[0]?.organization?.id || '');
  }, []);

  const loadCourses = useCallback(async () => {
    if (!selectedId) return setCourses([]);
    const response = await apiClient.get(
      `/api/v1/courses/provider/organizations/${selectedId}/courses`,
    );
    setCourses(response.data.courses || []);
    setSelectedCourseId((current) => current || response.data.courses?.[0]?.id || '');
  }, [selectedId]);

  const loadOperations = useCallback(async () => {
    if (!selectedId) return;
    const dashboardResponse = await apiClient.get(`/api/v1/lms/provider/organizations/${selectedId}/dashboard`);
    setDashboard(dashboardResponse.data);
    const membersResponse = await apiClient.get(`/api/v1/organizations/${selectedId}/members`);
    setMembers(membersResponse.data.members || []);
    const paymentsResponse = await apiClient.get(`/api/v1/lms/provider/organizations/${selectedId}/payments`);
    setPayments(paymentsResponse.data || []);
    try {
      const settingsResponse = await apiClient.get(`/api/v1/lms/provider/organizations/${selectedId}/payment-settings`);
      setPaymentSettings({
        qrFileId: settingsResponse.data.qr_file_id || '',
        instructions: settingsResponse.data.instructions || '',
      });
    } catch (error) {
      if (error.response?.status === 404) setPaymentSettings({ qrFileId: '', instructions: '' });
      else throw error;
    }
    if (!selectedCourseId) return;
    const [rosterResponse, analyticsResponse, gradingResponse, quizGradingResponse] = await Promise.all([
      apiClient.get(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/roster`),
      apiClient.get(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/analytics`),
      apiClient.get(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/grading`),
      apiClient.get(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/quiz-grading`),
    ]);
    setRoster(rosterResponse.data || []);
    setAnalytics(analyticsResponse.data);
    setGrading(gradingResponse.data || []);
    setQuizGrading(quizGradingResponse.data || []);
  }, [selectedId, selectedCourseId]);

  const loadStructure = useCallback(async () => {
    if (!selectedId || !selectedCourseId) return;
    const response = await apiClient.get(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/structure`);
    setStructureJson(JSON.stringify(response.data.modules || [{ title: 'Module 1', contents: [] }], null, 2));
    setStructureVersion(response.data.version || null);
  }, [selectedId, selectedCourseId]);

  useEffect(() => {
    loadOrganizations().catch(() => setMessage('Could not load your organizations.'));
  }, [loadOrganizations]);

  useEffect(() => {
    loadCourses().catch(() => setMessage('Could not load provider courses.'));
  }, [loadCourses]);

  useEffect(() => {
    loadOperations().catch(() => {});
  }, [loadOperations]);

  useEffect(() => {
    loadStructure().catch(() => {
      setStructureVersion(null);
      setStructureJson('[{"title":"Module 1","contents":[]}]');
    });
  }, [loadStructure]);

  const run = async (work, success) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      setMessage(success);
    } catch (error) {
      setMessage(apiProblemCode(error) || 'The request could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const createOrganization = (event) => {
    event.preventDefault();
    run(async () => {
      const response = await apiClient.post('/api/v1/organizations', organizationForm);
      setOrganizationForm(emptyOrganization);
      await loadOrganizations();
      setSelectedId(response.data.organization.id);
    }, 'Organization created. You are its owner.');
  };

  const submitVerification = () =>
    run(async () => {
      await apiClient.post(`/api/v1/organizations/${selectedId}/verification`, { statement });
      setStatement('');
      await loadOrganizations();
    }, 'Provider verification submitted for superadmin review.');

  const inviteMember = (event) => {
    event.preventDefault();
    run(async () => {
      await apiClient.post(`/api/v1/organizations/${selectedId}/invitations`, invite);
      setInvite({ email: '', role: 'instructor' });
      await loadOperations();
    }, 'Invitation queued.');
  };

  const updateMember = (userId, currentRole, status = 'active') => {
    const role = window.prompt('Organization role: admin, instructor, grader, or analyst', currentRole);
    if (!role) return;
    run(async () => {
      await apiClient.patch(`/api/v1/organizations/${selectedId}/members/${userId}`, { role: role.toLowerCase(), status });
      await loadOperations();
    }, 'Organization membership updated.');
  };

  const removeMember = (userId) => run(async () => {
    await apiClient.delete(`/api/v1/organizations/${selectedId}/members/${userId}`);
    await loadOperations();
  }, 'Organization membership revoked.');

  const createCourse = (event) => {
    event.preventDefault();
    run(async () => {
      await apiClient.post(`/api/v1/courses/provider/organizations/${selectedId}/courses`, {
        ...courseForm,
        priceMinor: courseForm.pricing === 'paid' ? Number(courseForm.priceMinor) : null,
        modules: [],
      });
      setCourseForm(emptyCourse);
      await loadCourses();
    }, 'Draft course created.');
  };

  const publishCourse = (courseId) =>
    run(async () => {
      await apiClient.post(
        `/api/v1/courses/provider/organizations/${selectedId}/courses/${courseId}/publish`,
      );
      await loadCourses();
    }, 'Course published.');

  const saveStructure = () => run(async () => {
    const modules = JSON.parse(structureJson);
    const response = await apiClient.put(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/structure`, { modules, expectedVersion: structureVersion });
    setStructureVersion(response.data.version);
    await loadCourses();
  }, 'Course modules, lessons, resources and assessments saved as a new draft version.');

  const uploadCourseResource = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    run(async () => {
      const fileId = await uploadSecureFile(file, 'course_resource', { ownerOrganizationId: selectedId, ownerType: 'organization' });
      setResourceFileId(fileId);
    }, 'Resource scanned and ready. Use the displayed fileId in the structure JSON.');
  };

  const uploadCourseVideo = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    run(async () => {
      const durationSeconds = await readVideoDuration(file);
      const mediaFileId = await uploadSecureFile(file, 'course_video', {
        ownerOrganizationId: selectedId,
        ownerType: 'organization',
      });
      setUploadedVideo({ durationSeconds, mediaFileId, title: file.name.replace(/\.[^.]+$/, '') });
    }, 'Video scanned and ready. Add it to the current draft structure.');
  };

  const addUploadedVideo = () => run(async () => {
    if (!uploadedVideo) throw new Error('uploaded_video_required');
    const modules = JSON.parse(structureJson);
    if (!Array.isArray(modules) || modules.length === 0) modules.push({ title: 'Module 1', contents: [] });
    if (!Array.isArray(modules[0].contents)) modules[0].contents = [];
    modules[0].contents.push({ kind: 'VIDEO', ...uploadedVideo });
    setStructureJson(JSON.stringify(modules, null, 2));
  }, 'Uploaded video added to the draft. Save the new draft version when ready.');

  const inviteLearner = (event) => {
    event.preventDefault();
    run(async () => {
      await apiClient.post(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/invitations`, { email: courseInviteEmail });
      setCourseInviteEmail('');
    }, 'Private-course invitation created and queued.');
  };

  const updateEnrollment = (enrollmentId, status) => run(async () => {
    await apiClient.patch(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/enrollments/${enrollmentId}`, { status });
    await loadOperations();
  }, 'Enrollment updated.');

  const assignCourseRole = (userId) => {
    const role = window.prompt('Course role: manager, instructor, grader, analyst, or payment_reviewer');
    if (!role) return;
    run(async () => {
      await apiClient.put(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/staff/${userId}`, { role: role.toLowerCase() });
    }, 'Course role updated.');
  };

  const gradeSubmission = (submissionId) => {
    const score = window.prompt('Score');
    if (score === null) return;
    const feedback = window.prompt('Feedback') || '';
    run(async () => {
      await apiClient.put(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/submissions/${submissionId}/grade`, { score: Number(score), feedback, rubricScores: {}, release: true });
      await loadOperations();
    }, 'Grade released.');
  };

  const gradeQuiz = (attemptId) => {
    const score = window.prompt('Quiz score from 0 to 100');
    if (score === null) return;
    const feedback = window.prompt('Feedback') || '';
    run(async () => {
      await apiClient.put(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/quiz-attempts/${attemptId}/grade`, { score: Number(score), feedback, release: true });
      await loadOperations();
    }, 'Quiz grade released.');
  };

  const reviewPayment = (orderId, decision) => run(async () => {
    await apiClient.put(`/api/v1/lms/provider/organizations/${selectedId}/payments/${orderId}/review`, { decision, note: '' });
    await loadOperations();
  }, `Payment ${decision}.`);

  const openPrivateFile = async (fileId) => {
    try {
      const response = await apiClient.post(`/api/v1/files/${fileId}/download`, {});
      window.open(response.data.download?.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setMessage(apiProblemCode(error) || 'Payment proof is unavailable.');
    }
  };

  const uploadPaymentQr = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    run(async () => {
      const qrFileId = await uploadSecureFile(file, 'payment_qr', {
        ownerOrganizationId: selectedId,
        ownerType: 'organization',
      });
      setPaymentSettings((current) => ({ ...current, qrFileId }));
    }, 'Payment QR scanned and ready. Save the payment settings to activate paid enrollment.');
  };

  const savePaymentSettings = () => run(async () => {
    await apiClient.put(`/api/v1/lms/provider/organizations/${selectedId}/payment-settings`, paymentSettings);
  }, 'Manual QR-payment settings saved. New payment orders will snapshot these instructions.');

  const downloadAnalytics = () => run(async () => {
    const response = await apiClient.get(`/api/v1/lms/provider/organizations/${selectedId}/courses/${selectedCourseId}/analytics.csv`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `course-${selectedCourseId}-analytics.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, 'Analytics export downloaded and recorded in the audit log.');

  if (!user?.emailVerified) {
    return (
      <main className="provider-center">
        <section className="provider-card">
          <p className="provider-eyebrow">Provider Center</p>
          <h1>Verify your email first</h1>
          <p>Company accounts belong to verified human accounts. No administrator manually verifies your email.</p>
          <button disabled={busy} onClick={() => run(requestEmailVerification, 'Verification email queued.')} type="button">
            Send verification email
          </button>
          {message && <p role="status">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="provider-center">
      <header className="provider-hero">
        <p className="provider-eyebrow">Provider Center</p>
        <h1>Organizations and courses</h1>
        <p>Create a provider organization, request approval, invite staff, and manage draft courses.</p>
      </header>

      {message && <p className="provider-message" role="status">{message}</p>}

      <div className="provider-grid">
        <section className="provider-card">
          <h2>Your organizations</h2>
          {organizations.length > 0 && (
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {organizations.map(({ organization }) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name} · {organization.verificationStatus}
                </option>
              ))}
            </select>
          )}
          <form onSubmit={createOrganization}>
            <h3>Create organization</h3>
            <input required minLength="2" maxLength="120" placeholder="Organization name" value={organizationForm.name} onChange={(event) => setOrganizationForm({ ...organizationForm, name: event.target.value })} />
            <input required pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]" placeholder="organization-slug" value={organizationForm.slug} onChange={(event) => setOrganizationForm({ ...organizationForm, slug: event.target.value.toLowerCase() })} />
            <input maxLength="100" placeholder="Industry" value={organizationForm.industry} onChange={(event) => setOrganizationForm({ ...organizationForm, industry: event.target.value })} />
            <textarea maxLength="2000" placeholder="Description" value={organizationForm.description} onChange={(event) => setOrganizationForm({ ...organizationForm, description: event.target.value })} />
            <button disabled={busy} type="submit">Create organization</button>
          </form>
        </section>

        {selected && (
          <section className="provider-card">
            <h2>{selected.organization.name}</h2>
            <p>Status: <strong>{selected.organization.verificationStatus}</strong></p>
            <p>Your role: <strong>{selected.membership.role}</strong></p>
            {['draft', 'rejected'].includes(selected.organization.verificationStatus) && (
              <div>
                <textarea minLength="20" maxLength="2000" placeholder="Describe your organization and the courses you intend to provide." value={statement} onChange={(event) => setStatement(event.target.value)} />
                <button disabled={busy || statement.trim().length < 20} onClick={submitVerification} type="button">Submit for verification</button>
              </div>
            )}
            <form onSubmit={inviteMember}>
              <h3>Invite staff</h3>
              <input required type="email" placeholder="person@company.com" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} />
              <select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}>
                {['admin', 'instructor', 'grader', 'analyst'].map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              <button disabled={busy} type="submit">Send invitation</button>
            </form>
            <h3>Active staff</h3>
            {members.map((membership) => (
              <div className="provider-row" key={membership.id || membership.user?.id}>
                <span>{membership.user?.displayName || membership.user?.email || membership.user?.id} · {membership.role} · {membership.status}</span>
                {membership.role !== 'owner' && <span><button onClick={() => updateMember(membership.user.id, membership.role, membership.status)} type="button">Edit</button><button onClick={() => removeMember(membership.user.id)} type="button">Revoke</button></span>}
              </div>
            ))}
          </section>
        )}

        {selected && dashboard && (
          <section className="provider-card provider-card--wide">
            <h2>Provider dashboard</h2>
            <div className="provider-metrics">
              <span>Courses <strong>{dashboard.courses}</strong></span>
              <span>Learners <strong>{dashboard.learners}</strong></span>
              <span>Awaiting grades <strong>{dashboard.pending_grading}</strong></span>
              <span>Payment reviews <strong>{dashboard.pending_payments}</strong></span>
            </div>
          </section>
        )}

        {selected && (
          <section className="provider-card provider-card--wide">
            <h2>Manual QR-payment settings</h2>
            <p>Upload the provider QR image and instructions learners must follow. Payment approval remains a manual reviewer decision.</p>
            <label>Payment QR image<input accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={uploadPaymentQr} type="file" /></label>
            {paymentSettings.qrFileId && <p>Ready QR fileId: <code>{paymentSettings.qrFileId}</code></p>}
            <textarea maxLength="5000" placeholder="Payment instructions, reference format, and expected review time" value={paymentSettings.instructions} onChange={(event) => setPaymentSettings((current) => ({ ...current, instructions: event.target.value }))} />
            <button disabled={busy || !paymentSettings.qrFileId || !paymentSettings.instructions.trim()} onClick={savePaymentSettings} type="button">Save payment settings</button>
          </section>
        )}

        {selected && (
          <section className="provider-card provider-card--wide">
            <h2>Courses</h2>
            <form className="provider-course-form" onSubmit={createCourse}>
              <input required placeholder="Course title" value={courseForm.title} onChange={(event) => setCourseForm({ ...courseForm, title: event.target.value })} />
              <input placeholder="Category" value={courseForm.category} onChange={(event) => setCourseForm({ ...courseForm, category: event.target.value })} />
              <textarea placeholder="Course description" value={courseForm.description} onChange={(event) => setCourseForm({ ...courseForm, description: event.target.value })} />
              <select value={courseForm.visibility} onChange={(event) => setCourseForm({ ...courseForm, visibility: event.target.value })}>
                <option value="public">Public</option><option value="private">Private</option>
              </select>
              <select value={courseForm.pricing} onChange={(event) => setCourseForm({ ...courseForm, pricing: event.target.value })}>
                <option value="free">Free</option><option value="paid">Paid with manual QR review</option>
              </select>
              {courseForm.pricing === 'paid' && <><input min="1" required type="number" placeholder="Price in minor units (e.g. paise)" value={courseForm.priceMinor} onChange={(event) => setCourseForm({ ...courseForm, priceMinor: event.target.value })} /><input maxLength="3" minLength="3" required value={courseForm.currency} onChange={(event) => setCourseForm({ ...courseForm, currency: event.target.value.toUpperCase() })} /></>}
              <button disabled={busy} type="submit">Create draft course</button>
            </form>
            <div className="provider-course-list">
              {courses.map((course) => (
                <article key={course.id}>
                  <div><strong>{course.title}</strong><p>{course.publication_status}</p></div>
                  {(course.publication_status === 'draft' || course.has_draft) && <button disabled={busy || selected.organization.verificationStatus !== 'approved'} onClick={() => publishCourse(course.id)} type="button">Publish draft</button>}
                </article>
              ))}
              {!courses.length && <p>No courses yet.</p>}
            </div>
            {courses.length > 0 && (
              <label>Manage course
                <select value={selectedCourseId} onChange={(event) => setSelectedCourseId(event.target.value)}>
                  {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                </select>
              </label>
            )}
          </section>
        )}

        {selected && selectedCourseId && (
          <section className="provider-card provider-card--wide">
            <h2>Course builder</h2>
            <p>Define ordered modules and contents. Content kinds: VIDEO, ARTICLE, RESOURCE, QUIZ, ASSIGNMENT and CHALLENGE. Resources accept a private fileId or HTTPS externalUrl; quizzes accept objective or written questions; assignments accept rubrics and deadlines.</p>
            <textarea className="provider-json-editor" aria-label="Course structure JSON" value={structureJson} onChange={(event) => setStructureJson(event.target.value)} />
            <label>Upload private course resource<input accept=".pdf,.txt,.json,.md,.zip,image/png,image/jpeg,image/gif,image/webp" disabled={busy} onChange={uploadCourseResource} type="file" /></label>
            {resourceFileId && <p>Ready resource fileId: <code>{resourceFileId}</code></p>}
            <label>Upload course video<input accept="video/mp4,video/webm" disabled={busy} onChange={uploadCourseVideo} type="file" /></label>
            {uploadedVideo && <p>Ready video: {uploadedVideo.title} ({uploadedVideo.durationSeconds}s) <button disabled={busy} onClick={addUploadedVideo} type="button">Add to first module</button></p>}
            <button disabled={busy} onClick={saveStructure} type="button">Save new draft version</button>
            <form onSubmit={inviteLearner}>
              <h3>Invite learner to private course</h3>
              <input required type="email" value={courseInviteEmail} onChange={(event) => setCourseInviteEmail(event.target.value)} placeholder="learner@example.com" />
              <button disabled={busy} type="submit">Create invitation</button>
            </form>
          </section>
        )}

        {selectedCourseId && (
          <section className="provider-card provider-card--wide">
            <h2>Learners and analytics</h2>
            {analytics && <p>{analytics.learners} learners · {analytics.completed} completed · {analytics.average_progress}% average progress · {analytics.quiz_attempts} quiz attempts · {analytics.assignment_submissions} assignment submissions</p>}
            <button disabled={busy} onClick={downloadAnalytics} type="button">Download CSV analytics</button>
            {roster.map((entry) => <div className="provider-row" key={entry.id}><span>{entry.display_name} · {entry.status}</span><span><button onClick={() => updateEnrollment(entry.id, 'enrolled')} type="button">Activate</button><button onClick={() => updateEnrollment(entry.id, 'suspended')} type="button">Suspend</button><button onClick={() => assignCourseRole(entry.user_id)} type="button">Course role</button></span></div>)}
          </section>
        )}

        {selectedCourseId && grading.length > 0 && (
          <section className="provider-card provider-card--wide"><h2>Grading queue</h2>{grading.map((entry) => <div className="provider-row" key={entry.id}><span>{entry.display_name} · {entry.title} · {entry.status}{entry.written_answer && <small>{entry.written_answer}</small>}</span><span>{(entry.file_ids || []).map((fileId, index) => <button key={fileId} onClick={() => openPrivateFile(fileId)} type="button">Attachment {index + 1}</button>)}<button onClick={() => gradeSubmission(entry.id)} type="button">Grade</button></span></div>)}</section>
        )}

        {selectedCourseId && quizGrading.length > 0 && (
          <section className="provider-card provider-card--wide"><h2>Written quiz grading</h2>{quizGrading.map((entry) => <div className="provider-row" key={entry.id}><span>{entry.display_name} · {entry.title}</span><button onClick={() => gradeQuiz(entry.id)} type="button">Grade quiz</button></div>)}</section>
        )}

        {payments.length > 0 && (
          <section className="provider-card provider-card--wide"><h2>Payment verification</h2>{payments.map((entry) => <div className="provider-row" key={entry.id}><span>{entry.display_name} · {entry.title} · {entry.amount_minor} {entry.currency}</span><span>{entry.proof_file_id && <button onClick={() => openPrivateFile(entry.proof_file_id)} type="button">View proof</button>}<button onClick={() => reviewPayment(entry.id, 'approved')} type="button">Approve</button><button onClick={() => reviewPayment(entry.id, 'rejected')} type="button">Reject</button><button onClick={() => reviewPayment(entry.id, 'more_information')} type="button">Request more</button></span></div>)}</section>
        )}
      </div>
    </main>
  );
}

export default ProviderCenter;
