'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createLmsService } = require('../modules/lms/service');

const ID = '11111111-1111-4111-8111-111111111111';

function repository(overrides = {}) {
  return {
    async replaceStructure(_organizationId, _courseId, modules) { return modules; },
    async setStaffRole(...args) { return args; },
    async setEnrollmentStatus(...args) { return args; },
    async submitAssignment(...args) { return args; },
    async reviewPayment(...args) { return args; },
    async setPaymentSettings(...args) { return args; },
    ...overrides,
  };
}

test('provider structure validation accepts uploaded videos, resources, quizzes, assignments, and challenges', async () => {
  const service = createLmsService(repository());
  const modules = await service.replaceStructure(ID, ID, [{
    title: 'Complete module',
    contents: [
      { kind: 'VIDEO', title: 'Uploaded lesson', mediaFileId: ID, durationSeconds: 120 },
      { kind: 'VIDEO', title: 'External lesson', url: 'https://video.example/lesson' },
      { kind: 'ARTICLE', title: 'Notes', body: 'Restricted plain text notes' },
      { kind: 'RESOURCE', title: 'Workbook', resource: { fileId: ID, allowDownload: true } },
      { kind: 'QUIZ', title: 'Quiz', quiz: { questions: [{ kind: 'true_false', prompt: 'Safe?', answerKey: true, points: 1 }] } },
      { kind: 'ASSIGNMENT', title: 'Project', assignment: { instructions: 'Upload work', maxAttempts: 2, maxScore: 100 } },
      { kind: 'CHALLENGE', title: 'Challenge', challengeId: ID },
    ],
  }]);
  assert.equal(modules[0].contents.length, 7);
  assert.equal(modules[0].contents[0].mediaFileId, ID);
});

test('provider structure validation rejects ambiguous or unverifiable video sources', async () => {
  const service = createLmsService(repository());
  const structure = (content) => [{ title: 'Module', contents: [content] }];
  assert.throws(
    () => service.replaceStructure(ID, ID, structure({ kind: 'VIDEO', title: 'Missing' })),
    (error) => error.code === 'video_requires_exactly_one_source',
  );
  assert.throws(
    () => service.replaceStructure(ID, ID, structure({ kind: 'VIDEO', title: 'Ambiguous', url: 'https://example.test/v', mediaFileId: ID, durationSeconds: 30 })),
    (error) => error.code === 'video_requires_exactly_one_source',
  );
  assert.throws(
    () => service.replaceStructure(ID, ID, structure({ kind: 'VIDEO', title: 'No duration', mediaFileId: ID })),
    (error) => error.code === 'uploaded_video_requires_duration',
  );
});

test('assignment, staff, enrollment, and payment commands enforce bounded policy values', async () => {
  const service = createLmsService(repository());
  assert.throws(
    () => service.submitAssignment(ID, ID, ID, { fileIds: ['not-a-uuid'], writtenAnswer: '' }),
    (error) => error.code === 'invalid_file_id',
  );
  assert.deepEqual(await service.submitAssignment(ID, ID, ID, { fileIds: [ID], writtenAnswer: 'Answer' }), [ID, ID, ID, 'Answer', [ID]]);
  assert.deepEqual(await service.setStaffRole(ID, ID, ID, 'grader'), [ID, ID, ID, 'grader']);
  assert.deepEqual(await service.setEnrollmentStatus(ID, ID, ID, 'suspended'), [ID, ID, ID, 'suspended']);
  assert.throws(
    () => service.reviewPayment(ID, ID, ID, { decision: 'silently_approve' }),
    (error) => error.code === 'invalid_payment_decision',
  );
  assert.deepEqual(
    await service.setPaymentSettings(ID, ID, { qrFileId: ID, instructions: 'Pay and include the order reference.' }),
    [ID, ID, ID, 'Pay and include the order reference.'],
  );
  assert.throws(
    () => service.setPaymentSettings(ID, ID, { qrFileId: 'bad', instructions: 'Pay' }),
    (error) => error.code === 'invalid_payment_qr_file_id',
  );
  assert.throws(
    () => service.setPaymentSettings(ID, ID, { qrFileId: ID, instructions: '' }),
    (error) => error.code === 'invalid_payment_instructions',
  );
});
