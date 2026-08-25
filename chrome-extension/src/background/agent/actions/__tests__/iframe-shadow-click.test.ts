import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ActionBuilder } from '../builder';
import type { AgentContext } from '../../types';
import { applyCdpHandles } from '../../../browser/cdp/merge';
import { walkInteractiveNodes } from '../../../browser/cdp/collect';
import { clickCdpElement } from '../../../browser/cdp/click';
import { resolveIntent } from '../../../browser/kernel/resolve-intent';
import { digestInteractiveElements } from '../../../browser/kernel/observation';
import { DOMElementNode } from '../../../browser/dom/views';
import {
  iframeShadowFrameDocument,
  iframeShadowMainDocument,
} from '../../../browser/cdp/__tests__/iframe-shadow-fixture';
import type { PageState } from '../../../browser/views';

function fixtureState(): PageState {
  const tree = new DOMElementNode({
    tagName: 'body',
    xpath: '/body',
    attributes: {},
    children: [],
    isVisible: true,
  });
  const selectorMap = new Map<number, DOMElementNode>();
  const collected = [
    ...walkInteractiveNodes(iframeShadowMainDocument(), { tabId: 7, frameId: 'main' }),
    ...walkInteractiveNodes(iframeShadowFrameDocument(), {
      tabId: 7,
      frameId: 'iframe-pay',
      targetId: 'tgt-iframe',
      inIframe: true,
    }),
  ];
  applyCdpHandles(tree, selectorMap, collected);
  return {
    tabId: 7,
    url: 'https://shop.test/checkout',
    title: 'Checkout',
    elementTree: tree,
    selectorMap,
    screenshot: null,
    scrollY: 0,
    scrollHeight: 0,
    visualViewportHeight: 0,
  };
}

describe('iframe + shadow query click', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('observe digest keeps backendNodeId for iframe submit and shadow pay', () => {
    const digested = digestInteractiveElements(fixtureState(), 2000);
    const submit = digested.find(item => item.text === '提交');
    const pay = digested.find(item => item.text === '结算');
    expect(submit?.backendNodeId).toBe(22);
    expect(submit?.cdpTargetId).toBe('tgt-iframe');
    expect(pay?.backendNodeId).toBe(13);
    expect(pay?.cdpFrameId).toBe('main');
  });

  it('query 提交 resolves to the iframe submit and clicks that node', async () => {
    const state = fixtureState();
    const digested = digestInteractiveElements(state, 2000);
    const resolved = resolveIntent(digested, '提交');
    expect(resolved.kind).toBe('match');
    if (resolved.kind === 'match') {
      expect(resolved.element.backendNodeId).toBe(22);
      expect(resolved.element.type).toBe('submit');
    }

    const clickElementNode = vi.fn(async () => undefined);
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => state,
        getCurrentPage: async () => ({
          getDomElementByIndex: (index: number) => state.selectorMap.get(index),
          isFileUploader: () => false,
          clickElementNode,
        }),
        getAllTabIds: async () => new Set([7]),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const click = actions.find(action => action.name() === 'click_element');
    const result = await click!.call({ query: '提交' });
    expect(result.error).toBeFalsy();
    expect(clickElementNode).toHaveBeenCalledTimes(1);
    expect(clickElementNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ backendNodeId: 22, cdpTargetId: 'tgt-iframe' }),
    );
  });

  it('query 结算 resolves to the shadow button and CDP click uses backendNodeId 13', async () => {
    const state = fixtureState();
    const digested = digestInteractiveElements(state, 2000);
    const resolved = resolveIntent(digested, '结算');
    expect(resolved.kind).toBe('match');
    if (resolved.kind !== 'match') return;

    const api = {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async (...args: unknown[]) => {
        if (args[1] === 'DOM.getBoxModel') {
          return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
        }
        return {};
      }),
      getTargets: vi.fn(async () => []),
    };
    vi.stubGlobal('chrome', { debugger: api });

    const node = state.selectorMap.get(resolved.index);
    expect(node?.backendNodeId).toBe(13);
    await clickCdpElement({
      tabId: node!.tabId ?? 7,
      frameId: node!.cdpFrameId ?? 'main',
      backendNodeId: node!.backendNodeId!,
      targetId: node!.cdpTargetId,
    });
    expect(api.sendCommand).toHaveBeenCalledWith(
      { tabId: 7 },
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed' }),
    );
    expect(api.sendCommand.mock.calls.some(call => call[1] === 'Input.dispatchMouseEvent')).toBe(true);
  });

  it('does not click when query matches nothing', async () => {
    const clickElementNode = vi.fn(async () => undefined);
    const state = fixtureState();
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => state,
        getCurrentPage: async () => ({
          getDomElementByIndex: (index: number) => state.selectorMap.get(index),
          isFileUploader: () => false,
          clickElementNode,
        }),
        getAllTabIds: async () => new Set([7]),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const click = actions.find(action => action.name() === 'click_element');
    const result = await click!.call({ query: '不存在的按钮' });
    expect(clickElementNode).not.toHaveBeenCalled();
    expect(result.error).toMatch(/Did not act/);
  });
});
