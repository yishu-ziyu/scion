import { describe, expect, it } from 'vitest';
import {
  CHEAP_GREETING_REPLY_TEXT,
  CHEAP_STOP_TEXT,
  EMPTY_TURN_CLARIFY_TEXT,
  enforcePageObservationInvariant,
  parseUserTurnDecision,
  resolveUserTurnCheap,
} from '../user-turn-decision';

describe('parseUserTurnDecision', () => {
  it('accepts valid reply JSON', () => {
    const r = parseUserTurnDecision(
      JSON.stringify({ kind: 'reply', user_visible_text: '你好，需要我帮你做什么？' }),
    );
    expect(r).toEqual({
      ok: true,
      decision: { kind: 'reply', userVisibleText: '你好，需要我帮你做什么？' },
    });
  });

  it('accepts execute with empty text', () => {
    const r = parseUserTurnDecision(JSON.stringify({ kind: 'execute', user_visible_text: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.decision.kind).toBe('execute');
  });

  it('accepts fenced JSON and camelCase field', () => {
    const r = parseUserTurnDecision('```json\n{"kind":"clarify","userVisibleText":"想让我搜什么？"}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.decision.kind).toBe('clarify');
      expect(r.decision.userVisibleText).toContain('搜');
    }
  });

  it('rejects reply without text', () => {
    const r = parseUserTurnDecision(JSON.stringify({ kind: 'reply', user_visible_text: '' }));
    expect(r.ok).toBe(false);
  });

  it('rejects invalid kind', () => {
    const r = parseUserTurnDecision(JSON.stringify({ kind: 'browse', user_visible_text: 'x' }));
    expect(r.ok).toBe(false);
  });

  it('rejects garbage', () => {
    expect(parseUserTurnDecision('not json at all').ok).toBe(false);
    expect(parseUserTurnDecision('').ok).toBe(false);
  });
});

describe('resolveUserTurnCheap', () => {
  it('clarifies an empty sentence without a model', () => {
    expect(resolveUserTurnCheap('   ')).toEqual({
      kind: 'clarify',
      userVisibleText: EMPTY_TURN_CLARIFY_TEXT,
    });
  });

  it('replies to a whole-message greeting without a model', () => {
    expect(resolveUserTurnCheap('你好')).toEqual({
      kind: 'reply',
      userVisibleText: CHEAP_GREETING_REPLY_TEXT,
    });
    expect(resolveUserTurnCheap('谢谢')).toMatchObject({ kind: 'reply' });
  });

  it('stops on a whole-message stop without a model', () => {
    expect(resolveUserTurnCheap('停止')).toEqual({
      kind: 'stop',
      userVisibleText: CHEAP_STOP_TEXT,
    });
    expect(resolveUserTurnCheap('cancel')).toMatchObject({ kind: 'stop' });
  });

  it('executes obvious page work without a model', () => {
    expect(resolveUserTurnCheap('打开 YouTube')).toEqual({ kind: 'execute', userVisibleText: '' });
    expect(resolveUserTurnCheap('open https://example.com')).toEqual({ kind: 'execute', userVisibleText: '' });
    expect(resolveUserTurnCheap('用一句话说明当前 AICSS 页面展示的内容。不要点击或修改页面。')).toEqual({
      kind: 'execute',
      userVisibleText: '',
    });
  });

  it('leaves ambiguous chat for the model', () => {
    expect(resolveUserTurnCheap('帮我看看')).toBeNull();
    expect(resolveUserTurnCheap('请用一句话说明什么是 AICSS。')).toBeNull();
    expect(resolveUserTurnCheap('打开')).toBeNull();
  });
});

describe('enforcePageObservationInvariant', () => {
  it('routes the exact AICSS current-page summary request to execute even after a reply misclassification', () => {
    expect(
      enforcePageObservationInvariant(
        '用一句话说明当前 AICSS 页面展示的内容。不要点击或修改页面。',
        {
          kind: 'reply',
          userVisibleText: '好的，请稍等，我来描述一下当前 AICSS 页面的内容。',
        },
      ),
    ).toEqual({ kind: 'execute', userVisibleText: '' });
  });

  it.each([
    '请用一句话说明什么是 AICSS。',
    '总结一下我们刚才的对话。',
    '你好，你是谁？',
  ])('keeps pure chat as reply: %s', text => {
    const decision = { kind: 'reply' as const, userVisibleText: '普通回复' };
    expect(enforcePageObservationInvariant(text, decision)).toEqual(decision);
  });

  it('preserves stop even when the sentence mentions the current page', () => {
    const decision = { kind: 'stop' as const, userVisibleText: '已停止' };
    expect(enforcePageObservationInvariant('停止读取当前页面', decision)).toEqual(decision);
  });
});
