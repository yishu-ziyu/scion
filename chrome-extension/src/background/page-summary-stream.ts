import { pageSummaryRecipe, runRecipe } from '@extension/agent-core';
import {
  contextBlockCharacters,
  contextBlockText,
  extractWebpageContext,
  fitToContext,
  safePageUrl,
  type ContextBlock,
  type ContextBundle,
} from '@extension/context-engine';
import {
  CHAT_STREAM_UNBOUND_ERROR,
  productionChatStreamDeps,
  resolveChatRuntime,
  type ChatStreamDeps,
} from './chat-stream';
import { ingestPageBundle } from './wisebase-runtime';

export const PAGE_CONTEXT_COLLECT = 'CHIJIE_COLLECT_PAGE_CONTEXT';
export const PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT = 24_000;
export const PAGE_CONTEXT_MAX_FRAMES = 24;
export const PAGE_SUMMARY_FEATURE_ID = 'page_summary';
export const PAGE_SUMMARY_CONTEXT_LIMIT = 24_000;
export const PAGE_NOT_WEB_ERROR = '无法读取当前页面。请打开普通网页后再试。';

const RESTRICTED_PAGE_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'devtools://',
  'view-source:',
  'chrome-search://',
  'chrome-error://',
];

export interface InaccessibleIframe {
  url?: string;
  error: string;
}

export interface CollectedPageContext {
  bundle: ContextBundle;
  truncated: boolean;
  omittedFrameCount?: number;
  inaccessibleIframes: InaccessibleIframe[];
}

export interface PageSummaryStreamRequest {
  sessionId: string;
  text: string;
  tabId: number;
}

export interface PageSummarySource {
  title: string;
  url: string;
  tabId: number;
}

export type PageSummaryStreamEvent =
  | { type: 'page_summary_stream_source'; sessionId: string; source: PageSummarySource }
  | { type: 'page_summary_stream_delta'; sessionId: string; text: string }
  | { type: 'page_summary_stream_done'; sessionId: string }
  | { type: 'page_summary_stream_error'; sessionId: string; error: string };

export interface PageSummaryStreamPort {
  postMessage: (message: PageSummaryStreamEvent) => void;
}

export interface PageSummaryStreamDeps extends ChatStreamDeps {
  collectPageContext: (tabId: number) => Promise<unknown>;
  ingestPageContext?: (bundle: ContextBundle) => Promise<void>;
}

export interface PageContextFrame {
  frameId: number;
  url?: string;
}

export interface PageContextTabApi {
  getFrames: (tabId: number) => Promise<PageContextFrame[]>;
  sendToFrame: (tabId: number, frameId: number, maxPayloadChars: number) => Promise<unknown>;
  getTab?: (tabId: number) => Promise<{ url?: string; title?: string }>;
  readFrameHtml?: (
    tabId: number,
    frameId: number,
  ) => Promise<{ title?: string; url?: string; html?: string } | null>;
}

export function parsePageSummaryStreamRequest(message: unknown): PageSummaryStreamRequest | null {
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  if (record.type !== 'page_summary_stream') return null;
  if (typeof record.sessionId !== 'string' || !record.sessionId) return null;
  if (typeof record.text !== 'string' || !record.text.trim()) return null;
  if (!Number.isSafeInteger(record.tabId) || (record.tabId as number) < 0) return null;
  return { sessionId: record.sessionId, text: record.text, tabId: record.tabId as number };
}

export function parseCollectedPageContext(
  input: unknown,
  maxPayloadChars = PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT,
): CollectedPageContext | null {
  if (!input || typeof input !== 'object') return null;
  if (serializedPayloadCharacters(input) > boundedPayloadLimit(maxPayloadChars)) return null;
  const record = input as Record<string, unknown>;
  const bundle = parseContextBundle(record.bundle);
  const inaccessibleIframes = parseInaccessibleIframes(record.inaccessibleIframes);
  if (!bundle || !inaccessibleIframes || typeof record.truncated !== 'boolean') return null;
  if (
    record.omittedFrameCount !== undefined &&
    (!Number.isSafeInteger(record.omittedFrameCount) || (record.omittedFrameCount as number) < 0)
  ) {
    return null;
  }
  return {
    bundle,
    truncated: record.truncated,
    ...(record.omittedFrameCount === undefined ? {} : { omittedFrameCount: record.omittedFrameCount as number }),
    inaccessibleIframes,
  };
}

function parseContextBundle(input: unknown): ContextBundle | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  if (
    record.sourceType !== 'webpage' ||
    typeof record.title !== 'string' ||
    typeof record.url !== 'string' ||
    !Array.isArray(record.blocks) ||
    !Array.isArray(record.anchors) ||
    record.anchors.length > 0 ||
    record.trustLevel !== 'untrusted'
  ) {
    return null;
  }
  const blocks: ContextBlock[] = [];
  for (const inputBlock of record.blocks) {
    const block = parseContextBlock(inputBlock);
    if (!block) return null;
    blocks.push(block);
  }
  return {
    sourceType: 'webpage',
    title: record.title,
    url: safePageUrl(record.url),
    blocks,
    anchors: [],
    trustLevel: 'untrusted',
  };
}

function parseContextBlock(input: unknown): ContextBlock | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  switch (record.type) {
    case 'heading':
      return parseHeadingBlock(record);
    case 'paragraph':
      return parseParagraphBlock(record);
    case 'list':
      return parseListBlock(record);
    case 'table':
      return parseTableBlock(record);
    case 'link':
      return parseLinkBlock(record);
    default:
      return null;
  }
}

function parseHeadingBlock(record: Record<string, unknown>): ContextBlock | null {
  if (
    typeof record.text !== 'string' ||
    !Number.isInteger(record.level) ||
    (record.level as number) < 1 ||
    (record.level as number) > 6
  ) {
    return null;
  }
  return { type: 'heading', level: record.level as 1 | 2 | 3 | 4 | 5 | 6, text: record.text };
}

function parseParagraphBlock(record: Record<string, unknown>): ContextBlock | null {
  if (typeof record.text !== 'string' || (record.omitted !== undefined && record.omitted !== true)) return null;
  return { type: 'paragraph', text: record.text, ...(record.omitted === true ? { omitted: true } : {}) };
}

function parseListBlock(record: Record<string, unknown>): ContextBlock | null {
  if (typeof record.ordered !== 'boolean' || !isStringArray(record.items)) return null;
  return { type: 'list', ordered: record.ordered, items: record.items };
}

function parseTableBlock(record: Record<string, unknown>): ContextBlock | null {
  if (!Array.isArray(record.rows) || !record.rows.every(isStringArray)) return null;
  return { type: 'table', rows: record.rows };
}

function parseLinkBlock(record: Record<string, unknown>): ContextBlock | null {
  if (typeof record.text !== 'string' || typeof record.href !== 'string') return null;
  return { type: 'link', text: record.text, href: record.href };
}

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every(item => typeof item === 'string');
}

function parseInaccessibleIframes(input: unknown): InaccessibleIframe[] | null {
  if (!Array.isArray(input) || input.length > PAGE_CONTEXT_MAX_FRAMES) return null;
  const frames: InaccessibleIframe[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') return null;
    const frame = item as Record<string, unknown>;
    if (typeof frame.error !== 'string') return null;
    if (frame.url !== undefined && typeof frame.url !== 'string') return null;
    const frameUrl = typeof frame.url === 'string' ? safePageUrl(frame.url) : '';
    frames.push({ ...(frameUrl ? { url: frameUrl } : {}), error: frame.error });
  }
  return frames;
}

function serializedPayloadCharacters(input: unknown): number {
  try {
    return JSON.stringify(input)?.length ?? Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundedPayloadLimit(requested: number): number {
  if (!Number.isFinite(requested)) return PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT;
  return Math.min(PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT, Math.max(0, Math.floor(requested)));
}

function serializeBlocks(blocks: readonly ContextBlock[]): string {
  return blocks
    .map(block => {
      if (block.type === 'heading') return `${'#'.repeat(block.level)} ${block.text}`;
      if (block.type === 'list') {
        return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`).join('\n');
      }
      return contextBlockText(block);
    })
    .filter(Boolean)
    .join('\n\n');
}

export function preparePageSummaryContext(
  collected: CollectedPageContext,
  maxChars = PAGE_SUMMARY_CONTEXT_LIMIT,
): { bundle: ContextBundle; page: { title: string; url: string; text: string } } {
  const limit = Number.isFinite(maxChars)
    ? Math.min(PAGE_SUMMARY_CONTEXT_LIMIT, Math.max(0, Math.floor(maxChars)))
    : PAGE_SUMMARY_CONTEXT_LIMIT;
  const fullText = serializeBlocks(collected.bundle.blocks);
  const wasTruncated = collected.truncated || fullText.length > limit;
  const omitted = collected.omittedFrameCount ?? 0;
  const signal = wasTruncated
    ? `[Page source truncated to the collection limit${omitted > 0 ? `; ${omitted} additional iframe(s) omitted` : ''}.]`
    : '';
  const bodyLimit = Math.max(0, limit - (signal ? signal.length + 2 : 0));
  const blocks = fitToContext(collected.bundle.blocks, bodyLimit);
  const body = serializeBlocks(blocks).slice(0, bodyLimit).trim();
  const text = body ? `${body}${signal ? `\n\n${signal}` : ''}`.slice(0, limit) : '';
  const url = safePageUrl(collected.bundle.url);
  const bundle = { ...collected.bundle, blocks, anchors: [], url };
  return { bundle, page: { title: bundle.title, url, text } };
}

function inaccessibleIframeError(frames: readonly InaccessibleIframe[]): string {
  const sources = frames
    .slice(0, 3)
    .map(frame => frame.url || frame.error)
    .filter(Boolean)
    .join('、');
  return `无法完整读取页面：有 ${frames.length} 个 iframe 无法访问${sources ? `（${sources}）` : ''}。未生成摘要。`;
}

function postError(port: PageSummaryStreamPort, sessionId: string, error: string): void {
  try {
    port.postMessage({ type: 'page_summary_stream_error', sessionId, error });
  } catch {
    // The side panel closed while the page was being read.
  }
}

type ResolvedPageRuntime = Extract<NonNullable<Awaited<ReturnType<typeof resolveChatRuntime>>>, { ok: true }>;
type PreparedPage = ReturnType<typeof preparePageSummaryContext>['page'];

async function streamResolvedPageSummary(
  request: PageSummaryStreamRequest,
  page: PreparedPage,
  result: ResolvedPageRuntime,
  port: PageSummaryStreamPort,
): Promise<void> {
  const { sessionId, text, tabId } = request;
  const post = (message: PageSummaryStreamEvent): boolean => {
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  };
  const source: PageSummarySource = { title: page.title, url: page.url, tabId };
  if (!post({ type: 'page_summary_stream_source', sessionId, source })) return;

  let finished = false;
  const messages = [{ role: 'user' as const, content: text }];
  for await (const event of runRecipe(pageSummaryRecipe, {
    runtime: result.runtime,
    model: result.model,
    messages,
    page,
  })) {
    if (event.type === 'token') {
      if (!post({ type: 'page_summary_stream_delta', sessionId, text: event.text })) return;
    } else if (event.type === 'done') {
      post({ type: 'page_summary_stream_done', sessionId });
      finished = true;
    } else {
      post({ type: 'page_summary_stream_error', sessionId, error: event.text });
      finished = true;
    }
  }
  if (!finished) post({ type: 'page_summary_stream_done', sessionId });
}

export function createPageSummaryStreamHandler(deps: PageSummaryStreamDeps) {
  return async function handlePageSummaryStream(
    request: PageSummaryStreamRequest,
    port: PageSummaryStreamPort,
  ): Promise<void> {
    const { sessionId, text, tabId } = request;
    let collected: CollectedPageContext | null;
    try {
      collected = parseCollectedPageContext(await deps.collectPageContext(tabId));
    } catch (error) {
      postError(port, sessionId, collectionError(error));
      return;
    }
    if (!collected) {
      postError(port, sessionId, PAGE_NOT_WEB_ERROR);
      return;
    }
    if (collected.inaccessibleIframes.length > 0) {
      postError(port, sessionId, inaccessibleIframeError(collected.inaccessibleIframes));
      return;
    }

    let prepared: ReturnType<typeof preparePageSummaryContext>;
    try {
      prepared = preparePageSummaryContext(collected);
    } catch (error) {
      postError(port, sessionId, `无法总结当前页面：${collectionError(error)}`);
      return;
    }
    if (!prepared.page.text.trim()) {
      postError(port, sessionId, '当前页面没有可总结的正文。');
      return;
    }
    await rememberCollectedPage(deps.ingestPageContext, prepared.bundle);

    let result: Awaited<ReturnType<typeof resolveChatRuntime>>;
    try {
      result = await resolveChatRuntime(deps, PAGE_SUMMARY_FEATURE_ID);
    } catch (error) {
      postError(port, sessionId, `无法总结当前页面：${collectionError(error)}`);
      return;
    }
    if (!result?.ok) {
      const error =
        result?.reason === 'missing_api_key'
          ? `chat 模型缺少 API key（${result.provider.id}）`
          : CHAT_STREAM_UNBOUND_ERROR;
      postError(port, sessionId, error);
      return;
    }

    await streamResolvedPageSummary({ sessionId, text, tabId }, prepared.page, result, port);
  };
}

async function rememberCollectedPage(
  ingest: PageSummaryStreamDeps['ingestPageContext'],
  bundle: ContextBundle,
): Promise<void> {
  if (!ingest) return;
  try {
    await ingest(bundle);
  } catch {
    // summarizing still proceeds if local save fails
  }
}

const chromePageContextApi: PageContextTabApi = {
  getFrames: async tabId => (await chrome.webNavigation.getAllFrames({ tabId })) ?? [],
  sendToFrame: (tabId, frameId, maxPayloadChars) =>
    chrome.tabs.sendMessage(tabId, { type: PAGE_CONTEXT_COLLECT, maxPayloadChars }, { frameId }),
  getTab: async tabId => {
    const tab = await chrome.tabs.get(tabId);
    return { url: tab.url, title: tab.title };
  },
  readFrameHtml: readFrameHtmlViaScripting,
};

async function readFrameHtmlViaScripting(
  tabId: number,
  frameId: number,
): Promise<{ title: string; url: string; html: string } | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: () => ({
      title: document.title || '',
      url: document.URL || '',
      html: document.documentElement?.outerHTML || '',
    }),
  });
  const result = results[0]?.result;
  if (!result || typeof result !== 'object') return null;
  const record = result as { title?: unknown; url?: unknown; html?: unknown };
  if (typeof record.html !== 'string') return null;
  return {
    title: typeof record.title === 'string' ? record.title : '',
    url: typeof record.url === 'string' ? record.url : '',
    html: record.html,
  };
}

export function isRestrictedPageUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false;
  return RESTRICTED_PAGE_PREFIXES.some(prefix => url.trim().startsWith(prefix));
}

function collectionError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'content script did not respond';
}

type PageContextFrameOutcome =
  | { frame: PageContextFrame; context: CollectedPageContext }
  | { frame: PageContextFrame; error: string };

function collectedFromHtml(html: string, title: string, url: string): CollectedPageContext {
  const bundle = extractWebpageContext(html, { title, url: safePageUrl(url) });
  return {
    bundle: { ...bundle, url: safePageUrl(bundle.url || url), anchors: [] },
    truncated: false,
    inaccessibleIframes: [],
  };
}

async function contextFromHtmlFallback(
  tabId: number,
  frame: PageContextFrame,
  api: PageContextTabApi,
): Promise<CollectedPageContext | null> {
  if (!api.readFrameHtml) return null;
  try {
    const raw = await api.readFrameHtml(tabId, frame.frameId);
    if (!raw || typeof raw.html !== 'string' || !raw.html.trim()) return null;
    return collectedFromHtml(raw.html, raw.title ?? '', raw.url ?? frame.url ?? '');
  } catch {
    return null;
  }
}

async function readOneFrame(
  tabId: number,
  frame: PageContextFrame,
  maxPayloadChars: number,
  api: PageContextTabApi,
): Promise<PageContextFrameOutcome> {
  let sendError = 'invalid or oversized page context response';
  try {
    const response = await api.sendToFrame(tabId, frame.frameId, maxPayloadChars);
    const context = parseCollectedPageContext(response, maxPayloadChars);
    if (context) return { frame, context };
  } catch (error) {
    sendError = collectionError(error);
  }
  if (frame.frameId === 0) {
    const scripted = await contextFromHtmlFallback(tabId, frame, api);
    if (scripted) return { frame, context: scripted };
  }
  return { frame, error: sendError };
}

/** Read a bounded set of frames in the background without activating the tab. */
export async function collectPageContextFromTab(
  tabId: number,
  api: PageContextTabApi = chromePageContextApi,
): Promise<CollectedPageContext | null> {
  const tab = api.getTab ? await api.getTab(tabId).catch(() => undefined) : undefined;
  if (isRestrictedPageUrl(tab?.url)) return null;

  const discovered = await api.getFrames(tabId);
  const frames = (discovered.length > 0 ? discovered : [{ frameId: 0 }]).sort(
    (left, right) => left.frameId - right.frameId,
  );
  const admitted = frames.slice(0, PAGE_CONTEXT_MAX_FRAMES);
  const budgets = allocateFramePayloadBudgets(admitted.length);
  const outcomes = await Promise.all(
    admitted.map((frame, index) => readOneFrame(tabId, frame, budgets[index], api)),
  );
  const top = outcomes.find(outcome => outcome.frame.frameId === 0);
  if (!top || !('context' in top)) {
    if (isRestrictedPageUrl(top?.frame.url ?? tab?.url)) return null;
    throw new Error(top && 'error' in top ? top.error : 'content script did not respond');
  }

  const readable = outcomes.flatMap(outcome => ('context' in outcome ? [outcome.context] : []));
  const inaccessibleIframes = outcomes.flatMap(outcome =>
    'context' in outcome
      ? outcome.context.inaccessibleIframes
      : [
          {
            ...(safePageUrl(outcome.frame.url) ? { url: safePageUrl(outcome.frame.url) } : {}),
            error: outcome.error,
          },
        ],
  );
  const omittedFrameCount =
    frames.length - admitted.length + readable.reduce((sum, context) => sum + (context.omittedFrameCount ?? 0), 0);
  const mergedBundle: ContextBundle = {
    ...top.context.bundle,
    blocks: readable.flatMap(context => context.bundle.blocks),
    anchors: [],
  };
  return fitCollectedPagePayload(
    mergedBundle,
    inaccessibleIframes,
    omittedFrameCount > 0 || readable.some(context => context.truncated),
    omittedFrameCount,
  );
}

function allocateFramePayloadBudgets(frameCount: number): number[] {
  if (frameCount <= 0) return [];
  if (frameCount === 1) return [PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT];
  const topFrameBudget = Math.floor(PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT / 2);
  const childCount = frameCount - 1;
  const childTotal = PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT - topFrameBudget;
  const childBase = Math.floor(childTotal / childCount);
  const remainder = childTotal - childBase * childCount;
  return [topFrameBudget, ...Array.from({ length: childCount }, (_, index) => childBase + (index < remainder ? 1 : 0))];
}

function fitCollectedPagePayload(
  bundle: ContextBundle,
  inaccessibleIframes: readonly InaccessibleIframe[],
  alreadyTruncated: boolean,
  omittedFrameCount: number,
): CollectedPageContext {
  const title = bundle.title.slice(0, 512);
  const url = safePageUrl(bundle.url).slice(0, 2_048);
  const frames = inaccessibleIframes.slice(0, PAGE_CONTEXT_MAX_FRAMES).map(frame => {
    const frameUrl = safePageUrl(frame.url).slice(0, 256);
    return {
      ...(frameUrl ? { url: frameUrl } : {}),
      error: frame.error.slice(0, 256),
    };
  });
  const metadataTruncated =
    title.length < bundle.title.length ||
    url.length < bundle.url.length ||
    frames.length < inaccessibleIframes.length ||
    frames.some(
      (frame, index) =>
        frame.url !== inaccessibleIframes[index]?.url || frame.error !== inaccessibleIframes[index]?.error,
    );
  const boundedBundle = { ...bundle, title, url, anchors: [] };
  const rawCharacters = bundle.blocks.reduce((sum, block) => sum + contextBlockCharacters(block), 0);
  const makePayload = (blocks: ContextBlock[], truncated: boolean): CollectedPageContext => ({
    bundle: { ...boundedBundle, blocks },
    truncated,
    omittedFrameCount,
    inaccessibleIframes: frames,
  });
  const base = makePayload([], alreadyTruncated || metadataTruncated || rawCharacters > 0);
  let blockBudget = Math.max(0, PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT - serializedPayloadCharacters(base) - 32);
  let payload = makePayload(
    fitToContext(bundle.blocks, blockBudget),
    alreadyTruncated || metadataTruncated || rawCharacters > blockBudget,
  );
  while (serializedPayloadCharacters(payload) > PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT && blockBudget > 0) {
    const overflow = serializedPayloadCharacters(payload) - PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT;
    blockBudget = Math.max(0, blockBudget - Math.max(16, overflow * 2));
    payload = makePayload(fitToContext(bundle.blocks, blockBudget), true);
  }
  if (serializedPayloadCharacters(payload) <= PAGE_CONTEXT_TOTAL_PAYLOAD_LIMIT) return payload;
  return makePayload([], true);
}

const productionPageSummaryDeps: PageSummaryStreamDeps = {
  ...productionChatStreamDeps,
  collectPageContext: collectPageContextFromTab,
  ingestPageContext: async bundle => {
    await ingestPageBundle(bundle);
  },
};

export const handlePageSummaryStream = createPageSummaryStreamHandler(productionPageSummaryDeps);

export async function handlePageSummaryStreamRequest(message: unknown, port: PageSummaryStreamPort): Promise<void> {
  const request = parsePageSummaryStreamRequest(message);
  if (!request) {
    postError(port, '', 'invalid page_summary_stream message');
    return;
  }
  await handlePageSummaryStream(request, port);
}
