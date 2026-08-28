/**
 * Leftover prompt / outcome helpers from the retired JSON control driver.
 * Production ExecutorDriver is createToolLoopControlDriver.
 */
import type { ExecutorHooks, ExecutorMissionPlan, ExecutorOutcome, VerifiedPageRecord } from '../../task/contracts';
import { formatVerifiedPagesForPrompt } from '../../task/verified-step-records';
import type { TaskArtifact } from '../../task/artifact';
import { buildPlanMemory, compactStateText } from '../context';
import type { LoopDecision, LoopOutcome } from './observe-act-loop';

/** Default no-progress budget for control path (contracts 010/011). */
export const CONTROL_MAX_NO_PROGRESS = 3;

export interface CurrentMissionContext {
  planMemory: string;
  activePhaseId?: string;
}

export function buildControlUserPrompt(input: {
  instruction: string;
  step: number;
  maxSteps: number;
  criteriaLocked: boolean;
  contextBlock: string;
  lastActionMemory: string | null;
  statusBar: string;
  verifiedPages: VerifiedPageRecord[];
  userMemory?: string;
}): string {
  return [
    `Task:\n${input.instruction}`,
    input.userMemory?.trim() ? input.userMemory.trim() : '',
    formatVerifiedPagesForPrompt(input.verifiedPages),
    `Step: ${input.step + 1}/${input.maxSteps}`,
    input.criteriaLocked
      ? 'Completion criteria already frozen; do not change them.'
      : 'Propose completion_criteria if possible.',
    input.contextBlock,
    input.lastActionMemory ? `<last_action_result>\n${input.lastActionMemory}\n</last_action_result>` : '',
    input.statusBar,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function missionContextFromPlan(plan: ExecutorMissionPlan | undefined): CurrentMissionContext {
  return {
    planMemory: buildPlanMemory(plan),
    activePhaseId: plan?.phases.find(phase => phase.status === 'active')?.id,
  };
}

/** Resolve plan state at decision time so a long run never repeats a phase that already advanced. */
export async function readCurrentMissionContext(
  hooks: Pick<ExecutorHooks, 'getMissionPlan'>,
  roundId: string,
  initialPlan?: ExecutorMissionPlan,
): Promise<CurrentMissionContext> {
  if (!hooks.getMissionPlan) return missionContextFromPlan(initialPlan);
  try {
    return missionContextFromPlan(await hooks.getMissionPlan(roundId));
  } catch {
    return missionContextFromPlan(undefined);
  }
}

const CONTENT_RESULT_ACTIONS = new Set([
  'record_evidence',
  'read_page_text',
  'inspect_open_tabs',
  'find_tab',
  'snapshot',
  'inspect_evidence_space',
  'inspect_github_repository',
  'record_research_decision',
  'record_research_delivery',
  'observe',
  'extract_content',
]);

const CONTROL_LLM_TIMEOUT_MS = 90_000;

export function shouldKeepActionResultInContext(actionName: string): boolean {
  return CONTENT_RESULT_ACTIONS.has(actionName);
}

/**
 * Next-turn lastActionMemory after one act.
 * Failures always feed decide; click/nav success must not keep a summary or a prior failure.
 */
export function memoryAfterAction(
  name: string,
  result: { error?: string | null; summary?: string | null },
): string | null {
  if (result.error) {
    return compactStateText(`${name} failed: ${result.error}`, 24_000);
  }
  if (result.summary && shouldKeepActionResultInContext(name)) {
    return compactStateText(result.summary, 24_000);
  }
  return null;
}

export async function invokeWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = CONTROL_LLM_TIMEOUT_MS,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error('llm_timeout');
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

/** Visible page, no action: ask again. Must not terminate as no_action. */
export function decideVisiblePageWithoutAction(feedback: string): {
  memory: string;
  decision: Extract<LoopDecision, { kind: 'recoverable' }>;
} {
  return { memory: feedback, decision: { kind: 'recoverable', category: 'judge_retry' } };
}

/**
 * Map observe-act loop terminal outcome → TaskManager ExecutorOutcome.
 * Contract 011: no_progress / max_steps must keep category (never collapse to other/unknown).
 */
export function mapLoopOutcomeToExecutor(
  outcome: LoopOutcome,
  extras?: { artifacts?: TaskArtifact[] },
): ExecutorOutcome {
  if (outcome.kind === 'waiting_user') {
    return { kind: 'waiting_user', reason: outcome.reason };
  }
  if (outcome.kind === 'failed') {
    const category = outcome.category?.trim() || 'unknown';
    return { kind: 'failed', category };
  }
  if (outcome.kind === 'cancelled') {
    return { kind: 'cancelled' };
  }
  return {
    kind: 'candidate_complete',
    summary: outcome.summary,
    ...(extras?.artifacts && extras.artifacts.length > 0 ? { artifacts: extras.artifacts } : {}),
  };
}
