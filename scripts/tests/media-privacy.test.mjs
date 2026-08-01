import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';

const homeUrl = new URL('../../client/src/pages/HomePage.js', import.meta.url);
const gitignoreUrl = new URL('../../.gitignore', import.meta.url);
const appUrl = new URL('../../server/app.js', import.meta.url);
const originalPromoUrl = new URL(
  '../../client/src/assets/videos/Aaj%20Ki%20Raat.mp4',
  import.meta.url,
);
const quarantinedPromoUrl = new URL(
  '../../quarantine/media/unverified-aaj-ki-raat.mp4',
  import.meta.url,
);
const reviewUrl = new URL('../../docs/baselines/P0E-S5_MEDIA_PRIVACY_REVIEW.md', import.meta.url);

test('unproven promo and third-party interaction audio are absent from the shipped client graph', async () => {
  const home = await readFile(homeUrl, 'utf8');

  assert.doesNotMatch(home, /Aaj Ki Raat|assets\.codepen\.io|new Audio\(|soundManager/);
  await assert.rejects(access(originalPromoUrl), { code: 'ENOENT' });
});

test('promo quarantine preserves the reviewed bytes outside application roots', async () => {
  const bytes = await readFile(quarantinedPromoUrl);
  const details = await stat(quarantinedPromoUrl);

  assert.equal(details.size, 17_771_306);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    '2C7B862882D5A68B9EAE253EF439DBA8A186A135FF3A4435F701F3D3C9208CA2',
  );
});

test('runtime uploads are excluded from future commits and fail closed in production', async () => {
  const [gitignore, app] = await Promise.all([
    readFile(gitignoreUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ]);

  assert.match(gitignore, /^\/server\/uploads\/\*\*$/m);
  assert.match(app, /nodeEnv !== 'production'/);
  assert.match(app, /Local upload serving cannot be enabled in production/);
  assert.match(app, /legacy_local_upload_retired/);
  assert.match(app, /new PublicHttpError\('legacy_local_upload_retired', 410\)/);
});

test('media review records non-destructive migration and history-remediation gates', async () => {
  const review = await readFile(reviewUrl, 'utf8');

  assert.match(review, /43 files/);
  assert.match(review, /100,209,574 bytes/);
  assert.match(review, /No legacy upload bytes were deleted, moved, renamed, or rewritten/);
  assert.match(review, /owner-approved Git-history remediation/);
  assert.match(review, /QUARANTINED_NOT_FOR_DEPLOYMENT/);
});
