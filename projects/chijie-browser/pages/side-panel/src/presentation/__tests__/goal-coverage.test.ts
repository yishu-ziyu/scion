import { describe, expect, it } from 'vitest';
import {
  assessGoalCoverage,
  hasSubstantiveAnswer,
  resolveDeliverableAnswer,
  wantsContentDeliverable,
} from '../goal-coverage';

describe('assessGoalCoverage', () => {
  it('flags play+comment goal as partial when only media evidence exists', () => {
    const goal = '将这个视频的播放按键点击开始，并且把第一条评论复制下来，之后发给我。';
    expect(wantsContentDeliverable(goal)).toBe(true);
    const result = assessGoalCoverage({
      goalText: goal,
      evidence: [{ kind: 'media_state', passed: true, value: 'playing' }],
      answerText: undefined,
    });
    expect(result.coverage).toBe('partial');
    expect(result.missing.some(line => /评论|复制|回复/.test(line))).toBe(true);
    expect(result.done.length).toBeGreaterThan(0);
  });

  it('stays partial when answer is only media status or goal echo', () => {
    const goal = '打开B站 播放第一个视频 并复制第一个评论发给我';
    for (const fake of [goal, '视频正在播放', 'Browser opened', 'Playing video for 3 seconds']) {
      const result = assessGoalCoverage({
        goalText: goal,
        evidence: [{ kind: 'media_state', passed: true, value: 'playing' }],
        answerText: fake,
      });
      expect(result.coverage).toBe('partial');
    }
  });

  it('is full when media and comment answer both present', () => {
    const goal = '播放视频并把第一条评论发给我';
    const result = assessGoalCoverage({
      goalText: goal,
      evidence: [{ kind: 'media_state', passed: true, value: 'playing' }],
      answerText: '第一条评论：这个视频太好看了',
    });
    expect(result.coverage).toBe('full');
    expect(result.missing).toEqual([]);
  });
});

describe('resolveDeliverableAnswer', () => {
  it('rejects goal echo and media status', () => {
    const goal = '打开B站 播放第一个视频 并复制第一个评论发给我';
    expect(
      resolveDeliverableAnswer({
        instructionSummary: goal,
        goalText: goal,
        completionOutcome: '视频正在播放',
      }),
    ).toBeUndefined();
    expect(hasSubstantiveAnswer('第一条评论：哈哈哈', goal)).toBe(true);
  });
});
