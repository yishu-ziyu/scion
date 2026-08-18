/**
 * Skill Runtime (product/022).
 * Discover → try match → run → on fail fallback to generic agent.
 * Skills never touch chrome.* / BrowserContext / Task completed state.
 */
import { discoverSkills } from './discovery';
import type { SkillRegistry } from './registry';
import type {
  BrowserSkill,
  SkillCandidate,
  SkillContext,
  SkillDecision,
  SkillResult,
  SkillRunRecord,
  SkillRuntimeFlags,
  SkillTrace,
} from './types';
import type { BrowserKernel, ObservationFrame } from '../../browser/kernel';

export interface SkillRuntimeOptions {
  registry: SkillRegistry;
  kernel: BrowserKernel;
  taskId: string;
  flags?: SkillRuntimeFlags;
  hasAction?: (name: string) => boolean;
  /** Max in-skill recovery attempts after fail before fallback. Default 1. */
  maxSkillRecovery?: number;
  topK?: number;
}

export interface SkillTryInput {
  roundId: string;
  instruction: string;
  url: string;
  observationText?: string;
  frame?: ObservationFrame | null;
  phaseId?: string;
  /** Per-skill retained state from previous step. */
  skillState?: Map<string, unknown>;
  signal?: AbortSignal;
}

export interface SkillTryResult {
  handled: boolean;
  decision?: SkillDecision;
  record?: SkillRunRecord;
  /** Updated skill state map. */
  skillState: Map<string, unknown>;
  candidates: SkillCandidate[];
  fallbackUsed: boolean;
}

function noopTrace(): SkillTrace {
  return { record: () => undefined };
}

export class SkillRuntime {
  private readonly registry: SkillRegistry;
  private readonly kernel: BrowserKernel;
  private readonly taskId: string;
  private readonly flags?: SkillRuntimeFlags;
  private readonly hasAction?: (name: string) => boolean;
  private readonly maxSkillRecovery: number;
  private readonly topK: number;
  private readonly recoveryCounts = new Map<string, number>();

  constructor(options: SkillRuntimeOptions) {
    this.registry = options.registry;
    this.kernel = options.kernel;
    this.taskId = options.taskId;
    this.flags = options.flags;
    this.hasAction = options.hasAction;
    this.maxSkillRecovery = options.maxSkillRecovery ?? 1;
    this.topK = options.topK ?? 5;
  }

  /**
   * Try skill candidates for this step. If none handle, returns handled=false (fallback).
   */
  async tryDecide(input: SkillTryInput): Promise<SkillTryResult> {
    const skillState = input.skillState ?? new Map<string, unknown>();
    if (this.flags?.enableSkillRuntime === false) {
      return { handled: false, skillState, candidates: [], fallbackUsed: true };
    }

    const candidates = discoverSkills({
      registry: this.registry,
      instruction: input.instruction,
      url: input.url,
      phaseId: input.phaseId,
      flags: this.flags,
      topK: this.topK,
    });

    if (candidates.length === 0) {
      return { handled: false, skillState, candidates, fallbackUsed: true };
    }

    const signal = input.signal ?? new AbortController().signal;
    const trace = noopTrace();

    for (const candidate of candidates) {
      const skill = candidate.skill;
      const started = Date.now();
      const ctx: SkillContext = {
        kernel: this.kernel,
        taskId: this.taskId,
        roundId: input.roundId,
        signal,
        trace,
        instruction: input.instruction,
        frame: input.frame,
        observationText: input.observationText,
        flags: this.flags,
        hasAction: this.hasAction,
      };

      let result: SkillResult;
      try {
        result = await skill.run(ctx, {
          state: skillState.get(skill.manifest.id),
          instruction: input.instruction,
          url: input.url,
        });
      } catch (error) {
        const failureClass = error instanceof Error ? error.message : 'skill_threw';
        const recoveries = this.recoveryCounts.get(skill.manifest.id) ?? 0;
        if (recoveries < this.maxSkillRecovery) {
          this.recoveryCounts.set(skill.manifest.id, recoveries + 1);
          continue;
        }
        const record: SkillRunRecord = {
          skillId: skill.manifest.id,
          skillVersion: skill.manifest.version,
          candidateCount: candidates.length,
          selectedReason: candidate.reason,
          durationMs: Date.now() - started,
          outcome: 'fail',
          fallbackUsed: true,
          failureClass,
        };
        return {
          handled: false,
          skillState,
          candidates,
          fallbackUsed: true,
          record,
        };
      }

      if (result.state !== undefined) {
        skillState.set(skill.manifest.id, result.state);
      } else if (result.decision.state !== undefined) {
        skillState.set(skill.manifest.id, result.decision.state);
      }

      if (result.decision.kind === 'continue') {
        // Try next candidate.
        continue;
      }

      if (result.decision.kind === 'fail') {
        const recoveries = this.recoveryCounts.get(skill.manifest.id) ?? 0;
        if (recoveries < this.maxSkillRecovery) {
          this.recoveryCounts.set(skill.manifest.id, recoveries + 1);
          continue;
        }
        const record: SkillRunRecord = {
          skillId: skill.manifest.id,
          skillVersion: skill.manifest.version,
          candidateCount: candidates.length,
          selectedReason: candidate.reason,
          durationMs: Date.now() - started,
          outcome: 'fail',
          fallbackUsed: true,
          failureClass: result.decision.failureClass ?? result.decision.reason,
        };
        return { handled: false, skillState, candidates, fallbackUsed: true, record };
      }

      // action | done
      const record: SkillRunRecord = {
        skillId: skill.manifest.id,
        skillVersion: skill.manifest.version,
        candidateCount: candidates.length,
        selectedReason: candidate.reason,
        durationMs: Date.now() - started,
        outcome: result.decision.kind,
        fallbackUsed: false,
      };
      return {
        handled: true,
        decision: result.decision,
        record,
        skillState,
        candidates,
        fallbackUsed: false,
      };
    }

    return { handled: false, skillState, candidates, fallbackUsed: true };
  }
}

export function createSkillRuntime(options: SkillRuntimeOptions): SkillRuntime {
  return new SkillRuntime(options);
}

/** Test helper: run one skill directly. */
export async function runSkillDirect(
  skill: BrowserSkill,
  context: SkillContext,
  input: unknown = {},
): Promise<SkillResult> {
  return skill.run(context, input);
}
