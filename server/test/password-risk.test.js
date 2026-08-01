'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const {
  createPasswordRiskChecker,
  isLocallyCompromised,
  parseRangeResponse,
} = require('../modules/identity/password-risk');

test('local screening rejects known weak values without an external request', async () => {
  assert.equal(isLocallyCompromised('Password1234'), true);
  let requested = false;
  const checker = createPasswordRiskChecker({
    fetchImpl: async () => {
      requested = true;
      throw new Error('must not request');
    },
    mode: 'local',
  });
  await assert.rejects(checker.assertAllowed('Password1234'), (error) => {
    return error.code === 'password_compromised';
  });
  assert.equal(requested, false);
});

test('required range screening sends only five SHA-1 characters and requests padded results', async () => {
  const password = 'a unique integration-test password value';
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  const seen = {};
  const checker = createPasswordRiskChecker({
    fetchImpl: async (url, options) => {
      seen.url = url;
      seen.headers = options.headers;
      return new Response(`${suffix}:42\r\n${'0'.repeat(35)}:0\r\n`, { status: 200 });
    },
    mode: 'required',
  });
  await assert.rejects(checker.assertAllowed(password), (error) => {
    return error.code === 'password_compromised';
  });
  assert.equal(seen.url, `https://api.pwnedpasswords.com/range/${prefix}`);
  assert.equal(seen.url.includes(password), false);
  assert.equal(seen.url.includes(digest), false);
  assert.equal(seen.headers['add-padding'], 'true');
  assert.equal(seen.headers['user-agent'], 'CodeWithMee-Password-Screening');
});

test('padded zero-count rows are ignored and provider failure obeys configured posture', async () => {
  assert.equal(parseRangeResponse(`${'A'.repeat(35)}:0`, 'A'.repeat(35)), false);

  const clean = createPasswordRiskChecker({
    fetchImpl: async () => new Response(`${'A'.repeat(35)}:0\r\n`, { status: 200 }),
    mode: 'required',
  });
  await clean.assertAllowed('another unique integration password');

  const required = createPasswordRiskChecker({
    fetchImpl: async () => {
      throw new Error('provider unavailable');
    },
    mode: 'required',
  });
  await assert.rejects(required.assertAllowed('yet another unique password'), (error) => {
    return error.code === 'password_screening_unavailable' && error.status === 503;
  });

  const bestEffort = createPasswordRiskChecker({
    fetchImpl: async () => {
      throw new Error('provider unavailable');
    },
    mode: 'best_effort',
  });
  await bestEffort.assertAllowed('yet another unique password');
});
