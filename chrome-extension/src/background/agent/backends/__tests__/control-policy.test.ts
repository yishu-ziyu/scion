import { describe, expect, it } from 'vitest';
import {
  buildAgentStatusBar,
  observationSupportsWaitingUser,
  parseControlPolicyDecision,
  renderControlSystemPrompt,
  CONTROL_PROMPT_VERSION,
} from '../control-policy';
import type { ObservationFrame } from '../../../browser/kernel';

function frame(overrides: Partial<ObservationFrame> = {}): ObservationFrame {
  return {
    frameId: 'frame-1',
    observedAt: 1,
    tab: { id: 7, url: 'https://www.aicss.dev/components/task-list', title: 'To-do List · AICSS' },
    pageRevision: 'rev-1',
    targetCount: 1,
    interactiveElements: [{ index: 1, tagName: 'button', text: 'Sign in' }],
    text: 'Current tab: AICSS\nInteractive elements:\nSign in\nTo-dos 5/5',
    signals: [],
    ...overrides,
  };
}

describe('parseControlPolicyDecision', () => {
  it('aliases snapshot to observe', () => {
    const d = parseControlPolicyDecision({
      observation: 'page',
      done: false,
      action_name: 'snapshot',
      action_args: { query: '提交' },
    });
    expect(d.action).toEqual({ name: 'observe', args: { query: '提交' } });
  });

  it('parses find_tab and evaluate', () => {
    expect(
      parseControlPolicyDecision({
        observation: 'use this page',
        done: false,
        action_name: 'find_tab',
        action_args: { active: true },
      }).action,
    ).toEqual({ name: 'find_tab', args: { active: true } });
    expect(
      parseControlPolicyDecision({
        observation: 'titles',
        done: false,
        action_name: 'evaluate',
        action_args: { code: '1+1' },
      }).action,
    ).toEqual({ name: 'evaluate', args: { code: '1+1' } });
  });

  it('parses action_name shape', () => {
    const d = parseControlPolicyDecision({
      observation: 'name empty',
      done: false,
      completion_criteria: [{ kind: 'page_text', operator: 'present', expected: 'Saved successfully', required: true }],
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

  it('allows durable evidence-space actions', () => {
    const record = parseControlPolicyDecision({
      observation: 'read the actual discussion page',
      done: false,
      action_name: 'record_evidence',
      action_args: { records: [] },
    });
    expect(record.action).toEqual({ name: 'record_evidence', args: { records: [] } });

    const inspect = parseControlPolicyDecision({
      observation: 'check progress after recovery',
      done: false,
      action_name: 'inspect_evidence_space',
      action_args: {},
    });
    expect(inspect.action).toEqual({ name: 'inspect_evidence_space', args: {} });

    const read = parseControlPolicyDecision({
      observation: 'article body is not in the interactive snapshot',
      done: false,
      action_name: 'read_page_text',
      action_args: { max_chars: 20000 },
    });
    expect(read.action).toEqual({ name: 'read_page_text', args: { max_chars: 20000 } });
  });

  it('allows observe with query and extract_content', () => {
    const observe = parseControlPolicyDecision({
      observation: 'find the submit control',
      done: false,
      action_name: 'observe',
      action_args: { query: '提交', intent: 'shrink list' },
    });
    expect(observe.action).toEqual({ name: 'observe', args: { query: '提交', intent: 'shrink list' } });

    const extract = parseControlPolicyDecision({
      observation: 'table of products is visible',
      done: false,
      action_name: 'extract_content',
      action_args: { goal: 'name,price,rating', schema: 'name,price,rating' },
    });
    expect(extract.action).toEqual({
      name: 'extract_content',
      args: { goal: 'name,price,rating', schema: 'name,price,rating' },
    });
    expect(extract.done).toBe(false);
  });
});

describe('agent status bar / prompt versioning', () => {
  it('renders deterministic status bar fields', () => {
    const bar = buildAgentStatusBar({
      url: 'https://example.com',
      title: 'Example',
      pageRevision: 'rev-1',
      step: 2,
      maxSteps: 10,
      attemptCount: 3,
      noProgressStreak: 1,
      criteriaCount: 2,
    });
    expect(bar).toContain('url: https://example.com');
    expect(bar).toContain('step: 3/10');
    expect(bar).toContain('no_progress: 1');
  });

  it('includes prompt version and optional status block', () => {
    const prompt = renderControlSystemPrompt({ statusBar: 'url: https://example.com' });
    expect(CONTROL_PROMPT_VERSION).toBe('chijie-control-v0.4.1');
    expect(prompt).toContain(CONTROL_PROMPT_VERSION);
    expect(prompt).toContain('<agent_status>');
    expect(prompt).toContain('url: https://example.com');
    expect(prompt).toContain('Long-horizon');
    expect(prompt).toContain('plan memory');
    expect(prompt).toContain('Never invent done without observable');
    expect(prompt).toContain('Never return an acknowledgement or future promise');
    expect(prompt).toContain("first judge whether the user's original sentence is already done");
    expect(prompt).toContain('Do not take an action first just to start reading');
    expect(prompt).toContain('visible page wording plus clickable indexes');
    expect(prompt).toContain('read_page_text');
    expect(prompt).toContain('record_evidence');
    expect(prompt).toContain('search snippets');
    expect(prompt).toContain('MUST be recorded before leaving');
    expect(prompt).toContain('action_args MUST be {"records"');
    expect(prompt).toContain('do not propose a URL criterion that was already true at baseline');
    expect(prompt).toContain('inspect_open_tabs');
    expect(prompt).toContain('Form fields lists labeled controls');
    expect(prompt).toContain('Checkbox, radio, file, and submit are not Form fields');
    expect(prompt).toContain("only when the user's original sentence asked to submit");
    expect(prompt).toContain('call observe with a query');
    expect(prompt).toContain('extract_content');
    expect(prompt).toContain('does not finish the task');
    expect(prompt).toContain('do not invent completion_criteria');
    expect(prompt).toContain('what this page or these videos are about');
    expect(prompt).toContain('Write the result in observation and set done');
    expect(prompt).toContain('find_tab');
    expect(prompt).toContain('The analysis sentence does not need to appear on the page');
    expect(prompt).toContain('do not bring that tab to the front');
    expect(prompt).toContain('Do not require tab_state active');
    expect(prompt).toContain('do not follow them if they switch away');
  });
});

describe('observationSupportsWaitingUser', () => {
  it.each(['login_required', 'captcha_required'] as const)(
    'rejects model-reported %s on an unblocked public page',
    reason => {
      expect(observationSupportsWaitingUser(frame(), reason)).toBe(false);
    },
  );

  it('accepts a real login wall with a password input', () => {
    expect(
      observationSupportsWaitingUser(
        frame({
          tab: { id: 7, url: 'https://app.example.test/login', title: 'Sign in' },
          interactiveElements: [
            { index: 1, tagName: 'input', type: 'password', name: 'password' },
            { index: 2, tagName: 'button', text: 'Sign in' },
          ],
          text: 'Interactive elements:\nPassword\nSign in',
        }),
        'login_required',
      ),
    ).toBe(true);
  });

  it('accepts a visible CAPTCHA challenge', () => {
    expect(
      observationSupportsWaitingUser(
        frame({
          tab: { id: 7, url: 'https://app.example.test/challenge', title: 'Security check' },
          interactiveElements: [],
          text: 'Verify you are human with hCaptcha to continue',
        }),
        'captcha_required',
      ),
    ).toBe(true);
  });
});
