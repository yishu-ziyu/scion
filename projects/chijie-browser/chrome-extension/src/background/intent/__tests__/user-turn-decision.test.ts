import { describe, expect, it } from 'vitest';
import { parseUserTurnDecision } from '../user-turn-decision';

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
