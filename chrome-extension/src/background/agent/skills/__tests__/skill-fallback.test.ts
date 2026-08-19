/**
 * 022-SKILL-02: matching Skill fails → fallback to generic Agent path (handled=false), not task death.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSkillRuntime } from '../runtime';
import { createSkillRegistry } from '../registry';
import type { BrowserSkill } from '../types';
import type { BrowserKernel, ObservationFrame } from '../../../browser/kernel';

function mockKernel(): BrowserKernel {
  return {
    observe: vi.fn(async () => ({ frameId: 'f1', observedAt: 1, tab: { id: 1, url: 'https://example.com', title: 't' }, pageRevision: 'r1', targetCount: 0, interactiveElements: [], text: 'page', signals: [] }) as ObservationFrame),
    act: vi.fn(async () => ({ ok: true })),
    extract: vi.fn(async () => ({ ok: true, data: '' })),
    waitFor: vi.fn(async () => ({ ok: true })),
    currentFrame: vi.fn(() => null),
    getPageRevision: vi.fn(() => 'r1'),
    diff: vi.fn(),
  } as unknown as BrowserKernel;
}

describe('022-SKILL-02 skill fallback', () => {
  it('failed matching skill returns handled=false with fallbackUsed and does not throw', async () => {
    const failing: BrowserSkill = {
      manifest: {
        id: 'test.always-fail',
        version: '1.0.0',
        description: 'always fails after match',
        capabilities: ['test'],
        domains: ['*'],
        requiredPrimitives: [],
        risk: 'read',
        enabled: true,
      },
      match() {
        return { score: 100, reason: 'forced_match' };
      },
      async run() {
        return { decision: { kind: 'fail', reason: 'injected_fail', failureClass: 'skill_injected_fail' } };
      },
    };

    const registry = createSkillRegistry([failing]);
    const runtime = createSkillRuntime({
      registry,
      kernel: mockKernel(),
      taskId: 't-skill-02',
      flags: { enableSkillRuntime: true },
      hasAction: () => true,
      maxSkillRecovery: 0,
    });

    const result = await runtime.tryDecide({
      roundId: 'r1',
      instruction: 'do something that matches failing skill',
      url: 'https://example.com',
      observationText: 'page',
      frame: null,
    });

    expect(result.handled).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.candidates.map(item => item.skill.manifest.id)).toEqual(['test.always-fail']);
  });

  it('throwing skill also falls back after recovery budget', async () => {
    const throwing: BrowserSkill = {
      manifest: {
        id: 'test.throw',
        version: '1.0.0',
        description: 'throws',
        capabilities: ['test'],
        domains: ['*'],
        requiredPrimitives: [],
        risk: 'read',
        enabled: true,
      },
      match() {
        return { score: 100, reason: 'throw_match' };
      },
      async run() {
        throw new Error('skill_boom');
      },
    };
    const runtime = createSkillRuntime({
      registry: createSkillRegistry([throwing]),
      kernel: mockKernel(),
      taskId: 't-skill-02b',
      flags: { enableSkillRuntime: true },
      hasAction: () => true,
      maxSkillRecovery: 0,
    });
    const result = await runtime.tryDecide({
      roundId: 'r1',
      instruction: 'throw path',
      url: 'https://example.com',
      observationText: 'page',
      frame: null,
    });
    expect(result.handled).toBe(false);
    expect(result.fallbackUsed).toBe(true);
    expect(result.candidates.map(item => item.skill.manifest.id)).toEqual(['test.throw']);
  });
});
