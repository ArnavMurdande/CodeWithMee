import { useState, useEffect, useContext, useRef } from 'react';
import axios from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { safeHttpUrl, youtubeEmbedUrl } from '../lib/restricted-content';
import { AsyncState } from '../components/ui/AsyncState';
import { AccessibleMedia } from '../components/ui/AccessibleMedia';
import { uploadSecureFile } from '../lib/secure-file-upload';

const CourseVideo = ({ courseId, content, src }) => {
  const mediaRef = useRef(null);
  const resumePositionRef = useRef(0);
  const lastSavedRef = useRef(0);
  useEffect(() => {
    axios.get(`/api/v1/courses/${courseId}/lessons/${content.id}/progress`)
      .then((response) => {
        resumePositionRef.current = response.data.lastPositionSec || 0;
        const media = mediaRef.current;
        if (media?.readyState >= 1) {
          media.currentTime = Math.min(resumePositionRef.current, Math.max(0, media.duration - 1));
        }
      })
      .catch(() => {});
  }, [courseId, content.id]);
  const save = (event) => {
    const media = event.currentTarget;
    if (media.currentTime - lastSavedRef.current < 10 && !media.ended) return;
    const end = Math.floor(media.currentTime);
    lastSavedRef.current = end;
    axios.patch(`/api/v1/courses/${courseId}/lessons/${content.id}/progress`, {
      lastPositionSec: end,
      watchedIntervals: [{ start: Math.max(0, end - 10), end }],
    }).catch(() => {});
  };
  return <AccessibleMedia mediaRef={mediaRef} onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(resumePositionRef.current, Math.max(0, event.currentTarget.duration - 1)); }} onTimeUpdate={save} src={src} title={`${content.title} video`} transcript={content.transcript} />;
};

const chooseFile = (accept) => new Promise((resolve) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => resolve(input.files?.[0] || null);
  input.oncancel = () => resolve(null);
  input.click();
});

const Courses = () => {
  const { user } = useContext(AuthContext);
  const [courses, setCourses] = useState([]);
  const [enrolledCourses, setEnrolledCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState('browse'); // 'browse' | 'enrolled'

  // Course Viewer State
  const [viewingCourse, setViewingCourse] = useState(null);
  const [viewingEnrollment, setViewingEnrollment] = useState(null);
  const [inviteToken, setInviteToken] = useState('');
  const [assessmentAnswers, setAssessmentAnswers] = useState({});
  const [results, setResults] = useState({ quizzes: [], assignments: [] });
  const [mediaUrls, setMediaUrls] = useState({});
  const [pendingPayment, setPendingPayment] = useState(null);

  useEffect(() => {
    fetchCourses();
    fetchEnrolled();
    const tokenFromLink = new URLSearchParams(window.location.search).get('invite');
    if (tokenFromLink) setInviteToken(tokenFromLink);
  }, [user]);

  const fetchCourses = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await axios.get('/api/v1/courses');
      const data = Array.isArray(res.data) ? res.data : (res.data.courses || []);
      setCourses(data.map((c) => ({ ...c, _id: c.id || c._id })));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchEnrolled = async () => {
    try {
      const res = await axios.get('/api/v1/courses/me/enrollments');
      const normalized = await Promise.all((res.data.enrollments || []).map(async (entry) => {
        let progressPercent = 0;
        try {
          const progress = await axios.get(`/api/v1/courses/${entry.id}/progress`);
          progressPercent = progress.data.percent || 0;
        } catch { /* Keep the enrollment visible if progress is temporarily unavailable. */ }
        return { _id: entry.enrollment_id, status: entry.enrollment_status, progressPercent, course: { ...entry, _id: entry.id } };
      }));
      setEnrolledCourses(normalized);
    } catch (err) {
      console.error(err);
    }
  };

  const enrollCourse = async (courseId) => {
    try {
      await axios.post(`/api/v1/courses/${courseId}/enroll`, {});
      alert('Enrolled successfully!');
      fetchEnrolled();
    } catch (err) {
      const msg = err.response?.data?.msg || err.response?.data?.error || 'Enrollment failed';
      alert(msg);
    }
  };

  const beginPaidEnrollment = async (courseId) => {
    try {
      const response = await axios.post(`/api/v1/lms/courses/${courseId}/payment-orders`, {});
      const download = await axios.post(`/api/v1/files/${response.data.qr_file_id}/download`, {});
      setPendingPayment({ ...response.data, qrUrl: download.data.download?.url || null });
    } catch (error) { alert(error.response?.data?.error?.code || 'Could not create payment order.'); }
  };

  const submitPaymentProof = async () => {
    if (!pendingPayment) return;
    try {
      const proof = await chooseFile('image/png,image/jpeg,image/webp,application/pdf');
      if (!proof) return;
      const fileId = await uploadSecureFile(proof, 'payment_proof');
      await axios.put(`/api/v1/lms/payment-orders/${pendingPayment.id}/proof`, { fileId });
      setPendingPayment(null);
      alert('Payment proof submitted for manual review.');
    } catch (error) { alert(error.response?.data?.error?.code || 'Could not submit payment proof.'); }
  };

  const acceptCourseInvitation = async () => {
    try {
      await axios.post(`/api/v1/lms/invitations/${encodeURIComponent(inviteToken.trim())}/accept`, {});
      setInviteToken('');
      await fetchEnrolled();
      alert('Invitation accepted.');
    } catch (error) { alert(error.response?.data?.error?.code || 'Invitation is invalid or expired.'); }
  };

  const openCourseViewer = async (courseId) => {
    try {
      const res = await axios.get(`/api/v1/courses/${courseId}`);
      const courseObj = res.data.course || res.data;
      setViewingCourse({ ...courseObj, _id: courseObj.id || courseObj._id });
      const mediaContents = (courseObj.modules || [])
        .flatMap((module) => module.contents || [])
        .filter((content) => content.mediaFileId);
      const resolvedMedia = await Promise.all(mediaContents.map(async (content) => {
        try {
          const download = await axios.post(`/api/v1/files/${content.mediaFileId}/download`, {});
          return [content.id, download.data.download?.url || null];
        } catch {
          return [content.id, null];
        }
      }));
      setMediaUrls(Object.fromEntries(resolvedMedia.filter(([, url]) => url)));
      if (courseObj.isEnrolled) {
        const [progress, learnerResults] = await Promise.all([
          axios.get(`/api/v1/courses/${courseId}/progress`),
          axios.get(`/api/v1/lms/courses/${courseId}/results`),
        ]);
        setViewingEnrollment({
          status: progress.data.status || courseObj.enrollmentStatus,
          progressPercent: progress.data.percent || 0,
          completedContents: progress.data.completedContentIds || [],
        });
        setResults(learnerResults.data);
      } else setViewingEnrollment(null);
    } catch (err) {
      alert(err.response?.data?.msg || err.response?.data?.error || 'Cannot access this course');
    }
  };

  const markContentComplete = async (contentId) => {
    if (!viewingCourse) return;
    const cid = viewingCourse.id || viewingCourse._id;
    try {
      await axios.patch(`/api/v1/courses/${cid}/lessons/${contentId}/progress`, {
        markComplete: true,
      });
      const progress = await axios.get(`/api/v1/courses/${cid}/progress`);
      setViewingEnrollment((current) => ({
        ...current,
        status: progress.data.status || current.status,
        progressPercent: progress.data.percent || 0,
        completedContents: progress.data.completedContentIds || current.completedContents,
      }));
      await fetchEnrolled();
    } catch (err) {
      console.error(err);
    }
  };

  const submitQuiz = async (quiz) => {
    try {
      const response = await axios.post(`/api/v1/lms/courses/${viewingCourse.id}/quizzes/${quiz.id}/attempts`, { answers: assessmentAnswers });
      alert(response.data.status === 'pending_grading' ? 'Submitted for written-answer grading.' : `Score: ${response.data.score}%`);
    } catch (error) { alert(error.response?.data?.error?.code || 'Quiz submission failed.'); }
  };

  const submitAssignment = async (assignment) => {
    const writtenAnswer = window.prompt('Enter your written answer.') || '';
    const attachFile = window.confirm('Attach a PDF, text, JSON, Markdown, or ZIP file?');
    const file = attachFile ? await chooseFile('.pdf,.txt,.json,.md,.zip') : null;
    if (!writtenAnswer.trim() && !file) return;
    try {
      const fileIds = file ? [await uploadSecureFile(file, 'assignment_submission')] : [];
      await axios.post(`/api/v1/lms/courses/${viewingCourse.id}/assignments/${assignment.id}/submissions`, { writtenAnswer, fileIds });
      alert('Assignment submitted.');
    } catch (error) { alert(error.response?.data?.error?.code || 'Assignment submission failed.'); }
  };

  const openPrivateResource = async (resource) => {
    if (resource.externalUrl) return window.open(resource.externalUrl, '_blank', 'noopener,noreferrer');
    if (!resource.fileId) return;
    try {
      const response = await axios.post(`/api/v1/files/${resource.fileId}/download`, {});
      window.open(response.data.download?.url, '_blank', 'noopener,noreferrer');
    } catch { alert('Resource is unavailable or download permission was denied.'); }
  };

  if (loading)
    return <AsyncState label="Loading courses" title="Loading courses…" type="loading" />;

  if (loadError) {
    return (
      <AsyncState
        action={
          <button className="cwm-button" onClick={fetchCourses} type="button">
            Try again
          </button>
        }
        description="The course catalog could not be loaded. Existing enrollment data was not changed."
        label="Course catalog error"
        title="Courses are temporarily unavailable"
        type="error"
      />
    );
  }

  // Course Viewer
  if (viewingCourse) {
    return (
      <div className="course-viewer">
        <button
          className="neo-button back-btn"
          onClick={() => {
            setViewingCourse(null);
            setViewingEnrollment(null);
          }}
        >
          ← Back to Courses
        </button>
        <div className="viewer-header">
          <h1>{viewingCourse.title}</h1>
          <p className="viewer-company">By {viewingCourse.company?.companyName}</p>
          {viewingEnrollment && (
            <div className="viewer-progress">
              <div className="progress-bar-container large">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${viewingEnrollment.progressPercent}%` }}
                />
                <span className="progress-text">{viewingEnrollment.progressPercent}% Complete</span>
              </div>
            </div>
          )}
        </div>

        <div className="viewer-body">
          <div className="viewer-sidebar">
            {viewingCourse.modules?.map((mod, mi) => (
              <div key={mi} className="viewer-module">
                <h3 className="viewer-module-title">
                  Module {mi + 1}: {mod.title}
                </h3>
                {mod.contents?.map((content, ci) => {
                  const contentId = content.id || content._id;
                  const isCompleted = viewingEnrollment?.completedContents?.includes(contentId);
                  return (
                    <div
                      key={ci}
                      className={`viewer-content-item ${isCompleted ? 'completed' : ''}`}
                    >
                      <span className="content-type-icon">
                        {content.type === 'video' && '📹'}
                        {content.type === 'note' && '📝'}
                        {content.type === 'link' && '🔗'}
                        {content.type === 'resource' && '📦'}
                        {content.type === 'practice' && '🎮'}
                      </span>
                      <span className="content-title-text">{content.title}</span>
                      {!isCompleted && (String(content.kind || content.type).toUpperCase() !== 'VIDEO' || youtubeEmbedUrl(content.legacyUrl || content.url)) && (
                        <button
                          className="mark-done-btn"
                          onClick={() => markContentComplete(contentId)}
                        >
                          ✓
                        </button>
                      )}
                      {isCompleted && <span className="done-check">✅</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="viewer-main">
            <h2>Course Description</h2>
            <p>{viewingCourse.description}</p>
            {viewingCourse.modules?.map((mod, mi) => (
              <div key={mi} className="viewer-main-module">
                <h3>{mod.title}</h3>
                <p className="mod-desc">{mod.description}</p>
                {mod.contents?.map((content, ci) => {
                  const contentUrl = mediaUrls[content.id] || content.legacyUrl || content.url;
                  const embedUrl = youtubeEmbedUrl(contentUrl);
                  const safeUrl = safeHttpUrl(contentUrl);
                  const kind = String(content.kind || content.type || '').toUpperCase();
                  return (
                    <div key={ci} className="viewer-content-detail">
                      <h4>{content.title}</h4>
                      {kind === 'VIDEO' && safeUrl && (
                        <div className="video-embed">
                          {embedUrl ? (
                            <>
                              <iframe
                                src={embedUrl}
                                title={`${content.title} video`}
                                referrerPolicy="strict-origin-when-cross-origin"
                                sandbox="allow-presentation allow-scripts allow-same-origin"
                                allowFullScreen
                                style={{
                                  width: '100%',
                                  height: '400px',
                                  border: 'none',
                                  borderRadius: '12px',
                                }}
                              />
                              <p className="cwm-media-access-note">
                                Caption availability is controlled by the external video provider.
                              </p>
                            </>
                          ) : (
                            <CourseVideo courseId={viewingCourse.id} content={content} src={safeUrl} />
                          )}
                          {embedUrl && (
                            <button onClick={() => markContentComplete(content.id)} type="button">
                              Mark external video complete
                            </button>
                          )}
                        </div>
                      )}
                      {kind === 'ARTICLE' && (
                        <div className="note-content-viewer">
                          <pre>{content.body || content.content}</pre>
                          {!content.allowDownload && (
                            <p className="view-only-notice">
                              📖 View only — download disabled by the course provider
                            </p>
                          )}
                          <button onClick={() => markContentComplete(content.id)} type="button">
                            Mark article complete
                          </button>
                        </div>
                      )}
                      {content.type === 'link' && safeUrl && (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="resource-link"
                        >
                          🔗 {safeUrl}
                        </a>
                      )}
                      {content.type === 'resource' && safeUrl && (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="resource-link"
                        >
                          📦 Download Resource
                        </a>
                      )}
                      {kind === 'RESOURCE' && content.resource?.allowDownload && (
                        <button className="resource-link" onClick={() => openPrivateResource(content.resource)} type="button">
                          Download resource
                        </button>
                      )}
                      {kind === 'RESOURCE' && content.resource && !content.resource.allowDownload && (
                        <p>View-only resource: {content.resource.notes || 'The provider has disabled downloads.'}</p>
                      )}
                      {kind === 'RESOURCE' && content.resource && (
                        <button onClick={() => markContentComplete(content.id)} type="button">
                          Mark resource complete
                        </button>
                      )}
                      {kind === 'QUIZ' && content.quiz && (
                        <div className="course-assessment">
                          <p>{content.quiz.instructions}</p>
                          {content.quiz.questions.map((question) => (
                            <fieldset key={question.id}>
                              <legend>{question.prompt}</legend>
                              {question.kind === 'written' && <textarea onChange={(event) => setAssessmentAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />}
                              {question.kind === 'true_false' && <select defaultValue="" onChange={(event) => setAssessmentAnswers((current) => ({ ...current, [question.id]: event.target.value === 'true' }))}><option disabled value="">Choose</option><option value="true">True</option><option value="false">False</option></select>}
                              {question.kind === 'single_choice' && <select defaultValue="" onChange={(event) => setAssessmentAnswers((current) => ({ ...current, [question.id]: event.target.value }))}><option disabled value="">Choose</option>{(question.options || []).map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select>}
                              {question.kind === 'multiple_choice' && (question.options || []).map((option) => <label key={String(option)}><input type="checkbox" onChange={(event) => setAssessmentAnswers((current) => { const existing = Array.isArray(current[question.id]) ? current[question.id] : []; return { ...current, [question.id]: event.target.checked ? [...existing, option] : existing.filter((value) => value !== option) }; })} />{String(option)}</label>)}
                            </fieldset>
                          ))}
                          <button onClick={() => submitQuiz(content.quiz)} type="button">Submit quiz</button>
                        </div>
                      )}
                      {kind === 'ASSIGNMENT' && content.assignment && (
                        <div className="course-assessment">
                          <p>{content.assignment.instructions}</p>
                          <p>Due: {content.assignment.dueAt ? new Date(content.assignment.dueAt).toLocaleString() : 'No deadline'}</p>
                          <button onClick={() => submitAssignment(content.assignment)} type="button">Submit assignment</button>
                        </div>
                      )}
                      {kind === 'CHALLENGE' && content.challengeId && (
                        <a className="resource-link" href={`/challenges/${content.challengeId}`}>Open coding challenge</a>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {viewingEnrollment?.status === 'completed' && viewingCourse.certificateTemplateUrl && (
              <div className="certificate-section">
                <h2>🎓 Certificate of Completion</h2>
                <p>Congratulations! You've completed this course.</p>
                <button
                  className="neo-button primary"
                  onClick={() => {
                    // Generate certificate using Canvas
                    const canvas = document.createElement('canvas');
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => {
                      canvas.width = img.width;
                      canvas.height = img.height;
                      const ctx = canvas.getContext('2d');
                      ctx.drawImage(img, 0, 0);
                      ctx.font = 'bold 48px Arial';
                      ctx.fillStyle = '#222';
                      ctx.textAlign = 'center';
                      const coords = viewingCourse.certificateDesignCoordinates || {};
                      ctx.fillText(
                        user?.username || 'Student',
                        coords.nameX || canvas.width / 2,
                        coords.nameY || canvas.height / 2,
                      );
                      ctx.font = '28px Arial';
                      ctx.fillText(
                        new Date().toLocaleDateString(),
                        coords.dateX || canvas.width / 2,
                        coords.dateY || canvas.height / 2 + 60,
                      );
                      const link = document.createElement('a');
                      link.download = `certificate-${viewingCourse.title}.png`;
                      link.href = canvas.toDataURL();
                      link.click();
                    };
                    img.src = viewingCourse.certificateTemplateUrl;
                  }}
                >
                  📥 Download Certificate
                </button>
              </div>
            )}
            {(results.quizzes.length > 0 || results.assignments.length > 0) && (
              <section className="course-results">
                <h2>Grades and feedback</h2>
                {results.quizzes.map((entry) => <p key={entry.id}>Quiz: {entry.title} · {entry.status}{entry.released_at ? ` · ${entry.score}% · ${entry.feedback || 'No feedback'}` : ''}</p>)}
                {results.assignments.map((entry) => <p key={entry.id}>Assignment: {entry.title} · {entry.status}{entry.released_at ? ` · ${entry.score} · ${entry.feedback || 'No feedback'}` : ''}</p>)}
              </section>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="courses-page neo-container">
      <h1 className="neo-title">📚 Course Catalog</h1>
      <p className="subtitle">Discover courses built by top companies and community members.</p>
      {pendingPayment && (
        <section className="course-payment-instructions" aria-label="Manual payment instructions">
          <h2>Complete manual payment</h2>
          {pendingPayment.qrUrl && <img alt="Provider payment QR code" src={pendingPayment.qrUrl} />}
          <p>{pendingPayment.qr_instructions}</p>
          <p>Amount: {pendingPayment.currency} {(pendingPayment.amount_minor / 100).toFixed(2)}</p>
          <button onClick={submitPaymentProof} type="button">Upload payment proof</button>
          <button onClick={() => setPendingPayment(null)} type="button">Cancel</button>
        </section>
      )}
      <div className="course-invite-accept">
        <input aria-label="Private course invitation token" placeholder="Invitation token" value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} />
        <button disabled={!inviteToken.trim()} onClick={acceptCourseInvitation} type="button">Accept private invitation</button>
      </div>

      {/* Tabs */}
      <div aria-label="Course sections" className="courses-tabs" role="group">
        <button
          aria-pressed={activeTab === 'browse'}
          className={`tab-btn ${activeTab === 'browse' ? 'active' : ''}`}
          onClick={() => setActiveTab('browse')}
          type="button"
        >
          Browse Courses
        </button>
        <button
          aria-pressed={activeTab === 'enrolled'}
          className={`tab-btn ${activeTab === 'enrolled' ? 'active' : ''}`}
          onClick={() => setActiveTab('enrolled')}
          type="button"
        >
          My Courses ({enrolledCourses.length})
        </button>
      </div>

      {/* Browse Tab */}
      {activeTab === 'browse' && (
        <div className="courses-grid">
          {courses.map((course) => {
            const isEnrolled = enrolledCourses.some((e) => e.course?._id === course._id);
            return (
              <div key={course._id} className="course-card">
                <div
                  className="course-thumb"
                  style={{
                    background: course.thumbnail
                      ? `url(${course.thumbnail}) center/cover`
                      : 'linear-gradient(135deg, #2d2d3a, #1a1a2e)',
                  }}
                >
                  {course.pricing === 'free' ? (
                    <span className="badge green">FREE</span>
                  ) : (
                    <span className="badge blue">{course.currency || 'INR'} {((course.priceMinor || 0) / 100).toFixed(2)}</span>
                  )}
                </div>
                <div className="course-info">
                  <h3 className="course-title">{course.title}</h3>
                  <p className="company-name">By {course.company?.companyName || 'Unknown'}</p>
                  <p className="course-desc">{course.description}</p>
                  <div className="course-meta-tags">
                    {course.category && <span className="meta-tag">{course.category}</span>}
                    <span className="meta-tag">{course.modules?.length || 0} modules</span>
                  </div>
                  <div className="course-actions">
                    {isEnrolled ? (
                      <button
                        className="neo-button enrolled-btn"
                        onClick={() => openCourseViewer(course._id)}
                      >
                        Continue Learning →
                      </button>
                    ) : (
                      <button
                        className="neo-button primary"
                        onClick={() => course.pricing === 'paid' ? beginPaidEnrollment(course._id) : enrollCourse(course._id)}
                      >
                        Enroll Now
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {courses.length === 0 && (
            <div className="no-courses-container">
              <div className="no-courses-icon">📭</div>
              <h3>No public courses available right now.</h3>
            </div>
          )}
        </div>
      )}

      {/* Enrolled Tab */}
      {activeTab === 'enrolled' && (
        <div className="courses-grid">
          {enrolledCourses.map((enrollment) => (
            <div key={enrollment._id} className="course-card enrolled">
              <div
                className="course-thumb"
                style={{
                  background: enrollment.course?.thumbnail
                    ? `url(${enrollment.course.thumbnail}) center/cover`
                    : 'linear-gradient(135deg, #2d2d3a, #1a1a2e)',
                }}
              >
                <span className={`badge ${enrollment.status === 'completed' ? 'green' : 'blue'}`}>
                  {enrollment.status === 'completed'
                    ? 'COMPLETED'
                    : `${enrollment.progressPercent}%`}
                </span>
              </div>
              <div className="course-info">
                <h3 className="course-title">{enrollment.course?.title}</h3>
                <p className="company-name">
                  By {enrollment.course?.company?.companyName || 'Unknown'}
                </p>
                <div className="enrollment-progress">
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${enrollment.progressPercent}%` }}
                    />
                  </div>
                  <span className="progress-label">{enrollment.progressPercent}% complete</span>
                </div>
                <button
                  className="neo-button primary"
                  onClick={() => openCourseViewer(enrollment.course?._id)}
                >
                  {enrollment.status === 'completed' ? 'Review Course' : 'Continue Learning →'}
                </button>
              </div>
            </div>
          ))}
          {enrolledCourses.length === 0 && (
            <div className="no-courses-container">
              <div className="no-courses-icon">🎓</div>
              <h3>You haven't enrolled in any courses yet.</h3>
              <p>Browse the catalog to find your next learning adventure!</p>
              <button className="neo-button primary mt-1" onClick={() => setActiveTab('browse')}>
                Browse Catalog
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Courses;
