/** Observed download progress for download_state criteria (stub-safe). */
export type DownloadStateProbe = 'none' | 'started' | 'finished';

export interface DownloadProbeItem {
  startTime?: string;
  state?: string;
  referrer?: string;
  byExtensionId?: string;
}

export interface DownloadStatePrefer {
  referrer?: string;
  extensionId?: string;
}

function startedAt(item: DownloadProbeItem): number | undefined {
  const started = Date.parse(item.startTime || '');
  return Number.isFinite(started) ? started : undefined;
}

function itemMatchesPrefer(item: DownloadProbeItem, prefer: DownloadStatePrefer): boolean {
  if (prefer.extensionId && item.byExtensionId && item.byExtensionId === prefer.extensionId) return true;
  if (prefer.referrer && item.referrer) {
    return item.referrer === prefer.referrer || item.referrer.startsWith(prefer.referrer);
  }
  return false;
}

/** Classify Chrome download items started at or after `notBefore`. Pre-freeze leftovers do not count. */
export function downloadStateFromItems(
  items: readonly DownloadProbeItem[],
  notBefore: number,
  prefer?: DownloadStatePrefer,
): DownloadStateProbe {
  const eligible = items.filter(item => {
    const started = startedAt(item);
    return started !== undefined && started >= notBefore;
  });
  const preferred =
    prefer && (prefer.referrer || prefer.extensionId) ? eligible.filter(item => itemMatchesPrefer(item, prefer)) : [];
  const considered = preferred.length > 0 ? preferred : eligible;
  if (considered.some(item => item.state === 'complete')) return 'finished';
  if (considered.some(item => item.state === 'in_progress')) return 'started';
  return 'none';
}
