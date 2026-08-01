'use strict';

const CONTENT_FORMAT = Object.freeze({
  PLAIN_TEXT: 'plain_text_v1',
  RESTRICTED_MARKDOWN: 'restricted_markdown_v1',
});

const ENTITY = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
});

class ContentValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = 400;
  }
}

function decodeEntity(match, entity) {
  const lower = entity.toLowerCase();
  if (Object.hasOwn(ENTITY, lower)) return ENTITY[lower];
  if (!lower.startsWith('#')) return match;

  const hexadecimal = lower.startsWith('#x');
  const digits = lower.slice(hexadecimal ? 2 : 1);
  if (!/^[0-9a-f]+$/i.test(digits)) return match;
  const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return '\uFFFD';
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return '\uFFFD';
  return String.fromCodePoint(codePoint);
}

function legacyHtmlToPlainText(value) {
  return String(value ?? '')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(
      /<\/(?:address|article|aside|blockquote|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)>/gi,
      '\n',
    )
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-z]+|#\d+|#x[0-9a-f]+);/gi, decodeEntity);
}

function stripUnsafeControlCharacters(value) {
  let output = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const unsafe =
      (codePoint >= 0 && codePoint <= 8) ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127;
    if (!unsafe) output += character;
  }
  return output;
}

function normalizeText(value, options = {}) {
  const {
    allowEmpty = true,
    field = 'content',
    legacyHtml = false,
    maximumLength = 100_000,
  } = options;

  if (typeof value !== 'string') throw new ContentValidationError(`invalid_${field}`);
  if (!Number.isInteger(maximumLength) || maximumLength < 1 || maximumLength > 1_000_000) {
    throw new TypeError('maximumLength must be an integer between 1 and 1000000');
  }

  const source = legacyHtml ? legacyHtmlToPlainText(value) : value;
  const normalized = stripUnsafeControlCharacters(source.normalize('NFC').replace(/\r\n?/g, '\n'));

  if (!allowEmpty && !normalized.trim()) throw new ContentValidationError(`invalid_${field}`);
  if (normalized.length > maximumLength) throw new ContentValidationError(`${field}_too_large`);
  return normalized;
}

function createDocument(value, options = {}) {
  const format = options.format || CONTENT_FORMAT.PLAIN_TEXT;
  if (!Object.values(CONTENT_FORMAT).includes(format)) {
    throw new ContentValidationError('unsupported_content_format');
  }
  const text = normalizeText(value, options);
  return Object.freeze({ format, text, version: 1 });
}

function readDocument(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentValidationError('invalid_content_document');
  }
  if (value.version !== 1 || !Object.values(CONTENT_FORMAT).includes(value.format)) {
    throw new ContentValidationError('unsupported_content_format');
  }
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'format,text,version') {
    throw new ContentValidationError('invalid_content_document');
  }
  return createDocument(value.text, { ...options, format: value.format });
}

function isContentValidationError(error) {
  return error instanceof ContentValidationError;
}

module.exports = {
  CONTENT_FORMAT,
  ContentValidationError,
  createDocument,
  isContentValidationError,
  legacyHtmlToPlainText,
  normalizeText,
  readDocument,
};
