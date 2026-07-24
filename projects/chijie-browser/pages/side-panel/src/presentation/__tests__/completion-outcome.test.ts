import { describe, expect, it } from 'vitest';
import {
  COMPLETION_RESULT_FALLBACK,
  humanCompletionOutcome,
  requiredCompletionResult,
} from '../completion-outcome';

describe('humanCompletionOutcome', () => {
  it('prefers tab closed over generic summary', () => {
    expect(
      humanCompletionOutcome({
        instructionSummary: '关掉这个页',
        evidence: [{ kind: 'tab_state', passed: true, value: 'closed' }],
      }),
    ).toBe('目标标签已关闭');
  });

  it('describes media paused', () => {
    expect(
      humanCompletionOutcome({
        evidence: [{ kind: 'media_state', passed: true, value: 'paused' }],
      }),
    ).toBe('视频已暂停');
  });

  it('falls back to instruction summary', () => {
    expect(
      humanCompletionOutcome({
        instructionSummary: '打开 bilibili',
        evidence: [],
      }),
    ).toBe('打开 bilibili');
  });

  it('returns null when nothing useful', () => {
    expect(humanCompletionOutcome({ evidence: [], instructionSummary: 'User instruction' })).toBeNull();
  });

  it('requiredCompletionResult never leaves completion empty', () => {
    expect(
      requiredCompletionResult({
        evidence: [],
        instructionSummary: 'User instruction',
      }),
    ).toBe(COMPLETION_RESULT_FALLBACK);
    expect(
      requiredCompletionResult({
        evidence: [{ kind: 'media_state', passed: true, value: 'paused' }],
      }),
    ).toBe('视频已暂停');
    expect(
      requiredCompletionResult({
        evidence: [],
        instructionSummary: 'User instruction',
        fallback: '页面结果已核对通过，可以放心结束这一步。',
      }),
    ).toBe('页面结果已核对通过，可以放心结束这一步。');
  });
});
