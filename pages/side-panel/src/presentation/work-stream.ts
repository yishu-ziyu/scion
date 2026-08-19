/**
 * Side panel stream: blocks appear from what happened.
 * No reserved 目标 / 现在 / 结果 slots.
 */

import type { ActionAttempt, AttemptFinding, TaskStatus } from '@extension/storage';

const HIDDEN_ACTIONS = new Set([
  'observe',
  'snapshot',
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

const THINKING_NOISE =
  /^(思考中|获取页面快照|查看页面|推进当前任务|已按步骤做完|正在处理|正在操作页面|在想下一步|正在看\s)/;

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
}

export type WorkStreamBlock =
  | { type: 'thinking'; id: string; text: string; open: boolean }
  | { type: 'search'; id: string; queries: StreamSearchQuery[] }
  | { type: 'page'; id: string; page: StreamPage }
  | { type: 'commit'; id: string; commit: StreamCommit };

export interface WorkStreamView {
  blocks: WorkStreamBlock[];
}

function compact(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function isLive(state: ActionAttempt['state'] | string): boolean {
  return state === 'proposed' || state === 'authorized' || state === 'executing';
}

export function isSearchAttempt(attempt: Pick<ActionAttempt, 'actionName' | 'displaySummary'>): boolean {
  if (attempt.actionName === 'search_google') return true;
  return /^搜索[:：]/.test(attempt.displaySummary?.replace(/\s+/g, ' ').trim() ?? '');
}

export function searchQueryFromAttempt(attempt: Pick<ActionAttempt, 'displaySummary' | 'targetLabel'>): string {
  const summary = attempt.displaySummary?.replace(/\s+/g, ' ').trim() ?? '';
  const matched = /^搜索[:：]\s*(.+)$/.exec(summary);
  if (matched?.[1]) return compact(matched[1], 48);
  if (attempt.targetLabel?.trim()) return compact(attempt.targetLabel, 48);
  return summary.length >= 2 ? compact(summary, 48) : '搜索网页';
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
    attempt.actionName === 'click_element' ||
    attempt.actionName === 'send_keys' ||
    attempt.actionName === 'input_text'
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
  hasLiveObject: boolean;
  lastPublicText?: string;
}): string {
  if (input.status === 'failed' || input.status === 'cancelled') return '';
  if (input.hasLiveObject) return '';
  const current = input.currentSummary?.replace(/\s+/g, ' ').trim() ?? '';
  if (current && input.lastPublicText && current === input.lastPublicText) return '';
  if (current && !THINKING_NOISE.test(current)) return current;
  return '';
}

export function deriveWorkStream(input: {
  status: TaskStatus | string;
  attempts: ActionAttempt[];
  currentSummary?: string;
  pageLabel?: string;
}): WorkStreamView {
  const blocks: WorkStreamBlock[] = [];
  const running = input.status === 'running';
  const searchHits: AttemptFinding[] = [];
  let i = 0;
  let lastPage: Extract<WorkStreamBlock, { type: 'page' }> | undefined;
  let hasLiveObject = false;

  while (i < input.attempts.length) {
    const attempt = input.attempts[i]!;
    if (HIDDEN_ACTIONS.has(attempt.actionName)) {
      i += 1;
      continue;
    }

    if (isSearchAttempt(attempt)) {
      const queries: StreamSearchQuery[] = [];
      while (i < input.attempts.length && input.attempts[i] && isSearchAttempt(input.attempts[i]!)) {
        const row = input.attempts[i]!;
        const live = isLive(row.state);
        if (live) hasLiveObject = true;
        const results = row.findings ?? [];
        searchHits.push(...results);
        queries.push({
          id: row.id,
          query: searchQueryFromAttempt(row),
          results,
          live,
        });
        i += 1;
      }
      if (queries.length > 0) {
        blocks.push({ type: 'search', id: queries[0]!.id, queries });
        lastPage = undefined;
      }
      continue;
    }

    if (
      attempt.actionName === 'go_to_url' ||
      attempt.actionName === 'open_tab' ||
      attempt.actionName === 'switch_tab' ||
      attempt.actionName === 'focus_tab'
    ) {
      const live = isLive(attempt.state);
      if (live) hasLiveObject = true;
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
        if (live) hasLiveObject = true;
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
      attempt.actionName === 'send_keys'
    ) {
      if (attempt.actionName === 'send_keys' && !isCommitAttempt(attempt)) {
        i += 1;
        continue;
      }
      const title = pageTitleFromAttempt(attempt, searchHits);
      const live = isLive(attempt.state);
      if (live) hasLiveObject = true;
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
      if (lastPage) {
        lastPage.page.live = live;
        lastPage.page.url = lastPage.page.url ?? pageUrlFromAttempt(attempt);
      } else {
        const block: WorkStreamBlock = {
          type: 'page',
          id: attempt.id,
          page: {
            id: attempt.id,
            title,
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

    i += 1;
  }

  if (blocks.length === 0 && input.pageLabel?.trim()) {
    blocks.push({
      type: 'page',
      id: 'bound-page',
      page: { id: 'bound-page', title: compact(input.pageLabel, 80), live: running },
    });
    if (running) hasLiveObject = true;
  }

  const lastPublic = [...blocks].reverse().find(block => block.type !== 'thinking');
  const lastPublicText =
    lastPublic?.type === 'page'
      ? lastPublic.page.title
      : lastPublic?.type === 'search'
        ? lastPublic.queries[lastPublic.queries.length - 1]?.query
        : lastPublic?.type === 'commit'
          ? lastPublic.commit.text
          : undefined;
  const thinking = thinkingText({
    status: input.status,
    currentSummary: input.currentSummary,
    hasLiveObject,
    lastPublicText,
  });
  if (thinking) {
    blocks.push({
      type: 'thinking',
      id: 'thinking',
      text: thinking,
      open: running,
    });
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
