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
});
