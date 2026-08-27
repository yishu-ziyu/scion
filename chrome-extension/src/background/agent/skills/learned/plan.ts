/**
 * Declarative Learned SkillPlan runner (product/022 Phase 5).
 * No eval(), no new Function(), no remote JS.
 */
import type { BrowserKernel, WaitCondition } from '../../../browser/kernel';
import type { CompletionCriterionDraft } from '../../../task/contracts';
import { modelActionRejection } from '../../actions/model-action-safety';
import type { SkillExpr, SkillPlan, SkillStep } from '../types';

export interface SkillPlanRunContext {
  kernel: BrowserKernel;
  roundId: string;
  vars?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface SkillPlanRunResult {
  ok: boolean;
  vars: Record<string, unknown>;
  error?: string;
  stepsExecuted: number;
}

function resolveExpr(expr: SkillExpr, vars: Record<string, unknown>): unknown {
  if (expr && typeof expr === 'object' && 'ref' in expr) {
    return vars[expr.ref];
  }
  return expr;
}

function resolveArgs(args: Record<string, SkillExpr>, vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = resolveExpr(value, vars);
  }
  return out;
}

const SKILL_PLAN_OPS = new Set(['observe', 'act', 'extract', 'wait_for', 'assert']);

function validateSkillStep(step: unknown): string | null {
  if (!step || typeof step !== 'object' || !('op' in step)) return 'invalid_step';
  const typed = step as SkillStep;
  if (!SKILL_PLAN_OPS.has(typed.op)) return `forbidden_op:${typed.op}`;
  if (typed.op !== 'act') return null;
  return modelActionRejection(typed.action, typed.args);
}

async function runSkillAction(
  step: Extract<SkillStep, { op: 'act' }>,
  ctx: SkillPlanRunContext,
  vars: Record<string, unknown>,
) {
  const args = resolveArgs(step.args, vars);
  const rejection = modelActionRejection(step.action, args);
  return rejection ? { error: rejection } : await ctx.kernel.act(ctx.roundId, step.action, args);
}

function toWaitCondition(step: Extract<SkillStep, { op: 'wait_for' }>): WaitCondition {
  const kind = step.condition.kind;
  if (kind === 'url_includes') return { kind: 'url_includes', value: String(step.condition.value ?? '') };
  if (kind === 'url_starts_with') return { kind: 'url_starts_with', value: String(step.condition.value ?? '') };
  if (kind === 'title_includes') return { kind: 'title_includes', value: String(step.condition.value ?? '') };
  if (kind === 'text_includes') return { kind: 'text_includes', value: String(step.condition.value ?? '') };
  if (kind === 'revision_changed') {
    return { kind: 'revision_changed', fromRevision: String(step.condition.fromRevision ?? '') };
  }
  return { kind: 'text_includes', value: String(step.condition.value ?? '') };
}

/** Static validation — reject forbidden patterns before run/promote. */
export function validateSkillPlan(plan: SkillPlan): { ok: true } | { ok: false; error: string } {
  if (!plan.id || !plan.version) return { ok: false, error: 'missing_id_or_version' };
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) return { ok: false, error: 'empty_steps' };
  if (plan.steps.length > 40) return { ok: false, error: 'too_many_steps' };
  for (const step of plan.steps) {
    const error = validateSkillStep(step);
    if (error) return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Execute a declarative SkillPlan through BrowserKernel only.
 * Assert steps are recorded; actual CompletionChecker remains outside.
 */
export async function runSkillPlan(plan: SkillPlan, ctx: SkillPlanRunContext): Promise<SkillPlanRunResult> {
  const valid = validateSkillPlan(plan);
  if (!valid.ok) return { ok: false, vars: {}, error: valid.error, stepsExecuted: 0 };

  const vars: Record<string, unknown> = { ...(ctx.vars ?? {}) };
  const assertions: CompletionCriterionDraft[] = [];
  let stepsExecuted = 0;

  for (const step of plan.steps) {
    if (ctx.signal?.aborted) {
      return { ok: false, vars, error: 'aborted', stepsExecuted };
    }
    stepsExecuted += 1;
    switch (step.op) {
      case 'observe': {
        const frame = await ctx.kernel.observe();
        vars.lastFrame = frame;
        vars.lastUrl = frame.tab.url;
        break;
      }
      case 'act': {
        const result = await runSkillAction(step, ctx, vars);
        vars.lastAct = result;
        if (result.error) {
          return { ok: false, vars, error: result.error, stepsExecuted };
        }
        break;
      }
      case 'extract': {
        const extracted = await ctx.kernel.extract({ schema: step.schema });
        if (!extracted.ok) {
          return { ok: false, vars, error: extracted.error ?? 'extract_failed', stepsExecuted };
        }
        vars[step.saveAs] = extracted.data;
        break;
      }
      case 'wait_for': {
        const frame = await ctx.kernel.waitFor(toWaitCondition(step), 5_000);
        vars.lastFrame = frame;
        break;
      }
      case 'assert': {
        assertions.push(step.criterion);
        vars.assertions = assertions;
        break;
      }
      default:
        return { ok: false, vars, error: 'unknown_step', stepsExecuted };
    }
  }

  return { ok: true, vars, stepsExecuted };
}

export interface SkillPromotionGate {
  /** Reliability score 0-10 style (019: R >= 9). */
  reliability: number;
  falseComplete: number;
  hasSensitiveFields: boolean;
  distinctInputPasses: number;
}

export function canPromoteSkill(gate: SkillPromotionGate): { promote: boolean; reason: string } {
  if (gate.reliability < 9) return { promote: false, reason: 'reliability_below_9' };
  if (gate.falseComplete !== 0) return { promote: false, reason: 'false_complete_nonzero' };
  if (gate.hasSensitiveFields) return { promote: false, reason: 'sensitive_fields' };
  if (gate.distinctInputPasses < 3) return { promote: false, reason: 'need_3_input_reruns' };
  return { promote: true, reason: 'ok' };
}
