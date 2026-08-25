/**
 * Map a query string onto the current page's numbered controls.
 * Zero or many equal-best matches: do not act; return candidates.
 */
import type { InteractiveElementDigest } from './types';
import { filterInteractiveElements, formatInteractiveList, scoreInteractiveElement } from './filter-interactive';

export type ResolveIntentResult =
  | { kind: 'match'; index: number; element: InteractiveElementDigest }
  | { kind: 'none'; candidates: InteractiveElementDigest[] }
  | { kind: 'ambiguous'; candidates: InteractiveElementDigest[] };

export type NamedWaitAsk = {
  prompt: string;
  options: { label: string; sendText: string }[];
};

const MAX_WAIT_OPTIONS = 7;
const MAX_WAIT_LABEL = 40;

const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export function resolveIntent(elements: InteractiveElementDigest[], query: string): ResolveIntentResult {
  const ordinal = parseOrdinalQuery(query);
  if (ordinal) {
    const picked = pickOrdinal(elements, ordinal);
    if (picked) return { kind: 'match', index: picked.index, element: picked };
  }

  const matches = filterInteractiveElements(elements, query);
  if (matches.length === 0) {
    return { kind: 'none', candidates: [] };
  }
  const best = uniqueBestMatches(matches, query);
  if (best.length === 1) {
    return { kind: 'match', index: best[0]!.index, element: best[0]! };
  }
  if (matches.length === 1) {
    return { kind: 'match', index: matches[0]!.index, element: matches[0]! };
  }
  return { kind: 'ambiguous', candidates: best };
}

function uniqueBestMatches(matches: InteractiveElementDigest[], query: string): InteractiveElementDigest[] {
  if (matches.length <= 1) return matches;
  const scored = matches.map(element => ({ element, score: scoreInteractiveElement(element, query) }));
  const top = Math.max(...scored.map(row => row.score));
  return scored.filter(row => row.score === top).map(row => row.element);
}

function parseOrdinalQuery(query: string): { n: number; rest: string } | null {
  const trimmed = query.trim();
  const cn = trimmed.match(/第\s*([一二三四五六七八九十\d]+)\s*[个条]/);
  if (cn) {
    const n = /^\d+$/.test(cn[1]!) ? Number(cn[1]) : (CN_NUM[cn[1]!] ?? 0);
    if (n < 1) return null;
    const rest = `${trimmed.slice(0, cn.index)}${trimmed.slice((cn.index ?? 0) + cn[0].length)}`
      .replace(/\s+/g, ' ')
      .trim();
    return { n, rest };
  }
  const en = trimmed.match(/\b(first|1st)\b/i);
  if (en) {
    return { n: 1, rest: trimmed.replace(en[0], '').replace(/\s+/g, ' ').trim() };
  }
  return null;
}

function pickOrdinal(
  elements: InteractiveElementDigest[],
  ordinal: { n: number; rest: string },
): InteractiveElementDigest | undefined {
  const rest = ordinal.rest;
  const videoRest = !rest || /^(视频|影片|video)s?$/i.test(rest);
  if (videoRest) {
    return elements.filter(isVideoLikeControl).sort((a, b) => a.index - b.index)[ordinal.n - 1];
  }
  const best = uniqueBestMatches(filterInteractiveElements(elements, rest), rest);
  const sameName = best.filter(element => bindLabel(element) === rest);
  const pool = (sameName.length > 0 ? sameName : best).sort((a, b) => a.index - b.index);
  return pool[ordinal.n - 1];
}

function isVideoLikeControl(element: InteractiveElementDigest): boolean {
  const tag = (element.tagName || '').toLowerCase();
  const role = (element.role || '').toLowerCase();
  const text = [element.text, element.label].filter(Boolean).join(' ').toLowerCase();
  if (/home|首页|登录|login|search|搜索|cancel|取消/.test(text)) return false;
  const isLink = tag === 'a' || role === 'link';
  if (!isLink && !/video|视频|watch/.test(text)) return false;
  return text.trim().length > 2 || /video|视频|watch/.test(text);
}

export function formatResolveIntentError(
  result: Exclude<ResolveIntentResult, { kind: 'match' }>,
  query: string,
): string {
  const q = query.trim();
  if (result.kind === 'none') {
    return `No control matched query="${q}". Candidates: (none). Did not act.`;
  }
  return `Query="${q}" matched ${result.candidates.length} controls. Candidates:\n${formatInteractiveList(result.candidates)}\nDid not act.`;
}

function bindLabel(element: InteractiveElementDigest): string {
  return (element.text || element.label || element.placeholder || '').replace(/\s+/g, ' ').trim();
}

function compactWaitLabel(value: string): string {
  return value.length > MAX_WAIT_LABEL ? `${value.slice(0, MAX_WAIT_LABEL - 1)}…` : value;
}

/** Named choices from an ambiguous bind. Null when fewer than two observed names exist. */
export function waitAskFromAmbiguousBind(query: string, candidates: InteractiveElementDigest[]): NamedWaitAsk | null {
  const named = uniqueBestMatches(candidates, query)
    .map(element => ({ element, name: bindLabel(element) }))
    .filter(row => row.name.length >= 1);
  if (named.length < 2) return null;
  const sliced = named.slice(0, MAX_WAIT_OPTIONS);
  const nameCount = new Map<string, number>();
  for (const row of sliced) {
    nameCount.set(row.name, (nameCount.get(row.name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const options = sliced.map(row => {
    const duplicate = (nameCount.get(row.name) ?? 0) > 1;
    const ordinal = (seen.get(row.name) ?? 0) + 1;
    seen.set(row.name, ordinal);
    const sendText = duplicate ? `第${ordinal}个${row.name}` : row.name;
    const label = compactWaitLabel(duplicate ? `${row.name}（${ordinal}）` : row.name);
    return { label, sendText };
  });
  const q = query.replace(/\s+/g, ' ').trim().slice(0, MAX_WAIT_LABEL);
  return {
    prompt: q ? `这几个都对得上「${q}」，要哪一个？` : '这几个都对得上，要哪一个？',
    options,
  };
}
