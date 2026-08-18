/**
 * Page-injected fill primitive (Web Bridge fill).
 * Must stay self-contained: Puppeteer serializes this function onto the page.
 */

export type FillMode = 'value' | 'contenteditable' | 'unsupported';

export interface FillResult {
  ok: boolean;
  mode: FillMode;
  tag: string;
  before?: string;
  after?: string;
  error?: string;
}

export function classifyFillTarget(input: {
  tagName?: string;
  isContentEditable?: boolean;
  contentEditableAttr?: string | null;
  disabled?: boolean;
  readOnly?: boolean;
}): FillMode | 'disabled' {
  if (input.disabled || input.readOnly) return 'disabled';
  const editable =
    !!input.isContentEditable || input.contentEditableAttr === 'true' || input.contentEditableAttr === '';
  if (editable) return 'contenteditable';
  const tag = (input.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'value';
  return 'unsupported';
}

/**
 * Clear-and-insert into an input, textarea, select, or contenteditable.
 * Fires input/change so React / Vue / ProseMirror see the edit.
 * Self-contained: Puppeteer serializes this function onto the page. Do not call other module exports.
 */
export function fillEditableElement(el: Element, value: string): FillResult {
  const tag = ((el as HTMLElement).tagName || '').toLowerCase();
  const htmlEl = el as HTMLElement & {
    value?: string;
    disabled?: boolean;
    readOnly?: boolean;
    checked?: boolean;
    type?: string;
    isContentEditable?: boolean;
    innerText?: string;
    focus?: () => void;
  };
  const editableAttr = typeof el.getAttribute === 'function' ? el.getAttribute('contenteditable') : null;
  let mode: FillMode | 'disabled' = 'unsupported';
  if (htmlEl.disabled || htmlEl.readOnly) {
    mode = 'disabled';
  } else if (htmlEl.isContentEditable || editableAttr === 'true' || editableAttr === '') {
    mode = 'contenteditable';
  } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    mode = 'value';
  }

  if (mode === 'disabled') {
    return { ok: false, mode: 'unsupported', tag, error: 'disabled_or_readonly' };
  }
  if (mode === 'unsupported') {
    return { ok: false, mode: 'unsupported', tag, error: 'not_fillable' };
  }

  const readCurrent = (): string => {
    if (mode === 'contenteditable') {
      return String(htmlEl.innerText ?? htmlEl.textContent ?? '');
    }
    return String(htmlEl.value ?? '');
  };

  const before = readCurrent();

  const fire = (type: string, extra?: Record<string, unknown>) => {
    try {
      if (type === 'input' && typeof InputEvent === 'function') {
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            data: value,
            inputType: 'insertFromPaste',
            ...extra,
          }),
        );
        return;
      }
    } catch {
      // fall through to Event
    }
    el.dispatchEvent(new Event(type, { bubbles: true }));
  };

  try {
    htmlEl.focus?.();
  } catch {
    // focus is optional
  }

  if (mode === 'value') {
    try {
      const proto = Object.getPrototypeOf(el);
      const desc =
        Object.getOwnPropertyDescriptor(proto, 'value') ||
        (typeof HTMLInputElement !== 'undefined'
          ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
          : undefined) ||
        (typeof HTMLTextAreaElement !== 'undefined'
          ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
          : undefined);
      if (desc?.set) desc.set.call(el, value);
      else htmlEl.value = value;
    } catch {
      htmlEl.value = value;
    }
    fire('input');
    fire('change');
  } else {
    let inserted = false;
    const doc = el.ownerDocument;
    if (doc && typeof doc.execCommand === 'function') {
      try {
        const sel = doc.getSelection?.() || (typeof window !== 'undefined' ? window.getSelection() : null);
        const range = doc.createRange();
        range.selectNodeContents(el);
        sel?.removeAllRanges();
        sel?.addRange(range);
        inserted = doc.execCommand('insertText', false, value);
      } catch {
        inserted = false;
      }
    }
    if (!inserted) {
      htmlEl.textContent = value;
      fire('input');
    }
    fire('change');
  }

  const after = readCurrent();
  const looksFilled = value === '' ? after.trim() === '' : after.includes(value) || after === value;
  return {
    ok: looksFilled || mode === 'contenteditable',
    mode,
    tag,
    before,
    after,
    error: looksFilled || mode === 'contenteditable' ? undefined : 'value_did_not_stick',
  };
}
