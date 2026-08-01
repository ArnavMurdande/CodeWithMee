import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/** @param {string} relativePath */
const readClientSource = (relativePath) =>
  readFile(new URL(`../../client/src/${relativePath}`, import.meta.url), 'utf8');

test('global client styles expose stable design, focus, and motion primitives', async () => {
  const [indexStyles, tokens] = await Promise.all([
    readClientSource('index.css'),
    readClientSource('styles/tokens.css'),
  ]);

  assert.match(indexStyles, /@import ['"]\.\/styles\/tokens\.css['"]/);
  assert.match(indexStyles, /:focus-visible/);
  assert.match(indexStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(tokens, /--cwm-color-focus:/);
  assert.match(tokens, /--cwm-control-min-size:\s*2\.75rem/);
  assert.match(tokens, /--cwm-z-overlay:/);
});

test('application shell owns navigation, skip-link, main landmark, and safe theme colors', async () => {
  const [app, shell] = await Promise.all([
    readClientSource('App.js'),
    readClientSource('components/AppShell.js'),
  ]);

  assert.match(app, /<AppErrorBoundary>[\s\S]*<AppShell/);
  assert.match(app, /<AsyncState/);
  assert.match(shell, /href="#main-content"/);
  assert.match(shell, /<main[\s\S]*id="main-content"[\s\S]*tabIndex="-1"/);
  assert.match(shell, /SAFE_COLOR\s*=\s*\/\^#\[0-9a-f\]\{6\}\$\/i/);
  assert.doesNotMatch(shell, /dangerouslySetInnerHTML/);
});

test('shared asynchronous states expose assistive status and retry semantics', async () => {
  const [state, challenges, courses, space] = await Promise.all([
    readClientSource('components/ui/AsyncState.js'),
    readClientSource('pages/Challenges.js'),
    readClientSource('pages/Courses.js'),
    readClientSource('pages/Space.js'),
  ]);

  assert.match(state, /aria-busy=/);
  assert.match(state, /aria-live=/);
  assert.match(state, /role=\{STATE_ROLE\[normalizedType\]\}/);
  for (const source of [challenges, courses, space]) {
    assert.match(source, /type="loading"/);
    assert.match(source, /type="error"/);
    assert.match(source, /type="button">\s*Try again\s*<\/button>/);
  }
});

test('header navigation uses named landmarks and semantic controls', async () => {
  const header = await readClientSource('components/Header.js');

  assert.match(header, /<nav aria-label="Primary navigation"/);
  assert.match(header, /<nav aria-label="Mobile primary navigation"/);
  assert.match(header, /aria-expanded=\{dropdownOpen\}/);
  assert.match(header, /aria-haspopup="menu"/);
  assert.match(header, /aria-label="CodeWithMee home"/);
  assert.doesNotMatch(header, /<div[^>]+onClick=/);
});

test('theme input is normalized before reaching CSS custom properties', async () => {
  const context = await readClientSource('context/ThemeContext.js');

  assert.match(context, /function normalizeTheme\(candidate\)/);
  assert.match(context, /THEME_COLOR\s*=\s*\/\^#\[0-9a-f\]\{6\}\$\/i/);
  assert.match(context, /THEME_COLOR_KEYS\.has\(colorKey\)/);
  assert.match(context, /normalizeTheme\(JSON\.parse\(saved\)\)/);
  assert.match(context, /const serverTheme = normalizeTheme/);
});
