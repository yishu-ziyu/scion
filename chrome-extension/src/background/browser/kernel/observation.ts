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
import { renderFormFieldsBlock } from './form-fields';
import { filterElementsTextByIndexes, filterInteractiveElements } from './filter-interactive';

export interface ObservationBuildInput {
  browserState: PageState;
  /** Raw clickable elements string from DOM tree. */
  elementsText: string;
  /** Visible document wording (innerText), already bounded. */
  visibleText?: string;
  media?: MediaObservation;
  viewport?: ViewportState;
  enrichment?: string;
  includeAttributes?: string[] | null;
  screenshotRef?: string;
  /** Keep only clickable controls matching this text. Empty = full page list. */
  query?: string;
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
    const attrs = node.attributes || {};
    const text = (node.getAllTextTillNextClickableElement?.() || attrs['aria-label'] || attrs.accname || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    const contentEditable = attrs.contenteditable === 'true' || attrs.contenteditable === '';
    out.push({
      index,
      tagName: node.tagName || undefined,
      text: text || undefined,
      type: attrs.type,
      name: attrs.name,
      id: attrs.id,
      role: attrs.role,
      value: attrs.value,
      placeholder: attrs.placeholder,
      label: attrs.accname || attrs['aria-label'] || attrs.placeholder,
      contentEditable: contentEditable || undefined,
      checked: attrs.checked,
      tabId: typeof node.tabId === 'number' ? node.tabId : state.tabId,
      cdpFrameId: node.cdpFrameId,
      backendNodeId: node.backendNodeId,
      cdpTargetId: node.cdpTargetId,
    });
  }
  return out;
}

export async function buildObservationFrame(input: ObservationBuildInput): Promise<ObservationFrame> {
  const frame = await captureActionFrame(input.browserState);
  const media = input.media ?? { kind: 'none' as const };
  let mediaLine = 'media: none';
  if (media.kind === 'bound') {
    mediaLine = `media: bound digest=${media.targetDigest ?? ''} state=${media.state ?? ''}`;
  } else if (media.kind === 'ambiguous') {
    mediaLine = `media: ambiguous count=${media.candidateCount ?? 0}`;
  }

  const query = input.query?.trim() ?? '';
  const digested = digestInteractiveElements(input.browserState, query ? 2000 : 80);
  const interactiveElements = filterInteractiveElements(digested, query);
  const formFieldsBlock = renderFormFieldsBlock(interactiveElements);
  const visibleText = input.visibleText?.trim() ?? '';
  const visibleBlock = visibleText
    ? `Visible page text:\n${wrapUntrustedContent(visibleText)}`
    : 'Visible page text:\n[empty]';
  const keptIndexes = new Set(interactiveElements.map(element => element.index));
  const elementsText = query ? filterElementsTextByIndexes(input.elementsText, keptIndexes) : input.elementsText;
  const elementsLabel = query
    ? `Interactive elements (query="${query}", ${interactiveElements.length} matches):`
    : 'Interactive elements:';
  const interactiveRaw = [formFieldsBlock, `${elementsLabel}\n${elementsText || 'empty interactive list'}`]
    .filter(Boolean)
    .join('\n');
  const interactiveBlock =
    elementsText !== '' || formFieldsBlock || Boolean(query)
      ? wrapUntrustedContent(interactiveRaw)
      : 'empty interactive list';
  const text = compactStateText(
    [
      `Current tab: {id: ${input.browserState.tabId}, url: ${input.browserState.url}, title: ${input.browserState.title}}`,
      `Snapshot frame: ${frame.pageRevision} (${frame.targetCount} indexed targets)`,
      mediaLine,
      input.enrichment ?? '',
      visibleBlock,
      interactiveBlock,
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
    interactiveElements,
    visibleText: visibleText || undefined,
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
  const visibleText = input.frame.visibleText?.trim() ?? '';
  const visibleBlock = visibleText
    ? `Visible page text:\n${wrapUntrustedContent(visibleText)}`
    : '';
  const formFieldsBlock = renderFormFieldsBlock(input.frame.interactiveElements);
  const header = [
    `Current tab: {id: ${input.frame.tab.id}, url: ${input.frame.tab.url}, title: ${input.frame.tab.title}}`,
    `Snapshot frame: ${input.frame.pageRevision} (${input.frame.targetCount} indexed targets)`,
    input.frame.enrichment ?? '',
    visibleBlock,
    formFieldsBlock ? wrapUntrustedContent(formFieldsBlock) : '',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    rendered: compactStateText(`${header}\n\n${input.diffText}`),
    mode: 'diff',
  };
}

export type { ObserveOptions };
