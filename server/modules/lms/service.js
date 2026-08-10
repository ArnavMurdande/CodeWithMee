'use strict';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTTPS_URL = /^https:\/\//i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lmsError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

function createLmsService(repository, { mailer = null } = {}) {
  const validKinds = new Set(['VIDEO', 'ARTICLE', 'RESOURCE', 'QUIZ', 'ASSIGNMENT', 'CHALLENGE']);
  function normalizeStructure(modules) {
    if (!Array.isArray(modules) || modules.length === 0 || modules.length > 100) throw lmsError('invalid_modules');
    return modules.map((moduleInput) => {
      if (!String(moduleInput.title || '').trim() || !Array.isArray(moduleInput.contents) || moduleInput.contents.length > 500) throw lmsError('invalid_module');
      return {
        title: String(moduleInput.title).trim().slice(0, 255),
        description: String(moduleInput.description || '').trim().slice(0, 5000),
        contents: moduleInput.contents.map((item) => {
          const kind = String(item.kind || '').toUpperCase();
          if (!validKinds.has(kind) || !String(item.title || '').trim()) throw lmsError('invalid_content');
          if (item.url && !HTTPS_URL.test(item.url)) throw lmsError('external_urls_must_use_https');
          if (kind === 'VIDEO') {
            if (Boolean(item.url) === Boolean(item.mediaFileId)) throw lmsError('video_requires_exactly_one_source');
            if (item.mediaFileId && !UUID.test(String(item.mediaFileId))) throw lmsError('invalid_video_file_id');
            if (item.mediaFileId && (!Number.isInteger(item.durationSeconds) || item.durationSeconds < 1 || item.durationSeconds > 86_400)) {
              throw lmsError('uploaded_video_requires_duration');
            }
          }
          if (item.resource?.externalUrl && !HTTPS_URL.test(item.resource.externalUrl)) throw lmsError('external_urls_must_use_https');
          if (item.resource && Boolean(item.resource.fileId) === Boolean(item.resource.externalUrl)) throw lmsError('resource_requires_exactly_one_source');
          if (item.quiz && (!Array.isArray(item.quiz.questions) || item.quiz.questions.length === 0 || item.quiz.questions.length > 200)) throw lmsError('quiz_requires_questions');
          if (item.quiz) {
            if (!Number.isInteger(item.quiz.attemptsAllowed || 1) || (item.quiz.attemptsAllowed || 1) < 1 || (item.quiz.attemptsAllowed || 1) > 100) throw lmsError('invalid_quiz_attempt_limit');
            if (!Number.isFinite(Number(item.quiz.passingScore ?? 70)) || Number(item.quiz.passingScore ?? 70) < 0 || Number(item.quiz.passingScore ?? 70) > 100) throw lmsError('invalid_quiz_passing_score');
            for (const question of item.quiz.questions) {
              if (!['single_choice','multiple_choice','true_false','written'].includes(question.kind) || !String(question.prompt || '').trim()) throw lmsError('invalid_quiz_question');
              if (question.kind !== 'written' && question.answerKey === undefined) throw lmsError('objective_question_requires_answer');
              if (!Number.isInteger(question.points || 1) || (question.points || 1) < 1 || (question.points || 1) > 1000) throw lmsError('invalid_question_points');
            }
          }
          if (item.assignment && !String(item.assignment.instructions || '').trim()) throw lmsError('assignment_requires_instructions');
          if (item.assignment) {
            if (!Number.isInteger(item.assignment.maxAttempts || 1) || (item.assignment.maxAttempts || 1) < 1 || (item.assignment.maxAttempts || 1) > 100) throw lmsError('invalid_assignment_attempt_limit');
            if (!Number.isInteger(item.assignment.maxScore || 100) || (item.assignment.maxScore || 100) < 1 || (item.assignment.maxScore || 100) > 10000) throw lmsError('invalid_assignment_score');
            if (item.assignment.dueAt && Number.isNaN(Date.parse(item.assignment.dueAt))) throw lmsError('invalid_assignment_due_date');
          }
          if (kind === 'CHALLENGE' && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(item.challengeId || ''))) throw lmsError('challenge_id_required');
          return { ...item, kind, title: String(item.title).trim().slice(0, 255), body: String(item.body || '').slice(0, 100000) };
        }),
      };
    });
  }

  return {
    replaceStructure(organizationId, courseId, modules, expectedVersion = null) {
      if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) throw lmsError('invalid_expected_version');
      return repository.replaceStructure(organizationId, courseId, normalizeStructure(modules), expectedVersion);
    },
    getStructure: (organizationId, courseId) => repository.getStructure(organizationId, courseId),
    dashboard: (organizationId) => repository.dashboard(organizationId),
    listStaff: (organizationId, courseId) => repository.listStaff(organizationId, courseId),
    setStaffRole(organizationId, courseId, userId, role) {
      if (!['manager','instructor','grader','analyst','payment_reviewer'].includes(role)) throw lmsError('invalid_course_role');
      if (!UUID.test(String(userId))) throw lmsError('invalid_user_id');
      return repository.setStaffRole(organizationId, courseId, userId, role);
    },
    roster: (organizationId, courseId) => repository.roster(organizationId, courseId),
    setEnrollmentStatus(organizationId, courseId, enrollmentId, status) {
      if (!['enrolled', 'suspended', 'completed'].includes(status)) throw lmsError('invalid_enrollment_status');
      return repository.setEnrollmentStatus(organizationId, courseId, enrollmentId, status);
    },
    async createInvitation(organizationId, courseId, email, userId) {
      const normalized = String(email || '').trim().toLowerCase();
      if (!EMAIL.test(normalized)) throw lmsError('invalid_email');
      const created = await repository.createInvitation(organizationId, courseId, normalized, userId);
      if (!created) return null;
      const delivery = mailer
        ? await mailer.send({ purpose: 'course_invitation', to: normalized, token: created.token })
        : { delivered: false };
      return { ...created.invitation, delivered: delivery.delivered === true };
    },
    acceptInvitation: (token, user) => repository.acceptInvitation(token, user.id, user.email),
    submitQuiz(userId, courseId, quizId, answers) {
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw lmsError('invalid_answers');
      return repository.submitQuiz(userId, courseId, quizId, answers);
    },
    submitAssignment(userId, courseId, assignmentId, body) {
      const fileIds = Array.isArray(body.fileIds) ? body.fileIds.slice(0, 20) : [];
      if (fileIds.some((fileId) => !UUID.test(String(fileId)))) throw lmsError('invalid_file_id');
      if (!String(body.writtenAnswer || '').trim() && fileIds.length === 0) throw lmsError('submission_is_empty');
      return repository.submitAssignment(userId, courseId, assignmentId, String(body.writtenAnswer || '').slice(0, 100000), fileIds);
    },
    gradingQueue: (organizationId, courseId) => repository.gradingQueue(organizationId, courseId),
    quizGradingQueue: (organizationId, courseId) => repository.quizGradingQueue(organizationId, courseId),
    gradeQuizAttempt(organizationId, courseId, attemptId, graderUserId, body) {
      const score = Number(body.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) throw lmsError('invalid_score');
      return repository.gradeQuizAttempt(organizationId, courseId, attemptId, graderUserId, score, String(body.feedback || '').slice(0, 20000), body.release);
    },
    learnerResults: (userId, courseId) => repository.learnerResults(userId, courseId),
    gradeSubmission(organizationId, courseId, submissionId, graderUserId, body) {
      const score = Number(body.score);
      if (!Number.isFinite(score) || score < 0) throw lmsError('invalid_score');
      return repository.gradeSubmission(organizationId, courseId, submissionId, graderUserId, score, body.rubricScores, String(body.feedback || '').slice(0, 20000), body.release);
    },
    createPaymentOrder: (userId, courseId) => repository.createPaymentOrder(userId, courseId),
    getPaymentSettings: (organizationId) => repository.getPaymentSettings(organizationId),
    setPaymentSettings(organizationId, userId, body) {
      if (!UUID.test(String(body?.qrFileId || ''))) throw lmsError('invalid_payment_qr_file_id');
      const instructions = String(body?.instructions || '').trim();
      if (!instructions || instructions.length > 5000) throw lmsError('invalid_payment_instructions');
      return repository.setPaymentSettings(organizationId, userId, body.qrFileId, instructions);
    },
    attachPaymentProof(userId, orderId, fileId) {
      if (!UUID.test(String(orderId)) || !UUID.test(String(fileId))) throw lmsError('invalid_file_id');
      return repository.attachPaymentProof(userId, orderId, fileId);
    },
    paymentQueue: (organizationId) => repository.paymentQueue(organizationId),
    reviewPayment(organizationId, orderId, reviewerUserId, body) {
      if (!['approved', 'rejected', 'more_information'].includes(body.decision)) throw lmsError('invalid_payment_decision');
      return repository.reviewPayment(organizationId, orderId, reviewerUserId, body.decision, String(body.note || '').slice(0, 5000));
    },
    analytics: (organizationId, courseId) => repository.analytics(organizationId, courseId),
    async analyticsExport(organizationId, courseId, actorUserId) {
      const rows = await repository.analyticsExport(organizationId, courseId, actorUserId);
      const columns = ['enrollment_id','display_name','email_display','status','enrolled_at','completed_at','total_lessons','completed_lessons','percent','quiz_attempts','assignment_submissions'];
      const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
      return [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n');
    },
  };
}

module.exports = { createLmsService };
