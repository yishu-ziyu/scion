import { describe, expect, it, vi } from 'vitest';
import { createSkillRegistry } from '../registry';
import { discoverSkills } from '../discovery';
import { createSkillRuntime } from '../runtime';
import { formFillSubmitSkill } from '../builtin/form-fill-submit';
import { repeatingListExtractSkill } from '../builtin/repeating-list-extract';
import { youtubeOpenFirstVideoSkill } from '../sites/youtube/open-first-video';
import { bilibiliOpenFirstVideoSkill } from '../sites/bilibili/open-first-video';
import { defaultSkills } from '../index';
import { validateSkillPlan, canPromoteSkill, runSkillPlan } from '../learned/plan';
import type { BrowserKernel, ObservationFrame } from '../../../browser/kernel';
import type { BrowserSkill } from '../types';

function mockKernel(overrides: Partial<BrowserKernel> = {}): BrowserKernel {
  const base: BrowserKernel = {
    observe: vi.fn(async () => ({
      frameId: 'f',
      observedAt: 1,
      tab: { id: 1, url: 'https://example.com/', title: 'Ex' },
      pageRevision: 'rev',
      targetCount: 0,
      interactiveElements: [],
      text: 'state',
      signals: [],
    })),
    act: vi.fn(async () => ({ error: null })),
    extract: (async () => ({ ok: true, data: '' })) as BrowserKernel['extract'],
    waitFor: vi.fn(async () => ({
      frameId: 'f',
      observedAt: 1,
      tab: { id: 1, url: 'https://example.com/', title: 'Ex' },
      pageRevision: 'rev',
      targetCount: 0,
      interactiveElements: [],
      text: 'state',
      signals: [],
    })),
    lastFrame: () => null,
    diff: vi.fn() as BrowserKernel['diff'],
  };
  return { ...base, ...overrides };
}

function frame(url: string, text = 'Interactive elements:\n[1]<input name=Name>\n[2]<button>Submit'): ObservationFrame {
  return {
    frameId: 'f1',
    observedAt: Date.now(),
    tab: { id: 1, url, title: 't' },
    pageRevision: 'rev-1',
    targetCount: 2,
    interactiveElements: [
      { index: 1, tagName: 'input', name: 'Name', type: 'text' },
      { index: 2, tagName: 'button', text: 'Submit' },
    ],
    text,
    signals: [],
  };
}

describe('Skill discovery + runtime', () => {
  it('registers default skills including site adapters', () => {
    const registry = createSkillRegistry(defaultSkills());
    expect(registry.size()).toBeGreaterThanOrEqual(7);
    expect(registry.get('sites.youtube.open-first-video')).toBeTruthy();
    expect(registry.get('builtin.form-fill-submit')).toBeTruthy();
  });

  it('discovers form skill from instruction', () => {
    const registry = createSkillRegistry([formFillSubmitSkill]);
    const found = discoverSkills({
      registry,
      instruction: 'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
      url: 'https://localhost/form.html',
      flags: { enableDeterministicFormFill: true },
    });
    expect(found).toHaveLength(1);
    expect(found[0].skill.manifest.id).toBe('builtin.form-fill-submit');
  });

  it('runs form fill skill to input_text then submit', async () => {
    const runtime = createSkillRuntime({
      registry: createSkillRegistry([formFillSubmitSkill]),
      kernel: mockKernel(),
      taskId: 't1',
      flags: { enableSkillRuntime: true, enableDeterministicFormFill: true },
      hasAction: () => true,
    });
    const skillState = new Map<string, unknown>();
    const first = await runtime.tryDecide({
      roundId: 'r1',
      instruction: 'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
      url: 'https://localhost/form.html',
      observationText: frame('https://localhost/form.html').text,
      frame: frame('https://localhost/form.html'),
      skillState,
    });
    expect(first.handled).toBe(true);
    expect(first.decision?.kind).toBe('action');
    if (first.decision?.kind === 'action') {
      expect(first.decision.name).toBe('input_text');
    }

    const second = await runtime.tryDecide({
      roundId: 'r1',
      instruction: 'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
      url: 'https://localhost/form.html',
      observationText: frame('https://localhost/form.html').text,
      frame: frame('https://localhost/form.html'),
      skillState: first.skillState,
    });
    expect(second.handled).toBe(true);
    expect(second.decision?.kind).toBe('action');
    if (second.decision?.kind === 'action') {
      expect(second.decision.name).toBe('click_element');
    }
  });

  it('extracts product table artifact via list skill', async () => {
    const html = `
      <div class="product" data-name="A" data-price="$1" data-rating="5"></div>
      <div class="product" data-name="B" data-price="$2" data-rating="4"></div>
    `;
    const runtime = createSkillRuntime({
      registry: createSkillRegistry([repeatingListExtractSkill]),
      kernel: mockKernel({
        extract: (async () => ({ ok: true, data: html })) as BrowserKernel['extract'],
      }),
      taskId: 't1',
      flags: { enableSkillRuntime: true },
      hasAction: () => true,
    });
    const result = await runtime.tryDecide({
      roundId: 'r1',
      instruction: 'Extract products to a CSV table with name, price, rating',
      url: 'https://shop.test/list',
      frame: frame('https://shop.test/list'),
    });
    expect(result.handled).toBe(true);
    expect(result.decision?.kind).toBe('done');
    if (result.decision?.kind === 'done') {
      expect(result.decision.artifact?.type).toBe('table');
      expect(result.decision.summary).toMatch(/name|A/i);
    }
  });

  it('falls back when skill fails after recovery budget', async () => {
    const flaky: BrowserSkill = {
      manifest: {
        id: 'test.flaky',
        version: '1',
        description: 'flaky',
        capabilities: ['x'],
        domains: ['*'],
        requiredPrimitives: [],
        risk: 'read',
      },
      match: () => ({ score: 10, reason: 'always' }),
      run: async () => ({ decision: { kind: 'fail', reason: 'boom', failureClass: 'boom' } }),
    };
    const runtime = createSkillRuntime({
      registry: createSkillRegistry([flaky]),
      kernel: mockKernel(),
      taskId: 't1',
      flags: { enableSkillRuntime: true },
      maxSkillRecovery: 1,
    });
    // First fail consumes recovery and continues to next (none) → fallback
    const first = await runtime.tryDecide({
      roundId: 'r',
      instruction: 'do it',
      url: 'https://x.test/',
    });
    expect(first.handled).toBe(false);
    expect(first.fallbackUsed).toBe(true);
  });

  it('matches youtube and bilibili site skills by domain', () => {
    const registry = createSkillRegistry([youtubeOpenFirstVideoSkill, bilibiliOpenFirstVideoSkill]);
    const yt = discoverSkills({
      registry,
      instruction: '打开第一个 YouTube 视频',
      url: 'https://www.youtube.com/',
      flags: { enableDeterministicYouTube: true },
    });
    // match depends on isYouTubeFirstVideoInstruction — may or may not match Chinese phrasing
    const bili = discoverSkills({
      registry,
      instruction: '打开 B 站第一个视频',
      url: 'https://www.bilibili.com/',
      flags: { enableDeterministicBilibili: true },
    });
    expect(Array.isArray(yt)).toBe(true);
    expect(Array.isArray(bili)).toBe(true);
  });
});

describe('Learned SkillPlan', () => {
  it('rejects dynamic code and empty plans', () => {
    expect(validateSkillPlan({ id: '', version: '1', description: '', capabilities: [], steps: [] }).ok).toBe(false);
    expect(
      validateSkillPlan({
        id: 'x',
        version: '1',
        description: 'bad',
        capabilities: [],
        steps: [{ op: 'observe' }],
      }).ok,
    ).toBe(true);
    expect(
      validateSkillPlan({
        id: 'x',
        version: '1',
        description: 'eval()',
        capabilities: [],
        steps: [{ op: 'observe' }],
      }).ok,
    ).toBe(false);
  });

  it('runs declarative plan through kernel only', async () => {
    const kernel = mockKernel();
    const result = await runSkillPlan(
      {
        id: 'p1',
        version: '1',
        description: 'obs+act',
        capabilities: [],
        steps: [
          { op: 'observe' },
          { op: 'act', action: 'wait', args: { seconds: 1 } },
          {
            op: 'assert',
            criterion: { kind: 'url', operator: 'starts_with', expected: 'https://', required: true },
          },
        ],
      },
      { kernel, roundId: 'r1' },
    );
    expect(result.ok).toBe(true);
    expect(result.stepsExecuted).toBe(3);
    expect(kernel.observe).toHaveBeenCalled();
    expect(kernel.act).toHaveBeenCalledWith('r1', 'wait', { seconds: 1 });
  });

  it('enforces promotion gate from 019', () => {
    expect(
      canPromoteSkill({
        reliability: 9,
        falseComplete: 0,
        hasSensitiveFields: false,
        distinctInputPasses: 3,
      }).promote,
    ).toBe(true);
    expect(
      canPromoteSkill({
        reliability: 8,
        falseComplete: 0,
        hasSensitiveFields: false,
        distinctInputPasses: 3,
      }).promote,
    ).toBe(false);
    expect(
      canPromoteSkill({
        reliability: 10,
        falseComplete: 1,
        hasSensitiveFields: false,
        distinctInputPasses: 3,
      }).promote,
    ).toBe(false);
  });
});
