import { describe, expect, it } from 'vitest';
import { BROWSER_PROTOCOL_VERSION_STRING, type BrowserAction } from '@chijie/browser-protocol';
import {
  LegacyActionAdapter,
  UNSUPPORTED_ACTION,
  runnerFromActions,
  type LegacyActionLike,
  type LegacyActionResultLike,
} from '../legacy-action-adapter';

function ok(overrides: Partial<LegacyActionResultLike> = {}): LegacyActionResultLike {
  return { isDone: false, success: true, extractedContent: null, error: null, ...overrides };
}

function fakeAction(name: string, result: LegacyActionResultLike, calls: unknown[]): LegacyActionLike {
  return {
    name: () => name,
    call: async (input: unknown) => {
      calls.push(input);
      return result;
    },
  };
}

function makeAction(kind: BrowserAction['kind'], over: Partial<BrowserAction> = {}): BrowserAction {
  const input: Record<BrowserAction['kind'], unknown> = {
    navigate: { url: 'https://example.test/go' },
    click: {},
    input_text: { text: 'Ada' },
    select_option: { optionText: 'China' },
    send_keys: { keys: 'Enter' },
    scroll: { direction: 'down' },
    open_tab: { url: 'https://example.test' },
    switch_tab: { tabId: 7 },
    close_tab: { tabId: 7 },
    go_back: {},
    media_control: { command: 'play' },
    wait: { condition: { kind: 'url_includes', value: 'x' }, timeoutMs: 500 },
  };
  const elementTarget = { kind: 'element' as const, identity: { backendNodeId: 42 }, pageRevision: 'rev-9', index: 3 };
  const mediaTarget = {
    kind: 'media' as const,
    mediaId: 'm-1',
    mediaKind: 'video' as const,
    tabId: 1,
    pageRevision: 'rev-9',
  };
  const target =
    kind === 'click' || kind === 'input_text' || kind === 'select_option'
      ? elementTarget
      : kind === 'media_control'
        ? mediaTarget
        : null;
  return {
    protocolVersion: BROWSER_PROTOCOL_VERSION_STRING,
    actionId: 'a-1',
    requestedAt: 1_700_000_000_000,
    effect: 'reversible_write',
    kind,
    target,
    input: input[kind],
    ...over,
  } as BrowserAction;
}

function adapterFor(actions: LegacyActionLike[]) {
  return new LegacyActionAdapter(runnerFromActions(actions), () => 1_700_000_000_500);
}

describe('LegacyActionAdapter (C2)', () => {
  it('maps click to legacy click_element with the element index', async () => {
    const calls: unknown[] = [];
    const adapter = adapterFor([fakeAction('click_element', ok(), calls)]);
    const receipt = await adapter.execute(makeAction('click'));
    expect(calls).toEqual([{ index: 3 }]);
    expect(receipt.status).toBe('applied');
    expect(receipt.actionId).toBe('a-1');
    expect(receipt.beforeRevision).toBe('rev-9');
  });

  it('maps input_text to legacy input_text with index and text', async () => {
    const calls: unknown[] = [];
    const adapter = adapterFor([fakeAction('input_text', ok({ extractedContent: 'filled' }), calls)]);
    const receipt = await adapter.execute(makeAction('input_text'));
    expect(calls).toEqual([{ index: 3, text: 'Ada' }]);
    expect(receipt.status).toBe('applied');
    expect(receipt.evidence).toHaveLength(1);
    expect(receipt.evidence[0].kind).toBe('text');
  });

  it('maps navigate to legacy go_to_url with the url', async () => {
    const calls: unknown[] = [];
    const adapter = adapterFor([fakeAction('go_to_url', ok(), calls)]);
    const receipt = await adapter.execute(makeAction('navigate'));
    expect(calls).toEqual([{ url: 'https://example.test/go' }]);
    expect(receipt.status).toBe('applied');
  });

  it('maps media_control to legacy control_media with the command', async () => {
    const calls: unknown[] = [];
    const adapter = adapterFor([fakeAction('control_media', ok(), calls)]);
    const receipt = await adapter.execute(makeAction('media_control'));
    expect(calls).toEqual([{ command: 'play' }]);
    expect(receipt.status).toBe('applied');
  });

  it('maps the tab actions to legacy switch_tab / open_tab / close_tab', async () => {
    const calls: unknown[] = [];
    const adapter = adapterFor([
      fakeAction('switch_tab', ok(), calls),
      fakeAction('open_tab', ok(), calls),
      fakeAction('close_tab', ok(), calls),
    ]);
    await adapter.execute(makeAction('switch_tab'));
    await adapter.execute(makeAction('open_tab'));
    await adapter.execute(makeAction('close_tab'));
    expect(calls).toEqual([{ tab_id: 7 }, { url: 'https://example.test' }, { tab_id: 7 }]);
  });

  it('maps select_option to legacy select_dropdown_option with option text', async () => {
    const calls: unknown[] = [];
    const adapter = adapterFor([fakeAction('select_dropdown_option', ok(), calls)]);
    await adapter.execute(makeAction('select_option'));
    expect(calls).toEqual([{ index: 3, text: 'China' }]);
  });

  it('returns UNSUPPORTED_ACTION for unmapped kinds instead of silently ignoring', async () => {
    const adapter = adapterFor([]);
    const receipt = await adapter.execute(makeAction('scroll'));
    expect(receipt.status).toBe('blocked');
    expect(receipt.error?.message).toContain(UNSUPPORTED_ACTION);
    expect(adapter.supports('scroll')).toBe(false);
    expect(adapter.supports('click')).toBe(true);
  });

  it('returns UNSUPPORTED_ACTION when the legacy action is absent from the runner', async () => {
    const adapter = adapterFor([]);
    const receipt = await adapter.execute(makeAction('navigate'));
    expect(receipt.status).toBe('blocked');
    expect(receipt.error?.message).toContain(UNSUPPORTED_ACTION);
  });

  it('converts a legacy action error into a mapped BrowserError', async () => {
    const adapter = adapterFor([
      fakeAction('click_element', ok({ success: false, error: 'action_target_stale: index 3' }), []),
    ]);
    const receipt = await adapter.execute(makeAction('click'));
    expect(receipt.status).toBe('blocked');
    expect(receipt.error?.code).toBe('TARGET_STALE');
    expect(receipt.error?.retryable).toBe(true);
  });

  it('maps a thrown legacy error too', async () => {
    const thrower: LegacyActionLike = {
      name: () => 'go_to_url',
      call: async () => {
        throw new Error('navigation timeout after 30s');
      },
    };
    const receipt = await adapterFor([thrower]).execute(makeAction('navigate'));
    expect(receipt.status).toBe('blocked');
    expect(receipt.error?.code).toBe('PROVIDER_TIMEOUT');
  });

  it('never lets a legacy result decide task completion', async () => {
    const calls: unknown[] = [];
    // Even a legacy `done`-style result (isDone: true) must not leak into the receipt.
    const adapter = adapterFor([
      fakeAction('click_element', ok({ isDone: true, extractedContent: 'task complete' }), calls),
    ]);
    const receipt = await adapter.execute(makeAction('click'));
    expect(receipt).not.toHaveProperty('isDone');
    expect(JSON.stringify(receipt)).not.toContain('isDone');
    expect(receipt.status).toBe('applied');
  });
});
