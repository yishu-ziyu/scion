import { describe, expect, it } from 'vitest';
import {
  applySuperviseVerdict,
  formatSuperviseRejectMemory,
  pageTextForSupervisor,
  parseSuperviseVerdict,
  renderSuperviseUserPrompt,
} from '../control-supervise';

describe('control-supervise', () => {
  it('accepts an explicit accept verdict', () => {
    expect(parseSuperviseVerdict({ accept: true, reason: '标题已是目标视频' })).toEqual({
      accept: true,
      reason: '标题已是目标视频',
    });
  });

  it('rejects missing or false accept so a broken supervisor cannot green-light', () => {
    expect(parseSuperviseVerdict(null).accept).toBe(false);
    expect(parseSuperviseVerdict({ accept: false, reason: '还在搜索页' }).accept).toBe(false);
    expect(parseSuperviseVerdict({ reason: '无结论' }).accept).toBe(false);
    expect(parseSuperviseVerdict({ accept: 'true', verdict: 'accept' }).accept).toBe(true);
  });

  it('turns a reject into judge_retry memory for the worker', () => {
    const applied = applySuperviseVerdict({ accept: false, reason: '仍在列表页' }, '已打开视频');
    expect(applied.decision).toEqual({ kind: 'recoverable', category: 'judge_retry' });
    expect(applied.lastActionMemory).toContain('仍在列表页');
    expect(applied.lastActionMemory).toContain('Do not claim done');
  });

  it('passes an accept through as done with the worker summary', () => {
    expect(applySuperviseVerdict({ accept: true, reason: '页面对得上' }, '正在播放目标视频')).toEqual({
      lastActionMemory: null,
      decision: { kind: 'done', summary: '正在播放目标视频' },
    });
  });

  it('shows the supervisor the user request, claim, and page together', () => {
    const prompt = renderSuperviseUserPrompt({
      instruction: '打开第一条视频',
      claimedResult: '已经打开',
      pageText: 'URL: https://example.com/results',
    });
    expect(prompt).toContain('打开第一条视频');
    expect(prompt).toContain('已经打开');
    expect(prompt).toContain('https://example.com/results');
    expect(prompt).toContain('untrusted');
  });

  it('caps page text and prefers visible wording over the worker fallback', () => {
    const text = pageTextForSupervisor({
      url: 'https://example.com/watch',
      title: 'Clip',
      visibleText: '正在播放',
      fallback: 'stale worker dump',
      maxChars: 80,
    });
    expect(text).toContain('https://example.com/watch');
    expect(text).toContain('正在播放');
    expect(text).not.toContain('stale worker dump');
    expect(text.length).toBeLessThanOrEqual(80);
  });

  it('keeps reject memory readable when the reason is empty', () => {
    expect(formatSuperviseRejectMemory('').toLowerCase()).toContain('supervisor rejected');
  });
});
