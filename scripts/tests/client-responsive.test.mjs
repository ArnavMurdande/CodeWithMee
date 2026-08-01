import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/** @param {string} relativePath */
const readClientSource = (relativePath) =>
  readFile(new URL(`../../client/src/${relativePath}`, import.meta.url), 'utf8');

const activeRouteRoots = [
  'auth-container',
  'dashboard-container',
  'pathways-container',
  'sandbox-page-container',
  'challenges-container',
  'create-challenge-container',
  'solver-page-container',
  'courses-page',
  'course-viewer',
  'space-page',
  'profile-page-container',
  'settings-page',
  'admin-dashboard',
  'homepage',
];

test('responsive compatibility layer is loaded after route styles and covers every route root', async () => {
  const [app, routeStyles, responsive] = await Promise.all([
    readClientSource('App.js'),
    readClientSource('styles/route-styles.css'),
    readClientSource('styles/responsive.css'),
  ]);

  assert.match(
    app,
    /import ['"]\.\/styles\/route-styles\.css['"];\s*import ['"]\.\/styles\/responsive\.css['"]/,
  );
  for (const style of ['Auth', 'Challenges', 'Courses', 'HomePage', 'Sandbox', 'Space']) {
    assert.match(routeStyles, new RegExp(`pages/${style}\\.css`));
  }
  for (const root of activeRouteRoots) assert.match(responsive, new RegExp(`\\.${root}\\b`), root);
  assert.match(responsive, /min-width:\s*0/);
});

test('responsive rules explicitly represent the supported viewport classes', async () => {
  const responsive = await readClientSource('styles/responsive.css');

  assert.match(responsive, /@media \(max-width: 24\.375rem\)/); // 360 and 390 px phones
  assert.match(responsive, /@media \(max-width: 48rem\)/); // 768 px
  assert.match(responsive, /max-width: 64rem\)/); // 1024 px
  assert.match(responsive, /@media \(min-width: 90rem\)/); // 1440 px
});

test('active learning routes no longer block small screens with a desktop warning', async () => {
  const [challenges, pathways] = await Promise.all([
    readClientSource('pages/Challenges.js'),
    readClientSource('pages/Pathways.js'),
  ]);

  for (const source of [challenges, pathways]) {
    assert.doesNotMatch(source, /MobileWarningOverlay/);
    assert.doesNotMatch(source, /Desktop Recommended/);
  }
});

test('notes remain available as a bounded mobile panel', async () => {
  const [notes, styles] = await Promise.all([
    readClientSource('components/NotesWidget.js'),
    readClientSource('components/NotesWidget.css'),
  ]);

  assert.doesNotMatch(notes, /Desktop Feature Only|Notes \(Desktop only\)/);
  assert.match(notes, /aria-controls="notes-panel"/);
  assert.match(notes, /aria-expanded=\{isOpen\}/);
  assert.match(styles, /\.nw-panel\s*\{[\s\S]*inset: 4\.75rem 0\.75rem 6\.75rem !important/);
  assert.doesNotMatch(styles, /\.nw-panel\s*\{\s*display:\s*none\s*!important/);
});

test('narrow layouts stack workspaces and retain intentional table scrolling', async () => {
  const responsive = await readClientSource('styles/responsive.css');

  assert.match(
    responsive,
    /\.sandbox-container,[\s\S]*\.solver-container,[\s\S]*\.viewer-body[\s\S]*flex-direction:\s*column/,
  );
  assert.match(responsive, /\.admin-dashboard \.admin-table-container[\s\S]*overflow-x:\s*auto/);
  assert.match(responsive, /\.solver-page-container \.problem-pane[\s\S]*width:\s*100% !important/);
});
