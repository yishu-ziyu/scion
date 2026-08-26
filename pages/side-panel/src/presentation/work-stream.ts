/**
 * Side panel stream: blocks appear from what happened.
 * No reserved 目标 / 现在 / 结果 slots.
 */

import type { ActionAttempt, AttemptFinding, TaskStatus } from '@extension/storage';
import {
  compactPageReading,
  isHumanPageReading,
  isSearchResultsUrl,
  searchQueryFromPageTitle,
  searchQueryFromResultsUrl,
} from '@extension/storage';
import { stripAnswerMarkup } from './answer-format';

const HIDDEN_ACTIONS = new Set([
  'evaluate',
  'wait',
  'done',
  'cache_content',
  'record_evidence',
  'inspect_evidence_space',
  'record_research_decision',
  'record_research_delivery',
  'read_page_text',
  'inspect_open_tabs',
  'find_tab',
  'go_back',
  'scroll_to_text',
  'scroll_to_percent',
]);

export interface StreamSearchQuery {
  id: string;
  query: string;
  results: AttemptFinding[];
  live: boolean;
}

export interface StreamPage {
  id: string;
  title: string;
  host?: string;
  url?: string;
  snippet?: string;
  live: boolean;
}

export interface StreamCommit {
  id: string;
  text: string;
  live: boolean;
}

export interface StreamSource {
  id: string;
  title: string;
  host?: string;
  url: string;
  /** Prefer the already-open verified task tab when the normalized URL omits a private query. */
  tabId?: number;
  /** The page was verified, but its private query is intentionally not durable or reopenable. */
  unavailable?: boolean;
}

export type WorkStreamBlock =
  | { type: 'thinking'; id: string; text: string; open: boolean }
  | { type: 'search'; id: string; queries: StreamSearchQuery[] }
  | { type: 'page'; id: string; page: StreamPage }
  | { type: 'commit'; id: string; commit: StreamCommit }
  | { type: 'act'; id: string; text: string; live: boolean };

export interface WorkStreamView {
  blocks: WorkStreamBlock[];
}

function compact(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/** Split a live page reading into sentences. Do not invent a canned SENTENCES list. */
export function splitThinkingSentences(text: string): string[] {
  const trimmed = stripAnswerMarkup(text).replace(/\s+/g, ' ').trim();
  if (!trimmed) return [];
  const parts = trimmed.match(/[^。！？]+[。！？]?/g);
  const sentences = (parts ?? [trimmed]).map(part => part.trim()).filter(Boolean);
  return sentences.length > 0 ? sentences : [trimmed];
}

/** Cadence between revealing two already-arrived sentences. Text is real; only the reveal is paced. */
export const THINKING_REVEAL_MS = 420;

export function thinkingRevealStep(
  total: number,
  revealed: number,
  opts: { running: boolean; reduceMotion: boolean },
): { visible: number; againInMs?: number } {
  if (opts.reduceMotion || !opts.running) return { visible: total };
  if (total <= 0) return { visible: 0 };
  if (revealed <= 0) return { visible: 1, againInMs: 30 };
  if (revealed >= total) return { visible: total };
  return { visible: revealed + 1, againInMs: THINKING_REVEAL_MS };
}

function isLive(state: ActionAttempt['state'] | string): boolean {
  return state === 'proposed' || state === 'authorized' || state === 'executing';
}

export function isSearchAttempt(
  attempt: Pick<ActionAttempt, 'actionName' | 'displaySummary'> & { findings?: ActionAttempt['findings'] },
): boolean {
  if (attempt.actionName === 'search_google') return true;
  if (/^搜索/.test(attempt.displaySummary?.replace(/\s+/g, ' ').trim() ?? '')) return true;
  return attempt.actionName === 'observe' && (attempt.findings?.length ?? 0) > 0;
}

const SEARCH_QUERY_NOISE = /^(搜索网页|获取页面快照|思考中|查看页面|page_state)$/;

export function searchQueryFromAttempt(attempt: Pick<ActionAttempt, 'displaySummary' | 'targetLabel'>): string {
  const summary = attempt.displaySummary?.replace(/\s+/g, ' ').trim() ?? '';
  const matched = /^搜索[:：]\s*(.+)$/.exec(summary);
  if (matched?.[1] && !SEARCH_QUERY_NOISE.test(matched[1])) return compact(matched[1], 48);
  const label = attempt.targetLabel?.trim() ?? '';
  if (
    label &&
    !SEARCH_QUERY_NOISE.test(label) &&
    !/^https?:\/\//i.test(label) &&
    !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(label)
  ) {
    return compact(label, 48);
  }
  return '搜索网页';
}

function resolvedSearchQuery(
  attempt: Pick<ActionAttempt, 'displaySummary' | 'targetLabel'>,
  pageTitle?: string,
): string {
  const fromAttempt = searchQueryFromAttempt(attempt);
  if (fromAttempt !== '搜索网页') return fromAttempt;
  const fromTitle = searchQueryFromPageTitle(pageTitle);
  return fromTitle ? compact(fromTitle, 48) : '搜索网页';
}

export function pageUrlFromAttempt(
  attempt: Pick<ActionAttempt, 'targetUrl' | 'targetLabel' | 'findings'>,
): string | undefined {
  if (attempt.targetUrl && /^https?:\/\//i.test(attempt.targetUrl)) return attempt.targetUrl;
  const found = attempt.findings?.find(hit => hit.url && /^https?:\/\//i.test(hit.url))?.url;
  if (found) return found;
  const label = attempt.targetLabel?.trim();
  if (label && /^https?:\/\//i.test(label)) return label;
  if (label && /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(label)) return `https://${label}`;
  return undefined;
}

function isCommitAttempt(attempt: Pick<ActionAttempt, 'effect' | 'actionName'>): boolean {
  if (attempt.effect !== 'external_commit') return false;
  return (
    attempt.actionName === 'click_element' || attempt.actionName === 'send_keys' || attempt.actionName === 'input_text'
  );
}

const ACTION_TITLE = /^(打开|切换到|查看|关闭|抽取[:：]|抽取)\s*/;

function pageTitleFromAttempt(
  attempt: Pick<ActionAttempt, 'displaySummary' | 'targetLabel' | 'actionName' | 'findings' | 'targetUrl'>,
  searchHits: AttemptFinding[] = [],
): string {
  const found = attempt.findings?.find(hit => hit.title.trim().length >= 2)?.title;
  if (found && found !== attempt.targetLabel?.trim()) return compact(found, 80);
  const url = pageUrlFromAttempt(attempt);
  const fromSearch = url
    ? searchHits.find(hit => hit.url === url || (hit.host && url.includes(hit.host)))?.title
    : undefined;
  if (fromSearch) return compact(fromSearch, 80);
  const label = attempt.targetLabel?.trim();
  if (label && !ACTION_TITLE.test(label)) return compact(label, 48);
  const summary = attempt.displaySummary?.replace(/\s+/g, ' ').trim() ?? '';
  if (summary && ACTION_TITLE.test(summary)) {
    const rest = summary.replace(ACTION_TITLE, '').trim();
    if (rest) return compact(rest, 80);
  }
  if (summary.length >= 2 && !/^[a-z][a-z0-9_]+$/.test(summary) && !ACTION_TITLE.test(summary)) {
    return compact(summary, 80);
  }
  if (attempt.actionName === 'extract_content') return '抽出的内容';
  return '打开的页';
}

function thinkingText(input: {
  status: TaskStatus | string;
  currentSummary?: string;
  liveSummaries: string[];
  lastPublicText?: string;
}): string {
  if (input.status === 'failed' || input.status === 'cancelled') return '';
  const current = input.currentSummary?.replace(/\s+/g, ' ').trim() ?? '';
  if (!isHumanPageReading(current)) return '';
  if (input.lastPublicText && current === input.lastPublicText) return '';
  if (input.liveSummaries.includes(current)) return '';
  return compactPageReading(current, 160);
}

function urlsInBlocks(blocks: WorkStreamBlock[]): Set<string> {
  const urls = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'page' && block.page.url) urls.add(block.page.url);
    if (block.type === 'search') {
      for (const query of block.queries) {
        for (const hit of query.results) {
          if (hit.url) urls.add(hit.url);
        }
      }
    }
  }
  return urls;
}

function appendObserveOrSkip(
  attempt: ActionAttempt,
  pushAct: (id: string, text: string, live: boolean) => void,
  liveSummaries: string[],
) {
  const summary = attempt.displaySummary?.replace(/\s+/g, ' ').trim() ?? '';
  const text = summary.length >= 2 ? compact(summary, 80) : '获取页面快照';
  if (SEARCH_QUERY_NOISE.test(text)) return;
  const live = isLive(attempt.state);
  if (live && summary) liveSummaries.push(summary);
  pushAct(attempt.id, text, live);
}

export function deriveWorkStream(input: {
  status: TaskStatus | string;
  attempts: ActionAttempt[];
  currentSummary?: string;
  pageLabel?: string;
  pageUrl?: string;
  pageTitle?: string;
}): WorkStreamView {
  const blocks: WorkStreamBlock[] = [];
  const running = input.status === 'running';
  const searchHits: AttemptFinding[] = [];
  const liveSummaries: string[] = [];
  let i = 0;
  let lastPage: Extract<WorkStreamBlock, { type: 'page' }> | undefined;
  let hasSearch = false;

  const pushAct = (id: string, text: string, live: boolean) => {
    const last = blocks[blocks.length - 1];
    if (last?.type === 'act' && last.text === text) {
      last.live = last.live || live;
      return;
    }
    blocks.push({ type: 'act', id, text, live });
  };

  while (i < input.attempts.length) {
    const attempt = input.attempts[i]!;
    if (isSearchAttempt(attempt)) {
      const queries: StreamSearchQuery[] = [];
      while (i < input.attempts.length && input.attempts[i] && isSearchAttempt(input.attempts[i]!)) {
        const row = input.attempts[i]!;
        const live = isLive(row.state);
        if (live && row.displaySummary) liveSummaries.push(row.displaySummary.replace(/\s+/g, ' ').trim());
        const results = row.findings ?? [];
        searchHits.push(...results);
        queries.push({
          id: row.id,
          query: resolvedSearchQuery(row, input.pageTitle),
          results,
          live,
        });
        i += 1;
      }
      if (queries.length > 0) {
        blocks.push({ type: 'search', id: queries[0]!.id, queries });
        lastPage = undefined;
        hasSearch = true;
      }
      continue;
    }

    if (attempt.actionName === 'observe' || attempt.actionName === 'snapshot') {
      appendObserveOrSkip(attempt, pushAct, liveSummaries);
      i += 1;
      continue;
    }

    if (HIDDEN_ACTIONS.has(attempt.actionName)) {
      i += 1;
      continue;
    }

    if (
      attempt.actionName === 'go_to_url' ||
      attempt.actionName === 'open_tab' ||
      attempt.actionName === 'switch_tab' ||
      attempt.actionName === 'focus_tab'
    ) {
      const live = isLive(attempt.state);
      if (live && attempt.displaySummary) liveSummaries.push(attempt.displaySummary.replace(/\s+/g, ' ').trim());
      const page: StreamPage = {
        id: attempt.id,
        title: pageTitleFromAttempt(attempt, searchHits),
        host: attempt.targetLabel?.trim() || undefined,
        url: pageUrlFromAttempt(attempt),
        live,
      };
      const block: WorkStreamBlock = { type: 'page', id: attempt.id, page };
      blocks.push(block);
      lastPage = block;
      i += 1;
      continue;
    }

    if (attempt.actionName === 'extract_content') {
      const snippet = pageTitleFromAttempt(attempt, searchHits);
      if (lastPage) {
        lastPage.page.snippet = snippet;
        lastPage.page.url = lastPage.page.url ?? pageUrlFromAttempt(attempt);
      } else {
        const live = isLive(attempt.state);
        if (live && attempt.displaySummary) liveSummaries.push(attempt.displaySummary.replace(/\s+/g, ' ').trim());
        const block: WorkStreamBlock = {
          type: 'page',
          id: attempt.id,
          page: {
            id: attempt.id,
            title: snippet,
            host: attempt.targetLabel?.trim(),
            url: pageUrlFromAttempt(attempt),
            live,
          },
        };
        blocks.push(block);
        lastPage = block;
      }
      i += 1;
      continue;
    }

    if (
      attempt.actionName === 'click_element' ||
      attempt.actionName === 'control_media' ||
      attempt.actionName === 'input_text' ||
      attempt.actionName === 'send_keys' ||
      attempt.actionName === 'select_dropdown_option'
    ) {
      if (attempt.state === 'blocked') {
        i += 1;
        continue;
      }
      if (attempt.actionName === 'send_keys' && !isCommitAttempt(attempt)) {
        i += 1;
        continue;
      }
      const summary = attempt.displaySummary?.replace(/\s+/g, ' ').trim();
      const title = summary && summary.length >= 2 ? compact(summary, 80) : pageTitleFromAttempt(attempt, searchHits);
      const live = isLive(attempt.state);
      if (live && summary) liveSummaries.push(summary);
      if (isCommitAttempt(attempt)) {
        blocks.push({
          type: 'commit',
          id: attempt.id,
          commit: { id: attempt.id, text: title, live },
        });
        lastPage = undefined;
        i += 1;
        continue;
      }
      pushAct(attempt.id, title, live);
      i += 1;
      continue;
    }

    i += 1;
  }

  const pageUrl = input.pageUrl?.trim();
  if (!hasSearch && pageUrl && isSearchResultsUrl(pageUrl)) {
    const query = searchQueryFromResultsUrl(pageUrl) ?? searchQueryFromPageTitle(input.pageTitle) ?? '搜索网页';
    blocks.unshift({
      type: 'search',
      id: 'bound-search',
      queries: [{ id: 'bound-search', query: compact(query, 48), results: searchHits.slice(0, 6), live: running }],
    });
    hasSearch = true;
  } else if (blocks.length === 0 && input.pageLabel?.trim()) {
    const title = compact(input.pageTitle?.trim() || input.pageLabel, 80);
    const host = input.pageLabel.replace(/\s+·\s+.*$/, '').trim();
    blocks.push({
      type: 'page',
      id: 'bound-page',
      page: {
        id: 'bound-page',
        title,
        host: host && host !== title ? host : undefined,
        url: pageUrl,
        live: running,
      },
    });
    lastPage = blocks[0] as Extract<WorkStreamBlock, { type: 'page' }>;
  } else if (pageUrl && !isSearchResultsUrl(pageUrl) && /^https?:\/\//i.test(pageUrl)) {
    const seen = urlsInBlocks(blocks);
    const already = [...seen].some(url => url === pageUrl || pageUrl.startsWith(url) || url.startsWith(pageUrl));
    if (!already && input.pageTitle?.trim()) {
      blocks.push({
        type: 'page',
        id: 'bound-page',
        page: {
          id: 'bound-page',
          title: compact(input.pageTitle, 80),
          host: undefined,
          url: pageUrl,
          live: running,
        },
      });
    }
  }

  const lastPublic = [...blocks].reverse().find(block => block.type !== 'thinking');
  const lastPublicText =
    lastPublic?.type === 'page'
      ? lastPublic.page.title
      : lastPublic?.type === 'search'
        ? lastPublic.queries[lastPublic.queries.length - 1]?.query
        : lastPublic?.type === 'commit'
          ? lastPublic.commit.text
          : lastPublic?.type === 'act'
            ? lastPublic.text
            : undefined;
  const thinking = thinkingText({
    status: input.status,
    currentSummary: input.currentSummary,
    liveSummaries,
    lastPublicText,
  });
  if (thinking) {
    const reading = { type: 'thinking' as const, id: 'thinking', text: thinking, open: running };
    const lastSeen = [...blocks]
      .map((block, index) => ({ block, index }))
      .reverse()
      .find(item => item.block.type === 'search' || item.block.type === 'page');
    if (lastSeen) blocks.splice(lastSeen.index + 1, 0, reading);
    else blocks.push(reading);
  }

  return { blocks };
}

export function collectStreamSources(view: WorkStreamView): StreamSource[] {
  const sources: StreamSource[] = [];
  const seen = new Set<string>();
  const push = (source: StreamSource) => {
    if (seen.has(source.url)) return;
    seen.add(source.url);
    sources.push(source);
  };
  for (const block of view.blocks) {
    if (block.type === 'search') {
      for (const query of block.queries) {
        for (const hit of query.results) {
          if (!hit.url || !/^https?:\/\//i.test(hit.url)) continue;
          push({
            id: `${query.id}-${hit.url}`,
            title: hit.title,
            host: hit.host,
            url: hit.url,
          });
        }
      }
    }
    if (block.type === 'page' && block.page.url && /^https?:\/\//i.test(block.page.url)) {
      push({
        id: block.page.id,
        title: block.page.title,
        host: block.page.host,
        url: block.page.url,
      });
    }
  }
  return sources.slice(0, 8);
}
