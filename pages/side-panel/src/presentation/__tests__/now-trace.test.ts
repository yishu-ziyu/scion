import { describe, expect, it } from 'vitest';
import type { ActionAttempt } from '@extension/storage';
import { deriveNowTrace, executionStepTitle } from '../now-trace';

const attempt = (partial: Partial<ActionAttempt> & Pick<ActionAttempt, 'id' | 'actionName'>): ActionAttempt =>
  ({
    roundId: 'r1',
    effect: 'read',
    argsDigest: 'd',
    state: 'observed',
    proposedAt: 1,
    ...partial,
  }) as ActionAttempt;

describe('now-trace', () => {
  it('maps navigation and snapshot to Tabbit-style step titles', () => {
    expect(executionStepTitle({ actionName: 'go_to_url', targetLabel: 'example.com' })).toBe('页面导航：example.com');
    expect(executionStepTitle({ actionName: 'observe' })).toBe('获取页面快照');
    expect(executionStepTitle({ actionName: 'go_to_url', displaySummary: '打开 example.com' })).toBe('打开 example.com');
  });

  it('shows thinking plus the full step list while running', () => {
    const view = deriveNowTrace({
      status: 'running',
      currentSummary: '正在打开 example.com',
      attempts: [
        attempt({ id: 'a1', actionName: 'go_to_url', displaySummary: '打开 example.com', state: 'observed' }),
        attempt({ id: 'a2', actionName: 'observe', state: 'executing' }),
      ],
    });
    expect(view.thinkingLine).toBe('正在打开 example.com');
    expect(view.thinkingOpen).toBe(true);
    expect(view.stepsOpen).toBe(true);
    expect(view.steps.map(step => step.title)).toEqual(['打开 example.com', '获取页面快照']);
    expect(view.steps[1]?.state).toBe('live');
  });

  it('hides thinking on a failed run so 结果 owns the verdict', () => {
    const view = deriveNowTrace({
      status: 'failed',
      currentSummary: '没做成',
      attempts: [attempt({ id: 'a1', actionName: 'observe', displaySummary: '获取页面快照', state: 'observed' })],
    });
    expect(view.thinkingLine).toBe('');
    expect(view.thinkingOpen).toBe(false);
    expect(view.steps).toHaveLength(1);
    expect(view.stepsOpen).toBe(false);
  });

  it('shows 思考中 after the snapshot step finishes and the model is deciding', () => {
    const view = deriveNowTrace({
      status: 'running',
      currentSummary: '获取页面快照',
      attempts: [attempt({ id: 'a1', actionName: 'observe', displaySummary: '获取页面快照', state: 'observed' })],
    });
    expect(view.thinkingLine).toBe('思考中');
    expect(view.steps[0]?.state).toBe('done');
  });

  it('collapses thinking after the task finishes', () => {
    const view = deriveNowTrace({
      status: 'completed',
      attempts: [attempt({ id: 'a1', actionName: 'done', displaySummary: '页面标题是 Example Domain' })],
    });
    expect(view.thinkingOpen).toBe(false);
    expect(view.thinkingLine).toBe('已按步骤做完');
    expect(view.steps).toHaveLength(1);
  });
});
