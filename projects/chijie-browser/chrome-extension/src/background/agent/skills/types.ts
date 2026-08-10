/**
 * Skill Runtime types (product/022).
 * Skills are higher-level capabilities than browser primitives.
 * Hard boundary: skills only use BrowserKernel — never chrome.* / BrowserContext / Task state.
 */
import type { BrowserKernel, ObservationFrame } from '../../browser/kernel';
import type { CompletionCriterionDraft } from '../../task/contracts';
import type { TaskArtifact } from '../../task/artifact';

export type SkillRisk = 'read' | 'reversible' | 'external_commit';

export interface SkillManifest {
  id: string;
  version: string;
  description: string;
  capabilities: string[];
  /** Domain host matchers; omit or ["*"] for generic. */
  domains?: string[];
  requiredPrimitives: string[];
  risk: SkillRisk;
  inputSchema?: unknown;
  outputSchema?: unknown;
  enabled?: boolean;
}

export interface SkillTrace {
  record(event: string, data?: Record<string, string | number | boolean>): void;
}

export interface SkillContext {
  kernel: BrowserKernel;
  taskId: string;
  roundId: string;
  signal: AbortSignal;
  trace: SkillTrace;
  instruction: string;
  /** Latest observation text/frame when available. */
  frame?: ObservationFrame | null;
  observationText?: string;
  /** Feature flag snapshot for skill-internal gates. */
  flags?: SkillRuntimeFlags;
  /** Whether an action name is available in the action registry. */
  hasAction?: (name: string) => boolean;
}

export interface SkillRuntimeFlags {
  enableDeterministicFormFill?: boolean;
  enableDeterministicBilibili?: boolean;
  enableDeterministicYouTube?: boolean;
  enableSkillRuntime?: boolean;
}

export type SkillDecision =
  | {
      kind: 'action';
      name: string;
      args: Record<string, unknown>;
      observation?: string;
      criteria?: CompletionCriterionDraft[];
      /** Internal phase token the skill wants retained across steps. */
      state?: unknown;
    }
  | {
      kind: 'done';
      summary: string;
      criteria?: CompletionCriterionDraft[];
      artifact?: TaskArtifact;
      state?: unknown;
    }
  | { kind: 'continue'; reason?: string; state?: unknown }
  | { kind: 'fail'; reason: string; failureClass?: string; state?: unknown };

export interface SkillResult<O = unknown> {
  decision: SkillDecision;
  output?: O;
  /** Skill-owned mutable phase state for multi-step skills. */
  state?: unknown;
}

export interface BrowserSkill<I = unknown, O = unknown> {
  manifest: SkillManifest;
  /**
   * Match whether this skill should run for the current task/page.
   * Pure preference signal; discovery ranks matches.
   */
  match?(input: {
    instruction: string;
    url: string;
    flags?: SkillRuntimeFlags;
  }): { score: number; reason: string } | null;
  run(context: SkillContext, input: I): Promise<SkillResult<O>>;
}

/** Declarative learned skill plan (no eval / new Function). */
export type SkillStep =
  | { op: 'observe' }
  | { op: 'act'; action: string; args: Record<string, SkillExpr> }
  | { op: 'extract'; schema: unknown; saveAs: string }
  | { op: 'wait_for'; condition: { kind: string; value?: string; fromRevision?: string } }
  | { op: 'assert'; criterion: CompletionCriterionDraft };

export type SkillExpr = string | number | boolean | { ref: string };

export interface SkillPlan {
  id: string;
  version: string;
  description: string;
  domains?: string[];
  capabilities: string[];
  steps: SkillStep[];
}

export interface SkillCandidate {
  skill: BrowserSkill;
  score: number;
  reason: string;
}

export interface SkillRunRecord {
  skillId: string;
  skillVersion: string;
  candidateCount: number;
  selectedReason: string;
  durationMs: number;
  outcome: 'action' | 'done' | 'continue' | 'fail' | 'fallback';
  fallbackUsed: boolean;
  failureClass?: string;
}
