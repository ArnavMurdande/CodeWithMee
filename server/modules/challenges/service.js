'use strict';

const { ChallengeError } = require('./errors');
const { learnerChallengeDto, authorChallengeDto, learnerChallengeSummaryDto, CHALLENGE_STATUS, TEST_VISIBILITY } = require('./contracts');
const { EXECUTION_MODE, buildExecutionHarness, evaluateTestResult } = require('./harness');

const EXECUTION_LANGUAGES = new Set(['python','javascript','java','cpp','c','rust','ruby','sqlite','go','php','kotlin','swift','scala','dart','perl','r','elixir','cobol','nasm','powershell','bash']);
function validateCodeInput(language, code) {
  if (!EXECUTION_LANGUAGES.has(String(language).toLowerCase())) throw new ChallengeError('unsupported_language', 400);
  if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code, 'utf8') > 100_000) throw new ChallengeError('invalid_code', 400);
}

function createChallengeService({ repository, executionGateway, jobQueue, onChallengeSolved = null }) {
  if (!repository) throw new Error('Challenge repository is required.');

  async function createChallenge(authorUserId, payload) {
    if (!authorUserId) {
      throw new ChallengeError('authentication_required', 401);
    }
    const title = String(payload?.title || '').trim();
    const difficulty = String(payload?.difficulty || '').toLowerCase();
    const visible = Array.isArray(payload?.visibleTestCases) ? payload.visibleTestCases : [];
    const hidden = Array.isArray(payload?.hiddenTestCases) ? payload.hiddenTestCases : [];
    const combined = Array.isArray(payload?.testCases) ? payload.testCases : [];
    if (!title || title.length > 255 || !['easy','medium','hard'].includes(difficulty)) throw new ChallengeError('invalid_challenge', 400);
    if (visible.length + hidden.length + combined.length > 200) throw new ChallengeError('too_many_test_cases', 400);
    for (const testCase of [...visible, ...hidden, ...combined]) {
      const output = testCase?.expectedOutput ?? testCase?.expected_output ?? testCase?.output;
      if (typeof testCase?.input !== 'string' || typeof output !== 'string' || !output.trim() || Buffer.byteLength(testCase.input, 'utf8') > 64_000 || Buffer.byteLength(output, 'utf8') > 64_000) throw new ChallengeError('invalid_test_case', 400);
    }
    const result = await repository.createChallenge(authorUserId, { ...payload, title, difficulty });
    return authorChallengeDto(result.challenge, result.version, result.testCases);
  }

  async function getChallengeForLearner(challengeId, userId = null) {
    const challenge = await repository.getChallengeById(challengeId);
    if (!challenge) {
      throw new ChallengeError('challenge_not_found', 404);
    }
    const version = await repository.getLatestVersion(challengeId);
    if (!version) {
      throw new ChallengeError('version_not_found', 404);
    }
    const testCases = await repository.getTestCases(version.id, { includeHidden: true });
    const dto = learnerChallengeDto(challenge, version, testCases);
    const [engagement, comments] = await Promise.all([
      repository.getEngagement ? repository.getEngagement(challengeId, userId) : null,
      repository.listComments ? repository.listComments(challengeId) : [],
    ]);
    return {
      ...dto,
      likes: engagement?.likes || [],
      dislikes: engagement?.dislikes || [],
      isSaved: engagement?.saved_status || false,
      comments: buildCommentTree(comments),
    };
  }

  async function getChallengeForAuthor(challengeId) {
    const challenge = await repository.getChallengeById(challengeId, { forAuthor: true });
    if (!challenge) {
      throw new ChallengeError('challenge_not_found', 404);
    }
    const version = await repository.getLatestVersion(challengeId);
    if (!version) {
      throw new ChallengeError('version_not_found', 404);
    }
    const testCases = await repository.getTestCases(version.id, { includeHidden: true });
    return authorChallengeDto(challenge, version, testCases);
  }

  async function listChallenges({ difficulty = null, tag = null, search = null, limit = 20, cursor = null, userId = null } = {}) {
    const result = await repository.listChallenges({ difficulty, tag, search, userId, limit, cursor });
    const mapped = (result.items || []).map((c) => learnerChallengeSummaryDto(c));
    return {
      items: mapped,
      challenges: mapped,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  }

  async function submitForReview(authorUserId, challengeId) {
    const challenge = await repository.getChallengeById(challengeId, { forAuthor: true });
    if (!challenge) throw new ChallengeError('challenge_not_found', 404);
    if (challenge.created_by_user_id !== authorUserId) throw new ChallengeError('unauthorized_author', 403);

    const updated = await repository.updateChallengeStatus(authorUserId, challengeId, CHALLENGE_STATUS.IN_REVIEW);
    const version = await repository.getLatestVersion(challengeId);
    const testCases = await repository.getTestCases(version.id, { includeHidden: true });
    return authorChallengeDto(updated, version, testCases);
  }

  async function publishChallenge(authorUserId, challengeId) {
    const challenge = await repository.getChallengeById(challengeId, { forAuthor: true });
    if (!challenge) throw new ChallengeError('challenge_not_found', 404);
    if (challenge.created_by_user_id !== authorUserId) throw new ChallengeError('unauthorized_author', 403);

    const version = await repository.getLatestVersion(challengeId);
    if (!version) throw new ChallengeError('version_not_found', 404);

    const testCases = await repository.getTestCases(version.id, { includeHidden: true });

    const visibleCount = testCases.filter((tc) => tc.visibility === TEST_VISIBILITY.VISIBLE || tc.visibility === 'visible').length;
    const hiddenCount = testCases.filter((tc) => tc.visibility === TEST_VISIBILITY.HIDDEN || tc.visibility === 'hidden').length;

    if (visibleCount < 1) {
      throw new ChallengeError('publish_requires_at_least_one_visible_test_case', 400);
    }
    if (hiddenCount < 1) {
      throw new ChallengeError('publish_requires_at_least_one_hidden_test_case', 400);
    }

    const invalidTestCase = testCases.find(
      (tc) => typeof tc.input !== 'string' || typeof tc.expected_output !== 'string' || tc.expected_output.trim() === ''
    );
    if (invalidTestCase) {
      throw new ChallengeError('test_cases_must_have_valid_input_and_output', 400);
    }

    const updated = await repository.updateChallengeStatus(authorUserId, challengeId, CHALLENGE_STATUS.PUBLISHED);
    return authorChallengeDto(updated, version, testCases);
  }

  async function retireChallenge(authorUserId, challengeId) {
    const challenge = await repository.getChallengeById(challengeId, { forAuthor: true });
    if (!challenge) throw new ChallengeError('challenge_not_found', 404);
    if (challenge.created_by_user_id !== authorUserId) throw new ChallengeError('unauthorized_author', 403);

    const updated = await repository.updateChallengeStatus(authorUserId, challengeId, CHALLENGE_STATUS.RETIRED);
    const version = await repository.getLatestVersion(challengeId);
    const testCases = await repository.getTestCases(version.id, { includeHidden: true });
    return authorChallengeDto(updated, version, testCases);
  }

  async function runCodeForLearner(challengeId, { language = 'python', code = '', customInput = null, userId = null } = {}, injectedGateway = executionGateway, injectedQueue = jobQueue) {
    validateCodeInput(language, code);
    if (typeof customInput === 'string' && Buffer.byteLength(customInput, 'utf8') > 64_000) throw new ChallengeError('custom_input_too_large', 400);
    const challenge = await repository.getChallengeById(challengeId);
    if (!challenge) throw new ChallengeError('challenge_not_found', 404);

    const version = await repository.getLatestVersion(challengeId);
    if (!version) throw new ChallengeError('version_not_found', 404);

    if (!injectedGateway) {
      throw new ChallengeError('runner_unavailable', 503);
    }

    const targetTestCases =
      typeof customInput === 'string'
        ? [{ id: 'custom', input: customInput, expected_output: '' }]
        : await repository.getTestCases(version.id, { includeHidden: false });

    const results = [];
    for (const tc of targetTestCases) {
      const harness = buildExecutionHarness(language, EXECUTION_MODE.STDIN_STDOUT, code, { input: tc.input });

      let rawRes;
      try {
        if (injectedQueue) {
          rawRes = await injectedQueue.enqueueJob(
            (signal) => injectedGateway.executeJob(language, harness.code, harness.stdin, 5000, { signal }),
            7000,
            { userId, challengeId, versionId: version.id, language, operationType: 'RUN' },
          );
        } else {
          rawRes = await injectedGateway.executeJob(language, harness.code, harness.stdin);
        }
      } catch (_err) {
        throw new ChallengeError('runner_unavailable', 503);
      }

      const evalRes = typeof customInput === 'string'
        ? { passed: null, status: (rawRes.exitCode || 0) === 0 ? 'EXECUTED' : 'RUNTIME_ERROR', actualOutput: rawRes.stdout || rawRes.output || '', errorOutput: rawRes.stderr || '' }
        : evaluateTestResult(
          EXECUTION_MODE.STDIN_STDOUT,
          rawRes.stdout || rawRes.output || '',
          rawRes.stderr || '',
          rawRes.code || rawRes.exitCode || 0,
          tc.expected_output || tc.expectedOutput || ''
        );

      results.push({
        testCaseId: tc.id,
        passed: evalRes.passed,
        status: evalRes.status,
        actualOutput: evalRes.actualOutput,
        errorOutput: evalRes.errorOutput,
      });
    }

    return {
      challengeId,
      language,
      results,
    };
  }

  async function submitCodeForLearner(learnerUserId, challengeId, { language = 'python', code = '' } = {}, injectedGateway = executionGateway, injectedQueue = jobQueue) {
    if (!learnerUserId) throw new ChallengeError('authentication_required', 401);
    validateCodeInput(language, code);

    const challenge = await repository.getChallengeById(challengeId);
    if (!challenge) throw new ChallengeError('challenge_not_found', 404);

    const version = await repository.getLatestVersion(challengeId);
    if (!version) throw new ChallengeError('version_not_found', 404);

    if (!injectedGateway) {
      throw new ChallengeError('runner_unavailable', 503);
    }

    const testCases = await repository.getTestCases(version.id, { includeHidden: true });
    let passCount = 0;
    let overallStatus = 'ACCEPTED';
    let failedTestCaseIndex = null;
    let primaryErrorMessage = null;
    let failedTestCaseExpectedOutput = null;
    let failedTestCaseActualOutput = null;
    let failedTestCaseErrorOutput = null;

    const testResults = [];

    for (let idx = 0; idx < testCases.length; idx++) {
      const tc = testCases[idx];
      const harness = buildExecutionHarness(language, EXECUTION_MODE.STDIN_STDOUT, code, { input: tc.input });

      let rawRes;
      try {
        if (injectedQueue) {
          rawRes = await injectedQueue.enqueueJob(
            (signal) => injectedGateway.executeJob(language, harness.code, harness.stdin, 5000, { signal }),
            7000,
            {
              userId: learnerUserId,
              challengeId,
              versionId: version.id,
              language,
              operationType: 'SUBMIT',
            },
          );
        } else {
          rawRes = await injectedGateway.executeJob(language, harness.code, harness.stdin);
        }
      } catch (_err) {
        throw new ChallengeError('runner_unavailable', 503);
      }

      const evalRes = evaluateTestResult(
        EXECUTION_MODE.STDIN_STDOUT,
        rawRes.stdout || rawRes.output || '',
        rawRes.stderr || '',
        rawRes.code || rawRes.exitCode || 0,
        tc.expected_output || tc.expectedOutput || ''
      );

      const isHidden = tc.visibility === TEST_VISIBILITY.HIDDEN || tc.visibility === 'hidden';

      if (evalRes.passed) {
        passCount++;
        testResults.push({
          position: idx,
          passed: true,
          status: 'PASSED',
          actualOutput: isHidden ? null : evalRes.actualOutput,
        });
      } else {
        if (overallStatus === 'ACCEPTED') {
          overallStatus = evalRes.status;
          failedTestCaseIndex = idx + 1;
          primaryErrorMessage = isHidden ? 'Hidden test case failed.' : evalRes.errorOutput || 'Wrong answer';
          failedTestCaseExpectedOutput = isHidden ? null : (tc.expected_output || tc.expectedOutput || null);
          failedTestCaseActualOutput = isHidden ? null : evalRes.actualOutput;
          failedTestCaseErrorOutput = isHidden ? null : evalRes.errorOutput;
        }
        testResults.push({
          position: idx,
          passed: false,
          status: evalRes.status,
          actualOutput: isHidden ? null : evalRes.actualOutput,
          errorOutput: isHidden ? null : evalRes.errorOutput,
        });
      }
    }

    const finalScore = overallStatus === 'ACCEPTED' ? challenge.score : 0;

    const submissionRecord = await repository.recordSubmission({
      challengeId,
      versionId: version.id,
      userId: learnerUserId,
      language,
      code,
      status: overallStatus,
      score: finalScore,
      passCount,
      totalCount: testCases.length,
      failedTestCase: failedTestCaseIndex,
      errorMessage: primaryErrorMessage,
    });
    if (overallStatus === 'ACCEPTED' && typeof onChallengeSolved === 'function') {
      await onChallengeSolved(learnerUserId, challengeId);
    }

    return {
      submissionId: submissionRecord ? submissionRecord.id : null,
      challengeId,
      status: overallStatus,
      score: finalScore,
      passCount,
      totalCount: testCases.length,
      failedTestCaseIndex,
      expectedOutput: failedTestCaseExpectedOutput,
      actualOutput: failedTestCaseActualOutput,
      errorOutput: failedTestCaseErrorOutput,
      results: testResults,
    };
  }

  async function getSubmissionsForLearner(userId, challengeId, { limit = 20, cursor = null } = {}) {
    const result = await repository.listSubmissions(userId, { challengeId, limit, cursor });
    const mapped = (result.items || []).map((sub) => ({
      id: sub.id,
      challengeId: sub.challenge_id,
      versionId: sub.version_id,
      userId: sub.user_id,
      language: sub.language,
      status: sub.status,
      score: sub.score,
      passCount: sub.pass_count,
      totalCount: sub.total_count,
      createdAt: sub.created_at,
    }));
    return {
      items: mapped,
      submissions: mapped,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  }

  async function getSubmissionById(userId, submissionId) {
    if (!userId) throw new ChallengeError('authentication_required', 401);
    const submission = await repository.getSubmissionById(userId, submissionId);
    if (!submission) throw new ChallengeError('submission_not_found', 404);
    return {
      id: submission.id,
      challengeId: submission.challenge_id,
      versionId: submission.version_id,
      language: submission.language,
      code: submission.code,
      status: submission.status,
      score: submission.score,
      passCount: submission.pass_count,
      totalCount: submission.total_count,
      failedTestCase: submission.failed_test_case,
      errorMessage: submission.error_message,
      createdAt: submission.created_at,
    };
  }

  async function toggleBookmark(userId, challengeId) {
    if (!userId) throw new ChallengeError('authentication_required', 401);
    const savedChallenges = await repository.toggleBookmark(userId, challengeId);
    if (!savedChallenges) throw new ChallengeError('challenge_not_found', 404);
    return { savedChallenges };
  }

  async function reactToChallenge(userId, challengeId, kind) {
    const engagement = await repository.setReaction(userId, challengeId, kind);
    if (!engagement) throw new ChallengeError('challenge_not_found', 404);
    return { likes: engagement.likes || [], dislikes: engagement.dislikes || [] };
  }

  async function archiveChallenge(userId, challengeId) {
    if (!(await repository.archiveChallenge(userId, challengeId))) {
      throw new ChallengeError('challenge_not_found_or_not_author', 404);
    }
  }

  async function addComment(userId, challengeId, text, parentId = null) {
    const normalized = String(text || '').trim();
    if (!normalized || normalized.length > 5000) throw new ChallengeError('invalid_comment', 400);
    const created = await repository.createComment(userId, challengeId, normalized, parentId);
    if (!created) throw new ChallengeError('challenge_or_parent_not_found', 404);
    return created;
  }

  async function reactToComment(userId, challengeId, commentId, kind, awardType = null) {
    if (!(await repository.setCommentReaction(userId, challengeId, commentId, kind, awardType))) {
      throw new ChallengeError('comment_not_found_or_invalid_reaction', 404);
    }
  }

  async function removeComment(userId, challengeId, commentId, canModerate = false) {
    if (!(await repository.deleteComment(userId, challengeId, commentId, canModerate))) {
      throw new ChallengeError('comment_not_found_or_not_authorized', 404);
    }
  }

  async function getLeaderboard(limit = 50) {
    const rows = await repository.getLeaderboard(limit);
    return rows.map((row) => ({
      _id: row.id,
      id: row.id,
      username: row.username || row.display_name,
      displayName: row.display_name,
      profilePictureUrl: row.avatar_url,
      score: row.score,
      solvedCount: row.solved_count,
    }));
  }

  return {
    createChallenge,
    getChallengeForLearner,
    getChallengeForAuthor,
    listChallenges,
    submitForReview,
    publishChallenge,
    retireChallenge,
    runCodeForLearner,
    submitCodeForLearner,
    getSubmissionsForLearner,
    getSubmissionById,
    toggleBookmark,
    reactToChallenge,
    archiveChallenge,
    addComment,
    reactToComment,
    removeComment,
    getLeaderboard,
  };
}

function buildCommentTree(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    byId.set(row.id, {
      _id: row.id,
      id: row.id,
      text: row.text,
      createdAt: row.created_at,
      author: {
        _id: row.author_user_id,
        id: row.author_user_id,
        username: row.username || row.display_name,
        displayName: row.display_name,
        profilePictureUrl: row.avatar_url,
      },
      likes: row.likes || [],
      dislikes: row.dislikes || [],
      awards: row.awards || [],
      replies: [],
    });
  }
  const roots = [];
  for (const row of rows || []) {
    const item = byId.get(row.id);
    const parent = row.parent_id && byId.get(row.parent_id);
    if (parent) parent.replies.push(item);
    else roots.push(item);
  }
  return roots;
}

module.exports = { createChallengeService };
