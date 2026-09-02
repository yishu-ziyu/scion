import { describe, expect, it } from 'vitest';
import { BROWSER_PROTOCOL_VERSION_STRING, type BrowserAction, type ElementTarget } from '@chijie/browser-protocol';
import { BrowserRuntime } from './runtime';
import { buildFakeObservation, createFakePorts, type FakeScenario } from './fakes';

function elementTarget(pageRevision = 'rev-1'): ElementTarget {
  return { kind: 'element', identity: { backendNodeId: 42 }, pageRevision };
}

function makeAction(kind: BrowserAction['kind'], over: Partial<BrowserAction> = {}): BrowserAction {
  const base = {
    protocolVersion: BROWSER_PROTOCOL_VERSION_STRING,
    actionId: 'a-1',
    requestedAt: 1_700_000_000_000,
    effect: 'reversible_write' as const,
    target: null,
  };
  const input: Record<BrowserAction['kind'], unknown> = {
    navigate: { url: 'https://example.test/go' },
    click: {},
    input_text: { text: 'hi' },
    select_option: { optionText: 'CN' },
    send_keys: { keys: 'Enter' },
    scroll: { direction: 'down' },
    open_tab: { url: 'https://example.test' },
    switch_tab: { tabId: 2 },
    close_tab: { tabId: 2 },
    go_back: {},
    media_control: { command: 'play' },
    wait: { condition: { kind: 'url_includes', value: 'example' }, timeoutMs: 1000 },
  };
  const target = kind === 'click' || kind === 'input_text' ? elementTarget() : null;
  return { ...base, kind, target, input: input[kind], ...over } as BrowserAction;
}

function makeRuntime(scenario: FakeScenario = 'applied') {
  const ports = createFakePorts(scenario);
  return { runtime: new BrowserRuntime(ports), ports };
}

describe('BrowserRuntime (C1)', () => {
  it('instantiates and runs observe + execute in plain Node with only fakes', async () => {
    const { runtime, ports } = makeRuntime('applied');

    const observation = await runtime.observe({ query: '提交' });
    expect(observation.protocolVersion).toBe('2');
    expect(ports.snapshot.lastOptions).toEqual({ query: '提交' });

    const outcome = await runtime.execute(makeAction('click'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.receipt.status).toBe('applied');
    expect(ports.executor.executed).toHaveLength(1);

    expect(ports.trace.events.map(e => e.kind)).toEqual(['observation.captured', 'action.requested', 'action.receipt']);
  });

  it('stale target scenario yields a blocked receipt with TARGET_STALE', async () => {
    const { runtime } = makeRuntime('stale_target');
    const outcome = await runtime.execute(makeAction('click'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.receipt.status).toBe('blocked');
    expect(outcome.receipt.error?.code).toBe('TARGET_STALE');
  });

  it('no effect scenario yields a no_effect receipt', async () => {
    const { runtime } = makeRuntime('no_effect');
    const outcome = await runtime.execute(makeAction('input_text'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.receipt.status).toBe('no_effect');
  });

  it('navigation scenario advances the observed page revision', async () => {
    const { runtime, ports } = makeRuntime('navigation');
    const before = await runtime.observe();
    const outcome = await runtime.execute(makeAction('navigate'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.receipt.status).toBe('applied');
    const after = await runtime.observe();
    expect(after.pageRevision).not.toBe(before.pageRevision);
    expect(after.signals.some(s => s.kind === 'navigation')).toBe(true);
  });

  it('rejects an illegal target before the executor sees the action', async () => {
    const { runtime, ports } = makeRuntime('applied');
    // open_tab only accepts a null target; give it an element target.
    const outcome = await runtime.execute(makeAction('open_tab', { target: elementTarget() }));
    expect(outcome.ok).toBe(false);
    expect(ports.executor.executed).toHaveLength(0);
  });

  it('fakes produce protocol-valid observations', () => {
    expect(() => buildFakeObservation()).not.toThrow();
  });
});
