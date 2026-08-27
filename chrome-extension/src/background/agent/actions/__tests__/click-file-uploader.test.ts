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

describe('click_element file uploader', () => {
  it('does not treat clicking a file uploader as a successful step', async () => {
    const clickElementNode = vi.fn(async () => undefined);
    const state = {
      tabId: 1,
      url: 'https://example.test/form',
      title: 'Form',
      selectorMap: new Map([[7, node('input', { type: 'file', name: 'resume' }, 'Choose file')]]),
    };
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => state,
        getCurrentPage: async () => ({
          getDomElementByIndex: (index: number) => state.selectorMap.get(index),
          isFileUploader: () => true,
          clickElementNode,
        }),
        getAllTabIds: async () => new Set([1]),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const click = actions.find(action => action.name() === 'click_element');
    const result = await click!.call({ index: 7, intent: 'upload resume' });
    expect(clickElementNode).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.isDone).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/文件|file/i);
    expect(result.extractedContent).toBeFalsy();
  });

  it('does not treat a query click on a file uploader as a successful step', async () => {
    const clickElementNode = vi.fn(async () => undefined);
    const state = {
      tabId: 1,
      url: 'https://example.test/form',
      title: 'Form',
      selectorMap: new Map([
        [2, node('a', {}, 'Home')],
        [7, node('input', { type: 'file', name: 'resume' }, 'Choose file')],
      ]),
    };
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => state,
        getCurrentPage: async () => ({
          getDomElementByIndex: (index: number) => state.selectorMap.get(index),
          isFileUploader: (element: { attributes?: { type?: string } }) => element?.attributes?.type === 'file',
          clickElementNode,
        }),
        getAllTabIds: async () => new Set([1]),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const click = actions.find(action => action.name() === 'click_element');
    const result = await click!.call({ query: 'Choose file', intent: 'upload resume' });
    expect(clickElementNode).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.extractedContent).toBeFalsy();
  });
});
