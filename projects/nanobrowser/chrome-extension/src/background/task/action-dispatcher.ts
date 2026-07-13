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
  intent?: string;
  hasSemanticName?: boolean;
  semanticCommit?: boolean;
  semanticNavigation?: boolean;
}

const COMMIT_SIGNAL =
  /(submit|send|buy|purchase|delete|remove|confirm|pay|publish|post|save|book|reserve|checkout|transfer|approve|accept|create|update|grant|revoke|enable|disable|cancel|unsubscribe|authorize|connect|disconnect|join|leave|follow|unfollow|提交|发送|购买|删除|确认|支付|发布|保存|预订|转账|批准|接受|创建|更新|授权|撤销|启用|禁用|取消|退订|连接|断开|加入|离开|关注|取关)/i;
const NAVIGATION_SIGNAL = /\b(home|favorites?|details?|learn more|next|previous|back)\b|主页|收藏|详情|下一|上一|返回/i;

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
  const signalsNavigation = target.semanticNavigation === true || NAVIGATION_SIGNAL.test(target.intent ?? '');

  if (actionName === 'input_text' && type === 'password') {
    return { kind: 'block', reason: 'Sensitive inputs require direct user entry' };
  }
  if (actionName === 'click_element') {
    if (signalsCommit) {
      return { kind: 'approval', effect: 'external_commit', summary: 'Perform the requested external action' };
    }
    if (tag === 'a' && !target.inForm && signalsNavigation) {
      return { kind: 'allow', effect: 'reversible' };
    }
    if (tag === 'a' || tag === 'button' || target.role === 'button' || type === 'submit' || target.inForm || !tag) {
      return { kind: 'approval', effect: 'external_commit', summary: 'Submit the current form' };
    }
    return { kind: 'allow', effect: 'reversible' };
  }
  if (actionName === 'send_keys' && keys?.split('+').some(key => key.trim() === 'enter')) {
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

      let rechecked: TargetObservation;
      try {
        rechecked = await this.deps.observe(request, parsedArgs, 'before');
      } catch {
        attempt = { ...attempt, state: 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(new ActionResult({ error: 'Approved target could not be revalidated' }), attempt, before);
      }
      if (!before.target || !rechecked.target || before.target.digest !== rechecked.target.digest) {
        attempt = { ...attempt, state: 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(new ActionResult({ error: 'Approved target changed; replan required' }), attempt, rechecked);
      }
    }

    attempt = { ...attempt, state: 'executing', executingAt: this.deps.now() };
    await this.deps.persistAttempt(attempt);
    if (this.interrupted) {
      attempt = { ...attempt, state: 'blocked' };
      await this.deps.persistAttempt(attempt);
      return this.result(new ActionResult({ error: 'Action was interrupted' }), attempt, before);
    }
    try {
      const actionResult = await request.action.executeParsed(parsedArgs);
      if (actionResult.error) {
        attempt = { ...attempt, state: attempt.effect === 'external_commit' ? 'uncertain' : 'blocked' };
        await this.deps.persistAttempt(attempt);
        return this.result(actionResult, attempt, before);
      }
      const after = await this.deps.observe(request, parsedArgs, 'after');
      attempt = { ...attempt, state: 'observed', observedAt: this.deps.now() };
      await this.deps.persistAttempt(attempt);
      return this.result(actionResult, attempt, after);
    } catch (error) {
      attempt = { ...attempt, state: attempt.effect === 'external_commit' ? 'uncertain' : 'blocked' };
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

  private readString(parsedArgs: unknown, key: string): string | undefined {
    if (!parsedArgs || typeof parsedArgs !== 'object' || !(key in parsedArgs)) return undefined;
    const value = (parsedArgs as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }
}
