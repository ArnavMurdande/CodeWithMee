import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const clientRoot = new URL('../../client/src/', import.meta.url);
/** @param {string} relativePath */
const readClientSource = (relativePath) => readFile(new URL(relativePath, clientRoot), 'utf8');

/**
 * @param {URL} directory
 * @returns {Promise<Array<{ name: string, source: string }>>}
 */
async function readSourceTree(directory = clientRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {Array<{ name: string, source: string }>} */
  const sources = [];
  for (const entry of entries) {
    const entryUrl = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      sources.push(...(await readSourceTree(new URL(`${entry.name}/`, directory))));
    } else if (/\.(?:css|js|tsx)$/.test(entry.name)) {
      sources.push({ name: entryUrl.pathname, source: await readFile(entryUrl, 'utf8') });
    }
  }
  return sources;
}

test('interactive client controls use native semantics', async () => {
  const sources = await readSourceTree();
  for (const { name, source } of sources) {
    assert.doesNotMatch(
      source,
      /<(?:div|span|li|tr)\b[^>]*\bonClick=/s,
      `non-semantic click target in ${name}`,
    );
  }

  const groupedRoutes = await Promise.all(
    [
      'pages/Challenges.js',
      'pages/Courses.js',
      'pages/Space.js',
      'pages/admin/AdminDashboard.js',
    ].map(readClientSource),
  );
  for (const source of groupedRoutes) {
    assert.match(source, /(?:role|contentRole)="group"/);
    assert.match(source, /aria-pressed=/);
    assert.doesNotMatch(source, /role="tab"|role="tablist"|aria-selected=/);
  }
});

test('shared dropdown exposes menu semantics and complete keyboard escape paths', async () => {
  const sources = await readSourceTree();
  const dropdown = await readClientSource('components/AppDropdown.js');

  for (const token of [
    'aria-expanded={isOpen}',
    'aria-haspopup="menu"',
    'role="menu"',
    'role="menuitemradio"',
    "event.key === 'ArrowDown'",
    "event.key === 'ArrowUp'",
    "event.key === 'Home'",
    "event.key === 'End'",
    "event.key === 'Escape'",
  ]) {
    assert.ok(dropdown.includes(token), `missing dropdown contract: ${token}`);
  }
  assert.match(dropdown, /selectedIndex/);
  assert.match(dropdown, /dropdownRef\.current\?\.querySelector\('button'\)\?\.focus\(\)/);

  for (const { name, source } of sources) {
    for (const match of source.matchAll(/<AppDropdown\b[\s\S]*?\/>/g)) {
      assert.match(match[0], /\blabel=/, `unnamed AppDropdown in ${name}`);
    }
  }
});

test('shared dialogs trap focus, close with Escape, and restore focus', async () => {
  const [dialog, pomodoro, solver, pathways, space] = await Promise.all([
    readClientSource('components/ui/AccessibleDialog.js'),
    readClientSource('components/PomodoroTimer.js'),
    readClientSource('pages/ChallengeSolver.js'),
    readClientSource('pages/Pathways.js'),
    readClientSource('pages/Space.js'),
  ]);

  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key === 'Escape'/);
  assert.match(dialog, /event\.key !== 'Tab'/);
  assert.match(dialog, /previouslyFocused/);
  assert.match(dialog, /previouslyFocused\.focus\(\)/);
  assert.match(dialog, /event\.target === event\.currentTarget/);
  for (const source of [pomodoro, solver, pathways, space]) {
    assert.match(source, /<AccessibleDialog/);
  }
});

test('media surfaces disclose caption and transcript availability', async () => {
  const sources = await readSourceTree();
  const media = await readClientSource('components/ui/AccessibleMedia.js');

  assert.match(media, /<track default kind="captions"/);
  assert.match(media, /<summary>Transcript<\/summary>/);
  assert.match(media, /are not available for\s*this legacy media/);
  for (const { name, source } of sources) {
    if (name.endsWith('/components/ui/AccessibleMedia.js')) continue;
    assert.doesNotMatch(source, /<(?:video|audio)\b/, `unwrapped media in ${name}`);
  }
  assert.doesNotMatch(await readClientSource('pages/HomePage.js'), /<AccessibleMedia/);
  for (const route of ['pages/Courses.js', 'pages/Space.js']) {
    assert.match(await readClientSource(route), /<AccessibleMedia/);
  }
});

test('focus, motion, contrast, and decorative animation preferences are enforced', async () => {
  const [indexStyles, animatedBackground, cursor, hero, home, allSources] = await Promise.all([
    readClientSource('index.css'),
    readClientSource('components/AnimatedBackground.js'),
    readClientSource('components/CustomCursor.js'),
    readClientSource('components/HeroSection.js'),
    readClientSource('pages/HomePage.js'),
    readSourceTree(),
  ]);

  assert.match(indexStyles, /:focus-visible/);
  assert.match(indexStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(indexStyles, /animation-iteration-count:\s*1\s*!important/);
  assert.match(indexStyles, /\.Cursor,[\s\S]*\.animated-background-container/);
  assert.match(indexStyles, /@media \(prefers-contrast: more\)/);
  assert.match(animatedBackground, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(cursor, /aria-hidden="true"/);
  assert.match(hero, /<h1 aria-label="Code With Mee"/);
  assert.match(hero, /<TypeAnimation\s+aria-hidden="true"/);
  assert.match(home, /<h2 aria-label=\{text\}/);
  assert.match(home, /<TypeAnimation\s+aria-hidden="true"/);
  for (const { name, source } of allSources.filter(({ name }) => name.endsWith('.css'))) {
    assert.doesNotMatch(source, /outline:\s*none/, `focus suppression in ${name}`);
  }
});

test('timer, notes, challenge forms, and code editors have assistive names', async () => {
  const [pomodoro, notes, createChallenge, solver, sandbox] = await Promise.all([
    readClientSource('components/PomodoroTimer.js'),
    readClientSource('components/NotesWidget.js'),
    readClientSource('pages/CreateChallenge.js'),
    readClientSource('pages/ChallengeSolver.js'),
    readClientSource('pages/Sandbox.js'),
  ]);

  assert.match(pomodoro, /aria-controls="pomodoro-settings"/);
  assert.match(pomodoro, /aria-expanded=\{isDropdownOpen\}/);
  assert.match(pomodoro, /htmlFor="pomodoro-work-time"/);
  assert.match(pomodoro, /htmlFor="pomodoro-break-time"/);
  assert.match(notes, /aria-label="Note content"/);
  assert.match(notes, /aria-multiline="true"/);
  assert.match(notes, /role="textbox"/);
  assert.match(createChallenge, /htmlFor="challenge-title"/);
  assert.match(createChallenge, /aria-label=\{`Test case \$\{index \+ 1\} input`\}/);
  assert.match(createChallenge, /ariaLabel: 'Challenge solution code'/);
  assert.match(solver, /ariaLabel: 'Challenge code editor'/);
  assert.match(sandbox, /ariaLabel: 'Practice code editor'/);
});
