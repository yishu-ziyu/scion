import { describe, expect, it } from 'vitest';
import { classifyFillTarget, fillEditableElement } from '../fill-text';

function fakeInput(initial = '') {
  const events: string[] = [];
  const el = {
    tagName: 'INPUT',
    value: initial,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    getAttribute: (name: string) => (name === 'type' ? 'text' : null),
    dispatchEvent(event: Event) {
      events.push(event.type);
      return true;
    },
    focus() {},
  };
  return { el: el as unknown as Element, events, read: () => el.value };
}

function fakeContentEditable(initial = '') {
  const events: string[] = [];
  const el = {
    tagName: 'DIV',
    textContent: initial,
    innerText: initial,
    isContentEditable: true,
    disabled: false,
    readOnly: false,
    ownerDocument: null,
    getAttribute: (name: string) => (name === 'contenteditable' ? 'true' : null),
    dispatchEvent(event: Event) {
      events.push(event.type);
      return true;
    },
    focus() {},
  };
  return { el: el as unknown as Element, events, read: () => el.textContent };
}

describe('fillEditableElement serialization', () => {
  it('does not close over other module exports (Puppeteer page.evaluate)', () => {
    expect(fillEditableElement.toString()).not.toContain('classifyFillTarget');
  });
});

describe('classifyFillTarget', () => {
  it('routes native fields to value and editors to contenteditable', () => {
    expect(classifyFillTarget({ tagName: 'input' })).toBe('value');
    expect(classifyFillTarget({ tagName: 'textarea' })).toBe('value');
    expect(classifyFillTarget({ tagName: 'select' })).toBe('value');
    expect(classifyFillTarget({ tagName: 'div', isContentEditable: true })).toBe('contenteditable');
    expect(classifyFillTarget({ tagName: 'button' })).toBe('unsupported');
    expect(classifyFillTarget({ tagName: 'input', disabled: true })).toBe('disabled');
  });
});

describe('fillEditableElement', () => {
  it('clears and inserts on a text input and fires input+change', () => {
    const { el, events, read } = fakeInput('old');
    const result = fillEditableElement(el, 'Alex Chen');
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('value');
    expect(read()).toBe('Alex Chen');
    expect(events).toContain('input');
    expect(events).toContain('change');
  });

  it('replaces contenteditable text when execCommand is unavailable', () => {
    const { el, events, read } = fakeContentEditable('draft');
    const result = fillEditableElement(el, 'final copy');
    expect(result.mode).toBe('contenteditable');
    expect(result.ok).toBe(true);
    expect(read()).toBe('final copy');
    expect(events).toContain('input');
  });

  it('sets select value and fires change', () => {
    const events: string[] = [];
    const el = {
      tagName: 'SELECT',
      value: '',
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      getAttribute: () => null,
      dispatchEvent(event: Event) {
        events.push(event.type);
        return true;
      },
      focus() {},
    } as unknown as Element;
    const result = fillEditableElement(el, 'CN');
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('value');
    expect((el as unknown as { value: string }).value).toBe('CN');
    expect(events).toContain('change');
  });

  it('refuses buttons and file-like unsupported targets', () => {
    const el = {
      tagName: 'BUTTON',
      isContentEditable: false,
      getAttribute: () => null,
      dispatchEvent() {
        return true;
      },
    } as unknown as Element;
    const result = fillEditableElement(el, 'nope');
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('unsupported');
  });
});
