import { describe, expect, it } from 'vitest';
import {
  BROWSER_ACTION_KINDS,
  BrowserActionSchema,
  ClickActionSchema,
  GoBackActionSchema,
  InputTextActionSchema,
  MediaControlActionSchema,
  NavigateActionSchema,
  OpenTabActionSchema,
  ScrollActionSchema,
  SelectOptionActionSchema,
  SendKeysActionSchema,
  SwitchTabActionSchema,
  CloseTabActionSchema,
  WaitActionSchema,
  assertActionTarget,
  describeActionKind,
  validateActionTarget,
  type BrowserAction,
} from './action';
import { deserializeAction, serializeAction } from './serialize';
import type { ElementTarget, MediaTarget, PageTarget } from './targets';

const elementTarget: ElementTarget = {
  kind: 'element',
  identity: { backendNodeId: 99 },
  pageRevision: 'rev-1',
};
const pageTarget: PageTarget = {
  kind: 'page',
  tabId: 1,
  url: 'https://example.com',
  title: 'x',
  pageRevision: 'rev-1',
};
const mediaTarget: MediaTarget = {
  kind: 'media',
  mediaId: 'm1',
  mediaKind: 'video',
  tabId: 1,
  pageRevision: 'rev-1',
};

function base(id: string) {
  return { protocolVersion: '2' as const, actionId: id, requestedAt: 1700000000000, effect: 'read' as const };
}

describe('BrowserAction discriminated union', () => {
  it('parses a click action', () => {
    const action = ClickActionSchema.parse({ ...base('a1'), kind: 'click', target: elementTarget, input: {} });
    expect(action.effect).toBe('read');
    expect(describeActionKind(action)).toBe('click element');
  });

  it('parses an input_text action', () => {
    const action = InputTextActionSchema.parse({
      ...base('a2'),
      kind: 'input_text',
      effect: 'reversible_write',
      target: elementTarget,
      input: { text: 'hello' },
    });
    expect(BrowserActionSchema.parse(action)).toEqual(action);
  });

  it('parses a navigate action', () => {
    const action = NavigateActionSchema.parse({
      ...base('a3'),
      kind: 'navigate',
      effect: 'external_commit',
      target: pageTarget,
      input: { url: 'https://example.com' },
    });
    expect(describeActionKind(action)).toContain('https://example.com');
  });

  it('parses tab actions', () => {
    expect(
      OpenTabActionSchema.parse({
        ...base('a4'),
        kind: 'open_tab',
        effect: 'reversible_write',
        target: null,
        input: { url: 'https://a.test' },
      }).kind,
    ).toBe('open_tab');
    expect(
      SwitchTabActionSchema.parse({
        ...base('a5'),
        kind: 'switch_tab',
        effect: 'read',
        target: pageTarget,
        input: { tabId: 2 },
      }).kind,
    ).toBe('switch_tab');
    expect(
      CloseTabActionSchema.parse({
        ...base('a6'),
        kind: 'close_tab',
        effect: 'reversible_write',
        target: pageTarget,
        input: { tabId: 2 },
      }).kind,
    ).toBe('close_tab');
  });

  it('parses a media action', () => {
    const action = MediaControlActionSchema.parse({
      ...base('a7'),
      kind: 'media_control',
      effect: 'reversible_write',
      target: mediaTarget,
      input: { command: 'pause' },
    });
    expect(describeActionKind(action)).toBe('media pause');
  });

  it('parses remaining kinds', () => {
    expect(
      SelectOptionActionSchema.parse({
        ...base('b1'),
        kind: 'select_option',
        effect: 'reversible_write',
        target: elementTarget,
        input: { optionText: 'B' },
      }).kind,
    ).toBe('select_option');
    expect(
      SendKeysActionSchema.parse({
        ...base('b2'),
        kind: 'send_keys',
        effect: 'reversible_write',
        target: elementTarget,
        input: { keys: 'Enter' },
      }).kind,
    ).toBe('send_keys');
    expect(
      ScrollActionSchema.parse({
        ...base('b3'),
        kind: 'scroll',
        effect: 'read',
        target: null,
        input: { direction: 'down' },
      }).kind,
    ).toBe('scroll');
    expect(
      GoBackActionSchema.parse({
        ...base('b4'),
        kind: 'go_back',
        effect: 'reversible_write',
        target: pageTarget,
        input: {},
      }).kind,
    ).toBe('go_back');
    expect(
      WaitActionSchema.parse({
        ...base('b5'),
        kind: 'wait',
        effect: 'read',
        target: null,
        input: { condition: { kind: 'url_includes', value: '/done' }, timeoutMs: 5000 },
      }).kind,
    ).toBe('wait');
  });

  it('requires effect on every action (external commits never defaulted)', () => {
    expect(
      BrowserActionSchema.safeParse({
        protocolVersion: '2',
        actionId: 'c1',
        requestedAt: 1700000000000,
        kind: 'click',
        target: elementTarget,
        input: {},
      }).success,
    ).toBe(false);
  });

  it('rejects unknown kinds', () => {
    expect(
      BrowserActionSchema.safeParse({ ...base('c2'), kind: 'teleport', effect: 'read', target: null, input: {} })
        .success,
    ).toBe(false);
  });

  it('has no task-completion field', () => {
    const action: BrowserAction = ClickActionSchema.parse({
      ...base('c3'),
      kind: 'click',
      effect: 'read',
      target: elementTarget,
      input: {},
    });
    expect(Object.keys(action)).not.toContain('isDone');
  });

  it('round-trips through JSON', () => {
    const action = WaitActionSchema.parse({
      ...base('c4'),
      kind: 'wait',
      effect: 'read',
      target: null,
      input: { condition: { kind: 'revision_changed', fromRevision: 'r1' }, timeoutMs: 1000 },
    });
    expect(deserializeAction(serializeAction(action))).toEqual(action);
  });
});

describe('target policy (validateActionTarget)', () => {
  it('rejects clicking a page target before execution', () => {
    const action = BrowserActionSchema.parse({
      ...base('d1'),
      kind: 'click',
      effect: 'read',
      target: pageTarget,
      input: {},
    });
    expect(validateActionTarget(action)).toEqual({
      ok: false,
      reason: "action kind 'click' does not accept target kind 'page'",
    });
    expect(() => assertActionTarget(action)).toThrow(/does not accept/);
  });

  it('rejects an element target for open_tab', () => {
    const action = BrowserActionSchema.parse({
      ...base('d2'),
      kind: 'open_tab',
      effect: 'reversible_write',
      target: elementTarget,
      input: { url: 'https://a.test' },
    });
    expect(validateActionTarget(action).ok).toBe(false);
  });

  it('rejects non-media targets for media_control', () => {
    const action = BrowserActionSchema.parse({
      ...base('d3'),
      kind: 'media_control',
      effect: 'reversible_write',
      target: pageTarget,
      input: { command: 'play' },
    });
    expect(validateActionTarget(action).ok).toBe(false);
  });

  it('accepts legal combinations', () => {
    const legal: BrowserAction[] = [
      ClickActionSchema.parse({ ...base('d4'), kind: 'click', effect: 'read', target: elementTarget, input: {} }),
      OpenTabActionSchema.parse({
        ...base('d5'),
        kind: 'open_tab',
        effect: 'reversible_write',
        target: null,
        input: { url: 'https://a.test' },
      }),
      MediaControlActionSchema.parse({
        ...base('d6'),
        kind: 'media_control',
        effect: 'reversible_write',
        target: mediaTarget,
        input: { command: 'play' },
      }),
    ];
    for (const action of legal) expect(validateActionTarget(action).ok).toBe(true);
  });
});

describe('exhaustiveness', () => {
  it('describeActionKind handles every declared kind', () => {
    const samples: Record<string, Record<string, unknown>> = {
      navigate: { input: { url: 'https://a.test' }, target: null },
      click: { input: {}, target: elementTarget },
      input_text: { input: { text: 'x' }, target: elementTarget },
      select_option: { input: { optionText: 'A' }, target: elementTarget },
      send_keys: { input: { keys: 'a' }, target: elementTarget },
      scroll: { input: { direction: 'up' }, target: null },
      open_tab: { input: { url: 'https://a.test' }, target: null },
      switch_tab: { input: { tabId: 1 }, target: pageTarget },
      close_tab: { input: { tabId: 1 }, target: pageTarget },
      go_back: { input: {}, target: pageTarget },
      media_control: { input: { command: 'play' }, target: mediaTarget },
      wait: { input: { condition: { kind: 'text_includes', value: 'x' }, timeoutMs: 1 }, target: null },
    };
    expect(BROWSER_ACTION_KINDS.length).toBe(12);
    for (const kind of BROWSER_ACTION_KINDS) {
      const action = BrowserActionSchema.parse({ ...base(`e-${kind}`), kind, effect: 'read', ...samples[kind] });
      expect(typeof describeActionKind(action)).toBe('string');
    }
  });
});
