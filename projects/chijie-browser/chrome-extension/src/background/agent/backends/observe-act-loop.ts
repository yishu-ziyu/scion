/**
 * Observe → decide → act → re-observe agent loop (browser-use architecture, TS).
 * Ticket 02 / seam S3: pure engine used by LLM control and unit-tested with mocks.
 */

export type LoopPhase = 'observe' | 'decide' | 'act' | 'reobserve';

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
  | 'cancelled';

export type LoopDecision =
  | { kind: 'waiting_user'; reason: 'login_required' | 'captcha_required' }
  | { kind: 'done'; summary: string }
  | { kind: 'action'; name: string; args: Record<string, unknown>; observation?: string }
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
  waitIfPaused: () => Promise<void>;
  /** Page state summary for the model / policy. */
  observe: () => Promise<string>;
  /** Turn observation into a decision. */
  decide: (stateText: string, step: number) => Promise<LoopDecision>;
  /** Execute one action through Task hooks / browser control. */
  act: (action: {
    name: string;
    args: Record<string, unknown>;
  }) => Promise<{ error?: string | null; isDone?: boolean; summary?: string | null }>;
  /** Optional re-observe after successful act (browser-use style). */
  reobserve?: () => Promise<string>;
  onPhase?: (event: LoopPhaseEvent) => void;
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

  let failures = 0;
  const budget = Math.max(1, maxFailures);
  // Successful reobserve feeds the next decide; avoids a redundant observe.
  let carriedState: string | undefined;
  let noProgressStreak = 0;
  /** When reobserve is absent, compare the next full observe to this fingerprint. */
  let pendingNoProgressBefore: string | undefined;

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
        onPhase?.({ phase: 'observe', step, detail: 'page_state' });
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
        if (noProgressStreak >= maxNoProgress) {
          return { kind: 'failed', category: 'no_progress' };
        }
      } else {
        noProgressStreak = 0;
      }
      pendingNoProgressBefore = undefined;
    }

    if (isStopped()) return { kind: 'cancelled' };

    let decision: LoopDecision;
    try {
      onPhase?.({ phase: 'decide', step });
      decision = await decide(stateText, step);
    } catch {
      failures += 1;
      if (failures >= budget) return { kind: 'failed', category: 'llm_failed' };
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

    // action
    const stateBeforeAct = stateText.trim();
    onPhase?.({ phase: 'act', step, detail: decision.name });
    try {
      const result = await act({ name: decision.name, args: decision.args });
      if (result.error) {
        failures += 1;
        pendingNoProgressBefore = undefined;
        if (failures >= budget) return { kind: 'failed', category: 'action_failed' };
        continue;
      }
      failures = 0;
      if (result.isDone) {
        return {
          kind: 'candidate_complete',
          summary: result.summary || decision.observation || 'done',
        };
      }
    } catch {
      failures += 1;
      pendingNoProgressBefore = undefined;
      if (failures >= budget) return { kind: 'failed', category: 'dispatch_failed' };
      continue;
    }

    if (reobserve) {
      try {
        onPhase?.({ phase: 'reobserve', step, detail: 'after_act' });
        carriedState = await reobserve();
        if (noProgressEnabled) {
          if ((carriedState ?? '').trim() === stateBeforeAct) {
            noProgressStreak += 1;
            if (noProgressStreak >= maxNoProgress) {
              return { kind: 'failed', category: 'no_progress' };
            }
          } else {
            noProgressStreak = 0;
          }
        }
      } catch {
        // Soft failure: next iteration falls back to a full observe.
        carriedState = undefined;
        if (noProgressEnabled) {
          pendingNoProgressBefore = stateBeforeAct;
        }
      }
    } else if (noProgressEnabled) {
      pendingNoProgressBefore = stateBeforeAct;
    }
  }

  return { kind: 'failed', category: 'max_steps' };
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
