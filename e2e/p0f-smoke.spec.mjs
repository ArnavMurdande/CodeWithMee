import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/** @typedef {import('@playwright/test').Page} Page */
/**
 * @typedef {object} FixtureUser
 * @property {string} _id
 * @property {string} avatarUrl
 * @property {unknown[]} challenges
 * @property {string} displayName
 * @property {string} email
 * @property {boolean} emailVerified
 * @property {string} id
 * @property {unknown[]} notes
 * @property {'learner' | 'superadmin'} platformRole
 * @property {unknown[]} roadmaps
 * @property {string[]} savedChallenges
 * @property {'active'} status
 * @property {string} username
 */
/**
 * @typedef {object} FixtureState
 * @property {string[]} observed
 * @property {string[]} pageErrors
 * @property {string[]} unexpectedApi
 * @property {string[]} unexpectedOrigins
 */

const baseOrigin = 'http://127.0.0.1:4173';
const monacoCdnPrefix = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.56.0/min/vs/';
const monacoFixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../client/node_modules/monaco-editor/min/vs',
);
const defaultAvatar =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3Cpath fill="%2391a6c7" d="M0 0h1v1H0z"/%3E%3C/svg%3E';

/** @param {'learner' | 'superadmin'} [platformRole] @returns {FixtureUser} */
function createUser(platformRole = 'learner') {
  return {
    _id: `e2e-${platformRole}`,
    avatarUrl: defaultAvatar,
    challenges: [],
    displayName: platformRole === 'superadmin' ? 'E2E Administrator' : 'E2E Learner',
    email: `${platformRole}@example.invalid`,
    emailVerified: true,
    id: `e2e-${platformRole}`,
    notes: [],
    platformRole,
    roadmaps: [],
    savedChallenges: [],
    status: 'active',
    username: platformRole === 'superadmin' ? 'e2e-admin' : 'e2e-learner',
  };
}

/** @param {FixtureUser} user */
function authenticationResult(user) {
  return {
    accessToken: 'e2e-access-token-not-a-secret',
    session: { id: 'e2e-session', expiresAt: '2030-08-01T00:00:00.000Z' },
    user,
  };
}

/** @param {string | null} status */
function providerReviews(status) {
  if (status === 'pending_review') {
    return {
      reviews: [
        {
          id: 'review-pending',
          organization: { name: 'Fixture Learning Lab' },
          organizationId: 'organization-pending',
          statement: 'Synthetic provider review for isolated browser testing.',
          submittedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    };
  }
  return {
    reviews: [
      {
        decisionReason: 'Verified synthetic provider fixture.',
        id: 'review-approved',
        organization: { name: 'Approved Fixture Academy' },
        organizationId: 'organization-approved',
        reviewedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  };
}

/**
 * @param {Page} page
 * @param {{ authenticated?: boolean, platformRole?: 'learner' | 'superadmin' }} [options]
 * @returns {Promise<FixtureState>}
 */
async function installFixtureApi(page, { authenticated = true, platformRole = 'learner' } = {}) {
  let activeUser = createUser(platformRole);
  let hasSession = authenticated;
  /** @type {string[]} */
  const observed = [];
  /** @type {string[]} */
  const unexpectedApi = [];
  /** @type {string[]} */
  const unexpectedOrigins = [];
  /** @type {string[]} */
  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin !== baseOrigin &&
      !url.href.startsWith(monacoCdnPrefix)
    ) {
      unexpectedOrigins.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
  });

  await page.route(`${monacoCdnPrefix}**`, async (route) => {
    const relativePath = decodeURIComponent(route.request().url().slice(monacoCdnPrefix.length));
    const fixturePath = path.resolve(monacoFixtureRoot, relativePath);
    if (
      route.request().method() !== 'GET' ||
      !fixturePath.startsWith(`${monacoFixtureRoot}${path.sep}`)
    ) {
      unexpectedOrigins.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort('blockedbyclient');
    }
    return route.fulfill({ path: fixturePath });
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    observed.push(key);
    /** @param {unknown} body @param {number} [status] */
    const fulfill = (body, status = 200) =>
      route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', status });

    if (key === 'POST /api/v1/auth/refresh') {
      if (hasSession) return fulfill(authenticationResult(activeUser));
      return fulfill(
        { code: 'authentication_required', detail: 'No synthetic session.', status: 401 },
        401,
      );
    }
    if (key === 'POST /api/v1/auth/login') {
      const body = request.postDataJSON();
      if (body?.email !== 'learner@example.invalid' || body?.password !== 'not-a-real-password') {
        return fulfill({ code: 'invalid_credentials', status: 401 }, 401);
      }
      activeUser = createUser('learner');
      hasSession = true;
      return fulfill(authenticationResult(activeUser));
    }
    if (key === 'GET /api/user/theme') {
      return fulfill({
        color1: '#00f8f1',
        color2: '#ff2cdf',
        color3: '#4b70ff',
        preset: 'default',
      });
    }
    if (key === 'PUT /api/user/me') {
      const body = request.postDataJSON();
      activeUser = { ...activeUser, username: body.username };
      return fulfill(activeUser);
    }
    if (key === 'GET /api/challenges') {
      return fulfill([
        {
          _id: 'challenge-two-sum',
          author: { _id: 'author-fixture', username: 'fixture-author' },
          createdAt: '2026-08-01T00:00:00.000Z',
          difficulty: 'Easy',
          dislikes: [],
          isSolved: false,
          likes: [],
          score: 10,
          tags: ['arrays', 'hash-map'],
          title: 'Two Sum Fixture',
        },
      ]);
    }
    if (key === 'GET /api/challenges/leaderboard') {
      return fulfill([{ _id: activeUser._id, score: 10, username: activeUser.username }]);
    }
    if (key === 'GET /api/challenges/challenge-two-sum') {
      return fulfill({
        _id: 'challenge-two-sum',
        comments: [],
        constraints: '2 <= nums.length <= 1000',
        description: 'Return the indices of two numbers whose sum equals the target.',
        dislikes: [],
        likes: [],
        solution: 'def solve(nums, target): return [0, 1]',
        testCases: [{ input: '[2, 7, 11, 15], 9', isExample: true, output: '[0, 1]' }],
        title: 'Two Sum Fixture',
      });
    }
    if (key === 'GET /api/v1/admin/provider-verifications') {
      return fulfill(providerReviews(url.searchParams.get('status')));
    }
    if (key === 'GET /api/v1/admin/users') {
      return fulfill({ users: [{ ...activeUser, authorityRevision: 1 }] });
    }
    if (key === 'GET /api/v1/admin/audit-events') return fulfill({ events: [] });

    unexpectedApi.push(`${key}${url.search}`);
    return fulfill({ code: 'unconfigured_e2e_request', status: 503 }, 503);
  });

  return {
    observed,
    pageErrors,
    unexpectedApi,
    unexpectedOrigins,
  };
}

/**
 * @param {Page} page
 * @param {FixtureState} fixture
 * @param {{ axe?: boolean }} [options]
 */
async function expectHealthyPage(page, fixture, { axe = true } = {}) {
  await expect(page.locator('main')).toHaveCount(1);
  const horizontalOverflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth >
      globalThis.document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);
  if (axe) {
    const analysis = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = analysis.violations.filter(
      ({ impact }) => impact != null && ['critical', 'serious'].includes(impact),
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  }
  expect(fixture.pageErrors).toEqual([]);
  expect(fixture.unexpectedApi).toEqual([]);
  expect(fixture.unexpectedOrigins).toEqual([]);
}

test('local sign-in restores the protected dashboard without persistent credentials', async ({
  page,
}) => {
  const fixture = await installFixtureApi(page, { authenticated: false });
  await page.goto('/auth');

  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email').fill('learner@example.invalid');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('e2e-learner');
  expect(fixture.observed).toContain('POST /api/v1/auth/login');
  await expectHealthyPage(page, fixture);
});

test('mobile navigation reaches the responsive challenge catalog', async ({ page }) => {
  await page.setViewportSize({ height: 740, width: 360 });
  const fixture = await installFixtureApi(page);
  await page.goto('/dashboard');

  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile primary navigation' });
  await expect(mobileNavigation).toBeVisible();
  await expect(
    page.getByRole('navigation', { exact: true, name: 'Primary navigation' }),
  ).toBeHidden();
  await mobileNavigation.getByRole('link', { name: 'Challenges' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Coding Challenges' })).toBeVisible();

  await expectHealthyPage(page, fixture);
});

test('profile data is populated from the current principal and updates through the fixture API', async ({
  page,
}) => {
  const fixture = await installFixtureApi(page);
  await page.goto('/profile');

  await expect(page.getByRole('heading', { name: 'Profile Settings' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue('learner@example.invalid');
  await page.getByLabel('Username').fill('updated-e2e-learner');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Profile updated successfully!');

  expect(fixture.observed).toContain('PUT /api/user/me');
  await expectHealthyPage(page, fixture);
});

test('challenge catalog opens a readable statement and visible example without submitting code', async ({
  page,
}) => {
  const fixture = await installFixtureApi(page);
  await page.goto('/challenges');
  await expect(page.getByText('Two Sum Fixture', { exact: true })).toBeVisible();
  await page.getByText('Two Sum Fixture', { exact: true }).click();

  await expect(page).toHaveURL(/\/challenges\/challenge-two-sum$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Two Sum Fixture' })).toBeVisible();
  await expect(
    page.getByText('Return the indices of two numbers whose sum equals the target.'),
  ).toBeVisible();
  await expect(page.getByText('[2, 7, 11, 15], 9')).toBeVisible();
  expect(fixture.observed).not.toContain('POST /api/challenges/challenge-two-sum/submit');

  await expectHealthyPage(page, fixture);
});

test('superadmin can read provider-review state while a learner is denied the admin route', async ({
  browser,
  page,
}) => {
  const fixture = await installFixtureApi(page, { platformRole: 'superadmin' });
  await page.goto('/admin');

  await expect(page.getByRole('heading', { level: 1, name: 'Sentinel Command' })).toBeVisible();
  await expect(page.getByText('Fixture Learning Lab')).toBeVisible();
  await expect(page.getByText('Approved Fixture Academy')).toBeVisible();
  await expectHealthyPage(page, fixture);

  const learnerContext = await browser.newContext();
  const learnerPage = await learnerContext.newPage();
  const learnerFixture = await installFixtureApi(learnerPage);
  await learnerPage.goto('/admin');
  await expect(learnerPage).toHaveURL(/\/dashboard$/);
  await expect(learnerPage.getByText('Sentinel Command')).toHaveCount(0);
  await expectHealthyPage(learnerPage, learnerFixture);
  await learnerContext.close();
});
