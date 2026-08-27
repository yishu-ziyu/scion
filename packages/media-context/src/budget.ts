import {
  contextBlockText,
  fitToContext,
  type ContextAnchor,
  type ContextBlock,
  type ContextBundle,
} from '@extension/context-engine';

/**
 * Fit a media bundle into a character budget using the context-engine budget
 * API, then drop anchors whose blocks were omitted and re-index the rest.
 */
export function fitBundleToBudget(bundle: ContextBundle, maxChars: number): ContextBundle {
  const fitted = fitToContext(bundle.blocks, maxChars);
  const mapping = mapBlockIndexes(bundle.blocks, fitted);
  const anchors = bundle.anchors
    .map(anchor => {
      const index = mapping.get(anchor.blockIndex);
      return index === undefined ? undefined : { ...anchor, blockIndex: index };
    })
    .filter((anchor): anchor is ContextAnchor => anchor !== undefined);
  return { ...bundle, blocks: fitted, anchors };
}

/** Alias kept for callers that think of fitting as trimming. */
export const trimBundleToBudget = fitBundleToBudget;

function mapBlockIndexes(original: readonly ContextBlock[], fitted: readonly ContextBlock[]): Map<number, number> {
  const mapping = new Map<number, number>();
  let cursor = 0;
  for (let fittedIndex = 0; fittedIndex < fitted.length; fittedIndex += 1) {
    const block = fitted[fittedIndex];
    if (block.type === 'paragraph' && block.omitted === true) continue;
    let matched = -1;
    for (let index = cursor; index < original.length; index += 1) {
      if (sameBlock(original[index], block)) {
        matched = index;
        break;
      }
    }
    if (matched >= 0) {
      mapping.set(matched, fittedIndex);
      cursor = matched + 1;
      continue;
    }
    // fitToContext truncates a list/table/heavy first block when nothing else fits.
    if (fittedIndex === 0 && original.length > 0 && contextBlockText(original[0]).startsWith(contextBlockText(block))) {
      mapping.set(0, fittedIndex);
      cursor = 1;
    }
  }
  return mapping;
}

function sameBlock(left: ContextBlock, right: ContextBlock): boolean {
  // fitToContext keeps original references for whole blocks; identity is
  // unambiguous even when two blocks share identical text.
  if (left === right) return true;
  return left.type === right.type && contextBlockText(left) === contextBlockText(right);
}
