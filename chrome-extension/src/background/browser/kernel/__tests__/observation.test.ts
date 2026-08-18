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
