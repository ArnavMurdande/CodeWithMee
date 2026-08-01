import { useState, useEffect, useContext } from 'react';
import axios from '../lib/api';
import { AuthContext } from '../context/AuthContext';
import { safeHttpUrl, youtubeEmbedUrl } from '../lib/restricted-content';
import { AsyncState } from '../components/ui/AsyncState';
import { AccessibleMedia } from '../components/ui/AccessibleMedia';

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

  useEffect(() => {
    fetchCourses();
    fetchEnrolled();
  }, [user]);

  const fetchCourses = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await axios.get('/api/courses');
      setCourses(res.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchEnrolled = async () => {
    try {
      const res = await axios.get('/api/courses/learner/enrolled');
      setEnrolledCourses(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const enrollCourse = async (courseId) => {
    try {
      await axios.post(`/api/courses/${courseId}/enroll`, {});
      alert('Enrolled successfully!');
      fetchEnrolled();
    } catch (err) {
      const msg = err.response?.data?.msg || 'Enrollment failed';
      alert(msg);
    }
  };

  const openCourseViewer = async (courseId) => {
    try {
      const res = await axios.get(`/api/courses/${courseId}`);
      setViewingCourse(res.data.course);
      setViewingEnrollment(res.data.enrollment);
    } catch (err) {
      alert(err.response?.data?.msg || 'Cannot access this course');
    }
  };

  const markContentComplete = async (contentId) => {
    if (!viewingCourse || !viewingEnrollment) return;
    try {
      const res = await axios.put(`/api/courses/${viewingCourse._id}/progress`, { contentId });
      setViewingEnrollment(res.data);
      fetchEnrolled();
    } catch (err) {
      console.error(err);
    }
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
                  const isCompleted = viewingEnrollment?.completedContents?.includes(content._id);
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
                      {!isCompleted && (
                        <button
                          className="mark-done-btn"
                          onClick={() => markContentComplete(content._id)}
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
                  const embedUrl = youtubeEmbedUrl(content.url);
                  const safeUrl = safeHttpUrl(content.url);
                  return (
                    <div key={ci} className="viewer-content-detail">
                      <h4>{content.title}</h4>
                      {content.type === 'video' && safeUrl && (
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
                            <AccessibleMedia
                              src={safeUrl}
                              title={`${content.title} video`}
                              transcript={content.transcript}
                            />
                          )}
                        </div>
                      )}
                      {content.type === 'note' && (
                        <div className="note-content-viewer">
                          <pre>{content.content}</pre>
                          {!content.allowDownload && (
                            <p className="view-only-notice">
                              📖 View only — download disabled by the course provider
                            </p>
                          )}
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="courses-page neo-container">
      <h1 className="neo-title">📚 Course Catalog</h1>
      <p className="subtitle">Discover courses built by top companies and community members.</p>

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
                    <span className="badge blue">₹{course.price}</span>
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
                        onClick={() => enrollCourse(course._id)}
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
