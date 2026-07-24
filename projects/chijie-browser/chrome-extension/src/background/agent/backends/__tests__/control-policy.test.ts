import { describe, expect, it } from 'vitest';
import { parseControlPolicyDecision } from '../control-policy';

describe('parseControlPolicyDecision', () => {
  it('parses action_name shape', () => {
    const d = parseControlPolicyDecision({
      observation: 'name empty',
      done: false,
      completion_criteria: [
        { kind: 'page_text', operator: 'present', expected: 'Saved successfully', required: true },
      ],
      action_name: 'input_text',
      action_args: { index: 1, text: 'BakeoffName', intent: 'fill' },
    });
    expect(d.done).toBe(false);
    expect(d.criteria).toHaveLength(1);
    expect(d.action).toEqual({
      name: 'input_text',
      args: { index: 1, text: 'BakeoffName', intent: 'fill' },
    });
  });

  it('parses navigator-style action array', () => {
    const d = parseControlPolicyDecision({
      observation: 'ok',
      done: false,
      action: [{ click_element: { index: 3, intent: 'submit' } }],
    });
    expect(d.action).toEqual({ name: 'click_element', args: { index: 3, intent: 'submit' } });
  });

  it('coerces string index to number and drops NaN', () => {
    const ok = parseControlPolicyDecision({
      observation: 'click first card',
      done: false,
      action_name: 'click_element',
      action_args: { index: '12', intent: 'open video' },
    });
    expect(ok.action).toEqual({ name: 'click_element', args: { index: 12, intent: 'open video' } });

    const bad = parseControlPolicyDecision({
      observation: 'bad index',
      done: false,
      action_name: 'click_element',
      action_args: { index: 'not-a-number' },
    });
    expect(bad.action).toEqual({ name: 'click_element', args: {} });
  });

  it('done true clears action', () => {
    const d = parseControlPolicyDecision({
      observation: 'saved',
      done: true,
      action_name: 'click_element',
      action_args: { index: 1 },
    });
    expect(d.done).toBe(true);
    expect(d.action).toBeNull();
  });

  it('action_name done becomes candidate complete', () => {
    const d = parseControlPolicyDecision({
      observation: 'done',
      done: false,
      action_name: 'done',
      action_args: { text: 'ok', success: true },
    });
    expect(d.done).toBe(true);
    expect(d.action).toBeNull();
  });

  it('parses control_media', () => {
    const d = parseControlPolicyDecision({
      observation: 'audio visible',
      done: false,
      completion_criteria: [{ kind: 'media_state', operator: 'equals', expected: 'paused', required: true }],
      action: { name: 'control_media', args: { command: 'play' } },
    });
    expect(d.action).toEqual({ name: 'control_media', args: { command: 'play' } });
    expect(d.criteria[0]).toMatchObject({ kind: 'media_state', expected: 'paused' });
  });

  it('aliases focus_tab to switch_tab and parses tab/download criteria', () => {
    const d = parseControlPolicyDecision({
      observation: 'user wants this tab closed',
      done: false,
      completion_criteria: [
        { kind: 'tab_state', operator: 'equals', expected: 'closed', required: true },
        { kind: 'download_state', operator: 'equals', expected: 'finished', required: true },
      ],
      action_name: 'focus_tab',
      action_args: { tab_id: 12 },
    });
    expect(d.action).toEqual({ name: 'switch_tab', args: { tab_id: 12 } });
    expect(d.criteria).toEqual([
      { kind: 'tab_state', operator: 'equals', expected: 'closed', required: true },
      { kind: 'download_state', operator: 'equals', expected: 'finished', required: true },
    ]);
  });

  it('parses save_screenshot', () => {
    const d = parseControlPolicyDecision({
      observation: 'page ready',
      done: false,
      action_name: 'save_screenshot',
      action_args: { filename: 'sspai-home.jpg', intent: 'save page shot' },
    });
    expect(d.action).toEqual({
      name: 'save_screenshot',
      args: { filename: 'sspai-home.jpg', intent: 'save page shot' },
    });
  });
});
