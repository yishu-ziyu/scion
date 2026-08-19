import { describe, expect, it } from 'vitest';
import { buildObservationFrame, renderContextForModel } from '../observation';
import type { PageState } from '../../views';

function node(
  tagName: string,
  attributes: Record<string, string>,
  text: string,
): {
  tagName: string;
  attributes: Record<string, string>;
  getAllTextTillNextClickableElement: () => string;
  hash: () => Promise<{ branchPathHash: string; attributesHash: string; xpathHash: string }>;
} {
  return {
    tagName,
    attributes,
    getAllTextTillNextClickableElement: () => text,
    hash: async () => ({
      branchPathHash: 'b',
      attributesHash: 'a',
      xpathHash: 'x',
    }),
  };
}

function browserState(): PageState {
  return {
    tabId: 7,
    url: 'https://evermind.ai/zh/',
    title: 'EverMind',
    elementTree: { clickableElementsToString: () => '[1] a Home' } as never,
    selectorMap: new Map([[1, node('a', {}, 'Home')]]),
  } as unknown as PageState;
}

describe('buildObservationFrame', () => {
  it('puts visible wording before clickable indexes', async () => {
    const frame = await buildObservationFrame({
      browserState: browserState(),
      elementsText: '[1] a Home',
      visibleText: '自组织记忆。用于结构化长程推理。',
    });
    expect(frame.visibleText).toContain('自组织记忆');
    expect(frame.text).toContain('Visible page text:');
    expect(frame.text).toContain('自组织记忆。用于结构化长程推理。');
    expect(frame.text).toContain('Interactive elements:');
    expect(frame.text.indexOf('Visible page text:')).toBeLessThan(frame.text.indexOf('Interactive elements:'));
  });

  it('lists labeled form fields with current values before clickable indexes', async () => {
    const state = {
      tabId: 3,
      url: 'https://salesforce.com/ap/form/demo/request-a-demo/',
      title: 'Request a Demo',
      elementTree: { clickableElementsToString: () => '[1]<input type=text /> [2]<button>Submit</button>' } as never,
      selectorMap: new Map([
        [1, node('input', { type: 'text', accname: 'First name', value: '' }, '')],
        [2, node('button', { type: 'submit' }, 'REQUEST A DEMO')],
      ]),
    } as unknown as PageState;
    const frame = await buildObservationFrame({
      browserState: state,
      elementsText: '[1]<input type=text /> [2]<button>Submit</button>',
      visibleText: 'Talk to an expert, and get a demo.',
    });
    expect(frame.interactiveElements[0]).toMatchObject({
      index: 1,
      label: 'First name',
      type: 'text',
      value: '',
    });
    expect(frame.text).toContain('Form fields:');
    expect(frame.text).toContain('[1] text "First name" value=(empty)');
    expect(frame.text.indexOf('Form fields:')).toBeLessThan(frame.text.indexOf('Interactive elements:'));
  });

  it('filters clickable controls when query is 提交 and keeps the full list when query is empty', async () => {
    const state = {
      tabId: 3,
      url: 'https://example.test/form',
      title: 'Form',
      elementTree: {
        clickableElementsToString: () =>
          '[1]<a>Home</a> [2]<input type=text /> [3]<button type=submit>提交</button> [4]<button>Cancel</button>',
      } as never,
      selectorMap: new Map([
        [1, node('a', {}, 'Home')],
        [2, node('input', { type: 'text', accname: 'Name' }, '')],
        [3, node('button', { type: 'submit' }, '提交')],
        [4, node('button', {}, 'Cancel')],
      ]),
    } as unknown as PageState;

    const filtered = await buildObservationFrame({
      browserState: state,
      elementsText: '[1]<a>Home</a>\n[2]<input type=text />\n[3]<button type=submit>提交</button>\n[4]<button>Cancel</button>',
      visibleText: 'Name',
      query: '提交',
    });
    expect(filtered.interactiveElements.map(item => item.index)).toEqual([3]);
    expect(filtered.text).toContain('query="提交"');
    expect(filtered.text).toContain('[3]');
    expect(filtered.text).not.toContain('[1]<a>Home</a>');
    expect(filtered.text).not.toContain('[4]<button>Cancel</button>');

    const full = await buildObservationFrame({
      browserState: state,
      elementsText: '[1]<a>Home</a>\n[2]<input type=text />\n[3]<button type=submit>提交</button>\n[4]<button>Cancel</button>',
      visibleText: 'Name',
      query: '',
    });
    expect(full.interactiveElements.map(item => item.index)).toEqual([1, 2, 3, 4]);
    expect(full.text).toContain('Interactive elements:');
    expect(full.text).not.toContain('query=');

    const none = await buildObservationFrame({
      browserState: state,
      elementsText: '[1]<a>Home</a>\n[2]<input type=text />\n[3]<button type=submit>提交</button>\n[4]<button>Cancel</button>',
      visibleText: 'Name',
      query: 'no-such-control',
    });
    expect(none.interactiveElements).toEqual([]);
    expect(none.text).toContain('0 matches');
    expect(none.text).not.toContain('[3]<button type=submit>提交</button>');
  });

  it('lists a form field past the first 80 clickable nav controls', async () => {
    const selectorMap = new Map(
      Array.from({ length: 80 }, (_, index) => [
        index + 1,
        node('a', {}, `Nav ${index + 1}`),
      ]),
    );
    selectorMap.set(81, node('input', { type: 'text', accname: 'Company', value: '' }, ''));
    const state = {
      tabId: 3,
      url: 'https://example.test/form',
      title: 'Form under chrome',
      elementTree: { clickableElementsToString: () => '[81]<input />' } as never,
      selectorMap,
    } as unknown as PageState;
    const frame = await buildObservationFrame({
      browserState: state,
      elementsText: '[1] a Nav 1\n[81]<input type=text />',
      visibleText: 'Request a demo',
    });
    expect(frame.interactiveElements).toHaveLength(80);
    expect(frame.interactiveElements.map(item => item.index)).not.toContain(81);
    expect(frame.formFieldsText).toContain('[81] text "Company" value=(empty)');
    expect(frame.text).toContain('Form fields:');
    expect(frame.text).toContain('[81] text "Company" value=(empty)');
  });

  it('keeps an empty wording slot when the body is blank', async () => {
    const frame = await buildObservationFrame({
      browserState: browserState(),
      elementsText: '',
      visibleText: '',
    });
    expect(frame.visibleText).toBeUndefined();
    expect(frame.text).toContain('Visible page text:\n[empty]');
  });
});

describe('renderContextForModel', () => {
  it('keeps visible wording in diff mode', async () => {
    const frame = await buildObservationFrame({
      browserState: browserState(),
      elementsText: '[1] a Home',
      visibleText: 'Quote this sentence from the article body.',
    });
    const rendered = renderContextForModel({
      frame,
      diffText: 'ObservationDiff: elements +0 -0 ~0',
      useDiff: true,
      forceFull: false,
    });
    expect(rendered.mode).toBe('diff');
    expect(rendered.rendered).toContain('Quote this sentence from the article body.');
    expect(rendered.rendered).toContain('ObservationDiff');
  });
});
