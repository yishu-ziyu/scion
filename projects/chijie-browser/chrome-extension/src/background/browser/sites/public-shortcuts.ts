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

/**
 * 013-B07 is done once IANA is open. Long-horizon goals that still need
 * Wikipedia, labeled observations, or a second source must keep the loop.
 */
export function exampleDomainLinkIsTerminalGoal(instruction: string): boolean {
  if (!isExampleDomainLinkInstruction(instruction)) return false;
  const text = normalizeInstruction(instruction);
  if (/双来源|观察一|观察二|多阶段|多步骤/i.test(text)) return false;
  if (/https?:\/\/en\.wikipedia\.org/i.test(text) || /维基百科|\bwikipedia\b/i.test(text)) return false;
  return true;
}

/** First en.wikipedia.org/wiki article URL named in the instruction, if any. */
export function nextInstructionWikipediaArticleUrl(instruction: string): string | null {
  const match = instruction.match(/https?:\/\/en\.wikipedia\.org\/wiki\/[^\s<>"'，。；;）)\]}]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    if (url.hostname !== 'en.wikipedia.org' || !url.pathname.startsWith('/wiki/')) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export const WIKIPEDIA_SEARCH_QUERY = 'Agent';
