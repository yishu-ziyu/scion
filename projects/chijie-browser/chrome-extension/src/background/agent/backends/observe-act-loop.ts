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
 */
export async function runObserveActLoop(options: ObserveActLoopOptions): Promise<LoopOutcome> {
  const {
    maxSteps,
    maxFailures,
    isStopped,
    waitIfPaused,
    observe,
    decide,
    act,
    reobserve,
    onPhase,
  } = options;

  let failures = 0;
  const budget = Math.max(1, maxFailures);

  for (let step = 0; step < maxSteps; step++) {
    if (isStopped()) return { kind: 'cancelled' };
    await waitIfPaused();
    if (isStopped()) return { kind: 'cancelled' };

    let stateText: string;
    try {
      onPhase?.({ phase: 'observe', step, detail: 'page_state' });
      stateText = await observe();
    } catch {
      failures += 1;
      if (failures >= budget) return { kind: 'failed', category: 'observe_failed' };
      continue;
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
    onPhase?.({ phase: 'act', step, detail: decision.name });
    try {
      const result = await act({ name: decision.name, args: decision.args });
      if (result.error) {
        failures += 1;
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
      if (failures >= budget) return { kind: 'failed', category: 'dispatch_failed' };
      continue;
    }

    if (reobserve) {
      try {
        onPhase?.({ phase: 'reobserve', step, detail: 'after_act' });
        await reobserve();
      } catch {
        // re-observe failure is soft: next loop iteration will observe again
      }
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
