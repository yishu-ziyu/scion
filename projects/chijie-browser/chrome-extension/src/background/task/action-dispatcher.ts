import type { Action } from '../agent/actions/builder';
import { ActionResult } from '../agent/types';
import type { ActionAttempt, BrowserTargetRef, CompletionEvidence } from '@extension/storage/lib/task';
import type { ActOutcome, DispatchResult } from './contracts';
import { sha256 } from './digest';
import { assertMutableStateBinding, classifyActOutcome, makePageRevision, readClaimedState } from './page-state';

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
  intent?: string;
  hasSemanticName?: boolean;
  semanticCommit?: boolean;
  semanticNavigation?: boolean;
}

const COMMIT_SIGNAL =
  /(submit|send|buy|purchase|delete|remove|confirm|pay|publish|post|save|book|reserve|checkout|transfer|approve|accept|create|update|grant|revoke|enable|disable|cancel|unsubscribe|authorize|connect|disconnect|join|leave|follow|unfollow|提交|发送|购买|删除|确认|支付|发布|保存|预订|转账|批准|接受|创建|更新|授权|撤销|启用|禁用|取消|退订|连接|断开|加入|离开|关注|取关)/i;

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
  const signalsCommit = target.semanticCommit === true || COMMIT_SIGNAL.test(target.intent ?? '');

  if (actionName === 'input_text' && type === 'password') {
    return { kind: 'block', reason: 'Sensitive inputs require direct user entry' };
  }
  if (actionName === 'click_element') {
    // Commit intent always gates (submit/buy/delete/… in model intent or semantic flag).
    if (signalsCommit) {
      return { kind: 'approval', effect: 'external_commit', summary: 'Perform the requested external action' };
    }
    // Native submit controls only - not every link/button (YouTube thumbs are <a>/role=button).
    if (type === 'submit' || type === 'image') {
      return { kind: 'approval', effect: 'external_commit', summary: 'Submit the current form' };
    }
    // HTML: <button> inside a form defaults to type=submit when type is omitted.
    if (tag === 'button' && target.inForm && (!type || type === 'submit')) {
      return { kind: 'approval', effect: 'external_commit', summary: 'Submit the current form' };
    }
    // Navigation and ordinary UI clicks (links, thumbs, role=button) are reversible.
    return { kind: 'allow', effect: 'reversible' };
  }
  if (actionName === 'send_keys' && keys?.split('+').some(key => key.trim() === 'enter')) {
    // Enter can submit forms; keep gated. (PageDown etc. never hit this branch.)
    return { kind: 'approval', effect: 'external_commit', summary: 'Submit with Enter' };
  }
  if (['done', 'cache_content', 'get_dropdown_options', 'wait', 'save_screenshot'].includes(actionName)) {
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
  /** product/007: immutable observe id; element refs bind to this only. */
  pageRevision?: string;
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
    // Claimed state lives on raw args (model may send pageRevision outside zod schema).
    const claimed = readClaimedState(request.rawArgs);
    const parsedArgs = request.action.parse(request.rawArgs);
    const before = this.withPageRevision(await this.deps.observe(request, parsedArgs, 'before'));
    const argsDigest = await sha256(JSON.stringify(parsedArgs));
    const decision = decideEffect({
      actionName: request.action.name(),
      target: {
        ...before.effectTarget,
        keys: this.readString(parsedArgs, 'keys'),
        intent: this.readString(parsedArgs, 'intent'),
      },
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

    // product/007: stale stateId/pageRevision or target ref → reject before mutate
    const binding = assertMutableStateBinding({
      claimedRevision: claimed.pageRevision,
      observedRevision: before.pageRevision,
      claimedTargetDigest: claimed.targetDigest,
      observedTargetDigest: before.target?.digest,
    });
    if (!binding.ok) {
      attempt = { ...attempt, state: 'blocked' };
      await this.deps.persistAttempt(attempt);
      return this.result(new ActionResult({ error: binding.message }), attempt, before, {
        actOutcome: 'didnt',
      });
    }

    if (decision.kind === 'block') {
      attempt = { ...attempt, state: 'blocked' };
      await this.deps.persistAttempt(attempt);
      return this.result(new ActionResult({ error: decision.reason }), attempt, before, {
        actOutcome: 'didnt',
      });
    }

    if (decision.kind === 'approval') {
      const approval = await this.deps.requestApproval(attempt, decision.summary);
      if (approval === 'rejected' || this.interrupted) {
        attempt = { ...attempt, state: 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(new ActionResult({ error: 'Action was not approved' }), attempt, before, {
          actOutcome: 'didnt',
        });
      }
      attempt = { ...attempt, state: 'approved', approvedAt: this.deps.now() };
      await this.deps.persistAttempt(attempt);

      let rechecked: TargetObservation;
      try {
        rechecked = this.withPageRevision(await this.deps.observe(request, parsedArgs, 'before'));
      } catch {
        attempt = { ...attempt, state: 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(new ActionResult({ error: 'Approved target could not be revalidated' }), attempt, before, {
          actOutcome: 'unknown',
        });
      }
      if (!before.target || !rechecked.target || before.target.digest !== rechecked.target.digest) {
        attempt = { ...attempt, state: 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(
          new ActionResult({ error: 'Approved target changed; replan required' }),
          attempt,
          rechecked,
          { actOutcome: 'didnt' },
        );
      }
      // Target digest is the commit binding; full-page revision may drift while the control stays.
    } else if (this.requiresIndexTargetBinding(parsedArgs, before)) {
      let rechecked: TargetObservation;
      try {
        rechecked = this.withPageRevision(await this.deps.observe(request, parsedArgs, 'before'));
      } catch {
        attempt = { ...attempt, state: 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(
          new ActionResult({ error: 'Action target could not be revalidated; replan required' }),
          attempt,
          before,
          { actOutcome: 'didnt' },
        );
      }
      if (!rechecked.target || before.target?.digest !== rechecked.target.digest) {
        attempt = { ...attempt, state: 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(new ActionResult({ error: 'Action target changed; replan required' }), attempt, rechecked, {
          actOutcome: 'didnt',
        });
      }
    }

    attempt = { ...attempt, state: 'executing', executingAt: this.deps.now() };
    await this.deps.persistAttempt(attempt);
    if (this.interrupted) {
      attempt = { ...attempt, state: 'blocked' };
      await this.deps.persistAttempt(attempt);
      return this.result(new ActionResult({ error: 'Action was interrupted' }), attempt, before, {
        actOutcome: 'didnt',
      });
    }
    try {
      const actionResult = await request.action.executeParsed(parsedArgs);
      if (actionResult.error) {
        const uncertain = attempt.effect === 'external_commit';
        attempt = { ...attempt, state: uncertain ? 'uncertain' : 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(actionResult, attempt, before, {
          actOutcome: classifyActOutcome({
            actionError: actionResult.error,
            effect: attempt.effect,
            expectEvidence: [],
            hasExpect: claimed.hasExpectFlag,
            uncertain,
          }),
        });
      }
      const after = this.withPageRevision(await this.deps.observe(request, parsedArgs, 'after'));
      attempt = { ...attempt, state: 'observed', observedAt: this.deps.now() };
      await this.deps.persistAttempt(attempt);
      const hasExpect = claimed.hasExpectFlag || after.evidence.length > 0;
      const actOutcome = classifyActOutcome({
        actionError: null,
        effect: attempt.effect,
        expectEvidence: after.evidence.map(e => ({ passed: e.passed, reason: e.reason })),
        hasExpect,
      });
      return this.result(actionResult, attempt, after, { actOutcome });
    } catch (error) {
      // Persist uncertain/blocked then return error — do not rethrow into control loop
      // (rethrow + waiting_* races → observe-act dispatch_failed / 动作调度失败).
      const uncertain = attempt.effect === 'external_commit';
      attempt = { ...attempt, state: uncertain ? 'uncertain' : 'blocked' };
      await this.deps.persistAttempt(attempt);
      const message = error instanceof Error ? error.message : String(error);
      return this.result(new ActionResult({ error: message || 'action_threw' }), attempt, before, {
        actOutcome: classifyActOutcome({
          actionError: message || 'action_threw',
          effect: attempt.effect,
          expectEvidence: [],
          hasExpect: claimed.hasExpectFlag,
          uncertain,
        }),
      });
    }
  }

  private withPageRevision(observation: TargetObservation): TargetObservation {
    if (observation.pageRevision) return observation;
    if (!observation.target) return observation;
    return {
      ...observation,
      pageRevision: makePageRevision({
        tabId: observation.target.tabId,
        urlOrigin: observation.target.urlOrigin,
        snapshotDigest: observation.target.digest,
      }),
    };
  }

  private result(
    actionResult: ActionResult,
    attempt: ActionAttempt,
    observation: TargetObservation,
    extra?: { actOutcome?: ActOutcome },
  ): DispatchResult {
    return {
      actionResult,
      attempt,
      targetRef: observation.target,
      evidence: observation.evidence,
      pageRevision: observation.pageRevision,
      actOutcome: extra?.actOutcome,
    };
  }

  private readString(parsedArgs: unknown, key: string): string | undefined {
    if (!parsedArgs || typeof parsedArgs !== 'object' || !(key in parsedArgs)) return undefined;
    const value = (parsedArgs as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }

  private requiresIndexTargetBinding(parsedArgs: unknown, observation: TargetObservation): boolean {
    if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) return false;
    return typeof (parsedArgs as Record<string, unknown>).index === 'number' && observation.target?.kind === 'element';
  }
}
