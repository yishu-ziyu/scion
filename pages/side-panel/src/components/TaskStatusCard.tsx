import type {
  ActionAttempt,
  EvidenceSpace,
  TaskCommand,
  TaskRound,
  TaskSnapshot,
  WaitReason,
} from '@extension/storage';
import { t } from '@extension/i18n';
import { useEffect, useState } from 'react';
import { FiCopy } from 'react-icons/fi';
import { primaryButtonClassName, secondaryButtonClassName, taskCardClassName } from '../design/contracts';
import { PanelReveal } from './MotionPrimitives';
import { shouldShowDeliveredResult, shouldShowVerifiedDone, taskPrimaryOrganism } from '../presentation/task-loop-ui';
import { deriveFailedResult } from '../presentation/failed-result';
import { looksLikeActionName } from '../presentation/activity-stream';
import { requiredCompletionResult } from '../presentation/completion-outcome';
import { assessGoalCoverage, resolveDeliverableAnswer } from '../presentation/goal-coverage';
import { productFailureLabel, toProductFailureCode } from '../presentation/failure-taxonomy';
import { waitUserAction } from '../presentation/wait-affordance';
import { deriveWaitAsk } from '../presentation/wait-ask';
import { deriveTaskProgressView, stripTabCountPrefix } from '../presentation/task-progress-view';
import {
  collectStreamSources,
  deriveWorkStream,
  verifiedPagesFromTargets,
  type StreamSource,
} from '../presentation/work-stream';
import { isFollowingForeground } from '../presentation/run-presence';
import { processNowBody, workStreamBody } from './ProcessDisclosure';
import { AnswerProse } from './AnswerProse';
import { TaskProgressOverview, type ProgressTurn } from './TaskProgressOverview';

export interface TaskStatusCardProps {
  snapshot: TaskSnapshot;
  send(command: TaskCommand): void;
  /** Last user goal text - used to prefill skill template. */
  defaultInstruction?: string;
  /** Original task instruction. Follow-ups appear as later user turns. */
  missionInstruction?: string;
  /** Chat text for each round, keyed by round id. */
  roundUtterances?: Readonly<Record<string, string>>;
  /** User sentences already sent that do not yet have a round. */
  pendingFollowUps?: readonly string[];
  evidenceSpace?: EvidenceSpace | null;
  /** Focus the continuous-control composer without changing the stable mission. */
  onAdjustDirection?: () => void;
  /** Focus the composer so waiting recovery becomes a valid TaskManager follow-up. */
  onContinueInComposer?: () => void;
  /** Send a waiting option as a user-authored follow-up. */
  onFollowUp?: (instruction: string) => void;
  /** Start the same instruction again after a failed run. */
  onRetry?: () => void;
  /** Stop the live run from the tool log (Sider-style stop pill). */
  onStop?: () => void;
  /** Task commands awaiting acknowledgement; matching controls stay single-shot. */
  pendingCommandTypes?: ReadonlySet<TaskCommand['type']>;
  /** Historical projections are inspect-only and may never dispatch task commands. */
  readOnly?: boolean;
  isDarkMode?: boolean;
}

function waitReasonHint(reason: WaitReason | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case 'login_required':
      return t('chat_task_hint_login');
    case 'captcha_required':
      return t('chat_task_hint_captcha');
    case 'proof_required':
      return t('chat_task_hint_proof');
    case 'commit_outcome_uncertain':
      return '提交结果不确定。请先在网页确认；为避免重复提交，当前任务只能停止后重新委托。';
    case 'target_missing':
      return t('chat_task_hint_target_missing');
    case 'target_ambiguous':
      return t('chat_task_hint_target_ambiguous');
    case 'confirm_execute':
      return null;
    case 'skill_inputs_required':
      return '当前任务不能直接补交模板参数。请停止后，从「可再运行」重新填写。';
  }
}

/** Map executor failureCategory → user-visible Chinese/en i18n (no machine noise). */
export function failureCategoryHint(category: string | undefined): string | null {
  if (!category) return null;
  switch (category) {
    case 'llm_failed':
      return t('chat_task_fail_llm');
    case 'observe_failed':
      return t('chat_task_fail_observe');
    case 'json_parse_failed':
      return t('chat_task_fail_json');
    case 'no_action':
      return t('chat_task_fail_no_action');
    case 'judge_retry':
      return t('chat_task_fail_no_deliverable');
    case 'unknown_action':
      return t('chat_task_fail_unknown_action');
    case 'action_failed':
      return t('chat_task_fail_action');
    case 'max_steps':
      return t('chat_task_fail_max_steps');
    case 'setup_failed':
      return t('chat_task_fail_setup');
    case 'executor_start_failed':
      return t('chat_task_fail_start');
    case 'on_plan_failed':
      return t('chat_task_fail_plan');
    case 'dispatch_failed':
      return t('chat_task_fail_dispatch');
    case 'no_completion_criteria':
      return t('chat_task_fail_no_criteria');
    case 'missing_instruction':
      return t('chat_task_fail_missing_instruction');
    default:
      return t('chat_task_fail_unknown', [category]);
  }
}

/** Avoid repeating the same recovery sentence as both hint and product label. */
export function distinctFailureCategoryLabel(nextStep: string, category: string | undefined): string | null {
  if (!category) return null;
  const label = productFailureLabel(category);
  return label && label !== nextStep ? label : null;
}

export function failureNextStep(snapshot: TaskSnapshot): string {
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  // proof_required copy mentions the confirm button; only show it when one exists.
  const hasConfirmable =
    round?.criteria.some(
      criterion =>
        criterion.kind === 'user_confirmed' &&
        !round.evidence.some(
          evidence => evidence.criterionId === criterion.id && evidence.source === 'user' && evidence.passed,
        ),
    ) ?? false;
  const strippedUnconfirmableProof = round?.waitReason === 'proof_required' && !hasConfirmable;
  const waitReason = strippedUnconfirmableProof ? undefined : round?.waitReason;
  const hint = waitReasonHint(waitReason);
  if (hint) return hint;
  if (strippedUnconfirmableProof) return t('chat_task_hint_proof_unconfirmable');
  if (snapshot.status === 'waiting_user') return t('chat_task_fail_no_action');
  if (snapshot.status === 'failed') {
    const category = round?.failureCategory;
    if (category === 'no_action') {
      return t('chat_task_fail_no_deliverable');
    }
    if (category) {
      // Known product codes keep the coarse label; "other" surfaces executor-specific i18n.
      if (toProductFailureCode(category) === 'other') {
        return failureCategoryHint(category) ?? productFailureLabel(category);
      }
      return productFailureLabel(category);
    }
    return t('chat_task_hint_failed_generic');
  }
  if (snapshot.status === 'cancelled') return t('chat_task_hint_cancelled');
  if (snapshot.status === 'interrupted') return t('chat_task_hint_interrupted');
  if (snapshot.status === 'completed') return '';
  return t('chat_task_hint_generic');
}

/** Turn a concrete instruction into a reusable template when possible. */
export function instructionToSkillTemplate(instruction: string): string {
  let text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const fieldTokens = [...text.matchAll(/\bFIELD_[A-Z0-9_]+\b/g)].map(match => match[0]);
  const unique = [...new Set(fieldTokens)];
  if (unique.length === 1) {
    return text.split(unique[0]).join('{{name}}');
  }
  if (unique.length > 1) {
    unique.forEach((token, index) => {
      text = text.split(token).join(`{{field${index + 1}}}`);
    });
    return text;
  }

  const withMatch = text.match(/\bwith\s+([A-Za-z0-9._@+-]{2,80})(?=\s+(?:and|then)\b|[,;.]|$)/i);
  if (withMatch?.[1] && !/^(the|a|an|this|that|my|your)$/i.test(withMatch[1])) {
    return text.replace(withMatch[1], '{{name}}');
  }

  return text;
}

/** Human labels for action names (design/003 round timeline). */
export function humanActionLabel(actionName: string): string {
  const map: Record<string, Parameters<typeof t>[0]> = {
    go_to_url: 'chat_task_action_open',
    open_tab: 'chat_task_action_open_tab',
    switch_tab: 'chat_task_action_switch_tab',
    focus_tab: 'chat_task_action_switch_tab',
    close_tab: 'chat_task_action_close_tab',
    click_element: 'chat_task_action_click',
    input_text: 'chat_task_action_input',
    send_keys: 'chat_task_action_keys',
    control_media: 'chat_task_action_media',
    save_screenshot: 'chat_task_action_screenshot',
    scroll_to_text: 'chat_task_action_scroll',
    scroll_to_percent: 'chat_task_action_scroll',
    wait: 'chat_task_action_wait',
    done: 'chat_task_action_done',
    search_google: 'chat_task_action_search',
    go_back: 'chat_task_action_back',
    get_dropdown_options: 'chat_task_action_read_options',
    select_dropdown_option: 'chat_task_action_select',
  };
  if (actionName === 'observe') return '查看页面';
  if (actionName === 'extract_content') return '抽取内容';
  return t(map[actionName] ?? 'chat_task_action_generic');
}

/** Prefer backend displaySummary (verb + object); fall back to coarse action label. */
export function attemptDisplayTitle(attempt: Pick<ActionAttempt, 'actionName' | 'displaySummary'>): string {
  const summary = attempt.displaySummary?.replace(/\s+/g, ' ').trim();
  // Never surface raw English actionName as a "summary" (design/005 P2).
  if (summary && summary.length >= 2 && !looksLikeActionName(summary)) return summary;
  return humanActionLabel(attempt.actionName);
}

function boundPageRef(snapshot: TaskSnapshot) {
  return (
    [...snapshot.targetRefs].reverse().find(ref => ref.kind === 'page' && ref.tabId === snapshot.activeTabId) ??
    [...snapshot.targetRefs].reverse().find(ref => ref.kind === 'page')
  );
}

function isLoopbackSource(source: { host?: string; url: string }): boolean {
  const host = (source.host ?? '').toLowerCase();
  try {
    const hostname = new URL(source.url).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
  } catch {
    return host === 'localhost' || host === '127.0.0.1';
  }
}

/** Prefer hostname · title for the card chrome; full URL only when needed. */
function siteHostLabel(snapshot: TaskSnapshot): string {
  const page = boundPageRef(snapshot);
  let host = '';
  if (page?.urlOrigin && page.urlOrigin !== 'null') {
    try {
      host = new URL(page.urlOrigin).hostname.replace(/^www\./, '');
    } catch {
      host = page.urlOrigin;
    }
  }
  const title = stripTabCountPrefix(page?.label?.trim() ?? '');
  if (host && title && title !== host) {
    const short = title.length > 28 ? `${title.slice(0, 26)}…` : title;
    return `${host} · ${short}`;
  }
  if (host) return host;
  if (title) return title;
  return t('chat_task_working_on_page');
}

export function taskPresenceLabel(snapshot: TaskSnapshot): string {
  if (snapshot.status === 'running') {
    return t(isFollowingForeground(snapshot) ? 'chat_task_presence_following' : 'chat_task_presence_background');
  }
  if (snapshot.status === 'failed') return t('chat_task_presence_not_completed');
  return t(`chat_task_status_${snapshot.status}` as `chat_task_status_${TaskSnapshot['status']}`);
}

function taskPresenceMeta(snapshot: TaskSnapshot): string {
  return siteHostLabel(snapshot);
}

export function mergeVerifiedTargetSources(
  snapshot: TaskSnapshot,
  round: TaskSnapshot['rounds'][number] | undefined,
  streamSources: StreamSource[],
): StreamSource[] {
  const verifiedTargetIds = new Set(
    round?.evidence.filter(evidence => evidence.passed).map(evidence => evidence.targetRefId),
  );
  const verifiedRefs = snapshot.targetRefs.filter(ref => {
    const hasVerifiedObservation = Boolean(ref.title?.trim() || ref.bodyDigest || ref.pageRevision);
    return ref.kind === 'page' && (verifiedTargetIds.has(ref.id) || hasVerifiedObservation);
  });
  const privateQueryPaths = new Set(
    verifiedRefs.filter(ref => ref.queryIdentityDigest && ref.normalizedUrl).map(ref => ref.normalizedUrl!),
  );
  const sourcePath = (value: string): string | null => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return (url.origin + url.pathname).replace(/\/+$/, '') || url.origin;
    } catch {
      return null;
    }
  };
  const sources = streamSources
    .filter(source => {
      const path = sourcePath(source.url);
      return !path || !privateQueryPaths.has(path);
    })
    .map(source => ({ ...source }));
  const seen = new Set(sources.map(source => source.url));

  for (const ref of verifiedRefs) {
    const url = ref.normalizedUrl ?? ref.urlOrigin;
    if (!/^https?:\/\//i.test(url)) continue;
    let host: string | undefined;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      host = undefined;
    }
    if (ref.queryIdentityDigest) {
      sources.push({
        id: `verified-${ref.id}`,
        title: ref.title?.trim() || ref.label?.trim() || host || '网页',
        host,
        url,
        unavailable: true,
      });
      continue;
    }
    if (seen.has(url)) {
      const existing = sources.find(source => source.url === url);
      if (existing) existing.tabId = ref.tabId;
      continue;
    }
    sources.push({
      id: `verified-${ref.id}`,
      title: ref.title?.trim() || ref.label?.trim() || host || '网页',
      host,
      url,
      tabId: ref.tabId,
    });
    seen.add(url);
  }

  return sources.slice(0, 8);
}

/**
 * What the user asked for.
 * Prefer chat message text: task snapshots intentionally keep generic
 * goalSummary ("User task") so secrets never land in storage.
 */
function isPlaceholderInstruction(value: string): boolean {
  return !value || /^user\s+(task|instruction)$/i.test(value) || value === 'Direction changed';
}

export function displayGoalText(
  snapshot: TaskSnapshot,
  roundInstruction: string | undefined,
  defaultInstruction = '',
): string {
  const fromChat = defaultInstruction.replace(/\s+/g, ' ').trim();
  if (fromChat && !isPlaceholderInstruction(fromChat)) return fromChat;
  for (const c of [snapshot.goalSummary, roundInstruction]) {
    const text = (c ?? '').replace(/\s+/g, ' ').trim();
    if (!isPlaceholderInstruction(text)) return text;
  }
  return fromChat || '—';
}

function roundUserText(
  round: TaskRound,
  index: number,
  goalText: string,
  roundUtterances?: Readonly<Record<string, string>>,
): string {
  const fromChat = (roundUtterances?.[round.id] ?? '').replace(/\s+/g, ' ').trim();
  if (fromChat && !isPlaceholderInstruction(fromChat)) return fromChat;
  return index === 0 ? goalText : '';
}

function followUpTurns(
  snapshot: TaskSnapshot,
  goalText: string,
  roundUtterances?: Readonly<Record<string, string>>,
  pendingFollowUps: readonly string[] = [],
): ProgressTurn[] | undefined {
  const rows = snapshot.rounds
    .map((round, index) => ({ round, user: roundUserText(round, index, goalText, roundUtterances) }))
    .filter(row => row.user.length > 0);
  const pending = pendingFollowUps
    .map(user => user.replace(/\s+/g, ' ').trim())
    .filter(user => user && !rows.some(row => row.user === user))
    .map(user => ({ user }));
  if (rows.length + pending.length <= 1) return undefined;
  const painted = rows.map(row => {
    if (row.round.id === snapshot.currentRoundId && pending.length === 0) return { user: row.user };
    const priorBody = row.round.result?.body?.replace(/\r\n?/g, '\n').trim() ?? '';
    return {
      user: row.user,
      result: priorBody ? <AnswerProse text={priorBody} /> : null,
      nowBody: workStreamBody(
        deriveWorkStream({
          status: row.round.status,
          attempts: row.round.attempts,
          currentSummary: row.round.pageReading,
        }),
        false,
      ),
    };
  });
  return [...painted, ...pending.map(row => ({ user: row.user }))];
}

function RunPresence({ snapshot, showPartialComplete }: { snapshot: TaskSnapshot; showPartialComplete: boolean }) {
  if (snapshot.status === 'running') return null;
  return (
    <div
      className="chijie-run-presence"
      data-testid="task-presence"
      data-status={showPartialComplete ? 'waiting_user' : snapshot.status}
      role="status"
      aria-live="polite">
      <span className="chijie-run-presence-state">
        <span className="chijie-run-presence-dot" aria-hidden />
        <strong>{showPartialComplete ? t('chat_task_status_waiting_user') : taskPresenceLabel(snapshot)}</strong>
      </span>
      <span className="chijie-run-presence-meta">{taskPresenceMeta(snapshot)}</span>
    </div>
  );
}

function ProofRecovery({
  producedBody,
  onRetry,
  buttonClassName,
}: {
  producedBody?: string;
  onRetry?: () => void;
  buttonClassName: string;
}) {
  return (
    <div className="chijie-proof-recovery" data-testid="proof-recovery">
      {producedBody ? (
        <section className="chijie-produced-answer" data-testid="produced-answer">
          <AnswerProse text={producedBody} />
        </section>
      ) : null}
      {onRetry ? (
        <button type="button" data-testid="proof-retry" className={buttonClassName} onClick={onRetry}>
          {t('chat_task_fail_action')}
        </button>
      ) : null}
    </div>
  );
}

export function TaskStatusCard({
  snapshot,
  send,
  defaultInstruction = '',
  missionInstruction = '',
  roundUtterances,
  pendingFollowUps = [],
  evidenceSpace = null,
  onAdjustDirection,
  onContinueInComposer,
  onFollowUp,
  onRetry,
  onStop,
  pendingCommandTypes = new Set(),
  readOnly = false,
}: TaskStatusCardProps) {
  const [deliverableCopied, setDeliverableCopied] = useState(false);
  const [waitAskBusy, setWaitAskBusy] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    setWaitAskBusy(false);
  }, [snapshot.id, snapshot.status, snapshot.revision]);
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  const attempts = round?.attempts ?? [];
  const confirmations =
    round?.criteria.filter(
      criterion =>
        criterion.kind === 'user_confirmed' &&
        !round.evidence.some(
          evidence => evidence.criterionId === criterion.id && evidence.source === 'user' && evidence.passed,
        ),
    ) ?? [];
  const waitAction = snapshot.status === 'waiting_user' ? waitUserAction(round?.waitReason) : null;
  const waitAsk = deriveWaitAsk({
    status: snapshot.status,
    waitReason: round?.waitReason,
    pageReading: round?.pageReading,
    waitAsk: round?.waitAsk,
  });

  const needsAttention =
    snapshot.status === 'waiting_user' || snapshot.status === 'inputs_required' || snapshot.status === 'interrupted';

  const stableInstruction = missionInstruction || defaultInstruction;
  const goalText = displayGoalText(snapshot, round?.instructionSummary, stableInstruction);
  const progressView = deriveTaskProgressView({
    snapshot,
    missionInstruction: stableInstruction,
    evidenceSpace,
    now: nowTick,
  });

  useEffect(() => {
    setWaitAskBusy(false);
  }, [snapshot.id, snapshot.revision, snapshot.status]);

  useEffect(() => {
    if (snapshot.status !== 'running') return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [snapshot.status, snapshot.id]);

  const passedEvidence =
    round?.evidence
      .filter(evidence => evidence.passed)
      .map(evidence => ({
        ...evidence,
        criterion: round.criteria.find(criterion => criterion.id === evidence.criterionId),
      })) ?? [];
  const showVerifiedDone = shouldShowVerifiedDone(snapshot, round?.receipt);
  const showDelivered = shouldShowDeliveredResult(snapshot);
  const evidenceForUi = passedEvidence.map(item => ({
    kind: item.criterion?.kind,
    passed: item.passed,
    value: item.value,
  }));
  // Always a human result sentence when verified (design/006 §5 #2) — never empty completion.
  const completionOutcome = requiredCompletionResult({
    instructionSummary: round?.instructionSummary,
    evidence: evidenceForUi,
    fallback: t('chat_task_done_body'),
  });
  const deliverableAnswer = resolveDeliverableAnswer({
    instructionSummary: round?.instructionSummary,
    goalText: goalText || snapshot.goalSummary || '',
    completionOutcome,
  });
  const goalCoverage = assessGoalCoverage({
    goalText: goalText || snapshot.goalSummary || '',
    evidence: evidenceForUi,
    answerText: deliverableAnswer,
  });
  const showPartialComplete = showVerifiedDone && goalCoverage.coverage === 'partial';
  const progressViewForUi = showPartialComplete
    ? {
        ...progressView,
        status: 'needs_user' as const,
        health: { state: 'needs_user' as const, summary: '部分完成，仍需补充未覆盖的要求' },
      }
    : progressView;
  // Feature-first primary organism (design/004+005): activity | completion | recovery.
  const primaryOrganism = taskPrimaryOrganism({
    status: snapshot.status,
    showVerifiedDone,
  });

  const recoveryNextStep = failureNextStep(snapshot);

  const boundPage = boundPageRef(snapshot);
  const workStream = deriveWorkStream({
    status: snapshot.status,
    attempts,
    currentSummary: round?.pageReading,
    pageLabel: boundPage ? siteHostLabel(snapshot) : undefined,
    pageUrl: boundPage?.normalizedUrl || (boundPage?.urlOrigin !== 'null' ? boundPage?.urlOrigin : undefined),
    pageTitle: boundPage?.title?.trim() || boundPage?.label?.trim(),
    verifiedPages: verifiedPagesFromTargets(snapshot.targetRefs),
  });
  const storedResult = round?.result?.body?.replace(/\r\n?/g, '\n').trim() ?? '';
  const resultSentence = storedResult || deliverableAnswer || '';
  const copyDeliverable = async () => {
    if (!resultSentence) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(resultSentence);
      }
      setDeliverableCopied(true);
      window.setTimeout(() => setDeliverableCopied(false), 1_500);
    } catch {
      // Clipboard may be blocked; still select-friendly via the text node.
    }
  };
  const answerSources = resultSentence
    ? mergeVerifiedTargetSources(snapshot, round, collectStreamSources(workStream)).filter(
        source => !isLoopbackSource(source),
      )
    : [];
  const failedResult = deriveFailedResult({
    failureCategory: round?.failureCategory,
    lastStepTitle: attempts.at(-1)?.displaySummary,
  });
  const nowTraceBody = processNowBody(
    workStream,
    snapshot.status === 'running',
    onStop,
    progressView.currentActivity,
    readOnly,
  );
  const turns = followUpTurns(snapshot, goalText, roundUtterances, pendingFollowUps);

  const completionBlock =
    showDelivered || (showVerifiedDone && round?.receipt) ? (
      <div
        data-testid="completion-receipt"
        data-receipt-id={round?.receipt?.id}
        data-coverage={goalCoverage.coverage}
        className={showPartialComplete ? 'chijie-done-block is-partial' : 'chijie-done-block'}>
        {showPartialComplete ? (
          <>
            <div className="font-medium" data-testid="completion-partial-title">
              {t('chat_task_partial_title')}
            </div>
            <div className="mt-0.5 text-xs opacity-90">{t('chat_task_partial_body')}</div>
            {goalCoverage.done.length > 0 && (
              <div className="chijie-coverage-block" data-testid="completion-coverage-done">
                <div className="chijie-coverage-label">{t('chat_task_partial_done_label')}</div>
                <ul>
                  {goalCoverage.done.map(line => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {goalCoverage.missing.length > 0 && (
              <div className="chijie-coverage-block is-missing" data-testid="completion-coverage-missing">
                <div className="chijie-coverage-label">{t('chat_task_partial_missing_label')}</div>
                <ul>
                  {goalCoverage.missing.map(line => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : resultSentence ? (
          <>
            <AnswerProse text={resultSentence} sources={answerSources} />
            {resultSentence ? (
              <div className="chijie-completion-deliverable" data-testid="completion-deliverable">
                <button
                  type="button"
                  className="chijie-answer-copy"
                  data-testid="completion-deliverable-copy"
                  title={deliverableCopied ? t('chat_task_copy_done') : t('chat_task_copy_result')}
                  onClick={() => void copyDeliverable()}>
                  <FiCopy aria-hidden />
                  {deliverableCopied ? t('chat_task_copy_done') : t('chat_task_copy_result')}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    ) : snapshot.status === 'failed' ? (
      <div data-testid="failed-result" className="chijie-failed-result is-failed">
        <p data-testid="failed-result-sentence">{failedResult.sentence}</p>
        {!readOnly && onRetry ? (
          <button type="button" data-testid="task-retry" className={primaryButtonClassName} onClick={onRetry}>
            {failedResult.action}
          </button>
        ) : null}
      </div>
    ) : null;

  // Follow-ups go through the composer. Do not put 调整方向 on the live card.
  const taskControls = null;
  void onAdjustDirection;

  return (
    <section
      data-testid="task-status"
      data-task-id={snapshot.id}
      data-round-id={round?.id}
      data-status={showPartialComplete ? 'waiting_user' : snapshot.status}
      data-coverage={showVerifiedDone ? goalCoverage.coverage : undefined}
      data-attention={needsAttention || showPartialComplete ? 'true' : 'false'}
      data-primary-organism={primaryOrganism}
      data-readonly={readOnly ? 'true' : undefined}
      className={`${taskCardClassName} t-resize`}>
      <RunPresence snapshot={snapshot} showPartialComplete={showPartialComplete} />
      {/* Original sentence first. Follow-ups are later user turns. */}
      <TaskProgressOverview
        view={progressViewForUi}
        now={nowTick}
        utterance={goalText}
        turns={turns}
        controls={taskControls}
        interrupted={snapshot.status === 'interrupted'}
        result={primaryOrganism === 'completion' || snapshot.status === 'failed' ? completionBlock : null}
        nowBody={nowTraceBody}
      />

      {/* Recovery: one human hint + one CTA. Stop stays beside the composer. */}
      {(snapshot.status === 'cancelled' ||
        snapshot.status === 'waiting_user' ||
        snapshot.status === 'inputs_required') && (
        <div data-testid="task-next-step" className="chijie-next-step" data-primary-organism="recovery">
          {!waitAsk && <div className="font-medium">{t('chat_task_next_step_title')}</div>}
          <div className={waitAsk ? 'chijie-wait-ask-prompt' : 'mt-1'} data-testid="task-failure-reason">
            {waitAsk?.prompt ?? recoveryNextStep}
          </div>

          {!readOnly &&
            snapshot.status === 'waiting_user' &&
            round?.waitReason === 'proof_required' &&
            confirmations.length === 0 && (
              <ProofRecovery
                producedBody={round.produced?.body}
                onRetry={onRetry}
                buttonClassName={primaryButtonClassName}
              />
            )}

          {/* One valid CTA: proof command or a composer follow-up. Stop stays in composer controls. */}
          {!readOnly &&
            snapshot.status === 'waiting_user' &&
            round?.waitReason === 'proof_required' &&
            confirmations.map(confirmation => (
              <button
                key={confirmation.id}
                type="button"
                data-testid="criterion-confirm"
                className={`${primaryButtonClassName} mt-2`}
                disabled={pendingCommandTypes.has('confirm_completion')}
                aria-busy={pendingCommandTypes.has('confirm_completion')}
                onClick={() =>
                  send({
                    type: 'confirm_completion',
                    commandId: crypto.randomUUID(),
                    taskId: snapshot.id,
                    expectedRevision: snapshot.revision,
                    roundId: round.id,
                    criterionId: confirmation.id,
                  })
                }>
                {t('chat_task_confirm_done')}
              </button>
            ))}

          {!readOnly && waitAsk && onFollowUp && !waitAskBusy && (
            <PanelReveal className="chijie-wait-ask" testId="wait-ask">
              <div className="chijie-wait-ask-options" role="group" aria-label={waitAsk.prompt}>
                {waitAsk.options.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    data-testid="wait-ask-option"
                    className={secondaryButtonClassName}
                    onClick={() => {
                      setWaitAskBusy(true);
                      onFollowUp(option.sendText);
                    }}>
                    {option.label}
                  </button>
                ))}
              </div>
            </PanelReveal>
          )}

          {!readOnly && waitAction && onContinueInComposer && (
            <button
              type="button"
              data-testid="wait-compose-follow-up"
              className={waitAsk ? 'chijie-wait-compose-follow-up' : `${primaryButtonClassName} mt-2`}
              onClick={onContinueInComposer}>
              {waitAsk ? '自己写' : waitAction === 'clarify-in-composer' ? '补充指令' : '告诉持节继续'}
            </button>
          )}
        </div>
      )}

      {!readOnly && showPartialComplete && onContinueInComposer && (
        <div className="chijie-next-step" data-testid="completion-partial-follow-up">
          <button type="button" className={primaryButtonClassName} onClick={onContinueInComposer}>
            补充未完成的要求
          </button>
        </div>
      )}
    </section>
  );
}
