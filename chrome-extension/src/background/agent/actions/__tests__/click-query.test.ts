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
    expect(result.error).toMatch(/Did not act/);
    expect(result.isDone).toBe(false);
  });

  it('does not click when several named controls match, and returns those names as waitAsk', async () => {
    const clickElementNode = vi.fn(async () => undefined);
    const state = {
      tabId: 1,
      url: 'https://example.test/form',
      title: 'Form',
      selectorMap: new Map([
        [3, node('button', { type: 'submit' }, 'Submit')],
        [5, node('button', { type: 'submit' }, 'Submit')],
      ]),
    };
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
        getAllTabIds: async () => new Set([1]),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const click = actions.find(action => action.name() === 'click_element');
    const result = await click!.call({ query: 'Submit', index: 3, intent: 'submit form' });
    expect(clickElementNode).not.toHaveBeenCalled();
    expect(result.error).toBe('target_ambiguous');
    expect(result.waitAsk?.prompt).toContain('Submit');
    expect(result.waitAsk?.prompt).not.toMatch(/点哪里|点击位置/);
    expect(result.waitAsk?.options.map(option => option.sendText)).toEqual(['第1个Submit', '第2个Submit']);
  });

  it('does not fill when several named fields match the same query', async () => {
    const inputTextElementNode = vi.fn(async () => undefined);
    const state = {
      tabId: 1,
      url: 'https://example.test/form',
      title: 'Form',
      selectorMap: new Map([
        [1, node('input', { type: 'text' }, 'Name')],
        [4, node('input', { type: 'text' }, 'Name')],
      ]),
    };
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
    expect(inputTextElementNode).not.toHaveBeenCalled();
    expect(result.error).toBe('target_ambiguous');
    expect(result.waitAsk?.options.map(option => option.sendText)).toEqual(['第1个Name', '第2个Name']);
  });

  it('does not invent waitAsk when several matching controls have no visible name', async () => {
    const clickElementNode = vi.fn(async () => undefined);
    const state = {
      tabId: 1,
      url: 'https://example.test/form',
      title: 'Form',
      selectorMap: new Map([
        [1, node('button', {}, '')],
        [2, node('button', {}, '')],
      ]),
    };
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
        getAllTabIds: async () => new Set([1]),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const click = actions.find(action => action.name() === 'click_element');
    const result = await click!.call({ query: 'button' });
    expect(clickElementNode).not.toHaveBeenCalled();
    expect(result.waitAsk).toBeNull();
    expect(result.error).toMatch(/Did not act/);
  });

  it('selects the only native dropdown whose visible name matches the query', async () => {
    const selectDropdownOption = vi.fn(async () => 'selected');
    const state = {
      tabId: 1,
      url: 'https://example.test/form',
      title: 'Form',
      selectorMap: new Map([
        [2, node('select', {}, '账单国家')],
        [3, node('button', { type: 'submit' }, 'Submit')],
      ]),
    };
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => state,
        getCurrentPage: async () => ({
          getState: async () => state,
          selectDropdownOption,
        }),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const select = actions.find(action => action.name() === 'select_dropdown_option');
    const result = await select!.call({ query: '国家', text: '中国', intent: 'choose country' });
    expect(result.error).toBeFalsy();
    expect(selectDropdownOption).toHaveBeenCalledWith(2, '中国');
  });

  it('does not change a native dropdown when several named selects match', async () => {
    const selectDropdownOption = vi.fn(async () => 'selected');
    const getDropdownOptions = vi.fn(async () => [{ index: 0, text: '中国' }]);
    const state = {
      tabId: 1,
      url: 'https://example.test/form',
      title: 'Form',
      selectorMap: new Map([
        [2, node('select', {}, '账单国家')],
        [6, node('select', {}, '收货国家')],
      ]),
    };
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => state,
        getCurrentPage: async () => ({
          getState: async () => state,
          selectDropdownOption,
          getDropdownOptions,
        }),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const select = actions.find(action => action.name() === 'select_dropdown_option');
    const listed = actions.find(action => action.name() === 'get_dropdown_options');
    const selected = await select!.call({ query: '国家', text: '中国', intent: 'choose country' });
    const options = await listed!.call({ query: '国家', intent: 'list country options' });
    expect(selectDropdownOption).not.toHaveBeenCalled();
    expect(getDropdownOptions).not.toHaveBeenCalled();
    expect(selected.error).toBe('target_ambiguous');
    expect(options.error).toBe('target_ambiguous');
    expect(selected.waitAsk?.options.map(option => option.sendText)).toEqual(['账单国家', '收货国家']);
    expect(options.waitAsk?.options.map(option => option.sendText)).toEqual(['账单国家', '收货国家']);
    expect(selected.waitAsk?.prompt).not.toMatch(/点哪里|点击位置|国家下拉/);
  });

  it('does not invent waitAsk when the query binds a non-select control', async () => {
    const selectDropdownOption = vi.fn(async () => 'selected');
    const state = formState();
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => state,
        getCurrentPage: async () => ({
          getState: async () => state,
          selectDropdownOption,
        }),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const select = actions.find(action => action.name() === 'select_dropdown_option');
    const result = await select!.call({ query: '提交', text: '中国' });
    expect(selectDropdownOption).not.toHaveBeenCalled();
    expect(result.waitAsk).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
