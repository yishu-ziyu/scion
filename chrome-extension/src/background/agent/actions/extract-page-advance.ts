import { nodeLooksLikeNextPage } from './extract-next';

export type NextControlNode = {
  tagName?: string;
  attributes?: Record<string, string>;
  getAllTextTillNextClickableElement?: (maxDepth?: number) => string;
};

export type ExtractAdvancePage = {
  getState?: (useVision?: boolean) => Promise<{ selectorMap?: Map<number, NextControlNode> }>;
  getDomElementByIndex?: (index: number) => NextControlNode | undefined | null;
  clickElementNode?: (useVision: boolean, node: NextControlNode) => Promise<void>;
  waitForPageAndFramesLoad?: () => Promise<void>;
  isFileUploader?: (node: NextControlNode) => boolean;
};

function nodeTag(node: NextControlNode): string {
  return (node.tagName || '').toLowerCase();
}

function nodeText(node: NextControlNode): string {
  return node.getAllTextTillNextClickableElement?.(2) || '';
}

export function findNextPageControlIndex(selectorMap: Map<number, NextControlNode>): number | undefined {
  const entries = [...selectorMap.entries()].sort(([left], [right]) => left - right);
  for (const [index, node] of entries) {
    if (nodeLooksLikeNextPage(nodeTag(node), node.attributes || {}, nodeText(node))) return index;
  }
  return undefined;
}

async function settleAfterAdvance(page: ExtractAdvancePage): Promise<void> {
  if (typeof page.waitForPageAndFramesLoad === 'function') {
    await page.waitForPageAndFramesLoad();
    return;
  }
  await new Promise(resolve => setTimeout(resolve, 250));
}

export async function advanceExtractPage(page: ExtractAdvancePage, useVision = false): Promise<boolean> {
  if (typeof page.getState !== 'function' || typeof page.clickElementNode !== 'function') return false;
  try {
    const state = await page.getState(useVision);
    const selectorMap = state?.selectorMap;
    if (!selectorMap?.size) return false;
    const index = findNextPageControlIndex(selectorMap);
    if (index == null) return false;
    const node = page.getDomElementByIndex?.(index);
    if (!node || page.isFileUploader?.(node)) return false;
    await page.clickElementNode(useVision, node);
    await settleAfterAdvance(page);
    return true;
  } catch {
    return false;
  }
}
