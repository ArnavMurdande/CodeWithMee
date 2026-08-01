export type RestrictedContentFormat = 'plain_text_v1' | 'restricted_markdown_v1';

export interface RestrictedDocument {
  format: RestrictedContentFormat;
  text: string;
  version: 1;
}

const ENTITY: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
});

function decodeEntity(match: string, entity: string): string {
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

export function legacyRichTextToPlainText(value: unknown): string {
  return String(value ?? '')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(
      /<\/(?:address|article|aside|blockquote|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)>/gi,
      '\n',
    )
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-z]+|#\d+|#x[0-9a-f]+);/gi, decodeEntity);
}

export function normalizeRestrictedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, 100_000);
}

export function readRestrictedDocument(
  document: RestrictedDocument | null | undefined,
  legacyContent = '',
): RestrictedDocument {
  if (
    document?.version === 1 &&
    (document.format === 'plain_text_v1' || document.format === 'restricted_markdown_v1') &&
    typeof document.text === 'string'
  ) {
    return { ...document, text: normalizeRestrictedText(document.text) };
  }
  return {
    format: 'plain_text_v1',
    text: normalizeRestrictedText(legacyRichTextToPlainText(legacyContent)),
    version: 1,
  };
}

export function plainTextDocument(text: string): RestrictedDocument {
  return { format: 'plain_text_v1', text: normalizeRestrictedText(text), version: 1 };
}

export function safeHttpUrl(
  value: unknown,
  base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) return null;
  try {
    const parsed = new URL(value.trim(), base);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function youtubeEmbedUrl(value: unknown): string | null {
  const safe = safeHttpUrl(value);
  if (!safe) return null;
  const parsed = new URL(safe);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let videoId = '';
  if (host === 'youtu.be') videoId = parsed.pathname.slice(1).split('/')[0] || '';
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    videoId = parsed.pathname.startsWith('/embed/')
      ? parsed.pathname.slice('/embed/'.length).split('/')[0] || ''
      : parsed.searchParams.get('v') || '';
  }
  if (host === 'youtube-nocookie.com' && parsed.pathname.startsWith('/embed/')) {
    videoId = parsed.pathname.slice('/embed/'.length).split('/')[0] || '';
  }
  return /^[A-Za-z0-9_-]{11}$/.test(videoId)
    ? `https://www.youtube-nocookie.com/embed/${videoId}`
    : null;
}

export function escapeTextDownload(value: unknown): string {
  return normalizeRestrictedText(legacyRichTextToPlainText(value)).replace(/^\uFEFF/, '');
}
