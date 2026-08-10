/**
 * ObservationFrame builder (product/022).
 */
import type { PageState } from '../views';
import { wrapUntrustedContent } from '../../agent/messages/utils';
import { compactStateText } from '../../agent/context';
import { captureActionFrame } from '../../task/action-frame';
import type {
  InteractiveElementDigest,
  MediaObservation,
  ObservationFrame,
  ObserveOptions,
  ViewportState,
} from './types';

export interface ObservationBuildInput {
  browserState: PageState;
  /** Raw clickable elements string from DOM tree. */
  elementsText: string;
  media?: MediaObservation;
  viewport?: ViewportState;
  enrichment?: string;
  includeAttributes?: string[] | null;
  screenshotRef?: string;
}

let frameSeq = 0;

export function nextFrameId(): string {
  frameSeq += 1;
  return `frame-${Date.now().toString(36)}-${frameSeq}`;
}

export function digestInteractiveElements(state: PageState, limit = 80): InteractiveElementDigest[] {
  const out: InteractiveElementDigest[] = [];
  const entries = [...state.selectorMap.entries()].sort(([a], [b]) => a - b);
  for (const [index, node] of entries) {
    if (out.length >= limit) break;
    const text = (node.getAllTextTillNextClickableElement?.() || node.attributes?.['aria-label'] || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    out.push({
      index,
      tagName: node.tagName || undefined,
      text: text || undefined,
      type: node.attributes?.type,
      name: node.attributes?.name,
      id: node.attributes?.id,
      role: node.attributes?.role,
    });
  }
  return out;
}

export async function buildObservationFrame(input: ObservationBuildInput): Promise<ObservationFrame> {
  const frame = await captureActionFrame(input.browserState);
  const elementsText =
    input.elementsText !== '' ? wrapUntrustedContent(input.elementsText) : 'empty interactive list';
  const media = input.media ?? { kind: 'none' as const };
  let mediaLine = 'media: none';
  if (media.kind === 'bound') {
    mediaLine = `media: bound digest=${media.targetDigest ?? ''} state=${media.state ?? ''}`;
  } else if (media.kind === 'ambiguous') {
    mediaLine = `media: ambiguous count=${media.candidateCount ?? 0}`;
  }

  const text = compactStateText(
    [
      `Current tab: {id: ${input.browserState.tabId}, url: ${input.browserState.url}, title: ${input.browserState.title}}`,
      `Snapshot frame: ${frame.pageRevision} (${frame.targetCount} indexed targets)`,
      mediaLine,
      input.enrichment ?? '',
      `Interactive elements:\n${elementsText}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  return {
    frameId: nextFrameId(),
    observedAt: Date.now(),
    tab: {
      id: input.browserState.tabId,
      url: input.browserState.url,
      title: input.browserState.title,
    },
    pageRevision: frame.pageRevision,
    targetCount: frame.targetCount,
    interactiveElements: digestInteractiveElements(input.browserState),
    text,
    viewport: input.viewport,
    media,
    screenshotRef: input.screenshotRef,
    signals: input.enrichment ? [{ kind: 'enrichment', label: 'skill', detail: 'attached' }] : [],
    enrichment: input.enrichment,
  };
}

export function renderFullFrameText(frame: ObservationFrame): string {
  return frame.text;
}

export function renderContextForModel(input: {
  frame: ObservationFrame;
  diffText?: string;
  useDiff: boolean;
  forceFull?: boolean;
}): { rendered: string; mode: 'full' | 'diff' } {
  if (!input.useDiff || input.forceFull || !input.diffText) {
    return { rendered: input.frame.text, mode: 'full' };
  }
  // Diff mode: change summary + short relevant element list already inside diff text.
  const header = [
    `Current tab: {id: ${input.frame.tab.id}, url: ${input.frame.tab.url}, title: ${input.frame.tab.title}}`,
    `Snapshot frame: ${input.frame.pageRevision} (${input.frame.targetCount} indexed targets)`,
    input.frame.enrichment ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    rendered: compactStateText(`${header}\n\n${input.diffText}`),
    mode: 'diff',
  };
}

export type { ObserveOptions };
