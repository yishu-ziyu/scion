import { describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ActionBuilder } from '../builder';
import type { AgentContext } from '../../types';

function node(tagName: string, attributes: Record<string, string>, text: string) {
  return {
    tagName,
    attributes,
    getAllTextTillNextClickableElement: (): string => text,
  };
}

function formState() {
  return {
    tabId: 1,
    url: 'https://example.test/form',
    title: 'Form',
    selectorMap: new Map([
      [1, node('input', { type: 'text', name: 'name' }, 'Name')],
      [2, node('a', {}, 'Home')],
      [3, node('button', { type: 'submit' }, 'Submit')],
      [4, node('button', {}, 'Cancel')],
    ]),
  };
}

describe('click_element query', () => {
  it('clicks the submit button when query is 提交', async () => {
    const clickElementNode = vi.fn(async () => undefined);
    const getAllTabIds = vi.fn(async () => new Set([1]));
    const state = formState();
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
        getAllTabIds,
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const click = actions.find(action => action.name() === 'click_element');
    const result = await click!.call({ query: '提交', intent: 'submit form' });
    expect(result.error).toBeFalsy();
    expect(clickElementNode).toHaveBeenCalledTimes(1);
    expect(clickElementNode).toHaveBeenCalledWith(expect.anything(), state.selectorMap.get(3));
  });

  it('fills the name field when input_text query is Name', async () => {
    const inputTextElementNode = vi.fn(async () => undefined);
    const state = formState();
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => state,
        getCurrentPage: async () => ({
          getState: async () => state,
          inputTextElementNode,
        }),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const input = actions.find(action => action.name() === 'input_text');
    const result = await input!.call({ query: 'Name', text: 'Ada' });
    expect(result.error).toBeFalsy();
    expect(inputTextElementNode).toHaveBeenCalledTimes(1);
    expect(inputTextElementNode).toHaveBeenCalledWith(expect.anything(), state.selectorMap.get(1), 'Ada');
  });

  it('does not click when query matches nothing, and lists empty candidates', async () => {
    const clickElementNode = vi.fn(async () => undefined);
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => formState(),
        getCurrentPage: async () => ({
          getDomElementByIndex: () => undefined,
          isFileUploader: () => false,
          clickElementNode,
        }),
        getAllTabIds: async () => new Set([1]),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const click = actions.find(action => action.name() === 'click_element');
    const result = await click!.call({ query: '结账' });
    expect(clickElementNode).not.toHaveBeenCalled();
    expect(result.error).toMatch(/Candidates: \(none\)/);
    expect(result.error).toMatch(/Did not click/);
    expect(result.isDone).toBe(false);
  });
});
