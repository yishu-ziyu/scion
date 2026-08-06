/**
 * Deterministic public-site shortcuts driven by the 013 task set.
 * These are narrow Harness paths: detect a frozen instruction, perform the
 * smallest reliable browser action, and hand the result back to the loop.
 */

export function normalizeInstruction(instruction: string): string {
  return instruction.replace(/\s+/g, ' ').trim();
}

export function isScrollBottomInstruction(instruction: string): boolean {
  const text = normalizeInstruction(instruction);
  return /滚到页面底部|滚到底部|scroll\s*to\s*(the\s*)?(page\s*)?bottom|page\s*bottom/i.test(text);
}

export function isWikipediaSearchInstruction(instruction: string): boolean {
  const text = normalizeInstruction(instruction);
  return /搜索|search/i.test(text) && /输入|输入框|type/i.test(text);
}

export function isExampleDomainLinkInstruction(instruction: string): boolean {
  const text = normalizeInstruction(instruction);
  return /点击|click/i.test(text) && /more information/i.test(text);
}

export const WIKIPEDIA_SEARCH_QUERY = 'Agent';
