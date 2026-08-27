import {
  contextBlockCharacters,
  extractWebpageContext,
  fitToContext,
  safePageUrl,
  type ContextBlock,
  type ContextBundle,
} from '@extension/context-engine';

export const PAGE_CONTEXT_COLLECT = 'CHIJIE_COLLECT_PAGE_CONTEXT';
export const PAGE_CONTEXT_FRAME_PAYLOAD_LIMIT = 24_000;
const PAGE_CONTEXT_MIN_FRAME_PAYLOAD_LIMIT = 512;

export interface InaccessibleIframe {
  url?: string;
  error: string;
}

export interface CollectedPageContext {
  bundle: ContextBundle;
  truncated: boolean;
  inaccessibleIframes: InaccessibleIframe[];
}

/** Extract this frame locally and return only a bounded, structured context bundle. */
export function collectPageContext(
  current: Document = document,
  maxPayloadChars = PAGE_CONTEXT_FRAME_PAYLOAD_LIMIT,
): CollectedPageContext {
  const limit = normalizePayloadLimit(maxPayloadChars);
  const title = boundedField(current.title, Math.min(512, Math.floor(limit / 8)));
  const displayUrl = safePageUrl(current.URL);
  const url = boundedField(displayUrl, Math.min(2_048, Math.floor(limit / 4)));
  const extracted = extractWebpageContext(current.documentElement?.outerHTML ?? '', { title, url });
  const metadataTruncated = title.length < current.title.length || url.length < displayUrl.length;
  return fitFramePayload(extracted, metadataTruncated, limit);
}

function fitFramePayload(bundle: ContextBundle, metadataTruncated: boolean, limit: number): CollectedPageContext {
  const rawCharacters = bundle.blocks.reduce((sum, block) => sum + contextBlockCharacters(block), 0);
  const empty = framePayload(bundle, [], metadataTruncated || rawCharacters > 0);
  let blockBudget = Math.max(0, limit - JSON.stringify(empty).length - 32);
  let payload = framePayload(
    bundle,
    fitToContext(bundle.blocks, blockBudget),
    metadataTruncated || rawCharacters > blockBudget,
  );

  while (JSON.stringify(payload).length > limit && blockBudget > 0) {
    const overflow = JSON.stringify(payload).length - limit;
    blockBudget = Math.max(0, blockBudget - Math.max(16, overflow * 2));
    payload = framePayload(bundle, fitToContext(bundle.blocks, blockBudget), true);
  }
  if (JSON.stringify(payload).length <= limit) return payload;

  return framePayload({ ...bundle, title: '', url: '' }, [], true);
}

function framePayload(bundle: ContextBundle, blocks: ContextBlock[], truncated: boolean): CollectedPageContext {
  return {
    bundle: { ...bundle, blocks, anchors: [] },
    truncated,
    inaccessibleIframes: [],
  };
}

function normalizePayloadLimit(maxPayloadChars: number): number {
  const requested = Number.isFinite(maxPayloadChars) ? Math.floor(maxPayloadChars) : PAGE_CONTEXT_FRAME_PAYLOAD_LIMIT;
  return Math.min(PAGE_CONTEXT_FRAME_PAYLOAD_LIMIT, Math.max(PAGE_CONTEXT_MIN_FRAME_PAYLOAD_LIMIT, requested));
}

function boundedField(value: string, limit: number): string {
  return value.slice(0, Math.max(0, limit));
}
