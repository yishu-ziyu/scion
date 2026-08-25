import { describe, expect, it } from 'vitest';
import {
  buildLongHorizonContext,
  buildPlanMemory,
  compactStateText,
  compressTrajectory,
  sanitizeTrajectoryField,
  summarizeActionResultForTrajectory,
  type TrajectoryStep,
} from '../context';

describe('compactStateText', () => {
  it('keeps short state unchanged', () => {
    expect(compactStateText('short state', 100)).toBe('short state');
  });

  it('keeps both ends and marks compaction', () => {
    const text = 'a'.repeat(500);
    const out = compactStateText(text, 200);
    expect(out.length).toBeGreaterThan(200);
    expect(out.startsWith('a'.repeat(140))).toBe(true);
    expect(out.endsWith('a'.repeat(60))).toBe(true);
    expect(out).toContain('[compacted 300 chars]');
  });
});

function makeSteps(n: number): TrajectoryStep[] {
  return Array.from({ length: n }, (_, i) => ({
    step: i + 1,
    action: `click_element`,
    result: `clicked index ${i + 1} with a longer result payload for step ${i + 1}`,
    url: `https://example.com/page/${i + 1}`,
    note: `note-${i + 1}`,
  }));
}

describe('compressTrajectory', () => {
  it('keeps last N steps fully without COMPRESSED mark', () => {
    const steps = makeSteps(5);
    const out = compressTrajectory(steps, { keepRecent: 2, fieldMaxChars: 40 });
    expect(out).toContain('## Recent steps');
    expect(out).toContain('step 4:');
    expect(out).toContain('step 5:');
    // Recent lines are not tagged compressed
    const recentBlock = out.split('## Recent steps')[1] ?? '';
    expect(recentBlock).not.toContain('[COMPRESSED]');
  });

  it('archives older steps with COMPRESSED and truncated fields', () => {
    const steps = makeSteps(5);
    const out = compressTrajectory(steps, { keepRecent: 2, fieldMaxChars: 20 });
    expect(out).toContain('## Trajectory archive');
    expect(out).toContain('[COMPRESSED] step 1:');
    expect(out).toContain('[COMPRESSED] step 3:');
    // Field truncation leaves ellipsis on long results
    const archiveLine = out.split('\n').find(l => l.includes('[COMPRESSED] step 1:')) as string;
    expect(archiveLine.length).toBeLessThan(200);
    expect(archiveLine).toMatch(/…|result=/);
  });

  it('enforces maxChars budget preferring recent tail', () => {
    const steps = makeSteps(20);
    const out = compressTrajectory(steps, { keepRecent: 3, maxChars: 400 });
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out).toMatch(/step 2[0-9]|step 20|trajectory truncated/);
  });

  it('returns empty for empty steps', () => {
    expect(compressTrajectory([])).toBe('');
  });
});

describe('buildPlanMemory', () => {
  it('renders id/title/status only', () => {
    const mem = buildPlanMemory({
      id: 'mission-1',
      goal: 'User task',
      phases: [
        { id: 'phase-1', title: '阶段 1', status: 'done' },
        { id: 'phase-2', title: '阶段 2', status: 'active' },
      ],
    });
    expect(mem).toContain('## Plan memory');
    expect(mem).toContain('plan_id: mission-1');
    expect(mem).toContain('- phase-1: 阶段 1 [done]');
    expect(mem).toContain('- phase-2: 阶段 2 [active]');
  });

  it('does not leak raw secrets from goal/title', () => {
    const mem = buildPlanMemory({
      goal: 'login with password=supersecret123',
      phases: [{ id: 'p1', title: 'enter password=hunter2', status: 'active' }],
    });
    expect(mem).not.toContain('supersecret123');
    expect(mem).not.toContain('hunter2');
    expect(mem).toContain('[REDACTED]');
  });

  it('returns empty when no phases', () => {
    expect(buildPlanMemory(null)).toBe('');
    expect(buildPlanMemory({ phases: [] })).toBe('');
  });
});

describe('buildLongHorizonContext', () => {
  it('prioritizes observation and stays within maxChars', () => {
    const observation = `OBS_HEAD ${'x'.repeat(5000)} OBS_TAIL`;
    const steps = makeSteps(15);
    const plan = buildPlanMemory({
      phases: [{ id: 'phase-1', title: 'Start', status: 'active' }],
    });
    const out = buildLongHorizonContext({
      observation,
      trajectory: steps,
      planMemory: plan,
      maxChars: 2_000,
      compressOptions: { keepRecent: 2, fieldMaxChars: 30 },
    });
    expect(out.length).toBeLessThanOrEqual(2_000);
    expect(out).toContain('## Observation');
    expect(out).toContain('OBS_HEAD');
  });

  it('includes plan memory and compressed trajectory when budget allows', () => {
    const out = buildLongHorizonContext({
      observation: 'short page state',
      trajectory: makeSteps(6),
      planMemory: buildPlanMemory({
        phases: [{ id: 'phase-1', title: 'Nav', status: 'active' }],
      }),
      maxChars: 8_000,
      compressOptions: { keepRecent: 2 },
    });
    expect(out).toContain('## Observation');
    expect(out).toContain('short page state');
    expect(out).toContain('## Plan memory');
    expect(out).toContain('phase-1');
    expect(out).toContain('[COMPRESSED]');
    expect(out).toContain('## Recent steps');
  });
});

describe('privacy helpers', () => {
  it('redacts password-like fields', () => {
    expect(sanitizeTrajectoryField('password=abc123 extra')).toContain('[REDACTED]');
    expect(sanitizeTrajectoryField('password=abc123 extra')).not.toContain('abc123');
  });

  it('summarizeActionResultForTrajectory never keeps input_text values', () => {
    const s = summarizeActionResultForTrajectory('input_text', 'typed: my-secret-password', null);
    expect(s).toBe('input_text applied');
    expect(s).not.toContain('secret');
  });
});
