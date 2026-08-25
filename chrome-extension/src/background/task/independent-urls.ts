import type { ActionAttempt, AttemptFinding, BrowserTargetRef } from '@extension/storage/lib/task';
import { isAtomicSkillInstruction } from '../agent/skills/instruction-scope';
import type BrowserContext from '../browser/context';
import { isSearchResultsUrl } from '../browser/search-results';
import { pageLooksUnavailable } from '../browser/page-availability';
import { analyzeInstructionLanguage, instructionAffirmsTarget } from '../instruction-language';
import { buildAttemptDisplaySummary, buildAttemptTargetLabel } from './attempt-display';
import { redactedHttpUrlIdentity } from './completion';
import { sha256 } from './digest';

/** Do not open dozens of tabs in one shot. */
export const MAX_PARALLEL_TABS = 5;

export type InstructionUrlPlanLike = {
  sourceUrls: string[];
  requiresOrderedSourceProof: boolean;
};

export function instructionUrlPlanFromText(instruction: string): InstructionUrlPlanLike {
  const analysis = analyzeInstructionLanguage(instruction);
  return {
    sourceUrls: analysis.urls.map(occurrence => occurrence.value),
    requiresOrderedSourceProof: instructionAffirmsTarget(analysis, 'ordered_sources'),
  };
}

export type OpenedIndependentTab = {
  tabId: number;
  requestedUrl: string;
  pageUrl: string;
  title: string;
};

export type IndependentTabOpenFailure = {
  requestedUrl: string;
  error: string;
};

export type IndependentTabOpenAttempt = OpenedIndependentTab | IndependentTabOpenFailure;

export function isIndependentTabOpenFailure(result: IndependentTabOpenAttempt): result is IndependentTabOpenFailure {
  return 'error' in result && !('tabId' in result);
}

export function provenanceUrlKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return (url.origin + url.pathname).replace(/\/+$/, '') || url.origin;
  } catch {
    return null;
  }
}

/** Page identity while opening tabs: query selects the page; fragments do not. */
function openTabUrlKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.origin}${pathname}${url.search}`;
  } catch {
    return null;
  }
}

function openTabUrlKeys(urls: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const value of urls) {
    const key = openTabUrlKey(value);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Literal http(s) URLs that can load together. Ordered "先 A 再 B" stays serial.
 * Skill-only sentences with fewer than two literals do not open here.
 */
export function instructionUrlsStillToOpen(
  plan: InstructionUrlPlanLike,
  alreadyOpenUrls: Iterable<string> = [],
): string[] {
  if (plan.sourceUrls.length < 2 || plan.requiresOrderedSourceProof) return [];
  const openKeys = openTabUrlKeys(alreadyOpenUrls);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of plan.sourceUrls) {
    const key = openTabUrlKey(url);
    if (!key || seen.has(key) || openKeys.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= MAX_PARALLEL_TABS) break;
  }
  return out;
}

export function instructionWantsOpenedSearchResults(instruction: string): boolean {
  return /打开前\s*[一二两三四五六七八九十\d]+\s*条|打开(?:搜索)?结果|打开多条|多条来源|多条证据|open (?:the )?(?:top|first)\s+\d+|open (?:these|the) (?:results?|sources?|links?)/i.test(
    instruction,
  );
}

export function searchFindingUrlsToOpen(
  findings: Array<Pick<AttemptFinding, 'url'>>,
  alreadyOpenUrls: Iterable<string> = [],
  limit = MAX_PARALLEL_TABS,
): string[] {
  const openKeys = openTabUrlKeys(alreadyOpenUrls);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    const url = finding.url?.trim();
    if (!url) continue;
    const key = openTabUrlKey(url);
    if (!key || seen.has(key) || openKeys.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Instruction literals first. Search-result hits only after the current page is a SERP
 * and the user asked to open several results. Atomic skill sentences stay serial.
 */
export function urlsForIndependentOpen(input: {
  instruction: string;
  plan: InstructionUrlPlanLike;
  alreadyOpenUrls?: Iterable<string>;
  currentUrl?: string;
  searchFindings?: Array<Pick<AttemptFinding, 'url'>>;
}): string[] {
  const alreadyOpen = input.alreadyOpenUrls ?? [];
  const fromInstruction = instructionUrlsStillToOpen(input.plan, alreadyOpen);
  if (fromInstruction.length > 0) return fromInstruction;
  if (isAtomicSkillInstruction(input.instruction)) return [];
  if (!input.currentUrl || !isSearchResultsUrl(input.currentUrl)) return [];
  if (!instructionWantsOpenedSearchResults(input.instruction)) return [];
  return searchFindingUrlsToOpen(input.searchFindings ?? [], alreadyOpen);
}

export function shouldPersistOpenedPage(url: string, title: string): boolean {
  const trimmed = title.replace(/\s+/g, ' ').trim();
  if (!trimmed) return false;
  return !pageLooksUnavailable({ url, title: trimmed });
}

export function persistableHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return provenanceUrlKey(value) ?? undefined;
}

export async function alreadyOpenTabUrls(browserContext: BrowserContext): Promise<string[]> {
  try {
    return (await browserContext.getTabInfos()).map(tab => tab.url);
  } catch {
    return [];
  }
}

export async function describeIndependentOpenResults(
  browserContext: Pick<BrowserContext, 'openIndependentTabs'>,
  urls: string[],
): Promise<OpenedIndependentTab[]> {
  if (urls.length === 0 || typeof browserContext.openIndependentTabs !== 'function') return [];
  const results = await browserContext.openIndependentTabs(urls);
  const opened: OpenedIndependentTab[] = [];
  for (const result of results) {
    if (!result.ok) continue;
    let title = '';
    let pageUrl = result.page.url();
    try {
      title = (await result.page.title()).replace(/\s+/g, ' ').trim();
    } catch {
      title = '';
    }
    try {
      const tab = await chrome.tabs.get(result.page.tabId);
      if (tab.title) title = tab.title.replace(/\s+/g, ' ').trim();
      if (tab.url) pageUrl = tab.url;
    } catch {
      // Page.url / Page.title remain.
    }
    opened.push({
      tabId: result.page.tabId,
      requestedUrl: result.requestedUrl,
      pageUrl,
      title,
    });
  }
  return opened;
}

export function persistableOpenedTabs(opened: OpenedIndependentTab[]): OpenedIndependentTab[] {
  return opened.filter(tab => shouldPersistOpenedPage(tab.pageUrl || tab.requestedUrl, tab.title));
}

export function pagesMatchingPlan(
  plan: InstructionUrlPlanLike,
  tabs: Array<{ url: string; title: string }>,
): Array<{ url: string; title: string }> {
  const keys = openTabUrlKeys(plan.sourceUrls);
  const out: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    const key = openTabUrlKey(tab.url);
    const title = tab.title.replace(/\s+/g, ' ').trim();
    if (!key || !keys.has(key) || !title || seen.has(key)) continue;
    seen.add(key);
    out.push({ url: tab.url, title });
  }
  return out;
}

export async function openAndDescribeIndependentPages(input: {
  instruction: string;
  plan: InstructionUrlPlanLike;
  browserContext: BrowserContext;
  currentUrl?: string;
  searchFindings?: Array<Pick<AttemptFinding, 'url'>>;
}): Promise<OpenedIndependentTab[]> {
  const alreadyOpen = await alreadyOpenTabUrls(input.browserContext);
  if (input.currentUrl) alreadyOpen.push(input.currentUrl);
  const urls = urlsForIndependentOpen({
    instruction: input.instruction,
    plan: input.plan,
    alreadyOpenUrls: alreadyOpen,
    currentUrl: input.currentUrl,
    searchFindings: input.searchFindings,
  });
  return persistableOpenedTabs(await describeIndependentOpenResults(input.browserContext, urls));
}

export function independentPagesMemory(pages: Array<{ url: string; title: string }>): string {
  if (pages.length === 0) return '';
  return [
    'Already opened independent pages (do not open them again):',
    ...pages.map((page, index) => `${index + 1}. url=${page.url} title=${page.title}`),
  ].join('\n');
}

export async function independentTabRecords(input: {
  tab: OpenedIndependentTab;
  roundId: string;
  now: number;
}): Promise<{ target: BrowserTargetRef; attempt: ActionAttempt } | null> {
  const title = input.tab.title.replace(/\s+/g, ' ').trim();
  const pageUrl = input.tab.pageUrl || input.tab.requestedUrl;
  if (!shouldPersistOpenedPage(pageUrl, title)) return null;
  const identity = await redactedHttpUrlIdentity(pageUrl);
  if (!identity?.normalizedUrl) return null;
  let urlOrigin = 'null';
  try {
    urlOrigin = new URL(pageUrl).origin;
  } catch {
    urlOrigin = 'null';
  }
  const digest = await sha256(JSON.stringify({ tabId: input.tab.tabId, normalizedUrl: identity.normalizedUrl, title }));
  const targetUrl = persistableHttpUrl(pageUrl);
  const displayInput = { actionName: 'open_tab', args: { url: input.tab.requestedUrl }, urlOrigin };
  const attempt: ActionAttempt = {
    id: crypto.randomUUID(),
    roundId: input.roundId,
    actionName: 'open_tab',
    effect: 'reversible',
    argsDigest: await sha256(JSON.stringify({ url: input.tab.requestedUrl })),
    displaySummary: buildAttemptDisplaySummary(displayInput),
    targetLabel: buildAttemptTargetLabel(displayInput),
    ...(targetUrl ? { targetUrl } : {}),
    findings: [
      {
        title: title.slice(0, 160),
        url: targetUrl,
        host: urlOrigin === 'null' ? undefined : urlOrigin.replace(/^https?:\/\//, '').replace(/^www\./, ''),
      },
    ],
    state: 'observed',
    proposedAt: input.now,
    authorizedAt: input.now,
    executingAt: input.now,
    observedAt: input.now,
  };
  const target: BrowserTargetRef = {
    id: `tab-${input.tab.tabId}`,
    kind: 'page',
    tabId: input.tab.tabId,
    frameId: 0,
    urlOrigin,
    normalizedUrl: identity.normalizedUrl,
    ...(identity.queryIdentityDigest ? { queryIdentityDigest: identity.queryIdentityDigest } : {}),
    taskOwned: true,
    digest,
    label: title,
    title,
    observedAt: input.now,
  };
  return { target, attempt };
}
