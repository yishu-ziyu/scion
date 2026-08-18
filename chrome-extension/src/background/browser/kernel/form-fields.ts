/**
 * Form-control view for the model: label, kind, current value.
 * Indexes stay the same highlight refs as Interactive elements.
 */

import type { InteractiveElementDigest } from './types';

const FILLABLE_TAGS = new Set(['input', 'textarea', 'select']);
const FILLABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'file',
  'submit',
  'button',
  'image',
  'reset',
  'hidden',
  'range',
  'color',
]);

const VALUE_MAX = 120;

export function isFillableControl(el: InteractiveElementDigest): boolean {
  if (el.contentEditable) return true;
  const role = (el.role || '').toLowerCase();
  if (role === 'checkbox' || role === 'radio') return false;
  const type = (el.type || '').toLowerCase();
  if (NON_TEXT_INPUT_TYPES.has(type)) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (FILLABLE_TAGS.has(tag)) return true;
  return FILLABLE_ROLES.has(role);
}

export function controlLabel(el: InteractiveElementDigest): string {
  const raw = el.label || el.placeholder || el.text || el.name || el.id || '';
  return raw.replace(/\s+/g, ' ').trim();
}

export function controlKind(el: InteractiveElementDigest): string {
  if (el.contentEditable) return 'contenteditable';
  const type = (el.type || '').trim();
  if (type) return type;
  const role = (el.role || '').trim();
  if (role) return role;
  return (el.tagName || 'field').toLowerCase();
}

export function formatControlValue(value: string | undefined): string {
  if (value === undefined || value === '') return '(empty)';
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '(empty)';
  if (oneLine.length <= VALUE_MAX) return oneLine;
  return `${oneLine.slice(0, VALUE_MAX)}…`;
}

export function describeFormControl(el: InteractiveElementDigest): string {
  const name = controlLabel(el);
  const namePart = name ? ` "${name}"` : '';
  const checked = el.checked !== undefined && el.checked !== '' ? ` checked=${el.checked}` : '';
  return `[${el.index}] ${controlKind(el)}${namePart} value=${formatControlValue(el.value)}${checked}`;
}

export function renderFormFieldsBlock(elements: InteractiveElementDigest[]): string {
  const fields = elements.filter(isFillableControl);
  if (!fields.length) return '';
  return `Form fields:\n${fields.map(describeFormControl).join('\n')}`;
}
