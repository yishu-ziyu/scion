import { bindTabForTask, type BoundContentTab } from './active-tab-bind';

/** Resolve the content tab associated with this side-panel window without activating it. */
export async function resolveActiveContentTab(
  options: { allowLastFocused?: boolean } = {},
): Promise<BoundContentTab | null> {
  const attempts: chrome.tabs.QueryInfo[] = [{ currentWindow: true }];
  if (options.allowLastFocused !== false) attempts.push({ lastFocusedWindow: true });
  for (const query of attempts) {
    try {
      const bound = bindTabForTask(await chrome.tabs.query(query));
      if (bound) return bound;
    } catch {
      // Try the fallback query without changing tab focus.
    }
  }
  return null;
}
