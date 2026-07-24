/**
 * Control-loop ExecutorDriver (design/002).
 *
 * M2-S4: scripted policy drives hooks under TaskManager (fixture/journey tests).
 * LLM-backed policy is a follow-up within M2; without a policy, production must
 * select `nano` or inject steps.
 *
 * All side effects go through ExecutorHooks.dispatchAction — never Action.call bypass.
 * Media uses control_media → Page.controlMedia (element API), not shadow clicks.
 */
import { Action } from '../actions/builder';
import {
  clickElementActionSchema,
  controlMediaActionSchema,
  doneActionSchema,
  goToUrlActionSchema,
  inputTextActionSchema,
  waitActionSchema,
  type ActionSchema,
} from '../actions/schemas';
import { ActionResult } from '../types';
import type {
  CompletionCriterionDraft,
  ExecutorDriver,
  ExecutorHooks,
  ExecutorInput,
  ExecutorOutcome,
} from '../../task/contracts';
import { createLogger } from '../../log';

const logger = createLogger('ControlLoopBackend');

export type ControlScriptStep =
  | { type: 'plan'; criteria: CompletionCriterionDraft[] }
  | { type: 'action'; name: string; args: Record<string, unknown> }
  | { type: 'candidate_complete'; summary?: string }
  | { type: 'fail'; category: string }
  | { type: 'waiting_user'; reason: 'login_required' | 'captcha_required' | 'target_missing' };

export interface ControlLoopOptions {
  /** Ordered script for tests / deterministic fixture drivers. */
  steps: ControlScriptStep[];
  /** Optional real action handlers keyed by action name (e.g. control_media → page API). */
  actionHandlers?: Record<string, (args: Record<string, unknown>) => Promise<ActionResult>>;
}

const SCHEMA_BY_NAME: Record<string, ActionSchema> = {
  done: doneActionSchema,
  input_text: inputTextActionSchema,
  click_element: clickElementActionSchema,
  control_media: controlMediaActionSchema,
  go_to_url: goToUrlActionSchema,
  wait: waitActionSchema,
};

function makeAction(name: string, handlers?: ControlLoopOptions['actionHandlers']): Action {
  const schema = SCHEMA_BY_NAME[name];
  if (!schema) {
    throw new Error(`control-loop: unsupported action "${name}"`);
  }
  const hasIndex = name === 'input_text' || name === 'click_element';
  return new Action(
    async (input: Record<string, unknown>) => {
      const handler = handlers?.[name];
      if (handler) return handler(input);
      // Default no-op success: TaskManager journey tests only need policy/approval/evidence paths.
      return new ActionResult({
        success: true,
        extractedContent: name === 'done' ? String(input.text ?? '') : null,
        isDone: name === 'done',
      });
    },
    schema,
    hasIndex,
  );
}

/**
 * Deterministic control driver: executes scripted steps via TaskManager hooks.
 */
export function createControlLoopDriver(
  input: ExecutorInput,
  hooks: ExecutorHooks,
  options: ControlLoopOptions,
): ExecutorDriver {
  let paused = false;
  let stopped = false;
  const followUps: string[] = [];
  let resumeWaiters: Array<() => void> = [];

  const waitIfPaused = async () => {
    while (paused && !stopped) {
      await new Promise<void>(resolve => {
        resumeWaiters.push(resolve);
      });
    }
  };

  return {
    run: async (roundId: string): Promise<ExecutorOutcome> => {
      logger.info('control-loop run', { taskId: input.taskId, roundId, steps: options.steps.length });
      const instruction = [input.instruction, ...followUps].join('\n');
      void instruction;

      for (const step of options.steps) {
        if (stopped) return { kind: 'cancelled' };
        await waitIfPaused();
        if (stopped) return { kind: 'cancelled' };

        switch (step.type) {
          case 'plan':
            await hooks.onPlan(roundId, step.criteria);
            break;
          case 'action': {
            const action = makeAction(step.name, options.actionHandlers);
            const result = await hooks.dispatchAction(roundId, action, step.args);
            if (result.actionResult?.error) {
              return { kind: 'failed', category: 'action_failed' };
            }
            break;
          }
          case 'candidate_complete':
            return { kind: 'candidate_complete', summary: step.summary ?? 'Control loop candidate complete' };
          case 'fail':
            return { kind: 'failed', category: step.category };
          case 'waiting_user':
            return { kind: 'waiting_user', reason: step.reason };
          default:
            return { kind: 'failed', category: 'unknown_step' };
        }
      }
      return { kind: 'failed', category: 'control_script_exhausted' };
    },
    addFollowUp: instruction => {
      followUps.push(instruction);
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      const waiters = resumeWaiters;
      resumeWaiters = [];
      for (const w of waiters) w();
    },
    stop: async () => {
      stopped = true;
      paused = false;
      const waiters = resumeWaiters;
      resumeWaiters = [];
      for (const w of waiters) w();
    },
  };
}

/**
 * Fixture form script: plan success text → fill → submit (approval gated by EffectPolicy) → candidate complete.
 * Fill/submit use real indices when wired to a live page; in pure TaskManager tests handlers may no-op.
 */
export function fixtureFormControlSteps(opts?: {
  nameText?: string;
  nameIndex?: number;
  submitIndex?: number;
  successText?: string;
}): ControlScriptStep[] {
  const nameText = opts?.nameText ?? 'BakeoffName';
  const nameIndex = opts?.nameIndex ?? 1;
  const submitIndex = opts?.submitIndex ?? 2;
  const successText = opts?.successText ?? 'Saved successfully';
  return [
    {
      type: 'plan',
      criteria: [{ kind: 'page_text', operator: 'present', expected: successText, required: true }],
    },
    {
      type: 'action',
      name: 'input_text',
      args: { intent: 'fill name', index: nameIndex, text: nameText },
    },
    {
      type: 'action',
      name: 'click_element',
      args: { intent: 'submit form', index: submitIndex },
    },
    { type: 'candidate_complete', summary: 'Form submit candidate' },
  ];
}

/**
 * Navigate-first script (ticket 02): plan url → go_to_url → wait → candidate complete.
 * Demoable without LLM; TaskManager still records attempts for side-panel steps.
 */
export function fixtureNavigateControlSteps(opts?: { url?: string; urlStartsWith?: string }): ControlScriptStep[] {
  const url = opts?.url ?? 'https://www.youtube.com/';
  const expected = opts?.urlStartsWith ?? 'https://www.youtube.com';
  return [
    {
      type: 'plan',
      criteria: [{ kind: 'url', operator: 'starts_with', expected, required: true }],
    },
    {
      type: 'action',
      name: 'go_to_url',
      args: { intent: 'open target site', url },
    },
    {
      type: 'action',
      name: 'wait',
      args: { intent: 'allow page load', seconds: 1 },
    },
    { type: 'candidate_complete', summary: 'Navigation candidate complete' },
  ];
}

/**
 * R1 product-table script: empty plan (list fields already true at baseline) →
 * candidate_complete with CSV deliverable summary.
 * TaskManager stores summary as instructionSummary for side-panel deliverable.
 */
export function fixtureProductTableControlSteps(opts?: {
  csvSummary?: string;
}): ControlScriptStep[] {
  const summary =
    opts?.csvSummary ??
    [
      '已提取 6 件商品（CSV）：',
      'name,price,rating',
      'Alpha Wireless Headphones,$49.99,4.5',
      'Beta Mechanical Keyboard,$89.00,4.8',
      'Gamma USB-C Hub,$34.50,4.2',
      'Delta Desk Lamp,$27.99,4.0',
      'Epsilon Notebook Stand,$19.95,4.6',
      'Zeta Webcam Cover,$8.49,3.9',
    ].join('\n');
  return [
    { type: 'plan', criteria: [] },
    { type: 'candidate_complete', summary },
  ];
}

/**
 * Fixture media script: plan media_state → play → pause same digest path → candidate complete.
 */
export function fixtureMediaControlSteps(opts?: { playDigest?: string }): ControlScriptStep[] {
  const digest = opts?.playDigest;
  return [
    {
      type: 'plan',
      criteria: [{ kind: 'media_state', operator: 'equals', expected: 'paused', required: true }],
    },
    {
      type: 'action',
      name: 'control_media',
      args: digest
        ? { intent: 'play media', command: 'play', target_digest: digest }
        : { intent: 'play media', command: 'play' },
    },
    {
      type: 'action',
      name: 'control_media',
      args: digest
        ? { intent: 'pause same media', command: 'pause', target_digest: digest }
        : { intent: 'pause same media', command: 'pause' },
    },
    { type: 'candidate_complete', summary: 'Media pause candidate' },
  ];
}
