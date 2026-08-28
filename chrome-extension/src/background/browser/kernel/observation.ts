/**
 * ObservationFrame builder (product/022).
 */
import type { PageState } from '../views';
import { isSensitiveFormControl, observableFormValue, type FormControlDescriptor } from '../form-value';
import { capTextLength } from '../util';
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

type ObservedNode = PageState['selectorMap'] extends Map<number, infer Node> ? Node : never;

function formDescriptor(node: ObservedNode): FormControlDescriptor {
  const attrs = node.attributes || {};
  return {
    tagName: node.tagName,
    type: attrs.type,
    name: attrs.name,
    id: attrs.id,
    role: attrs.role,
    autocomplete: attrs.autocomplete,
    placeholder: attrs.placeholder,
    label: attrs.accname || attrs['aria-label'] || attrs.placeholder,
  };
}

function secretWording(node: ObservedNode): string {
  const fromValue = node.attributes?.value?.trim() ?? '';
  const fromText = (node.getAllTextTillNextClickableElement?.() || '').replace(/\s+/g, ' ').trim();
  return fromValue || fromText;
}

function redactSensitiveVisibleText(visibleText: string, state: PageState): string {
  let next = visibleText;
  for (const node of state.selectorMap.values()) {
    if (!isSensitiveFormControl(formDescriptor(node))) continue;
    const secret = secretWording(node);
    if (secret) next = next.split(secret).join('');
  }
  return next.replace(/\s+/g, ' ').trim();
}

export function digestInteractiveElements(state: PageState, limit = 80): InteractiveElementDigest[] {
  const out: InteractiveElementDigest[] = [];
  const entries = [...state.selectorMap.entries()].sort(([a], [b]) => a - b);
  for (const [index, node] of entries) {
    if (out.length >= limit) break;
    const attrs = node.attributes || {};
    const contentEditable = attrs.contenteditable === 'true' || attrs.contenteditable === '';
    const label = attrs.accname || attrs['aria-label'] || attrs.placeholder;
    const observedValue = observableFormValue(formDescriptor(node), attrs.value);
    const rawText = (node.getAllTextTillNextClickableElement?.() || attrs['aria-label'] || attrs.accname || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    const text = observedValue.valueRedacted ? (label || '').slice(0, 80) : rawText;
    out.push({
      index,
      tagName: node.tagName || undefined,
      text: text || undefined,
      ...optionalElementTitle(attrs),
      type: attrs.type,
      name: attrs.name,
      id: attrs.id,
      role: attrs.role,
      value: observedValue.value,
      valueRedacted: observedValue.valueRedacted,
      autocomplete: attrs.autocomplete,
      placeholder: attrs.placeholder,
      label,
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

function optionalElementTitle(attrs: Record<string, string>): { title?: string } {
  const title = `${attrs.title || attrs.alt || ''}`.replace(/\s+/g, ' ').trim();
  return title ? { title } : {};
}

function stripSerializedControlValues(elementsText: string, state: PageState): string {
  let safe = elementsText;
  for (const node of state.selectorMap.values()) {
    const raw = node.attributes?.value?.trim();
    if (raw) {
      safe = safe
        .replaceAll(`value=${raw}`, 'value=[shown in Form fields]')
        .replaceAll(`value=${capTextLength(raw, 15)}`, 'value=[shown in Form fields]');
    }
    if (!isSensitiveFormControl(formDescriptor(node))) continue;
    const secret = secretWording(node);
    if (secret) safe = safe.split(secret).join('[redacted]');
  }
  return safe;
}

function describeMedia(media: MediaObservation): string {
  if (media.kind === 'bound') return `media: bound digest=${media.targetDigest ?? ''} state=${media.state ?? ''}`;
  if (media.kind === 'ambiguous') return `media: ambiguous count=${media.candidateCount ?? 0}`;
  return 'media: none';
}

export async function buildObservationFrame(input: ObservationBuildInput): Promise<ObservationFrame> {
  const frame = await captureActionFrame(input.browserState);
  const media = input.media ?? { kind: 'none' as const };
  const mediaLine = describeMedia(media);

  const query = input.query?.trim() ?? '';
  const digested = digestInteractiveElements(input.browserState, query ? 2000 : 80);
  const interactiveElements = filterInteractiveElements(digested, query);
  const formDigest = digestInteractiveElements(input.browserState, 2000);
  const formFieldsBlock = renderFormFieldsBlock(query ? filterInteractiveElements(formDigest, query) : formDigest);
  const visibleText = redactSensitiveVisibleText(input.visibleText?.trim() ?? '', input.browserState);
  const visibleBlock = visibleText
    ? `Visible page text:\n${wrapUntrustedContent(visibleText)}`
    : 'Visible page text:\n[empty]';
  const keptIndexes = new Set(interactiveElements.map(element => element.index));
  const valueSafeElementsText = stripSerializedControlValues(input.elementsText, input.browserState);
  const elementsText = query ? filterElementsTextByIndexes(valueSafeElementsText, keptIndexes) : valueSafeElementsText;
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
  const inaccessible = input.browserState.inaccessibleIframes ?? [];
  const inaccessibleBlock =
    inaccessible.length > 0
      ? [
          'Inaccessible iframes (do not treat the form as complete):',
          ...inaccessible.map(item => `- ${item.targetId}${item.url ? ` ${item.url}` : ''} ${item.error}`.trim()),
        ].join('\n')
      : '';
  const text = compactStateText(
    [
      `Current tab: {id: ${input.browserState.tabId}, url: ${input.browserState.url}, title: ${input.browserState.title}}`,
      `Snapshot frame: ${frame.pageRevision} (${frame.targetCount} indexed targets)`,
      mediaLine,
      input.enrichment ?? '',
      inaccessibleBlock,
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
    formFieldsText: formFieldsBlock || undefined,
    visibleText: visibleText || undefined,
    text,
    viewport: input.viewport,
    media,
    screenshotRef: input.screenshotRef,
    signals: input.enrichment ? [{ kind: 'enrichment', label: 'skill', detail: 'attached' }] : [],
    enrichment: input.enrichment,
    inaccessibleIframes: inaccessible.length > 0 ? inaccessible : undefined,
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
  const visibleBlock = visibleText ? `Visible page text:\n${wrapUntrustedContent(visibleText)}` : '';
  const formFieldsBlock = input.frame.formFieldsText || renderFormFieldsBlock(input.frame.interactiveElements);
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
