import type { Action } from '../agent/actions/builder';
import { modelActionRejection, type ModelActionRejection } from '../agent/actions/model-action-safety';
import { ActionResult } from '../agent/types';
import type { ActionAttempt, AttemptFinding, BrowserTargetRef, CompletionEvidence } from '@extension/storage/lib/task';
import type { ActOutcome, DispatchResult } from './contracts';
import { isSearchResultsUrl } from '../browser/search-results';
import { buildAttemptDisplaySummary, buildAttemptTargetLabel } from './attempt-display';
import { sha256 } from './digest';
import { assertMutableStateBinding, classifyActOutcome, makePageRevision, readClaimedState } from './page-state';

export type EffectDecision =
  | { kind: 'allow'; effect: 'read' | 'reversible' | 'external_commit' }
  | { kind: 'block'; reason: string };

interface EffectTarget {
  tag?: string;
  type?: string;
  role?: string;
  inForm?: boolean;
  activeTag?: string;
  keys?: string;
  intent?: string;
  text?: string;
  hasSemanticName?: boolean;
  semanticCommit?: boolean;
  semanticNavigation?: boolean;
}

/** Persist origin+path only. Query tokens must not land on ActionAttempt. */
function persistableTargetUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return (url.origin + url.pathname).replace(/\/+$/, '') || url.origin;
  } catch {
    return undefined;
  }
}

function pageFindingFromObservation(
  actionName: string,
  existing: AttemptFinding[] | undefined,
  after: TargetObservation,
  observedUrl?: string,
): AttemptFinding[] | undefined {
  if (existing?.length) return existing;
  if (observedUrl && isSearchResultsUrl(observedUrl)) return existing;
  if (!['go_to_url', 'open_tab', 'switch_tab', 'focus_tab'].includes(actionName)) return existing;
  const title = after.target?.label?.replace(/\s+/g, ' ').trim();
  if (!title || title.length < 2) return existing;
  let host: string | undefined;
  try {
    if (observedUrl) host = new URL(observedUrl).hostname.replace(/^www\./, '') || undefined;
  } catch {
    host = undefined;
  }
  if (host && title.toLowerCase() === host.toLowerCase()) return existing;
  return [{ title: title.slice(0, 160), url: observedUrl, host }];
}

function didNotActOnTarget(error: string): boolean {
  return (
    error === 'target_ambiguous' ||
    error === 'target_missing' ||
    error === 'media_target_ambiguous' ||
    error === 'media_target_missing' ||
    error.includes('Did not act') ||
    error.includes('Did not click')
  );
}

const COMMIT_SIGNAL =
  /(submit|send|buy|purchase|delete|remove|confirm|pay|publish|post|save|book|reserve|checkout|transfer|approve|accept|create|update|grant|revoke|enable|disable|cancel|unsubscribe|authorize|connect|disconnect|join|leave|follow|unfollow|提交|发送|购买|删除|确认|支付|发布|保存|预订|转账|批准|接受|创建|更新|授权|撤销|启用|禁用|取消|退订|连接|断开|加入|离开|关注|取关)/i;

function isExternalCommitDecision(decision: EffectDecision): decision is { kind: 'allow'; effect: 'external_commit' } {
  return decision.kind === 'allow' && decision.effect === 'external_commit';
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
  const signalsCommit = target.semanticCommit === true || COMMIT_SIGNAL.test(target.intent ?? '');

  if (actionName === 'input_text' && type === 'password') {
    return { kind: 'block', reason: 'Sensitive inputs require direct user entry' };
  }
  if (actionName === 'click_element') {
    // A plain anchor only navigates. Page text can contain words such as
    // "save" or "submit" and must not turn a search-result link into a
    // recoverable external commit.
    if (tag === 'a' && !target.inForm) {
      return { kind: 'allow', effect: 'reversible' };
    }
    // Commit intent is an external-commit label, not a user-approval gate.
    if (signalsCommit) {
      return { kind: 'allow', effect: 'external_commit' };
    }
    // Native submit controls only - not every link/button (YouTube thumbs are <a>/role=button).
    if (type === 'submit' || type === 'image') {
      return { kind: 'allow', effect: 'external_commit' };
    }
    // HTML: <button> inside a form defaults to type=submit when type is omitted.
    if (tag === 'button' && target.inForm && (!type || type === 'submit')) {
      return { kind: 'allow', effect: 'external_commit' };
    }
    // Navigation and ordinary UI clicks (links, thumbs, role=button) are reversible.
    return { kind: 'allow', effect: 'reversible' };
  }
  if (actionName === 'send_keys' && keys?.split('+').some(key => key.trim() === 'enter')) {
    // Enter can submit forms; label it external_commit for audit/recovery. (PageDown etc. never hit this branch.)
    return { kind: 'allow', effect: 'external_commit' };
  }
  if (
    [
      'done',
      'cache_content',
      'record_evidence',
      'inspect_evidence_space',
      'record_research_decision',
      'record_research_delivery',
      'read_page_text',
      'inspect_open_tabs',
      'find_tab',
      'snapshot',
      'observe',
      'extract_content',
      'get_dropdown_options',
      'wait',
      'save_screenshot',
    ].includes(actionName)
  ) {
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
  priorAttempts?(taskId: string, roundId: string): Promise<ActionAttempt[]>;
}

function isDispatchResult(value: DispatchResult | ActionAttempt | null): value is DispatchResult {
  return value != null && 'actionResult' in value;
}

function isDuplicateExternalCommit(prior: ActionAttempt[], current: ActionAttempt): boolean {
  if (current.effect !== 'external_commit') return false;
  return prior.some(
    item =>
      item.id !== current.id &&
      item.effect === 'external_commit' &&
      (item.state === 'executing' || item.state === 'uncertain' || item.state === 'observed') &&
      item.roundId === current.roundId &&
      item.actionName === current.actionName &&
      item.argsDigest === current.argsDigest &&
      (item.targetDigest ?? '') === (current.targetDigest ?? ''),
  );
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
    const rejection = modelActionRejection(request.action.name(), request.rawArgs);
    if (rejection) return await this.rejectModelAction(request, rejection);

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
    const displayInput = {
      actionName: request.action.name(),
      args: parsedArgs,
      redactIntent: decision.kind === 'allow' && decision.effect === 'external_commit',
      effectTarget: {
        ...before.effectTarget,
        intent: this.readString(parsedArgs, 'intent') ?? before.effectTarget.intent,
      },
      urlOrigin: before.target?.urlOrigin,
    };
    const targetUrl = persistableTargetUrl(
      this.readHttpUrl(parsedArgs, 'url') ||
        before.target?.normalizedUrl ||
        (before.target?.urlOrigin && before.target.urlOrigin !== 'null' ? before.target.urlOrigin : undefined),
    );
    let attempt: ActionAttempt = {
      id: crypto.randomUUID(),
      roundId: request.roundId,
      actionName: request.action.name(),
      effect: decision.kind === 'allow' ? decision.effect : 'reversible',
      targetDigest: before.target?.digest,
      argsDigest,
      displaySummary: buildAttemptDisplaySummary(displayInput),
      targetLabel: buildAttemptTargetLabel(displayInput),
      ...(targetUrl ? { targetUrl } : {}),
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

    const prepared = await this.revalidateBeforeExecute(request, attempt, parsedArgs, before, decision);
    if (isDispatchResult(prepared)) return prepared;
    if (prepared) attempt = prepared;

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
        const uncertain = attempt.effect === 'external_commit' && !didNotActOnTarget(actionResult.error);
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
      const observedUrl = persistableTargetUrl(
        attempt.targetUrl ||
          after.target?.normalizedUrl ||
          (after.target?.urlOrigin && after.target.urlOrigin !== 'null' ? after.target.urlOrigin : undefined),
      );
      const findings = pageFindingFromObservation(
        request.action.name(),
        actionResult.findings?.length ? actionResult.findings : undefined,
        after,
        observedUrl,
      );
      attempt = {
        ...attempt,
        state: 'observed',
        observedAt: this.deps.now(),
        ...(findings ? { findings } : {}),
        ...(observedUrl ? { targetUrl: observedUrl } : {}),
      };
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

  private async rejectModelAction(request: DispatchRequest, rejection: ModelActionRejection): Promise<DispatchResult> {
    const argsDigest = await sha256(JSON.stringify(request.rawArgs) ?? 'undefined');
    let attempt: ActionAttempt = {
      id: crypto.randomUUID(),
      roundId: request.roundId,
      actionName: request.action.name(),
      effect: 'reversible',
      argsDigest,
      displaySummary: rejection === 'dynamic_code_not_allowed' ? '拒绝执行模型提供的代码' : '拒绝未知页面操作',
      state: 'proposed',
      proposedAt: this.deps.now(),
    };
    await this.deps.persistAttempt(attempt);
    attempt = { ...attempt, state: 'blocked' };
    await this.deps.persistAttempt(attempt);
    return this.result(
      new ActionResult({ error: rejection, success: false, includeInMemory: true }),
      attempt,
      { effectTarget: {}, evidence: [] },
      { actOutcome: 'didnt' },
    );
  }

  private async revalidateBeforeExecute(
    request: DispatchRequest,
    attempt: ActionAttempt,
    parsedArgs: unknown,
    before: TargetObservation,
    decision: EffectDecision,
  ): Promise<DispatchResult | ActionAttempt | null> {
    if (isExternalCommitDecision(decision)) {
      return this.authorizeExternalCommit(request, attempt, parsedArgs, before);
    }
    if (this.requiresIndexTargetBinding(parsedArgs, before)) {
      return this.revalidateIndexTarget(request, attempt, parsedArgs, before);
    }
    return null;
  }

  private async authorizeExternalCommit(
    request: DispatchRequest,
    attempt: ActionAttempt,
    parsedArgs: unknown,
    before: TargetObservation,
  ): Promise<DispatchResult | ActionAttempt> {
    const authorized = { ...attempt, state: 'authorized' as const, authorizedAt: this.deps.now() };
    await this.deps.persistAttempt(authorized);
    let rechecked: TargetObservation;
    try {
      rechecked = this.withPageRevision(await this.deps.observe(request, parsedArgs, 'before'));
    } catch {
      const blocked = { ...authorized, state: 'blocked' as const };
      await this.deps.persistAttempt(blocked);
      return this.result(new ActionResult({ error: 'Authorized target could not be revalidated' }), blocked, before, {
        actOutcome: 'unknown',
      });
    }
    if (!before.target || !rechecked.target || before.target.digest !== rechecked.target.digest) {
      const blocked = { ...authorized, state: 'blocked' as const };
      await this.deps.persistAttempt(blocked);
      return this.result(
        new ActionResult({ error: 'Authorized target changed; replan required' }),
        blocked,
        rechecked,
        { actOutcome: 'didnt' },
      );
    }
    const duplicate = await this.skipDuplicateCommit(request, authorized, before);
    return duplicate ?? authorized;
  }

  private async revalidateIndexTarget(
    request: DispatchRequest,
    attempt: ActionAttempt,
    parsedArgs: unknown,
    before: TargetObservation,
  ): Promise<DispatchResult | null> {
    let rechecked: TargetObservation;
    try {
      rechecked = this.withPageRevision(await this.deps.observe(request, parsedArgs, 'before'));
    } catch {
      const blocked = { ...attempt, state: 'blocked' as const };
      await this.deps.persistAttempt(blocked);
      return this.result(
        new ActionResult({ error: 'Action target could not be revalidated; replan required' }),
        blocked,
        before,
        { actOutcome: 'didnt' },
      );
    }
    if (!rechecked.target || before.target?.digest !== rechecked.target.digest) {
      const blocked = { ...attempt, state: 'blocked' as const };
      await this.deps.persistAttempt(blocked);
      return this.result(new ActionResult({ error: 'Action target changed; replan required' }), blocked, rechecked, {
        actOutcome: 'didnt',
      });
    }
    return null;
  }

  private async skipDuplicateCommit(
    request: DispatchRequest,
    attempt: ActionAttempt,
    before: TargetObservation,
  ): Promise<DispatchResult | null> {
    if (!this.deps.priorAttempts) return null;
    const prior = await this.deps.priorAttempts(request.taskId, request.roundId);
    if (!isDuplicateExternalCommit(prior, attempt)) return null;
    const next = { ...attempt, state: 'uncertain' as const };
    await this.deps.persistAttempt(next);
    return this.result(new ActionResult({ error: 'Previous commit already executed' }), next, before, {
      actOutcome: 'unknown',
    });
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

  private readHttpUrl(parsedArgs: unknown, key: string): string | undefined {
    const raw = this.readString(parsedArgs, key);
    if (!raw) return undefined;
    try {
      const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
      return parsed.toString().slice(0, 500);
    } catch {
      return undefined;
    }
  }

  private readString(parsedArgs: unknown, key: string): string | undefined {
    if (!parsedArgs || typeof parsedArgs !== 'object' || !(key in parsedArgs)) return undefined;
    const value = (parsedArgs as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }

  private requiresIndexTargetBinding(parsedArgs: unknown, observation: TargetObservation): boolean {
    if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) return false;
    // Page.clickElementNode independently re-resolves anchors and requires the
    // live href to equal the observed href. A second whole-element digest check
    // is both redundant and unstable on dynamic search-result pages.
    if (observation.effectTarget.tag?.toLowerCase() === 'a' && !observation.effectTarget.inForm) return false;
    return typeof (parsedArgs as Record<string, unknown>).index === 'number' && observation.target?.kind === 'element';
  }
}
