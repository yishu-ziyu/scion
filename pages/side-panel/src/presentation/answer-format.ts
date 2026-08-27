import { csvOrMarkdownBlockSpans } from '@extension/shared';

export type AnswerSpan = { bold?: boolean; text: string; href?: string };

export type AnswerBlock =
  | { type: 'section'; spans: AnswerSpan[] }
  | { type: 'p'; spans: AnswerSpan[] }
  | { type: 'pre'; text: string }
  | { type: 'ul'; items: AnswerSpan[][] }
  | { type: 'ol'; items: AnswerSpan[][] };

type ProseState = {
  paragraph: string[];
  bullets: string[];
  numbers: string[];
};

const SECTION_LINE = /^\*\*([^*]+)\*\*\s*[:：]?\s*$/;
const SECTION_AFTER_SENTENCE = /^(.*?[。！？])\s*\*\*([^*]+)\*\*\s*[:：]?\s*$/;

function sectionNameFromLine(line: string): { name?: string; rest?: string } {
  const only = SECTION_LINE.exec(line);
  if (only?.[1]) return { name: only[1].trim() };
  const afterSentence = SECTION_AFTER_SENTENCE.exec(line);
  if (afterSentence?.[2]) return { rest: afterSentence[1].trim() || undefined, name: afterSentence[2].trim() };
  return {};
}

/** Drop model markup so copy/paste and tests see human text. */
export function stripAnswerMarkup(raw: string): string {
  return normalizeAnswerSource(raw)
    .replace(/^#{1,6}\s+/gm, '')
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
  const state: ProseState = { paragraph: [], bullets: [], numbers: [] };
  for (const line of text.split('\n')) {
    consumeProseLine(blocks, state, line.trim());
  }
  flushParagraph(blocks, state);
  flushBullets(blocks, state);
  flushNumbers(blocks, state);
}

function consumeProseLine(blocks: AnswerBlock[], state: ProseState, trimmed: string): void {
  if (!trimmed) {
    flushParagraph(blocks, state);
    flushBullets(blocks, state);
    flushNumbers(blocks, state);
    return;
  }
  if (consumeHeading(blocks, state, trimmed)) return;
  if (consumeBullet(blocks, state, trimmed)) return;
  if (consumeBoldNumbered(blocks, state, trimmed)) return;
  if (consumeNumbered(blocks, state, trimmed)) return;
  flushBullets(blocks, state);
  flushNumbers(blocks, state);
  if (consumeSection(blocks, state, trimmed)) return;
  state.paragraph.push(trimmed);
}

function consumeHeading(blocks: AnswerBlock[], state: ProseState, trimmed: string): boolean {
  const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(trimmed);
  if (!heading?.[1]) return false;
  flushParagraph(blocks, state);
  flushBullets(blocks, state);
  flushNumbers(blocks, state);
  blocks.push({ type: 'section', spans: parseSpans(heading[1]) });
  return true;
}

function consumeBullet(blocks: AnswerBlock[], state: ProseState, trimmed: string): boolean {
  const bullet = /^[-*•]\s+(.+)$/.exec(trimmed);
  if (!bullet?.[1]) return false;
  flushParagraph(blocks, state);
  flushNumbers(blocks, state);
  state.bullets.push(bullet[1]);
  return true;
}

function consumeBoldNumbered(blocks: AnswerBlock[], state: ProseState, trimmed: string): boolean {
  const boldNumbered = /^\*\*(\d+)[.、]\s*([^*]+?)\*\*\s*(.*)$/.exec(trimmed);
  if (!boldNumbered) return false;
  flushParagraph(blocks, state);
  flushBullets(blocks, state);
  const label = `**${boldNumbered[1]}. ${boldNumbered[2].trim()}**`;
  const rest = boldNumbered[3]?.trim();
  state.numbers.push(rest ? `${label} ${rest}` : label);
  return true;
}

function consumeNumbered(blocks: AnswerBlock[], state: ProseState, trimmed: string): boolean {
  const numbered = /^\d+[.、]\s*(.+)$/.exec(trimmed);
  if (!numbered?.[1]) return false;
  flushParagraph(blocks, state);
  flushBullets(blocks, state);
  state.numbers.push(numbered[1]);
  return true;
}

function consumeSection(blocks: AnswerBlock[], state: ProseState, trimmed: string): boolean {
  const section = sectionNameFromLine(trimmed);
  if (!section.name) return false;
  if (section.rest) state.paragraph.push(section.rest);
  flushParagraph(blocks, state);
  blocks.push({ type: 'section', spans: [{ text: section.name }] });
  return true;
}

function flushParagraph(blocks: AnswerBlock[], state: ProseState): void {
  if (state.paragraph.length === 0) return;
  const joined = state.paragraph.join(' ').replace(/\s+/g, ' ').trim();
  if (joined) blocks.push({ type: 'p', spans: parseSpans(joined) });
  state.paragraph = [];
}

function flushBullets(blocks: AnswerBlock[], state: ProseState): void {
  if (state.bullets.length === 0) return;
  blocks.push({ type: 'ul', items: state.bullets.map(item => parseSpans(item)) });
  state.bullets = [];
}

function flushNumbers(blocks: AnswerBlock[], state: ProseState): void {
  if (state.numbers.length === 0) return;
  blocks.push({ type: 'ol', items: state.numbers.map(item => parseSpans(item)) });
  state.numbers = [];
}

function normalizeAnswerSource(raw: string): string {
  return (raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/([。！？!?])\s*(#{1,6}\s+)/g, '$1\n$2')
    .replace(/：\s*-\s+/g, '：\n- ')
    .replace(/:\s*-\s+/g, ':\n- ')
    .replace(/([。；;])\s*-\s+/g, '$1\n- ')
    .replace(/\s+(\d+[.、])\s+/g, '\n$1 ')
    .replace(/\*\*\s+/g, '**')
    .replace(/([^\s.。])[ \t]+\*\*/g, '$1**')
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
    if (block.type === 'p' || block.type === 'section') return { ...block, spans: linkSpans(block.spans) };
    if (block.type === 'pre') return block;
    return { ...block, items: block.items.map(item => linkSpans(item)) };
  });
}
