import { describe, expect, it } from 'vitest';
import { describeFormControl, isFillableControl, renderFormFieldsBlock } from '../form-fields';
import type { InteractiveElementDigest } from '../types';

function field(partial: Partial<InteractiveElementDigest> & { index: number }): InteractiveElementDigest {
  return partial;
}

describe('form field view', () => {
  it('treats inputs, textareas, and contenteditable as fillable', () => {
    expect(isFillableControl(field({ index: 1, tagName: 'input', type: 'text' }))).toBe(true);
    expect(isFillableControl(field({ index: 2, tagName: 'textarea' }))).toBe(true);
    expect(isFillableControl(field({ index: 3, tagName: 'div', contentEditable: true }))).toBe(true);
    expect(isFillableControl(field({ index: 4, tagName: 'a', text: 'Home' }))).toBe(false);
    expect(isFillableControl(field({ index: 5, tagName: 'input', type: 'checkbox' }))).toBe(false);
    expect(isFillableControl(field({ index: 6, tagName: 'input', type: 'submit' }))).toBe(false);
  });

  it('prints label and current value for a Salesforce-style form', () => {
    const lines = renderFormFieldsBlock([
      field({ index: 1, tagName: 'input', type: 'text', label: 'First name', value: '' }),
      field({ index: 2, tagName: 'input', type: 'email', label: 'Work email', value: 'alex@' }),
      field({
        index: 3,
        tagName: 'div',
        contentEditable: true,
        label: 'Notes',
        value: 'hello',
      }),
      field({ index: 9, tagName: 'button', text: 'REQUEST A DEMO' }),
    ]);
    expect(lines).toContain('Form fields:');
    expect(lines).toContain('[1] text "First name" value=(empty)');
    expect(lines).toContain('[2] email "Work email" value=alex@');
    expect(lines).toContain('[3] contenteditable "Notes" value=hello');
    expect(lines).not.toContain('REQUEST A DEMO');
  });

  it('falls back to placeholder then name when no accessible label', () => {
    expect(
      describeFormControl(field({ index: 5, tagName: 'input', type: 'text', placeholder: 'Company', name: 'co' })),
    ).toBe('[5] text "Company" value=(empty)');
  });
});
