import { describe, expect, it } from 'vitest';
import { repeatingListExtractSkill } from '../builtin/repeating-list-extract';
import { youtubeOpenFirstVideoSkill } from '../sites/youtube/open-first-video';
import { bilibiliOpenFirstVideoSkill } from '../sites/bilibili/open-first-video';
import { createSkillRuntime } from '../runtime';
import { createSkillRegistry } from '../registry';
import { extractStructuredRecords } from '../../actions/extract-content';
import { resolveIntent } from '../../../browser/kernel/resolve-intent';
import type { BrowserKernel, InteractiveElementDigest, ObservationFrame } from '../../../browser/kernel';
import type { SkillContext } from '../types';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function frame(url: string, title = 't'): ObservationFrame {
  return {
    frameId: 'f1',
    observedAt: 1,
    tab: { id: 1, url, title },
    pageRevision: 'r1',
    targetCount: 0,
    interactiveElements: [],
    text: url,
    signals: [],
  };
}

function ctx(partial: Partial<SkillContext>): SkillContext {
  return {
    kernel: { extract: async () => ({ ok: true, data: '' }) } as unknown as BrowserKernel,
    taskId: 't',
    roundId: 'r',
    signal: new AbortController().signal,
    trace: { record: () => undefined },
    instruction: '',
    hasAction: () => true,
    flags: { enableDeterministicYouTube: true, enableDeterministicBilibili: true, enableSkillRuntime: true },
    ...partial,
  };
}

describe('listed skills do not declare the task complete', () => {
  it('repeating-list-extract proposes extract_content', async () => {
    const result = await repeatingListExtractSkill.run(
      ctx({ instruction: 'Extract products to a CSV table with name, price, rating' }),
      {},
    );
    expect(result.decision.kind).toBe('action');
    if (result.decision.kind === 'action') {
      expect(result.decision.name).toBe('extract_content');
    }
  });

  it('YouTube skill continues when already on a watch page', async () => {
    const result = await youtubeOpenFirstVideoSkill.run(
      ctx({
        instruction: '打开第一个 YouTube 视频',
        frame: frame('https://www.youtube.com/watch?v=abc'),
      }),
      {},
    );
    expect(result.decision.kind).not.toBe('done');
  });

  it('Bilibili skill continues when already on a watch page', async () => {
    const result = await bilibiliOpenFirstVideoSkill.run(
      ctx({
        instruction: '打开b站第一个视频',
        frame: frame('https://www.bilibili.com/video/BV1kguq6YEN6/', '标题_哔哩哔哩_bilibili'),
      }),
      {},
    );
    expect(result.decision.kind).not.toBe('done');
  });
});

describe('skills off still leaves generic extract and query click', () => {
  it('does not handle when skill runtime is off', async () => {
    const runtime = createSkillRuntime({
      registry: createSkillRegistry([
        repeatingListExtractSkill,
        youtubeOpenFirstVideoSkill,
        bilibiliOpenFirstVideoSkill,
      ]),
      kernel: { extract: async () => ({ ok: true, data: '' }) } as unknown as BrowserKernel,
      taskId: 't',
      flags: { enableSkillRuntime: false },
      hasAction: () => true,
    });
    const result = await runtime.tryDecide({
      roundId: 'r',
      instruction: 'Extract products to a CSV table with name, price, rating',
      url: 'https://example.test/products',
      observationText: 'page',
      frame: null,
    });
    expect(result.handled).toBe(false);
    expect(result.fallbackUsed).toBe(true);
  });

  it('extract_content still reads a product table without the skill', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const html = readFileSync(join(here, '../../../../../test/fixtures/products.html'), 'utf8');
    const rows = extractStructuredRecords(html, ['name', 'price', 'rating']);
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it('query click still resolves the first video link', () => {
    const elements: InteractiveElementDigest[] = [
      { index: 1, tagName: 'a', text: 'Home' },
      { index: 2, tagName: 'a', text: 'Alpha plays tonight' },
      { index: 3, tagName: 'a', text: 'Beta concert replay' },
    ];
    const result = resolveIntent(elements, '第一个视频');
    expect(result.kind).toBe('match');
    if (result.kind === 'match') {
      expect(result.index).toBe(2);
    }
  });
});
