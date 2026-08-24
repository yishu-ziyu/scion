/**
 * Observe → decide → act → re-observe agent loop (browser-use architecture, TS).
 * Ticket 02 / seam S3: pure engine used by LLM control and unit-tested with mocks.
 */

export type LoopPhase = 'observe' | 'decide' | 'act' | 'reobserve';

/** A single decide may execute at most this many actions before another decide. */
export const MAX_ACTIONS_PER_DECISION = 5;

const ELEMENT_INDEX_INVALIDATING_ACTIONS = new Set([
  'click_element',
  'go_to_url',
  'open_tab',
  'close_tab',
  'go_back',
  'previous_page',
  'next_page',
  'search_google',
  'select_dropdown_option',
  'send_keys',
  'switch_tab',
]);

export type LoopFailureCategory =
  | 'observe_failed'
  | 'llm_failed'
  | 'json_parse_failed'
  | 'no_action'
  | 'unknown_action'
  | 'action_failed'
  | 'dispatch_failed'
  | 'on_plan_failed'
  | 'max_steps'
  | 'no_progress'
  | 'evidence_required'
  | 'source_required'
  | 'judge_retry'
  | 'cancelled';

export type LoopAction = { name: string; args: Record<string, unknown> };

export type LoopDecision =
  | { kind: 'waiting_user'; reason: 'login_required' | 'captcha_required' }
  | { kind: 'done'; summary: string }
  | {
      kind: 'action';
      name: string;
      args: Record<string, unknown>;
      observation?: string;
      /** More acts from this decide. `args.index` is from the ObservationFrame at decide time. */
      followup?: LoopAction[];
    }
  | { kind: 'recoverable'; category: LoopFailureCategory }
  | { kind: 'fatal'; category: LoopFailureCategory };

export type LoopOutcome =
  | { kind: 'candidate_complete'; summary: string }
  | { kind: 'waiting_user'; reason: 'login_required' | 'captcha_required' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; category: string };

export interface LoopPhaseEvent {
  phase: LoopPhase;
  step: number;
  detail?: string;
}

export interface ObserveActLoopOptions {
  maxSteps: number;
  maxFailures: number;
  /**
   * Stop with `no_progress` after this many successful acts that leave the
   * page observation unchanged (trim-equal). Default 3. Set `<= 0` to disable.
   */
  maxNoProgress?: number;
  isStopped: () => boolean;
  /** Return true when execution actually waited for a pause/resume cycle. */
  waitIfPaused: () => Promise<void | boolean>;
  /** Monotonic counter incremented whenever a pause starts, including a pause/resume between checks. */
  pauseVersion?: () => number;
  /** Page state summary for the model / policy. */
  observe: () => Promise<string>;
  /** Turn observation into a decision. */
  decide: (stateText: string, step: number) => Promise<LoopDecision>;
  /** Execute one action through Task hooks / browser control. */
  act: (
    action: LoopAction,
  ) => Promise<{ error?: string | null; isDone?: boolean; summary?: string | null; progressKey?: string | null }>;
  /** Rebind a queued indexed action to the same element in the latest observation. Null forces a new decide. */
  resolveQueuedAction?: (action: LoopAction) => LoopAction | null | Promise<LoopAction | null>;
  /** Optional re-observe after successful act (browser-use style). */
  reobserve?: () => Promise<string>;
  onPhase?: (event: LoopPhaseEvent) => void | Promise<void>;
  /**
   * Optional policy gate for action errors (book ch5): retry only when the
   * error is recoverable. Defaults to true to preserve existing behavior.
   */
  shouldRetryFailure?: (error: string) => boolean;
  /**
   * Called once when the page observation stops changing.
   * Return `continue` to reset the no-progress streak and keep deciding.
   */
  onStuck?: () => Promise<'continue' | 'stop'>;
}

/**
 * Run the observe → decide → act → re-observe loop until terminal outcome.
 * Recoverable decide/observe/act failures increment failure budget; success resets it.
 * Unchanged observations after successful acts count toward no_progress (L1 seal).
 */
export async function runObserveActLoop(options: ObserveActLoopOptions): Promise<LoopOutcome> {
  const { maxSteps, maxFailures, isStopped, waitIfPaused, observe, decide, act, reobserve, onPhase } = options;
  const maxNoProgress = options.maxNoProgress === undefined ? 3 : options.maxNoProgress;
  const noProgressEnabled = maxNoProgress > 0;
  const emitPhase = async (event: LoopPhaseEvent) => {
    try {
      await onPhase?.(event);
    } catch {
      // Phase persist is UI-only. A write failure must not abort the loop.
    }
  };

  let failures = 0;
  const budget = Math.max(1, maxFailures);
  // Successful reobserve feeds the next decide; avoids a redundant observe.
  let carriedState: string | undefined;
  let noProgressStreak = 0;
  let stuckReplanUsed = false;
  const seenProgressKeys = new Set<string>();
  /** When reobserve is absent, compare the next full observe to this fingerprint. */
  let pendingNoProgressBefore: string | undefined;

  const shouldFailForNoProgress = async (): Promise<boolean> => {
    if (stuckReplanUsed || !options.onStuck) return true;
    stuckReplanUsed = true;
    try {
      const shouldContinue = (await options.onStuck()) === 'continue';
      if (shouldContinue) {
        noProgressStreak = 0;
      }
      return !shouldContinue;
    } catch {
      return true;
    }
  };

  const discardCurrentDecision = () => {
    carriedState = undefined;
    pendingNoProgressBefore = undefined;
  };

  for (let step = 0; step < maxSteps; step++) {
    if (isStopped()) return { kind: 'cancelled' };
    await waitIfPaused();
    if (isStopped()) return { kind: 'cancelled' };

    let stateText: string;
    if (carriedState !== undefined) {
      stateText = carriedState;
      carriedState = undefined;
    } else {
      try {
        await emitPhase({ phase: 'observe', step, detail: 'page_state' });
        stateText = await observe();
      } catch {
        failures += 1;
        if (failures >= budget) return { kind: 'failed', category: 'observe_failed' };
        continue;
      }
    }

    if (noProgressEnabled && pendingNoProgressBefore !== undefined) {
      if (stateText.trim() === pendingNoProgressBefore) {
        noProgressStreak += 1;
        if (noProgressStreak >= maxNoProgress && (await shouldFailForNoProgress())) {
          return { kind: 'failed', category: 'no_progress' };
        }
      } else {
        noProgressStreak = 0;
      }
      pendingNoProgressBefore = undefined;
    }

    if (isStopped()) return { kind: 'cancelled' };

    const pauseVersionBeforeDecide = options.pauseVersion?.();
    const decisionInvalidatedByPause = () =>
      pauseVersionBeforeDecide !== undefined && options.pauseVersion?.() !== pauseVersionBeforeDecide;

    let decision: LoopDecision;
    try {
      await emitPhase({ phase: 'decide', step });
      decision = await decide(stateText, step);
    } catch {
      if (isStopped()) return { kind: 'cancelled' };
      if (decisionInvalidatedByPause()) {
        discardCurrentDecision();
        continue;
      }
      failures += 1;
      if (failures >= budget) return { kind: 'failed', category: 'llm_failed' };
      continue;
    }

    if (isStopped()) return { kind: 'cancelled' };
    if (decisionInvalidatedByPause()) {
      discardCurrentDecision();
      continue;
    }

    if (decision.kind === 'fatal') {
      return { kind: 'failed', category: decision.category };
    }

    if (decision.kind === 'recoverable') {
      failures += 1;
      if (failures >= budget) return { kind: 'failed', category: decision.category };
      continue;
    }

    if (decision.kind === 'waiting_user') {
      return { kind: 'waiting_user', reason: decision.reason };
    }

    if (decision.kind === 'done') {
      return { kind: 'candidate_complete', summary: decision.summary };
    }

    // action + followup from this decide. args.index is from the ObservationFrame at decide time.
    const queue = [{ name: decision.name, args: decision.args }, ...(decision.followup ?? [])].slice(
      0,
      MAX_ACTIONS_PER_DECISION,
    );
    const stateBeforeQueue = stateText.trim();
    let queuedIndexesInvalid = false;
    let retryDecide = false;
    let queueInterruptedByPause = false;
    let queueSemanticProgress = false;
    let reobserveFailed = false;

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      if (isStopped()) return { kind: 'cancelled' };
      const resumedFromPause = (await waitIfPaused()) === true;
      if (isStopped()) return { kind: 'cancelled' };
      if (resumedFromPause || decisionInvalidatedByPause()) {
        queueInterruptedByPause = true;
        break;
      }

      let action = queue[queueIndex];
      if (queueIndex > 0 && queuedIndexesInvalid && actionUsesElementIndex(action)) {
        retryDecide = true;
        break;
      }
      if (queueIndex > 0 && options.resolveQueuedAction && actionUsesElementIndex(action)) {
        try {
          const resolved = await options.resolveQueuedAction(action);
          if (!resolved) {
            retryDecide = true;
            break;
          }
          action = resolved;
        } catch {
          retryDecide = true;
          break;
        }
        if (isStopped()) return { kind: 'cancelled' };
        if (decisionInvalidatedByPause()) {
          queueInterruptedByPause = true;
          break;
        }
      }

      await emitPhase({ phase: 'act', step, detail: action.name });
      if (isStopped()) return { kind: 'cancelled' };
      if (decisionInvalidatedByPause()) {
        queueInterruptedByPause = true;
        break;
      }
      try {
        const result = await act({ name: action.name, args: action.args });
        if (isStopped()) return { kind: 'cancelled' };
        if (decisionInvalidatedByPause()) {
          queueInterruptedByPause = true;
          break;
        }
        if (result.error) {
          if (options.shouldRetryFailure && !options.shouldRetryFailure(result.error)) {
            return { kind: 'failed', category: 'action_failed' };
          }
          failures += 1;
          pendingNoProgressBefore = undefined;
          if (failures >= budget) return { kind: 'failed', category: 'action_failed' };
          retryDecide = true;
          break;
        }
        if (result.progressKey && !seenProgressKeys.has(result.progressKey)) {
          seenProgressKeys.add(result.progressKey);
          queueSemanticProgress = true;
        }
        if (result.isDone) {
          return {
            kind: 'candidate_complete',
            summary: result.summary || decision.observation || 'done',
          };
        }
      } catch {
        if (isStopped()) return { kind: 'cancelled' };
        if (decisionInvalidatedByPause()) {
          queueInterruptedByPause = true;
          break;
        }
        failures += 1;
        pendingNoProgressBefore = undefined;
        if (failures >= budget) return { kind: 'failed', category: 'dispatch_failed' };
        retryDecide = true;
        break;
      }

      if (actionInvalidatesElementSnapshot(action.name)) {
        queuedIndexesInvalid = true;
      }

      if (reobserve) {
        const resumedBeforeReobserve = (await waitIfPaused()) === true;
        if (isStopped()) return { kind: 'cancelled' };
        if (resumedBeforeReobserve || decisionInvalidatedByPause()) {
          queueInterruptedByPause = true;
          break;
        }
        try {
          await emitPhase({ phase: 'reobserve', step, detail: 'after_act' });
          if (isStopped()) return { kind: 'cancelled' };
          if (decisionInvalidatedByPause()) {
            queueInterruptedByPause = true;
            break;
          }
          carriedState = await reobserve();
          if (isStopped()) return { kind: 'cancelled' };
          if (decisionInvalidatedByPause()) {
            carriedState = undefined;
            queueInterruptedByPause = true;
            break;
          }
          reobserveFailed = false;
        } catch {
          carriedState = undefined;
          reobserveFailed = true;
          if (queueIndex < queue.length - 1) {
            pendingNoProgressBefore = noProgressEnabled ? stateBeforeQueue : undefined;
            retryDecide = true;
            break;
          }
        }
      }
    }

    if (retryDecide) continue;
    if (queueInterruptedByPause) {
      discardCurrentDecision();
      continue;
    }
    failures = 0;

    if (noProgressEnabled) {
      if (reobserve && !reobserveFailed && carriedState !== undefined) {
        if (carriedState.trim() === stateBeforeQueue && !queueSemanticProgress) {
          noProgressStreak += 1;
          if (noProgressStreak >= maxNoProgress && (await shouldFailForNoProgress())) {
            return { kind: 'failed', category: 'no_progress' };
          }
        } else {
          noProgressStreak = 0;
        }
      } else if (!reobserve || reobserveFailed) {
        pendingNoProgressBefore = stateBeforeQueue;
      }
    }
  }

  return { kind: 'failed', category: 'max_steps' };
}

export function actionUsesElementIndex(action: { args: Record<string, unknown> }): boolean {
  return typeof action.args.index === 'number' && Number.isFinite(action.args.index);
}

/** Clicks and navigations replace the snapshot that remaining indexes were bound to. */
export function actionInvalidatesElementSnapshot(name: string): boolean {
  return ELEMENT_INDEX_INVALIDATING_ACTIONS.has(name);
}

/** Content targets must not be chrome-extension:// pages (side panel). */
export function isForbiddenTaskContentUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('chrome://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('about:devtools')
  );
}
