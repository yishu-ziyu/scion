import type { DelegateResult } from './types';

export const SUMMARY_MAX_CHARS = 4_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function cap(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/** Worker → orchestrator: summary only. Never raw page bodies or element dumps. */
export function toDelegateResult(value: unknown): DelegateResult {
  const record = asRecord(value);
  const summary = cap(typeof record.summary === 'string' ? record.summary.trim() : '', SUMMARY_MAX_CHARS);
  const result: DelegateResult = {
    summary: summary || 'Done.',
    did_operate_browser: record.did_operate_browser === true,
  };
  if (typeof record.page_url === 'string' && /^https?:\/\//i.test(record.page_url)) {
    result.page_url = record.page_url.slice(0, 2_048);
  }
  return result;
}
