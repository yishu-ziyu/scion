import type { PageState } from '../browser/views';
import { sha256 } from './digest';
import { makePageRevision } from './page-state';

export interface ActionFrame {
  pageRevision: string;
  targetCount: number;
}

/**
 * Immutable identity for one interactive-page observation.
 *
 * Element indexes are only meaningful inside this frame. The digest deliberately
 * uses the already-captured selector map instead of reading the live DOM again, so
 * the model prompt and the action dispatcher bind to the same observation.
 */
export async function captureActionFrame(
  state: Pick<PageState, 'tabId' | 'url' | 'selectorMap'>,
  liveUrl = state.url,
): Promise<ActionFrame> {
  const targets = await Promise.all(
    [...state.selectorMap.entries()]
      .sort(([left], [right]) => left - right)
      .map(async ([index, node]) => {
        const hash = await node.hash();
        const textDigest = await sha256(node.getAllTextTillNextClickableElement());
        return [index, hash.branchPathHash, hash.attributesHash, hash.xpathHash, textDigest] as const;
      }),
  );
  const snapshotDigest = await sha256(JSON.stringify({ url: liveUrl, targets }));
  let urlOrigin = 'null';
  try {
    urlOrigin = new URL(liveUrl).origin;
  } catch {
    // Keep a deterministic redacted origin for non-URL pages.
  }
  return {
    pageRevision: makePageRevision({
      tabId: state.tabId,
      urlOrigin,
      snapshotDigest,
    }),
    targetCount: targets.length,
  };
}

/** Bind index-based actions to the observation that supplied that index. */
export function bindIndexedActionToFrame(
  args: Record<string, unknown>,
  pageRevision: string | null,
): Record<string, unknown> {
  if (!pageRevision || typeof args.index !== 'number' || !Number.isFinite(args.index)) return args;
  return { ...args, page_revision: pageRevision };
}
