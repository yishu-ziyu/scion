import { describe, expect, it } from 'vitest';
import { Actors, type Message } from '@extension/storage';
import { applyChatStreamDelta, classifyChatTurn, isChatOnlyMessage } from '../chat-turn';

describe('isChatOnlyMessage', () => {
  it('treats plain conversation as chat-only', () => {
    expect(isChatOnlyMessage('你好')).toBe(true);
    expect(isChatOnlyMessage('解释一下什么是 Transformer')).toBe(true);
    expect(isChatOnlyMessage('help me brainstorm names for a cat')).toBe(true);
  });

  it('keeps page-pointing instructions on the task path', () => {
    expect(isChatOnlyMessage('总结一下这个页面')).toBe(false);
    expect(isChatOnlyMessage('what is this page about')).toBe(false);
  });

  it('keeps browser-operation verbs on the task path', () => {
    expect(isChatOnlyMessage('打开淘宝首页')).toBe(false);
    expect(isChatOnlyMessage('click the login button')).toBe(false);
    expect(isChatOnlyMessage('帮我登录邮箱')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isChatOnlyMessage('   ')).toBe(false);
  });
});

describe('classifyChatTurn', () => {
  it.each([
    '总结当前页面',
    '请概括一下这个网页',
    '帮我总结当前页面的主要内容',
    '用三点总结本页',
    'summarize this page',
    'summarize this page in three bullets',
  ])('routes a standalone current-page summary with output preferences to page_summary: %s', message => {
    expect(classifyChatTurn(message)).toBe('page_summary');
  });

  it.each([
    '总结当前页面，然后点击下一页',
    '总结本页后提交表单',
    '概括这个网页，然后打开详情',
    'summarize this page, then click Next',
    'summarize the current page and submit the form',
    'summarize this webpage, then open the details',
    '总结当前页，然后搜索相关资料',
    'summarize this page, then search for related sources',
  ])('keeps mixed summary and browser actions on the task loop: %s', message => {
    expect(classifyChatTurn(message)).toBe('task');
  });

  it('keeps plain chat and direct page operations off the page-summary route', () => {
    expect(classifyChatTurn('你好')).toBe('chat');
    expect(classifyChatTurn('点击登录按钮')).toBe('task');
  });
});

describe('applyChatStreamDelta', () => {
  const stream = { sessionId: 's1', timestamp: 100, text: '' };
  const user: Message = { actor: Actors.USER, content: '你好', timestamp: 99 };

  it('creates the assistant message on the first delta', () => {
    const next = applyChatStreamDelta([user], stream, '你');
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ actor: Actors.SYSTEM, content: '你', timestamp: 100 });
  });

  it('appends later deltas to the same message', () => {
    const start = applyChatStreamDelta([user], stream, '你');
    const next = applyChatStreamDelta(start, stream, '好');
    expect(next).toHaveLength(2);
    expect(next[1].content).toBe('你好');
  });

  it('never grows the user message', () => {
    const colliding = { ...user, timestamp: 100 };
    const next = applyChatStreamDelta([colliding], stream, 'x');
    expect(next).toHaveLength(2);
    expect(next[0].content).toBe('你好');
  });
});
