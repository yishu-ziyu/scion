import { csvOrMarkdownBlockSpans } from '@extension/shared';

export type AnswerSpan = { bold?: boolean; text: string; href?: string };

export type AnswerBlock =
  | { type: 'p'; spans: AnswerSpan[] }
  | { type: 'pre'; text: string }
  | { type: 'ul'; items: AnswerSpan[][] }
  | { type: 'ol'; items: AnswerSpan[][] };

/** Drop model markup so copy/paste and tests see human text. */
export function stripAnswerMarkup(raw: string): string {
  return normalizeAnswerSource(raw)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseAnswerBlocks(raw: string): AnswerBlock[] {
  const text = normalizeAnswerSource(raw);
  if (!text) return [];
  const blocks: AnswerBlock[] = [];
  let cursor = 0;
  for (const span of csvOrMarkdownBlockSpans(text)) {
    appendProseBlocks(blocks, text.slice(cursor, span.start));
    const table = text
      .slice(span.start, span.end)
      .split('\n')
      .map(line => line.trim())
      .join('\n');
    if (table) blocks.push({ type: 'pre', text: table });
    cursor = span.end;
    if (text[cursor] === '\n') cursor += 1;
  }
  appendProseBlocks(blocks, text.slice(cursor));
  return blocks;
}

function appendProseBlocks(blocks: AnswerBlock[], raw: string): void {
  const text = raw.replace(/^\n+|\n+$/g, '');
  if (!text) return;
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) blocks.push({ type: 'p', spans: parseSpans(joined) });
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push({ type: 'ul', items: bullets.map(item => parseSpans(item)) });
    bullets = [];
  };
  const flushNumbers = () => {
    if (numbers.length === 0) return;
    blocks.push({ type: 'ol', items: numbers.map(item => parseSpans(item)) });
    numbers = [];
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushBullets();
      flushNumbers();
      continue;
    }
    const bullet = /^[-*•]\s+(.+)$/.exec(trimmed);
    if (bullet?.[1]) {
      flushParagraph();
      flushNumbers();
      bullets.push(bullet[1]);
      continue;
    }
    const numbered = /^\d+[.、]\s*(.+)$/.exec(trimmed);
    if (numbered?.[1]) {
      flushParagraph();
      flushBullets();
      numbers.push(numbered[1]);
      continue;
    }
    flushBullets();
    flushNumbers();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushBullets();
  flushNumbers();
}

function normalizeAnswerSource(raw: string): string {
  return (raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/：\s*-\s+/g, '：\n- ')
    .replace(/:\s*-\s+/g, ':\n- ')
    .replace(/([。；;])\s*-\s+/g, '$1\n- ')
    .replace(/\s+(\d+[.、])\s+/g, '\n$1 ')
    .replace(/\*\*\s+/g, '**')
    .replace(/([^\s.。])\s+\*\*/g, '$1**')
    .trim();
}

function parseSpans(line: string): AnswerSpan[] {
  const spans: AnswerSpan[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match.index > last) spans.push({ text: line.slice(last, match.index) });
    spans.push({ bold: true, text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < line.length) spans.push({ text: line.slice(last) });
  return spans.filter(span => span.text.length > 0);
}

export function attachSourceHrefs(
  blocks: AnswerBlock[],
  sources: Array<{ host?: string; url: string }>,
): AnswerBlock[] {
  if (sources.length === 0) return blocks;
  const linkSpans = (spans: AnswerSpan[]): AnswerSpan[] =>
    spans.map(span => {
      if (span.href) return span;
      const match = sources.find(source => source.host && source.host.length >= 4 && span.text.includes(source.host));
      return match ? { ...span, href: match.url } : span;
    });
  return blocks.map(block => {
    if (block.type === 'p') return { ...block, spans: linkSpans(block.spans) };
    if (block.type === 'pre') return block;
    return { ...block, items: block.items.map(item => linkSpans(item)) };
  });
}
