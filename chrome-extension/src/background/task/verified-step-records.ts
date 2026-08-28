/**
 * Verified step records: URL, title, and optional quote from the current
 * observation. Values come from the page, not from model text.
 */
import type { BrowserTargetRef } from '@extension/storage/lib/task';
import { analyzeInstructionLanguage, instructionAffirmsTarget } from '../instruction-language';
import { pageLooksUnavailable } from '../browser/page-availability';
import { normalizeVisiblePageText } from '../browser/kernel/visible-text';
import { numberedStepSegments } from './mission-plan';
import { isAtomicSkillInstruction } from '../agent/skills/instruction-scope';
import type { VerifiedPageRecord } from './contracts';

export const VERIFIED_QUOTE_MAX_CHARS = 160;
export const VERIFIED_TITLE_MAX_CHARS = 160;

const GENERIC_TLDS = new Set(['com', 'org', 'net', 'edu', 'gov', 'io', 'co']);

export function instructionAsksVerifiedTitles(instruction: string): boolean {
  return (
    /标题|\btitles?\b/i.test(instruction) &&
    /写出|写下|读取|确认|列出|输出|返回|告诉(?:我)?|write|list|tell|read|confirm/i.test(instruction)
  );
}

export function instructionAsksVerifiedQuote(instruction: string): boolean {
  return /引用|摘录|摘句|quote|excerpt|\bcite\b/i.test(instruction);
}

function instructionLooksLikeWrittenResult(instruction: string): boolean {
  return (
    instructionAsksVerifiedTitles(instruction) ||
    instructionAsksVerifiedQuote(instruction) ||
    /复制|拷贝|\bcopy\b|告诉我|tell me|写出|写下|总结|主题|有关|评论|\bcomment\b/i.test(instruction)
  );
}

export function verifiedStepRecordsEnabled(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const analysis = analyzeInstructionLanguage(text);
  if (twoSiteReportNeedsPageRecords(text, analysis.urls.length)) return true;
  if (isAtomicSkillInstruction(text)) return false;
  if (numberedStepSegments(text).length >= 2) return true;
  if (instructionAffirmsTarget(analysis, 'ordered_sources') && analysis.urls.length >= 2) return true;
  if (analysis.urls.length > 1 && instructionLooksLikeWrittenResult(text)) return true;
  return false;
}

function twoSiteReportNeedsPageRecords(text: string, urlCount: number): boolean {
  if (urlCount < 1 || !instructionPointsAtCurrentPage(text)) return false;
  if (!/\bproducts?\b|商品|产品/.test(text)) return false;
  return (
    /\breport\b|报告/.test(text) || (/\bnames?\b|名称|名字|标题/.test(text) && /\bprices?\b|价格|售价|£|\$/.test(text))
  );
}

export function stripQueryTokensFromRecordText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"'，。；;）)\]]+/gi, url => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        return (parsed.origin + parsed.pathname).replace(/\/+$/, '') || parsed.origin;
      } catch {
        return url.replace(/\?[^\s]*/g, '');
      }
    })
    .replace(/\?[^\s]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactForVerifiedMatch(value: string): string {
  return value.replace(/\s+/g, '').toLocaleLowerCase();
}

export function answerContainsVerifiedText(answer: string, expected: string): boolean {
  const needle = compactForVerifiedMatch(expected);
  if (!needle) return false;
  return compactForVerifiedMatch(answer).includes(needle);
}

export function isRecordablePageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function instructionPointsAtCurrentPage(instruction: string): boolean {
  return (
    /(?:当前|这个|本)(?:的)?(?:页面|网页|网站|页)|(?:页面|网页)(?:上|中|展示|内容)/.test(instruction) ||
    /\b(?:this|the|current)\s+(?:page|webpage|site)\b/i.test(instruction)
  );
}

export function pageMatchesInstruction(instruction: string, url: string): boolean {
  const lower = instruction.toLowerCase();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const hostParts = host.split('.').filter(part => part.length >= 3 && !GENERIC_TLDS.has(part));
    if (hostParts.some(part => lower.includes(part))) return true;
    const path = decodeURIComponent(parsed.pathname).toLowerCase();
    const tokens = path.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(token => token.length >= 4);
    return tokens.some(token => lower.includes(token));
  } catch {
    return false;
  }
}

export function shouldCommitVerifiedPage(input: { title: string; url?: string; visibleText?: string }): boolean {
  const title = stripQueryTokensFromRecordText(input.title).slice(0, VERIFIED_TITLE_MAX_CHARS);
  if (!title) return false;
  if (/^(?:new tab|新标签页)$/i.test(title)) return false;
  if (
    pageLooksUnavailable({
      url: input.url,
      title: input.title,
      bodyText: input.visibleText,
    })
  ) {
    return false;
  }
  if (input.url) {
    try {
      const host = new URL(input.url).hostname.replace(/^www\./, '');
      if (compactForVerifiedMatch(title) === compactForVerifiedMatch(host)) return false;
    } catch {
      // Keep the title when the URL cannot be parsed as http(s).
    }
  }
  return true;
}

export function pickVerifiedQuote(visibleText: string): string | undefined {
  const normalized = normalizeVisiblePageText(visibleText);
  if (!normalized) return undefined;
  const compact = normalized.replace(/\s+/g, ' ').trim();
  const sentences = compact.split(/(?<=[.!?。！？])\s+/);
  for (const sentence of sentences) {
    const quote = stripQueryTokensFromRecordText(sentence).slice(0, VERIFIED_QUOTE_MAX_CHARS);
    if (quote.length >= 8 && compact.includes(quote)) return quote;
  }
  const fallback = stripQueryTokensFromRecordText(compact).slice(0, VERIFIED_QUOTE_MAX_CHARS);
  if (fallback.length >= 8 && compact.includes(fallback)) return fallback;
  return undefined;
}

export function formatVerifiedPagesForPrompt(pages: VerifiedPageRecord[]): string {
  if (pages.length === 0) return '';
  return [
    'Verified pages:',
    ...pages.map((page, index) => `${index + 1}. url=${page.normalizedUrl} title=${page.title}`),
  ].join('\n');
}

export function verifiedPageRecordsFromTargets(targets: BrowserTargetRef[]): VerifiedPageRecord[] {
  const seen = new Set<string>();
  const pages = targets
    .filter(
      (target): target is BrowserTargetRef & { normalizedUrl: string; title: string } =>
        target.kind === 'page' && Boolean(target.normalizedUrl) && Boolean(target.title?.trim()),
    )
    .sort((left, right) => (left.visitSeq ?? 0) - (right.visitSeq ?? 0));
  const records: VerifiedPageRecord[] = [];
  for (const page of pages) {
    const url = page.normalizedUrl;
    const key = `${url}\n${page.queryIdentityDigest ?? 'no-query'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      normalizedUrl: url,
      ...(page.queryIdentityDigest ? { queryIdentityDigest: page.queryIdentityDigest } : {}),
      title: page.title.replace(/\s+/g, ' ').trim(),
      ...(page.quote ? { quote: page.quote } : {}),
      ...(page.visitSeq !== undefined ? { visitSeq: page.visitSeq } : {}),
    });
  }
  return records;
}

export function upsertVerifiedPageTarget(
  refs: BrowserTargetRef[],
  incoming: BrowserTargetRef & { title: string; normalizedUrl: string },
): BrowserTargetRef[] {
  const index = refs.findIndex(
    item =>
      item.kind === 'page' &&
      item.normalizedUrl === incoming.normalizedUrl &&
      item.queryIdentityDigest === incoming.queryIdentityDigest,
  );
  if (index >= 0) {
    const existing = refs[index]!;
    const next: BrowserTargetRef = {
      ...existing,
      title: incoming.title,
      label: existing.label || incoming.title,
      ...(incoming.quote ? { quote: incoming.quote } : {}),
    };
    return [...refs.slice(0, index), next, ...refs.slice(index + 1)];
  }
  const visitSeq = refs.reduce((max, item) => Math.max(max, item.visitSeq ?? 0), 0) + 1;
  return [
    ...refs,
    {
      ...incoming,
      visitSeq,
      label: incoming.label || incoming.title,
    },
  ];
}

export function checkVerifiedRecordDeliverable(
  instruction: string,
  answer: string,
  records: Array<{ title: string; quote?: string }>,
  options?: { requireRecords?: boolean },
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const asksTitles = instructionAsksVerifiedTitles(instruction);
  const asksQuote = instructionAsksVerifiedQuote(instruction);
  if (!asksTitles && !asksQuote) return { passed: true, reasons };
  if (records.length === 0) {
    if (options?.requireRecords) reasons.push('missing_verified_title');
    return { passed: reasons.length === 0, reasons };
  }
  for (const record of records) {
    if (!answerContainsVerifiedText(answer, record.title)) {
      reasons.push('missing_verified_title');
      break;
    }
  }
  if (asksQuote) {
    for (const record of records) {
      if (record.quote && !answerContainsVerifiedText(answer, record.quote)) {
        reasons.push('missing_verified_quote');
        break;
      }
    }
  }
  return { passed: reasons.length === 0, reasons };
}
