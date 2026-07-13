import type { Action } from '../agent/actions/builder';
import { ActionResult } from '../agent/types';
import type { ActionAttempt, BrowserTargetRef, CompletionEvidence } from '@extension/storage/lib/task';
import type { DispatchResult } from './contracts';
import { sha256 } from './digest';

export type EffectDecision =
  | { kind: 'allow'; effect: 'read' | 'reversible' }
  | { kind: 'approval'; effect: 'external_commit'; summary: string }
  | { kind: 'block'; reason: string };

interface EffectTarget {
  tag?: string;
  type?: string;
  role?: string;
  inForm?: boolean;
  activeTag?: string;
  keys?: string;
}

export function decideEffect(input: {
  actionName: string;
  target: EffectTarget | Record<string, unknown>;
  skillPolicy: 'default';
}): EffectDecision {
  const { actionName } = input;
  const target = input.target as EffectTarget;
  const tag = target.tag?.toLowerCase();
  const type = target.type?.toLowerCase();
  const keys = target.keys?.toLowerCase();

  if (actionName === 'input_text' && type === 'password') {
    return { kind: 'block', reason: 'Sensitive inputs require direct user entry' };
  }
  if (actionName === 'click_element') {
    if (tag === 'a' && !target.inForm) return { kind: 'allow', effect: 'reversible' };
    if (tag === 'button' || target.role === 'button' || type === 'submit' || target.inForm || !tag) {
      return { kind: 'approval', effect: 'external_commit', summary: 'Submit the current form' };
    }
    return { kind: 'allow', effect: 'reversible' };
  }
  if (actionName === 'send_keys' && keys === 'enter' && (target.inForm || target.activeTag !== 'body')) {
    return { kind: 'approval', effect: 'external_commit', summary: 'Submit with Enter' };
  }
  if (['done', 'cache_content', 'get_dropdown_options', 'wait'].includes(actionName)) {
    return { kind: 'allow', effect: 'read' };
  }
  return { kind: 'allow', effect: 'reversible' };
}

export interface DispatchRequest {
  taskId: string;
  roundId: string;
  action: Action;
  rawArgs: unknown;
}

export interface TargetObservation {
  target?: BrowserTargetRef;
  effectTarget: EffectTarget;
  evidence: CompletionEvidence[];
}

export interface ActionDispatcherDeps {
  now(): number;
  observe(request: DispatchRequest, parsedArgs: unknown, phase: 'before' | 'after'): Promise<TargetObservation>;
  persistAttempt(attempt: ActionAttempt): Promise<void>;
  requestApproval(attempt: ActionAttempt, summary: string): Promise<'approved' | 'rejected'>;
}

export function recoverAttempt(attempt: ActionAttempt): ActionAttempt {
  return attempt.state === 'executing' ? { ...attempt, state: 'uncertain' } : attempt;
}

export class ActionDispatcher {
  private interrupted = false;

  constructor(private readonly deps: ActionDispatcherDeps) {}

  interrupt(): void {
    this.interrupted = true;
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    this.interrupted = false;
    const parsedArgs = request.action.parse(request.rawArgs);
    const before = await this.deps.observe(request, parsedArgs, 'before');
    const argsDigest = await sha256(JSON.stringify(parsedArgs));
    const decision = decideEffect({
      actionName: request.action.name(),
      target: { ...before.effectTarget, keys: this.readKeys(parsedArgs) },
      skillPolicy: 'default',
    });
    let attempt: ActionAttempt = {
      id: crypto.randomUUID(),
      roundId: request.roundId,
      actionName: request.action.name(),
      effect:
        decision.kind === 'approval' ? 'external_commit' : decision.kind === 'allow' ? decision.effect : 'reversible',
      targetDigest: before.target?.digest,
      argsDigest,
      state: 'proposed',
      proposedAt: this.deps.now(),
    };
    await this.deps.persistAttempt(attempt);

    if (decision.kind === 'block') {
      attempt = { ...attempt, state: 'blocked' };
      await this.deps.persistAttempt(attempt);
      return this.result(new ActionResult({ error: decision.reason }), attempt, before);
    }

    if (decision.kind === 'approval') {
      const approval = await this.deps.requestApproval(attempt, decision.summary);
      if (approval === 'rejected' || this.interrupted) {
        attempt = { ...attempt, state: 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(new ActionResult({ error: 'Action was not approved' }), attempt, before);
      }
      attempt = { ...attempt, state: 'approved', approvedAt: this.deps.now() };
      await this.deps.persistAttempt(attempt);
    }

    attempt = { ...attempt, state: 'executing', executingAt: this.deps.now() };
    await this.deps.persistAttempt(attempt);
    try {
      const actionResult = await request.action.executeParsed(parsedArgs);
      const after = await this.deps.observe(request, parsedArgs, 'after');
      attempt = { ...attempt, state: 'observed', observedAt: this.deps.now() };
      await this.deps.persistAttempt(attempt);
      return this.result(actionResult, attempt, after);
    } catch (error) {
      attempt = { ...attempt, state: 'uncertain' };
      await this.deps.persistAttempt(attempt);
      throw error;
    }
  }

  private result(actionResult: ActionResult, attempt: ActionAttempt, observation: TargetObservation): DispatchResult {
    return {
      actionResult,
      attempt,
      targetRef: observation.target,
      evidence: observation.evidence,
    };
  }

  private readKeys(parsedArgs: unknown): string | undefined {
    if (!parsedArgs || typeof parsedArgs !== 'object' || !('keys' in parsedArgs)) return undefined;
    const keys = (parsedArgs as { keys?: unknown }).keys;
    return typeof keys === 'string' ? keys : undefined;
  }
}
