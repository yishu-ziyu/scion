import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { id: 'test-extension' } },
  });
});

import Page from '../page';
import { sha256 } from '../../task/digest';

const candidate = (fingerprint: string, ordinal: number, area: number, state: 'playing' | 'paused') => ({
  fingerprint,
  ordinal,
  area,
  state,
});

describe('Page HTML media binding', () => {
  it('prefers the only currently playing visible candidate', async () => {
    const page = new Page(7, 'https://example.test/watch', 'Fixture');
    const evaluate = vi
      .fn()
      .mockResolvedValue([
        candidate('video|https://cdn.test/a.mp4|60|0', 0, 100, 'paused'),
        candidate('video|https://cdn.test/b.mp4|90|1', 1, 50, 'playing'),
      ]);
    (page as unknown as { _puppeteerPage: { evaluate: typeof evaluate } })._puppeteerPage = { evaluate };

    await expect(page.observeMedia()).resolves.toEqual({
      kind: 'bound',
      targetDigest: await sha256('video|https://cdn.test/b.mp4|90|1'),
      state: 'playing',
    });
  });

  it('fails closed when the largest visible candidates tie', async () => {
    const page = new Page(7, 'https://example.test/watch', 'Fixture');
    const evaluate = vi
      .fn()
      .mockResolvedValue([
        candidate('video|https://cdn.test/a.mp4|60|0', 0, 100, 'paused'),
        candidate('audio|https://cdn.test/b.mp3|90|1', 1, 100, 'paused'),
      ]);
    (page as unknown as { _puppeteerPage: { evaluate: typeof evaluate } })._puppeteerPage = { evaluate };

    await expect(page.observeMedia()).resolves.toEqual({ kind: 'ambiguous', candidateCount: 2 });
  });

  it('returns the observed state only after the selected element accepts control', async () => {
    const page = new Page(7, 'https://example.test/watch', 'Fixture');
    const before = candidate('video|https://cdn.test/a.mp4|60|0', 3, 100, 'paused');
    const after = { ...before, state: 'playing' as const };
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce([before])
      .mockResolvedValueOnce([before])
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce([after]);
    (page as unknown as { _puppeteerPage: { evaluate: typeof evaluate } })._puppeteerPage = { evaluate };
    const digest = await sha256(before.fingerprint);

    await expect(page.controlMedia('play', digest)).resolves.toEqual({
      kind: 'bound',
      targetDigest: digest,
      state: 'playing',
    });
    expect(evaluate.mock.calls[2]?.slice(1)).toEqual([3, 'play']);
  });

  it('binds media completion evidence to the selected digest', async () => {
    const page = new Page(7, 'https://example.test/watch', 'Fixture');
    const digest = await sha256('video|https://cdn.test/a.mp4|60|0');
    vi.spyOn(page, 'observeMedia').mockResolvedValue({ kind: 'bound', targetDigest: digest, state: 'paused' });

    await expect(
      page.observeCompletionCriteria([
        {
          id: 'media-state',
          kind: 'media_state',
          operator: 'equals',
          expected: 'paused',
          required: true,
          roundId: 'round-2',
          targetRefId: `media:${digest}`,
          baseline: 'playing',
          frozenAt: 100,
          notBefore: 100,
          timeoutMs: 10_000,
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        criterionId: 'media-state',
        roundId: 'round-2',
        targetRefId: `media:${digest}`,
        source: 'page',
        value: 'paused',
      }),
    ]);
  });
});
