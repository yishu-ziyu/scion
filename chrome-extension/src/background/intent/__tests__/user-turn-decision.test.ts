import { describe, expect, it } from 'vitest';
import { CHEAP_STOP_TEXT, isWholeStopInstruction } from '../user-turn-decision';

describe('isWholeStopInstruction', () => {
  it('matches a whole-message stop', () => {
    expect(isWholeStopInstruction('停止')).toBe(true);
    expect(isWholeStopInstruction(' cancel ')).toBe(true);
    expect(isWholeStopInstruction('停一下。')).toBe(true);
  });

  it('does not match a stop buried in a page instruction', () => {
    expect(isWholeStopInstruction('打开 YouTube')).toBe(false);
    expect(isWholeStopInstruction('不要停止播放')).toBe(false);
    expect(isWholeStopInstruction('你好')).toBe(false);
  });

  it('keeps the stop acknowledgement copy', () => {
    expect(CHEAP_STOP_TEXT).toBe('好的，已停止。');
  });
});
