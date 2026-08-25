/**
 * Observation Diff (product/022).
 * Pure functions — no Chrome APIs.
 */
import type { ElementDigest, InteractiveElementDigest, ObservationDiff, ObservationFrame } from './types';

function toDigest(el: InteractiveElementDigest): ElementDigest {
  return {
    index: el.index,
    tagName: el.tagName,
    text: el.text?.slice(0, 80),
  };
}

function elementKey(el: InteractiveElementDigest): string {
  return `${el.index}|${el.tagName ?? ''}|${(el.text ?? '').slice(0, 40)}`;
}

/**
 * Compute what changed between two observation frames.
 * Element identity reuses index + lightweight digest (no second selector system).
 */
export function computeObservationDiff(from: ObservationFrame, to: ObservationFrame): ObservationDiff {
  const urlChanged = from.tab.url !== to.tab.url;
  const titleChanged = from.tab.title !== to.tab.title;

  const beforeMap = new Map(from.interactiveElements.map(el => [el.index, el]));
  const afterMap = new Map(to.interactiveElements.map(el => [el.index, el]));

  const addedElements: ElementDigest[] = [];
  const removedElements: ElementDigest[] = [];
  const changedElements: ObservationDiff['changedElements'] = [];

  for (const [index, after] of afterMap) {
    const before = beforeMap.get(index);
    if (!before) {
      addedElements.push(toDigest(after));
      continue;
    }
    if (elementKey(before) !== elementKey(after)) {
      changedElements.push({ index, before: toDigest(before), after: toDigest(after) });
    }
  }
  for (const [index, before] of beforeMap) {
    if (!afterMap.has(index)) {
      removedElements.push(toDigest(before));
    }
  }

  let scrollDelta: number | undefined;
  if (from.viewport && to.viewport) {
    scrollDelta = to.viewport.scrollY - from.viewport.scrollY;
  }

  const mediaChange =
    JSON.stringify(from.media ?? null) !== JSON.stringify(to.media ?? null)
      ? { before: from.media, after: to.media }
      : undefined;

  const materialChange =
    urlChanged ||
    titleChanged ||
    addedElements.length > 0 ||
    removedElements.length > 0 ||
    changedElements.length > 0 ||
    (typeof scrollDelta === 'number' && Math.abs(scrollDelta) > 8) ||
    Boolean(mediaChange) ||
    from.pageRevision !== to.pageRevision;

  const text = renderDiffText({
    from,
    to,
    urlChanged,
    titleChanged,
    addedElements,
    removedElements,
    changedElements,
    scrollDelta,
    mediaChange,
    materialChange,
  });

  return {
    fromRevision: from.pageRevision,
    toRevision: to.pageRevision,
    urlChanged,
    titleChanged,
    addedElements,
    removedElements,
    changedElements,
    scrollDelta,
    mediaChange,
    materialChange,
    text,
  };
}

export function renderDiffText(input: {
  from: ObservationFrame;
  to: ObservationFrame;
  urlChanged: boolean;
  titleChanged: boolean;
  addedElements: ElementDigest[];
  removedElements: ElementDigest[];
  changedElements: ObservationDiff['changedElements'];
  scrollDelta?: number;
  mediaChange?: ObservationDiff['mediaChange'];
  materialChange: boolean;
}): string {
  const lines: string[] = [
    `ObservationDiff: ${input.from.pageRevision} → ${input.to.pageRevision}`,
    `material_change: ${input.materialChange}`,
  ];
  if (input.urlChanged) {
    lines.push(`url: ${input.from.tab.url} → ${input.to.tab.url}`);
  } else {
    lines.push(`url: (unchanged) ${input.to.tab.url}`);
  }
  if (input.titleChanged) {
    lines.push(`title: ${input.from.tab.title} → ${input.to.tab.title}`);
  }
  if (typeof input.scrollDelta === 'number' && input.scrollDelta !== 0) {
    lines.push(`scrollDelta: ${input.scrollDelta}`);
  }
  if (input.mediaChange) {
    lines.push(
      `media: ${input.mediaChange.before?.kind ?? 'none'}/${input.mediaChange.before?.state ?? '-'} → ${input.mediaChange.after?.kind ?? 'none'}/${input.mediaChange.after?.state ?? '-'}`,
    );
  }
  lines.push(
    `elements: +${input.addedElements.length} -${input.removedElements.length} ~${input.changedElements.length}`,
  );
  const sample = [
    ...input.addedElements.slice(0, 5).map(el => `+ [${el.index}] ${el.tagName ?? ''} ${el.text ?? ''}`.trim()),
    ...input.removedElements.slice(0, 3).map(el => `- [${el.index}] ${el.tagName ?? ''} ${el.text ?? ''}`.trim()),
    ...input.changedElements.slice(0, 5).map(el => `~ [${el.index}] ${el.after?.text ?? el.before?.text ?? ''}`.trim()),
  ];
  if (sample.length > 0) {
    lines.push('sample:');
    lines.push(...sample);
  }
  // Keep a short list of currently relevant interactive elements (not full page dump).
  const relevant = input.to.interactiveElements.slice(0, 24);
  if (relevant.length > 0) {
    lines.push('current relevant elements:');
    for (const el of relevant) {
      const bits = [`[${el.index}]`, el.tagName, el.type, el.text].filter(Boolean);
      lines.push(bits.join(' '));
    }
  }
  return lines.join('\n');
}

/** Metrics for Trace (privacy-safe aggregates only). */
export function diffMetrics(fullText: string, renderedText: string, diff: ObservationDiff) {
  return {
    observation_full_chars: fullText.length,
    observation_rendered_chars: renderedText.length,
    diff_chars: diff.text.length,
    material_change: diff.materialChange,
  };
}
