import { describe, expect, it } from 'vitest';
import { buildAttemptDisplaySummary, buildAttemptTargetLabel, sanitizeIntent } from '../attempt-display';

describe('buildAttemptDisplaySummary', () => {
  it('opens host for navigate', () => {
    expect(
      buildAttemptDisplaySummary({
        actionName: 'go_to_url',
        args: { url: 'https://www.bilibili.com/video/BV1', intent: 'open bili' },
      }),
    ).toBe('打开 bilibili.com');
  });

  it('plays media with command', () => {
    expect(
      buildAttemptDisplaySummary({
        actionName: 'control_media',
        args: { command: 'play', intent: 'play video' },
        urlOrigin: 'https://www.bilibili.com',
      }),
    ).toBe('播放视频（bilibili.com）');
  });

  it('uses click intent without leaking index', () => {
    expect(
      buildAttemptDisplaySummary({
        actionName: 'click_element',
        args: { index: 3, intent: '播放第一个视频' },
      }),
    ).toBe('点击播放第一个视频');
  });

  it('never echoes password input values', () => {
    expect(
      buildAttemptDisplaySummary({
        actionName: 'input_text',
        args: { index: 1, text: 'super-secret', intent: 'type password' },
        effectTarget: { tag: 'input', type: 'password' },
      }),
    ).toBe('密码框（需你自己输入）');
  });

  it('scrolls to short visible text', () => {
    expect(
      buildAttemptDisplaySummary({
        actionName: 'scroll_to_text',
        args: { text: '评论' },
      }),
    ).toBe('滚动到「评论」');
  });

  it('drops machine intent boilerplate', () => {
    expect(sanitizeIntent('Perform the requested external action')).toBeUndefined();
    expect(sanitizeIntent('点击开始播放')).toBe('点击开始播放');
  });

  it('target label prefers host', () => {
    expect(
      buildAttemptTargetLabel({
        actionName: 'go_to_url',
        args: { url: 'https://www.bilibili.com/x' },
      }),
    ).toBe('bilibili.com');
  });
});
