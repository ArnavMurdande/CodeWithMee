import { Fragment, type ReactNode } from 'react';

import { normalizeRestrictedText } from '../lib/restricted-content';

interface RestrictedMarkdownProps {
  source: unknown;
}

function inlineText(value: string, keyPrefix: string): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let cursor = 0;
  let match;
  let index = 0;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) result.push(value.slice(cursor, match.index));
    const token = match[0];
    result.push(
      token.startsWith('`') ? (
        <code key={`${keyPrefix}-${index}`}>{token.slice(1, -1)}</code>
      ) : (
        <strong key={`${keyPrefix}-${index}`}>{token.slice(2, -2)}</strong>
      ),
    );
    cursor = match.index + token.length;
    index += 1;
  }
  if (cursor < value.length) result.push(value.slice(cursor));
  return result;
}

export default function RestrictedMarkdown({ source }: RestrictedMarkdownProps) {
  const lines = normalizeRestrictedText(source).split('\n');
  const blocks: ReactNode[] = [];
  let code: string[] | null = null;
  let codeLanguage = '';
  let list: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join('\n');
    blocks.push(<p key={`p-${blocks.length}`}>{inlineText(text, `p-${blocks.length}`)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {list.map((item, index) => (
          <li key={index}>{inlineText(item, `li-${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const line of lines) {
    const fence = line.match(/^```([A-Za-z0-9#+._-]{0,30})\s*$/);
    if (fence) {
      if (code) {
        blocks.push(
          <pre key={`pre-${blocks.length}`} data-language={codeLanguage || undefined}>
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = null;
        codeLanguage = '';
      } else {
        flushParagraph();
        flushList();
        code = [];
        codeLanguage = fence[1] || '';
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      flushParagraph();
      list.push(item[1]);
      continue;
    }
    flushList();
    if (!line.trim()) flushParagraph();
    else paragraph.push(line);
  }

  if (code) {
    blocks.push(
      <pre key={`pre-${blocks.length}`} data-language={codeLanguage || undefined}>
        <code>{code.join('\n')}</code>
      </pre>,
    );
  }
  flushList();
  flushParagraph();
  return <Fragment>{blocks}</Fragment>;
}
