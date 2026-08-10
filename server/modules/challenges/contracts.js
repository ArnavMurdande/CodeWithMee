'use strict';

const CHALLENGE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  PUBLISHED: 'PUBLISHED',
  RETIRED: 'RETIRED',
});

const CHALLENGE_DIFFICULTY = Object.freeze({
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
});

const TEST_VISIBILITY = Object.freeze({
  VISIBLE: 'visible',
  HIDDEN: 'hidden',
});

function difficultyDto(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'easy') return CHALLENGE_DIFFICULTY.EASY;
  if (normalized === 'medium') return CHALLENGE_DIFFICULTY.MEDIUM;
  if (normalized === 'hard') return CHALLENGE_DIFFICULTY.HARD;
  return value;
}

/**
 * Learner DTO: Strips hidden test case inputs/outputs and reference solution.
 * Never leaks secret test cases or reference solution to non-author/learner clients.
 */
function learnerChallengeDto(challenge, version, testCases = []) {
  if (!challenge || !version) return null;

  const visibleTestCases = (testCases || [])
    .filter((tc) => tc.visibility === TEST_VISIBILITY.VISIBLE || tc.visibility === 'VISIBLE')
    .map((tc, idx) => ({
      id: tc.id,
      position: tc.position !== undefined ? tc.position : idx,
      input: tc.input,
      expectedOutput: tc.expectedOutput || tc.expected_output,
    }));

  const hiddenCount = (testCases || []).filter(
    (tc) => tc.visibility === TEST_VISIBILITY.HIDDEN || tc.visibility === 'hidden'
  ).length;

  return {
    id: challenge.id,
    title: challenge.title,
    difficulty: difficultyDto(challenge.difficulty),
    score: challenge.score,
    tags: Array.isArray(challenge.tags) ? challenge.tags : [],
    version: version.version,
    statement: version.statement,
    constraintsText: version.constraintsText || version.constraints_text || null,
    starterTemplates: version.starterTemplates || version.starter_templates || {},
    testCases: visibleTestCases,
    hiddenTestCount: hiddenCount,
    status: challenge.status || 'DRAFT',
    createdByUserId: challenge.createdByUserId || challenge.created_by_user_id,
    createdAt: challenge.createdAt || challenge.created_at,
    updatedAt: challenge.updatedAt || challenge.updated_at,
  };
}

/**
 * Learner Challenge Summary DTO for catalogue listing.
 */
function learnerChallengeSummaryDto(challenge) {
  if (!challenge) return null;
  return {
    id: challenge.id,
    title: challenge.title,
    difficulty: difficultyDto(challenge.difficulty),
    score: challenge.score,
    tags: Array.isArray(challenge.tags) ? challenge.tags : [],
    solvedStatus: challenge.solved_status ?? challenge.solvedStatus ?? false,
    isSolved: challenge.solved_status ?? challenge.solvedStatus ?? false,
    isSaved: challenge.saved_status ?? challenge.savedStatus ?? false,
    likes: Array.isArray(challenge.likes) ? challenge.likes : [],
    dislikes: Array.isArray(challenge.dislikes) ? challenge.dislikes : [],
    createdByUserId: challenge.createdByUserId || challenge.created_by_user_id,
    createdAt: challenge.createdAt || challenge.created_at,
    updatedAt: challenge.updatedAt || challenge.updated_at,
  };
}

/**
 * Author DTO: Includes reference solution, all visible and hidden test cases, for author/admin management.
 */
function authorChallengeDto(challenge, version, testCases = []) {
  if (!challenge || !version) return null;

  const formattedTestCases = (testCases || []).map((tc, idx) => ({
    id: tc.id,
    position: tc.position !== undefined ? tc.position : idx,
    input: tc.input,
    expectedOutput: tc.expectedOutput || tc.expected_output,
    visibility: tc.visibility || TEST_VISIBILITY.VISIBLE,
  }));

  return {
    id: challenge.id,
    title: challenge.title,
    difficulty: difficultyDto(challenge.difficulty),
    status: challenge.status || 'DRAFT',
    score: challenge.score,
    tags: Array.isArray(challenge.tags) ? challenge.tags : [],
    version: version.version,
    statement: version.statement,
    constraintsText: version.constraintsText || version.constraints_text || null,
    referenceSolution: version.referenceSolution || version.reference_solution,
    starterTemplates: version.starterTemplates || version.starter_templates || {},
    testCases: formattedTestCases,
    createdByUserId: challenge.createdByUserId || challenge.created_by_user_id,
    createdAt: challenge.createdAt || challenge.created_at,
    updatedAt: challenge.updatedAt || challenge.updated_at,
  };
}

module.exports = {
  CHALLENGE_STATUS,
  CHALLENGE_DIFFICULTY,
  TEST_VISIBILITY,
  learnerChallengeDto,
  learnerChallengeSummaryDto,
  authorChallengeDto,
};
