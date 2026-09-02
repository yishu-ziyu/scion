/**
 * C5 — action effect classification acceptance tests.
 */
import { describe, expect, it } from 'vitest';
import {
  BROWSER_PROTOCOL_VERSION_STRING,
  makeBrowserError,
  validateReceipt,
  type BrowserAction,
  type ElementTarget,
} from '@chijie/browser-protocol';
import { buildActionReceipt, classifyActionEffect, mayRetryAction, type EffectObservation } from './effect';
import { buildFakeObservation } from './fakes';

function inputTarget(value: string): ElementTarget {
  return { kind: 'element', identity: { backendNodeId: 42 }, pageRevision: 'rev-1', value };
}

function action(over: Partial<BrowserAction> = {}): BrowserAction {
  return {
    protocolVersion: BROWSER_PROTOCOL_VERSION_STRING,
    actionId: 'a-1',
    requestedAt: 1_700_000_000_000,
    effect: 'reversible_write',
    kind: 'click',
    target: { kind: 'element', identity: { backendNodeId: 42 }, pageRevision: 'rev-1' },
    input: {},
    ...over,
  } as BrowserAction;
}

function obs(overrides: Partial<EffectObservation> = {}): EffectObservation {
  return buildFakeObservation(overrides) as EffectObservation;
}

describe('classifyActionEffect (C5)', () => {
  it('click with nothing changed → no_effect', () => {
    const before = obs({ interactiveElements: [inputTarget('')] });
    expect(classifyActionEffect(before, obs({ interactiveElements: [inputTarget('')] }), action())).toBe('no_effect');
  });

  it('input_text re-entering the existing value → no_effect (fixed idempotence rule)', () => {
    const before = obs({ interactiveElements: [inputTarget('hello')] });
    const after = obs({ interactiveElements: [inputTarget('hello')] });
    const inputAction = action({
      kind: 'input_text',
      target: inputTarget('hello'),
      input: { text: 'hello' },
    });
    expect(classifyActionEffect(before, after, inputAction)).toBe('no_effect');
  });

  it('input_text that actually changes the field value → applied', () => {
    const before = obs({ interactiveElements: [inputTarget('')] });
    const after = obs({ interactiveElements: [inputTarget('hello')] });
    const inputAction = action({
      kind: 'input_text',
      target: inputTarget(''),
      input: { text: 'hello' },
    });
    expect(classifyActionEffect(before, after, inputAction)).toBe('applied');
  });

  it('page navigation (revision + url moved) → applied', () => {
    const before = obs();
    const after = obs({
      pageRevision: 'rev-2',
      page: { kind: 'page', tabId: 1, url: 'https://example.test/next', title: 'Next', pageRevision: 'rev-2' },
      signals: [{ kind: 'navigation' }],
    });
    expect(
      classifyActionEffect(
        before,
        after,
        action({ kind: 'navigate', target: null, input: { url: 'https://example.test/next' } }),
      ),
    ).toBe('applied');
  });

  it('policy refusal → blocked', () => {
    expect(classifyActionEffect(obs(), obs({ blocked: true }), action())).toBe('blocked');
  });

  it('debugger detach after the action → unknown, never applied', () => {
    const before = obs();
    const after = obs({ pageRevision: 'rev-2', debuggerDetached: true });
    expect(classifyActionEffect(before, after, action())).toBe('unknown');
  });

  it('external commit with no observable change → unknown (cannot confirm)', () => {
    expect(classifyActionEffect(obs(), obs(), action({ effect: 'external_commit' }))).toBe('unknown');
  });

  it('external commit with observable change → applied', () => {
    const before = obs({ interactiveElements: [inputTarget('')] });
    const after = obs({ pageRevision: 'rev-2', interactiveElements: [inputTarget('done')] });
    expect(classifyActionEffect(before, after, action({ effect: 'external_commit' }))).toBe('applied');
  });

  it('media state change counts as an effect', () => {
    const before = obs({ media: { kind: 'bound', state: 'paused' } });
    const after = obs({ media: { kind: 'bound', state: 'playing' } });
    expect(
      classifyActionEffect(before, after, action({ kind: 'media_control', target: null, input: { command: 'play' } })),
    ).toBe('applied');
  });

  it('tab-state change (runtime extras) counts as an effect', () => {
    const before = obs({ tabs: { count: 2, activeTabId: 1 } });
    const after = obs({ tabs: { count: 3, activeTabId: 2 } });
    expect(
      classifyActionEffect(
        before,
        after,
        action({ kind: 'open_tab', target: null, input: { url: 'https://example.test' } }),
      ),
    ).toBe('applied');
  });

  it('download-state change (runtime extras) counts as an effect', () => {
    const before = obs({ downloads: { completedCount: 0 } });
    const after = obs({ downloads: { completedCount: 1 } });
    expect(classifyActionEffect(before, after, action())).toBe('applied');
  });

  it('a pure index reshuffle with identical stable state is NOT an effect', () => {
    const before = obs({ interactiveElements: [{ ...inputTarget('x'), index: 1 }] });
    const after = obs({ interactiveElements: [{ ...inputTarget('x'), index: 9 }] });
    expect(classifyActionEffect(before, after, action({ target: inputTarget('x') }))).toBe('no_effect');
  });
});

describe('mayRetryAction (C5)', () => {
  it('unknown + external_commit must never auto-retry', () => {
    expect(mayRetryAction(action({ effect: 'external_commit' }), 'unknown')).toBe(false);
  });

  it('unknown + reversible_write is retryable', () => {
    expect(mayRetryAction(action(), 'unknown')).toBe(true);
  });

  it('applied is never a retry', () => {
    expect(mayRetryAction(action({ effect: 'external_commit' }), 'applied')).toBe(false);
  });
});

describe('buildActionReceipt (C5)', () => {
  it('applied verdict carries afterRevision and passes validateReceipt', () => {
    const receipt = buildActionReceipt({
      action: action(),
      before: obs(),
      after: obs({ pageRevision: 'rev-2' }),
      verdict: 'applied',
    });
    expect(receipt.status).toBe('applied');
    expect(receipt.beforeRevision).toBe('rev-1');
    expect(receipt.afterRevision).toBe('rev-2');
    expect(receipt.error).toBeUndefined();
    expect(() => validateReceipt(receipt)).not.toThrow();
    expect('isDone' in receipt).toBe(false);
  });

  it('unknown without an explicit error gets a default VALIDATION_UNAVAILABLE error', () => {
    const receipt = buildActionReceipt({ action: action(), before: obs(), verdict: 'unknown' });
    expect(receipt.status).toBe('unknown');
    expect(receipt.afterRevision).toBeUndefined();
    expect(receipt.error?.code).toBe('VALIDATION_UNAVAILABLE');
    expect(() => validateReceipt(receipt)).not.toThrow();
  });

  it('blocked carries the caller error when given', () => {
    const error = makeBrowserError('USER_IN_CONTROL', 'user took the tab');
    const receipt = buildActionReceipt({
      action: action(),
      before: obs(),
      after: obs({ blocked: true }),
      verdict: 'blocked',
      error,
    });
    expect(receipt.error).toBe(error);
    expect(() => validateReceipt(receipt)).not.toThrow();
  });

  it('no_effect carries no error and no afterRevision drift', () => {
    const receipt = buildActionReceipt({ action: action(), before: obs(), after: obs(), verdict: 'no_effect' });
    expect(receipt.status).toBe('no_effect');
    expect(receipt.afterRevision).toBe('rev-1');
    expect(receipt.error).toBeUndefined();
  });
});
