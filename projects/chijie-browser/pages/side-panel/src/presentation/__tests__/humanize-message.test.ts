import { describe, expect, it } from 'vitest';
import { Actors } from '@extension/storage';
import { ExecutionState } from '../../types/event';
import {
  DEFAULT_ZH_COPY,
  assertNoMachineRoleInTitle,
  classifyAgentEvent,
  classifyFailure,
  humanizeStoredMessage,
  looksLikeMachineToken,
  shouldMergeFailure,
} from '../humanize-message';

describe('humanizeStoredMessage', () => {
  it('maps planner step_failed to assistant Chinese failure without enum body', () => {
    const d = humanizeStoredMessage({
      actor: Actors.PLANNER,
      content: 'step_failed',
      timestamp: 1,
    });
    expect(d.title).toBe(DEFAULT_ZH_COPY.assistant);
    expect(d.kind).toBe('failure');
    expect(d.body).not.toMatch(/step_failed/i);
    expect(d.body).toMatch(/没做成|失败|中断/);
    expect(assertNoMachineRoleInTitle(d.title)).toBe(true);
    expect(d.actions).toContain('retry');
  });

  it('maps navigator JSON extract error to parse-failure copy', () => {
    const d = humanizeStoredMessage({
      actor: Actors.NAVIGATOR,
      content: 'Could not manually extract JSON from model output',
      timestamp: 1,
    });
    expect(d.title).toBe('助手');
    expect(d.kind).toBe('failure');
    expect(d.body).toBe(DEFAULT_ZH_COPY.failParse);
    expect(d.body).not.toMatch(/Navigator|PLANNER/i);
  });

  it('keeps user messages as 你', () => {
    const d = humanizeStoredMessage({
      actor: Actors.USER,
      content: '总结当前页面',
      timestamp: 1,
    });
    expect(d.kind).toBe('user');
    expect(d.title).toBe('你');
    expect(d.body).toBe('总结当前页面');
  });

  it('maps progress sentinel to progress kind with assistant title', () => {
    const d = humanizeStoredMessage({
      actor: Actors.PLANNER,
      content: '正在执行...',
      timestamp: 1,
    });
    expect(d.kind).toBe('progress');
    expect(d.title).toBe('助手');
    expect(assertNoMachineRoleInTitle(d.title)).toBe(true);
  });
});

describe('classifyAgentEvent', () => {
  it('STEP_START becomes progress not append', () => {
    expect(
      classifyAgentEvent({
        actor: Actors.PLANNER,
        state: ExecutionState.STEP_START,
        details: '',
      }),
    ).toEqual({ action: 'progress' });
  });

  it('STEP_FAIL becomes append_failure with human content', () => {
    const ui = classifyAgentEvent({
      actor: Actors.NAVIGATOR,
      state: ExecutionState.STEP_FAIL,
      details: 'Could not validate model output',
    });
    expect(ui.action).toBe('append_failure');
    if (ui.action === 'append_failure') {
      expect(ui.content).toBe(DEFAULT_ZH_COPY.failParse);
      expect(ui.content).not.toMatch(/step_failed/i);
    }
  });

  it('STEP_OK machine token is suppressed', () => {
    expect(
      classifyAgentEvent({
        actor: Actors.PLANNER,
        state: ExecutionState.STEP_OK,
        details: 'step_ok',
      }),
    ).toEqual({ action: 'suppress' });
  });

  it('STEP_OK human prose is light process append', () => {
    const ui = classifyAgentEvent({
      actor: Actors.PLANNER,
      state: ExecutionState.STEP_OK,
      details: '先打开表单页面再填写姓名',
    });
    expect(ui.action).toBe('append_assistant');
    if (ui.action === 'append_assistant') {
      expect(ui.content).toContain('表单');
    }
  });
});

describe('classifyFailure / merge', () => {
  it('detects machine tokens', () => {
    expect(looksLikeMachineToken('step_failed')).toBe(true);
    expect(looksLikeMachineToken('先打开页面')).toBe(false);
  });

  it('merges consecutive failures in window', () => {
    expect(
      shouldMergeFailure(
        { actor: Actors.PLANNER, content: 'step_failed', timestamp: 1000 },
        2000,
        4000,
      ),
    ).toBe(true);
    expect(
      shouldMergeFailure(
        { actor: Actors.USER, content: 'hi', timestamp: 1000 },
        2000,
        4000,
      ),
    ).toBe(false);
  });

  it('parse category', () => {
    expect(classifyFailure('validateModelOutput failed').body).toBe(DEFAULT_ZH_COPY.failParse);
  });
});
