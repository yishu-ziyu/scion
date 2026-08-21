import type { ActionAttempt, EvidenceSpace, TaskCommand, TaskSnapshot, WaitReason } from '@extension/storage';
import { t } from '@extension/i18n';
import { useEffect, useState } from 'react';
import { primaryButtonClassName, taskCardClassName } from '../design/contracts';
import { shouldShowDeliveredResult, shouldShowVerifiedDone, taskPrimaryOrganism } from '../presentation/task-loop-ui';
import { deriveFailedResult } from '../presentation/failed-result';
import { looksLikeActionName } from '../presentation/activity-stream';
import { requiredCompletionResult } from '../presentation/completion-outcome';
import { assessGoalCoverage, resolveDeliverableAnswer } from '../presentation/goal-coverage';
import { productFailureLabel, toProductFailureCode } from '../presentation/failure-taxonomy';
import { waitUserAction } from '../presentation/wait-affordance';
import { deriveTaskProgressView } from '../presentation/task-progress-view';
import { collectStreamSources, deriveWorkStream } from '../presentation/work-stream';
import { WorkStream } from './WorkStream';
import { AnswerProse } from './AnswerProse';
import { TaskProgressOverview } from './TaskProgressOverview';

export interface TaskStatusCardProps {
  snapshot: TaskSnapshot;
  send(command: TaskCommand): void;
  /** Last user goal text - used to prefill skill template. */
  defaultInstruction?: string;
  /** Original task instruction. Follow-ups must not replace the stable mission. */
  missionInstruction?: string;
  evidenceSpace?: EvidenceSpace | null;
  /** Focus the continuous-control composer without changing the stable mission. */
  onAdjustDirection?: () => void;
  /** Focus the composer so waiting recovery becomes a valid TaskManager follow-up. */
  onContinueInComposer?: () => void;
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
  if (strippedUnconfirmableProof) return t('chat_task_fail_no_deliverable');
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
  const title = page?.label?.trim();
  if (host && title && title !== host) {
    const short = title.length > 28 ? `${title.slice(0, 26)}…` : title;
    return `${host} · ${short}`;
  }
  if (host) return host;
  if (title) return title;
  return t('chat_task_working_on_page');
}

/**
 * What the user asked for.
 * Prefer chat message text: task snapshots intentionally keep generic
 * goalSummary ("User task") so secrets never land in storage.
 */
export function displayGoalText(
  snapshot: TaskSnapshot,
  roundInstruction: string | undefined,
  defaultInstruction = '',
): string {
  const isPlaceholder = (s: string) => !s || /^user\s+(task|instruction)$/i.test(s);
  const fromChat = defaultInstruction.replace(/\s+/g, ' ').trim();
  if (fromChat && !isPlaceholder(fromChat)) return fromChat;
  for (const c of [snapshot.goalSummary, roundInstruction]) {
    const text = (c ?? '').replace(/\s+/g, ' ').trim();
    if (!isPlaceholder(text)) return text;
  }
  return fromChat || '—';
}

export function TaskStatusCard({
  snapshot,
  send,
  defaultInstruction = '',
  missionInstruction = '',
  evidenceSpace = null,
  onAdjustDirection,
  onContinueInComposer,
  onRetry,
  onStop,
  pendingCommandTypes = new Set(),
  readOnly = false,
}: TaskStatusCardProps) {
  const [deliverableCopied, setDeliverableCopied] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
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

  const copyDeliverable = async () => {
    if (!deliverableAnswer) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(deliverableAnswer);
      }
      setDeliverableCopied(true);
      window.setTimeout(() => setDeliverableCopied(false), 1_500);
    } catch {
      // Clipboard may be blocked; still select-friendly via the text node.
    }
  };

  const workStream = deriveWorkStream({
    status: snapshot.status,
    attempts,
    pageLabel: boundPageRef(snapshot) ? siteHostLabel(snapshot) : undefined,
  });
  const storedResult = round?.result?.body?.replace(/\r\n?/g, '\n').trim() ?? '';
  const resultSentence = storedResult || deliverableAnswer || '';
  const answerSources = resultSentence
    ? collectStreamSources(workStream).filter(source => !isLoopbackSource(source))
    : [];
  const failedResult = deriveFailedResult({
    failureCategory: round?.failureCategory,
    lastStepTitle: attempts.at(-1)?.displaySummary,
  });
  const nowTraceBody =
    snapshot.status === 'running' || workStream.blocks.length > 0 ? (
      <div data-testid="task-activity-panel" className="chijie-activity-panel">
        <WorkStream
          view={workStream}
          running={snapshot.status === 'running'}
          onStop={!readOnly && snapshot.status === 'running' ? onStop : undefined}
        />
      </div>
    ) : null;

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
                  title={deliverableCopied ? '已复制' : '复制成果'}
                  onClick={() => void copyDeliverable()}>
                  {deliverableCopied ? '已复制' : '复制'}
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
      className={taskCardClassName}>
      {/* 2. Stable mission + durable gates + health. Follow-ups never replace Mission. */}
      <TaskProgressOverview
        view={progressViewForUi}
        now={nowTick}
        utterance={goalText}
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
          <div className="font-medium">{t('chat_task_next_step_title')}</div>
          <div className="mt-1" data-testid="task-failure-reason">
            {recoveryNextStep}
          </div>

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

          {!readOnly && waitAction && onContinueInComposer && (
            <button
              type="button"
              data-testid="wait-compose-follow-up"
              className={`${primaryButtonClassName} mt-2`}
              onClick={onContinueInComposer}>
              {waitAction === 'clarify-in-composer' ? '补充指令' : '告诉持节继续'}
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
