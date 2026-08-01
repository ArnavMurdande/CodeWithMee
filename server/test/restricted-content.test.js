'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const {
  CONTENT_FORMAT,
  ContentValidationError,
  createDocument,
  legacyHtmlToPlainText,
  normalizeText,
  readDocument,
} = require('../modules/content/restricted-content');
const { normalizeError } = require('../modules/http/error-handler');

const CLIENT_SOURCE = path.resolve(__dirname, '../../client/src');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(target)
      : /\.(?:js|jsx|ts|tsx)$/.test(entry.name)
        ? [target]
        : [];
  });
}

test('legacy rich HTML becomes inert bounded text without mutating the source', () => {
  const source = '<h1>Hello &amp; bye</h1><img src=x onerror=alert(1)><script>alert(2)</script>';
  const plain = legacyHtmlToPlainText(source);
  assert.equal(plain, 'Hello & bye\nalert(2)');
  assert.equal(source.includes('onerror'), true);
  assert.equal(/[<>]/.test(plain), false);
});

test('restricted documents have an exact versioned shape and fail closed', () => {
  assert.deepEqual(
    createDocument('**safe**\r\n```js\n<x>\n```', {
      format: CONTENT_FORMAT.RESTRICTED_MARKDOWN,
    }),
    {
      format: 'restricted_markdown_v1',
      text: '**safe**\n```js\n<x>\n```',
      version: 1,
    },
  );
  assert.throws(
    () => readDocument({ format: 'html', text: '<b>x</b>', version: 1 }),
    ContentValidationError,
  );
  assert.throws(
    () => readDocument({ extra: true, format: 'plain_text_v1', text: 'x', version: 1 }),
    ContentValidationError,
  );
  assert.throws(
    () => normalizeText('12345', { field: 'note_content', maximumLength: 4 }),
    /note_content_too_large/,
  );
  assert.deepEqual(normalizeError(new ContentValidationError('unsupported_content_format')), {
    code: 'unsupported_content_format',
    status: 400,
  });
});

test('client URL policy rejects active schemes and canonicalizes only valid YouTube embeds', async () => {
  const moduleUrl = pathToFileURL(path.resolve(CLIENT_SOURCE, 'lib/restricted-content.ts')).href;
  const content = await import(moduleUrl);
  assert.equal(content.safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(content.safeHttpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(content.safeHttpUrl('https://user:pass@example.com/private'), null);
  assert.equal(
    content.youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=4'),
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  );
  assert.equal(content.youtubeEmbedUrl('https://youtube.example/watch?v=dQw4w9WgXcQ'), null);
});

test('client source has no raw HTML execution sink', () => {
  const violations = [];
  for (const file of sourceFiles(CLIENT_SOURCE)) {
    const source = fs.readFileSync(file, 'utf8');
    if (
      /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|execCommand\(\s*['"]insertHTML|\bsrcDoc\s*=|document\.write\s*\(/.test(
        source,
      )
    ) {
      violations.push(path.relative(CLIENT_SOURCE, file));
    }
  }
  assert.deepEqual(violations, []);

  const sandbox = fs.readFileSync(path.join(CLIENT_SOURCE, 'pages/Sandbox.js'), 'utf8');
  assert.match(sandbox, /RestrictedMarkdown/);
  const renderer = fs.readFileSync(
    path.join(CLIENT_SOURCE, 'components/RestrictedMarkdown.tsx'),
    'utf8',
  );
  assert.doesNotMatch(renderer, /href=|dangerouslySetInnerHTML|createElement\s*\(/);
});
