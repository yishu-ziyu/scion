import { describe, expect, it } from 'vitest';
import { downloadStateFromItems } from '../download-state';

const notBefore = Date.UTC(2026, 0, 1, 12, 0, 0);

function item(startOffsetMs: number, state: string, extra: { referrer?: string; byExtensionId?: string } = {}) {
  return {
    startTime: new Date(notBefore + startOffsetMs).toISOString(),
    state,
    ...extra,
  };
}

describe('downloadStateFromItems', () => {
  it('treats leftover complete plus post-freeze in_progress as started, not finished', () => {
    expect(downloadStateFromItems([item(-120_000, 'complete'), item(1_000, 'in_progress')], notBefore)).toBe('started');
  });

  it('ignores a leftover complete download from before notBefore', () => {
    expect(downloadStateFromItems([item(-120_000, 'complete')], notBefore)).toBe('none');
  });

  it('does not treat in_progress as finished', () => {
    expect(downloadStateFromItems([item(1_000, 'in_progress')], notBefore)).toBe('started');
  });

  it('returns finished only for a complete item started at or after notBefore', () => {
    expect(downloadStateFromItems([item(0, 'complete')], notBefore)).toBe('finished');
    expect(downloadStateFromItems([item(-1, 'complete'), item(500, 'complete')], notBefore)).toBe('finished');
  });

  it('prefers post-freeze items from this extension or the task tab when those fields exist', () => {
    const leftover = item(-60_000, 'complete', { byExtensionId: 'this-ext' });
    const otherFinished = item(1_000, 'complete', { byExtensionId: 'other-ext' });
    const oursStarted = item(2_000, 'in_progress', { byExtensionId: 'this-ext' });
    expect(downloadStateFromItems([leftover, otherFinished, oursStarted], notBefore, { extensionId: 'this-ext' })).toBe(
      'started',
    );

    const tabStarted = item(3_000, 'in_progress', { referrer: 'https://watch.test/v/1' });
    const otherTabFinished = item(4_000, 'complete', { referrer: 'https://other.test/' });
    expect(
      downloadStateFromItems([otherTabFinished, tabStarted], notBefore, { referrer: 'https://watch.test/v/1' }),
    ).toBe('started');
  });
});
