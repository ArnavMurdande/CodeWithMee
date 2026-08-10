'use strict';

const { CourseError } = require('./errors');
const { learnerCourseDto } = require('./contracts');

function normalizeWatchedIntervals(intervals, maxDuration = 0) {
  if (!Array.isArray(intervals)) return [];
  const valid = [];
  for (const item of intervals.slice(0, 1000)) {
    if (item && typeof item === 'object') {
      let start = Math.max(0, Number(item.start ?? item[0] ?? 0));
      let end = Math.max(0, Number(item.end ?? item[1] ?? 0));
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (maxDuration > 0) {
        start = Math.min(start, maxDuration);
        end = Math.min(end, maxDuration);
      }
      if (end > start) {
        valid.push([start, end]);
      }
    }
  }
  valid.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const curr of valid) {
    if (!merged.length) {
      merged.push(curr);
    } else {
      const last = merged[merged.length - 1];
      if (curr[0] <= last[1]) {
        last[1] = Math.max(last[1], curr[1]);
      } else {
        merged.push(curr);
      }
    }
  }
  return merged;
}

function calculateTotalWatchedSeconds(intervals) {
  return intervals.reduce((acc, [start, end]) => acc + (end - start), 0);
}

function createCourseService({ repository }) {
  if (!repository) throw new Error('Course repository is required.');

  async function createCourse(organizationId, payload) {
    if (!organizationId) {
      throw new CourseError('organization_id_required', 400);
    }
    if (!payload || !payload.title || payload.title.trim() === '' || payload.title.trim().length > 255) {
      throw new CourseError('course_title_required', 400);
    }
    const visibility = String(payload.visibility || 'public').toLowerCase();
    const pricing = String(payload.pricing || 'free').toLowerCase();
    if (!['public', 'private'].includes(visibility)) throw new CourseError('invalid_course_visibility', 400);
    if (!['free', 'paid'].includes(pricing)) throw new CourseError('invalid_course_pricing', 400);
    const priceMinor = pricing === 'paid' ? Number(payload.priceMinor) : null;
    const currency = pricing === 'paid' ? String(payload.currency || '').toUpperCase() : null;
    if (pricing === 'paid' && (!Number.isSafeInteger(priceMinor) || priceMinor < 1 || !/^[A-Z]{3}$/.test(currency))) {
      throw new CourseError('invalid_course_price', 400);
    }
    const description = String(payload.description || '').trim();
    const category = String(payload.category || '').trim();
    const tags = Array.isArray(payload.tags) ? [...new Set(payload.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 20) : [];
    if (description.length > 50_000 || category.length > 120 || tags.some((tag) => tag.length > 64)) throw new CourseError('invalid_course_metadata', 400);
    const result = await repository.createCourse(organizationId, { ...payload, title: payload.title.trim(), description, category, tags, visibility, pricing, priceMinor, currency });
    if (!result) throw new CourseError('organization_not_found', 404);
    return learnerCourseDto(result.course, result.version, result.modules);
  }

  async function getCourseDetails(courseId, userId = null) {
    const course = await repository.getCourseById(courseId);
    if (!course) {
      throw new CourseError('course_not_found', 404);
    }
    const enrollment = userId ? await repository.getEnrollment(userId, courseId) : null;
    const version = enrollment?.course_version_id
      ? await repository.getVersionById(enrollment.course_version_id)
      : await repository.getLatestVersion(courseId);
    const entitled = Boolean(enrollment && ['enrolled', 'completed'].includes(String(enrollment.status).toLowerCase()));
    const publicFree = String(course.visibility).toLowerCase() === 'public' && String(course.pricing).toLowerCase() === 'free';
    const modules = version && (entitled || publicFree) ? await repository.getModulesForVersion(version.id) : [];

    return learnerCourseDto(course, version, modules, enrollment);
  }

  async function enrollInCourse(userId, courseId) {
    if (!userId) {
      throw new CourseError('authentication_required', 401);
    }
    const course = await repository.getCourseById(courseId);
    if (!course) {
      throw new CourseError('course_not_found', 404);
    }
    if (String(course.visibility).toLowerCase() !== 'public' || String(course.pricing).toLowerCase() !== 'free') {
      throw new CourseError('enrollment_not_permitted', 403);
    }

    const enrollment = await repository.enrollUser(userId, courseId);
    return {
      enrollmentId: enrollment.id,
      userId: enrollment.user_id,
      courseId: enrollment.course_id,
      status: enrollment.status,
      enrolledAt: enrollment.enrolled_at,
    };
  }

  async function listCourses({ category, limit, cursor }) {
    const result = await repository.listCourses({ category, limit, cursor });
    return {
      courses: result.items.map((item) => ({
        id: item.id,
        organizationId: item.organization_id,
        title: item.title,
        description: item.description,
        visibility: item.visibility,
        pricing: item.pricing,
        priceMinor: item.price_minor,
        currency: item.currency,
        category: item.category,
        tags: Array.isArray(item.tags) ? item.tags : [],
        createdAt: item.created_at,
      })),
      hasMore: result.hasMore,
    };
  }

  async function listMyEnrollments(userId) {
    if (!userId) throw new CourseError('authentication_required', 401);
    return repository.listEnrollmentsForUser(userId);
  }

  async function listProviderCourses(organizationId) {
    return repository.listCoursesForOrganization(organizationId);
  }

  async function publishCourse(organizationId, courseId) {
    const verificationStatus = await repository.getOrganizationVerificationStatus(organizationId);
    if (verificationStatus !== 'approved') {
      throw new CourseError('organization_not_approved', 403);
    }
    const validation = await repository.validateCourseForPublish(organizationId, courseId);
    if (!validation || validation.modules < 1 || validation.contents < 1 || validation.invalid_quizzes > 0 || validation.invalid_assignments > 0 || validation.invalid_resources > 0 || validation.invalid_videos > 0 || validation.invalid_challenges > 0) {
      throw new CourseError('course_is_not_publishable', 400);
    }
    const course = await repository.publishCourse(organizationId, courseId);
    if (!course) throw new CourseError('course_not_found', 404);
    return course;
  }

  async function retireCourse(organizationId, courseId) {
    const course = await repository.retireCourse(organizationId, courseId);
    if (!course) throw new CourseError('course_not_found', 404);
    return course;
  }

  async function updateLessonProgress(userId, courseId, contentId, { lastPositionSec = 0, watchedIntervals = [], markComplete = false } = {}) {
    if (!userId) throw new CourseError('authentication_required', 401);

    const enrollment = await repository.getEnrollment(userId, courseId);
    if (!enrollment) {
      throw new CourseError('not_enrolled', 403);
    }

    if (typeof repository.verifyContentBelongsToCourse === 'function') {
      const belongs = await repository.verifyContentBelongsToCourse(
        courseId,
        contentId,
        enrollment.course_version_id,
      );
      if (!belongs) {
        throw new CourseError('content_not_found', 404);
      }
    }

    const content = await repository.getCourseContentById(contentId);
    const existing = await repository.getLessonProgress(enrollment.id, contentId);
    const duration = Number(content?.duration_seconds) || 0;
    const normalizedIntervals = normalizeWatchedIntervals(
      [...(existing?.watched_intervals || []), ...watchedIntervals],
      duration,
    );
    const watchedSeconds = calculateTotalWatchedSeconds(normalizedIntervals);
    const contentKind = String(content?.kind || '').toUpperCase();
    const completed =
      (duration > 0 && watchedSeconds >= duration * 0.9) ||
      (markComplete && ['ARTICLE', 'RESOURCE'].includes(contentKind)) ||
      (markComplete && contentKind === 'VIDEO' && duration === 0 && /^https:\/\//i.test(content?.legacy_url || ''));

    const progress = await repository.upsertLessonProgress(enrollment.id, contentId, {
      status: completed ? 'COMPLETED' : 'IN_PROGRESS',
      lastPositionSec: Math.min(duration || Number.MAX_SAFE_INTEGER, Math.max(0, lastPositionSec)),
      watchedIntervals: normalizedIntervals,
    });

    return {
      id: progress.id,
      enrollmentId: progress.enrollment_id,
      contentId: progress.content_id,
      status: progress.status,
      lastPositionSec: progress.last_position_sec,
      watchedIntervals: progress.watched_intervals,
      completedAt: progress.completed_at,
    };
  }

  async function getLessonProgress(userId, courseId, contentId) {
    if (!userId) throw new CourseError('authentication_required', 401);

    const enrollment = await repository.getEnrollment(userId, courseId);
    if (!enrollment) {
      throw new CourseError('not_enrolled', 403);
    }

    if (typeof repository.verifyContentBelongsToCourse === 'function') {
      const belongs = await repository.verifyContentBelongsToCourse(
        courseId,
        contentId,
        enrollment.course_version_id,
      );
      if (!belongs) throw new CourseError('content_not_found', 404);
    }

    const progress = await repository.getLessonProgress(enrollment.id, contentId);
    if (!progress) {
      return {
        contentId,
        status: 'NOT_STARTED',
        lastPositionSec: 0,
        watchedIntervals: [],
        completedAt: null,
      };
    }

    return {
      id: progress.id,
      enrollmentId: progress.enrollment_id,
      contentId: progress.content_id,
      status: progress.status,
      lastPositionSec: progress.last_position_sec,
      watchedIntervals: progress.watched_intervals,
      completedAt: progress.completed_at,
    };
  }

  async function getCourseProgressOverview(userId, courseId) {
    if (!userId) throw new CourseError('authentication_required', 401);

    const enrollment = await repository.getEnrollment(userId, courseId);
    if (!enrollment) {
      throw new CourseError('not_enrolled', 403);
    }

    const overview = await repository.getCourseProgressOverview(enrollment.id);
    const completedLessons = Number(overview?.completed_lessons || 0);
    const totalLessons = Number(overview?.total_lessons || 0);
    return {
      enrollmentId: enrollment.id,
      status: overview?.enrollment_status || enrollment.status,
      completedAt: overview?.completed_at || enrollment.completed_at,
      totalLessons,
      completedLessons,
      percent: Number(overview?.percent || 0),
      completedContentIds: Array.isArray(overview?.completed_content_ids) ? overview.completed_content_ids : [],
      breakdown: [
        { status: 'COMPLETED', count: completedLessons },
        { status: 'REMAINING', count: Math.max(0, totalLessons - completedLessons) },
      ],
    };
  }

  async function onChallengeSolved(userId, challengeId) {
    if (!userId || !challengeId) return [];

    if (typeof repository.findContentByChallengeId === 'function') {
      const contents = await repository.findContentByChallengeId(challengeId);
      const updated = [];
      for (const content of contents) {
        const enrollment = await repository.getEnrollment(userId, content.course_id);
        if (enrollment) {
          const progress = await repository.upsertLessonProgress(enrollment.id, content.id, { status: 'COMPLETED' });
          if (progress) updated.push(progress);
        }
      }
      return updated;
    }
    return [];
  }

  return {
    createCourse,
    getCourseDetails,
    enrollInCourse,
    listCourses,
    listMyEnrollments,
    listProviderCourses,
    publishCourse,
    retireCourse,
    updateLessonProgress,
    getLessonProgress,
    getCourseProgressOverview,
    onChallengeSolved,
  };
}

module.exports = {
  createCourseService,
  normalizeWatchedIntervals,
  calculateTotalWatchedSeconds,
};
