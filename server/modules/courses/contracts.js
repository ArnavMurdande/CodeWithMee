'use strict';

const COURSE_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
};

const COURSE_VISIBILITY = {
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
  UNLISTED: 'UNLISTED',
};

const CONTENT_KIND = {
  VIDEO: 'VIDEO',
  ARTICLE: 'ARTICLE',
  QUIZ: 'QUIZ',
  CHALLENGE: 'CHALLENGE',
  ASSIGNMENT: 'ASSIGNMENT',
  RESOURCE: 'RESOURCE',
};

function learnerCourseDto(course, version, modules, enrollment = null) {
  return {
    id: course.id,
    organizationId: course.organization_id || course.organizationId,
    title: course.title,
    description: course.description,
    visibility: course.visibility,
    pricing: course.pricing,
    priceMinor: course.price_minor || course.priceMinor,
    currency: course.currency,
    category: course.category,
    tags: Array.isArray(course.tags) ? course.tags : [],
    version: version ? version.version : 1,
    modules: (modules || []).map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      position: m.position,
      contents: (m.contents || []).map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title,
        legacyUrl: c.legacy_url || c.legacyUrl,
        body: c.body,
        allowDownload: c.allow_download ?? c.allowDownload ?? false,
        durationSeconds: c.duration_seconds || c.durationSeconds || null,
        challengeId: c.challenge_id || c.challengeId || null,
        mediaFileId: c.media_file_id || c.mediaFileId || null,
        resource: c.resource
          ? {
              id: c.resource.id,
              fileId: c.resource.file_id,
              externalUrl: c.resource.external_url,
              notes: c.resource.notes,
              allowDownload: c.resource.allow_download,
            }
          : null,
        quiz: c.quiz
          ? {
              id: c.quiz.id,
              title: c.quiz.title,
              instructions: c.quiz.instructions,
              attemptsAllowed: c.quiz.attempts_allowed,
              passingScore: c.quiz.passing_score,
              questions: c.quiz.questions,
            }
          : null,
        assignment: c.assignment
          ? {
              id: c.assignment.id,
              title: c.assignment.title,
              instructions: c.assignment.instructions,
              dueAt: c.assignment.due_at,
              maxAttempts: c.assignment.max_attempts,
              maxScore: c.assignment.max_score,
              rubric: c.assignment.rubric,
            }
          : null,
        position: c.position,
      })),
    })),
    isEnrolled: !!enrollment,
    enrollmentStatus: enrollment ? enrollment.status : null,
  };
}

module.exports = {
  COURSE_STATUS,
  COURSE_VISIBILITY,
  CONTENT_KIND,
  learnerCourseDto,
};
