/**
 * Open-ended lookup must use search_google, not an invented go_to_url.
 */
import { extractInstructionUrlOccurrences } from '../../instruction-language';
import { isSearchResultsUrl } from '../../browser/search-results';

const GENERIC_HOST_LABELS = new Set(['com', 'org', 'net', 'edu', 'gov', 'www', 'html', 'co', 'io']);

function instructionMentionsDestinationHost(instruction: string, url: string): boolean {
  try {
    const host = new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
    const lower = instruction.toLowerCase();
    if (lower.includes(host)) return true;
    const labels = host.split('.').filter(part => part.length >= 3 && !GENERIC_HOST_LABELS.has(part));
    return labels.some(part => lower.includes(part));
  } catch {
    return false;
  }
}

const LOOKUP_VERB = /搜一下|搜索一下|搜索|帮我搜|查一下|查一查|search\s+for|google\s+/i;

export function instructionNeedsWebSearch(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (extractInstructionUrlOccurrences(text).length > 0) return false;
  return LOOKUP_VERB.test(text);
}

export function lookupQueryFromInstruction(instruction: string): string {
  const stripped = instruction
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:请|帮我|麻烦你?)?(?:搜一下|搜索一下|搜索|查一下|查一查|search\s+for|google\s+|search\s+)\s*/i, '')
    .replace(/[。！？.!?]+$/g, '')
    .trim();
  return (stripped || instruction.replace(/\s+/g, ' ').trim()).slice(0, 120);
}

function navigationUrl(action: { name: string; args: Record<string, unknown> }): string | null {
  if (action.name !== 'go_to_url' && action.name !== 'open_tab') return null;
  const url = action.args.url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

export function rewriteInventedLookupNavigation(
  instruction: string,
  action: { name: string; args: Record<string, unknown> } | null,
): { name: string; args: Record<string, unknown> } | null {
  if (!action) return action;
  if (!instructionNeedsWebSearch(instruction)) return action;
  const url = navigationUrl(action);
  if (!url) return action;
  if (isSearchResultsUrl(url)) return action;
  if (instructionMentionsDestinationHost(instruction, url)) return action;
  return {
    name: 'search_google',
    args: {
      query: lookupQueryFromInstruction(instruction),
      intent: 'open-ended lookup',
    },
  };
}
