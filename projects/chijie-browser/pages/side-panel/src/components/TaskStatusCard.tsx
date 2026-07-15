import type { ActionAttempt, TaskCommand, TaskSnapshot, WaitReason } from '@extension/storage';
import { t } from '@extension/i18n';
import { useEffect, useState } from 'react';
import {
  actionStackClassName,
  completionVisibleText,
  dangerButtonClassName,
  monoLabelClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
  statusLabelKey,
  taskCardClassName,
} from '../design/contracts';
import {
  TASK_OUTCOME_RATING_LABELS,
  type TaskOutcomeRating,
  defaultStepsExpanded,
  ratingStorageKey,
  shouldShowExecutionSteps,
  shouldShowOutcomeRating,
  shouldShowVerifiedDone,
} from '../presentation/task-loop-ui';
import { productFailureLabel, toProductFailureCode } from '../presentation/failure-taxonomy';

export interface TaskStatusCardProps {
  snapshot: TaskSnapshot;
  send(command: TaskCommand): void;
  /** Last user goal text - used to prefill skill template. */
  defaultInstruction?: string;
  isDarkMode?: boolean;
}

function waitReasonHint(reason: WaitReason | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case 'login_required':
      return t('chat_task_hint_login');
    case 'captcha_required':
      return t('chat_task_hint_captcha');
    case 'approval_rejected':
      return t('chat_task_hint_rejected');
    case 'proof_required':
      return t('chat_task_hint_proof');
    case 'commit_outcome_uncertain':
      return t('chat_task_hint_uncertain');
    case 'target_missing':
      return t('chat_task_hint_target_missing');
    case 'target_ambiguous':
      return t('chat_task_hint_target_ambiguous');
    case 'skill_inputs_required':
      return t('chat_task_hint_skill_inputs');
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
    default:
      return t('chat_task_fail_unknown', [category]);
  }
}

function failureNextStep(snapshot: TaskSnapshot): string {
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
  const waitReason =
    round?.waitReason === 'proof_required' && !hasConfirmable ? undefined : round?.waitReason;
  const hint = waitReasonHint(waitReason);
  if (hint) return hint;
  if (snapshot.status === 'failed') {
    const category = round?.failureCategory;
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
  const map: Record<string, string> = {
    go_to_url: '打开页面',
    open_tab: '打开标签页',
    switch_tab: '切换标签',
    click_element: '点击元素',
    input_text: '填写表单',
    send_keys: '键盘输入',
    control_media: '媒体控制',
    scroll_to_text: '滚动定位',
    scroll_to_percent: '滚动页面',
    wait: '等待',
    done: '准备完成',
    search_google: '搜索',
    go_back: '返回',
    get_dropdown_options: '读取选项',
    select_dropdown_option: '选择选项',
  };
  return map[actionName] ?? actionName.replaceAll('_', ' ');
}

function attemptLineState(attempt: ActionAttempt, isLatestPendingCommit: boolean): string {
  if (isLatestPendingCommit && attempt.effect === 'external_commit') {
    return '即将提交（需审批）';
  }
  switch (attempt.state) {
    case 'observed':
      return '已完成';
    case 'executing':
      return '执行中';
    case 'approved':
      return '已批准';
    case 'proposed':
      return '准备中';
    case 'uncertain':
      return '结果待确认';
    case 'blocked':
      return '已阻止';
    default:
      return attempt.state;
  }
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function siteLabel(snapshot: TaskSnapshot): string {
  const page = [...snapshot.targetRefs].reverse().find(ref => ref.kind === 'page');
  if (page?.urlOrigin && page.urlOrigin !== 'null') return page.urlOrigin;
  return t('chat_task_working_on_page');
}

export function TaskStatusCard({ snapshot, send, defaultInstruction = '' }: TaskStatusCardProps) {
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [skillTitle, setSkillTitle] = useState('');
  const [skillTemplate, setSkillTemplate] = useState('');
  const [stepsExpanded, setStepsExpanded] = useState(() => defaultStepsExpanded(snapshot.status));
  const [outcomeRating, setOutcomeRating] = useState<TaskOutcomeRating | null>(null);
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  const approval = round?.approvals.find(item => item.status === 'pending');
  const attempts = round?.attempts ?? [];
  const confirmations =
    round?.criteria.filter(
      criterion =>
        criterion.kind === 'user_confirmed' &&
        !round.evidence.some(
          evidence => evidence.criterionId === criterion.id && evidence.source === 'user' && evidence.passed,
        ),
    ) ?? [];

  const isTerminal = ['completed', 'failed', 'cancelled'].includes(snapshot.status);
  const needsAttention =
    snapshot.status === 'waiting_approval' ||
    snapshot.status === 'waiting_user' ||
    snapshot.status === 'inputs_required' ||
    snapshot.status === 'failed' ||
    snapshot.status === 'interrupted';

  const doneSteps = attempts.filter(a => a.state === 'observed' || a.state === 'approved').length;
  const totalHint = Math.max(attempts.length + (snapshot.status === 'waiting_approval' ? 1 : 0), attempts.length, 1);
  const progressLabel = `${Math.min(doneSteps + (snapshot.status === 'waiting_approval' ? 1 : 0), totalHint)}/${Math.max(totalHint, 7)}`;

  useEffect(() => {
    setStepsExpanded(defaultStepsExpanded(snapshot.status));
  }, [snapshot.id, snapshot.status, round?.id]);

  useEffect(() => {
    const receiptId = round?.receipt?.id;
    if (!receiptId || typeof localStorage === 'undefined') {
      setOutcomeRating(null);
      return;
    }
    const stored = localStorage.getItem(ratingStorageKey(receiptId));
    if (stored === 'success' || stored === 'partial' || stored === 'fail') {
      setOutcomeRating(stored);
    } else {
      setOutcomeRating(null);
    }
  }, [round?.receipt?.id]);

  const openSkillForm = () => {
    setShowSkillForm(true);
    setSkillTitle(previous => previous || snapshot.goalSummary.slice(0, 48) || t('chat_skills_defaultTitle'));
    setSkillTemplate(previous => {
      if (previous.trim()) return previous;
      return instructionToSkillTemplate(defaultInstruction) || defaultInstruction;
    });
  };

  const completionText = completionVisibleText({
    doneTitle: t('chat_task_done_title'),
    doneBody: t('chat_task_done_body'),
    receiptId: round?.receipt?.id ?? '',
  });

  const pendingCommitAttempt =
    approval &&
    attempts
      .slice()
      .reverse()
      .find(a => a.id === approval.attemptId || a.effect === 'external_commit');

  const showSteps = shouldShowExecutionSteps(attempts);
  const showVerifiedDone = shouldShowVerifiedDone(round?.receipt);
  const showRating = shouldShowOutcomeRating(round?.receipt);

  const selectRating = (rating: TaskOutcomeRating) => {
    setOutcomeRating(rating);
    const receiptId = round?.receipt?.id;
    if (receiptId && typeof localStorage !== 'undefined') {
      localStorage.setItem(ratingStorageKey(receiptId), rating);
    }
  };

  return (
    <section
      data-testid="task-status"
      data-status={snapshot.status}
      data-attention={needsAttention ? 'true' : 'false'}
      className={taskCardClassName}>
      {/* Header: status */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-medium leading-tight" data-testid="task-status-label">
            {t(statusLabelKey(snapshot.status))}
          </span>
          {!isTerminal && <span className={monoLabelClassName}>{t('chat_task_working_on_page')}</span>}
        </div>
      </div>

      {/* Block 2: Task card (design/003) */}
      <div data-testid="task-goal-block" className="chijie-task-section">
        <div className={monoLabelClassName}>{t('chat_task_section_task')}</div>
        <dl className="chijie-task-meta">
          <div>
            <dt>{t('chat_task_current_goal')}</dt>
            <dd data-testid="task-goal-summary">{snapshot.goalSummary || round?.instructionSummary || '—'}</dd>
          </div>
          <div>
            <dt>{t('chat_task_current_site')}</dt>
            <dd data-testid="task-site">{siteLabel(snapshot)}</dd>
          </div>
          <div>
            <dt>{t('chat_task_progress')}</dt>
            <dd data-testid="task-progress">
              <span className="chijie-progress-track" aria-hidden>
                <span
                  className="chijie-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.round((Number(progressLabel.split('/')[0]) / Number(progressLabel.split('/')[1] || 1)) * 100))}%`,
                  }}
                />
              </span>
              <span className="chijie-progress-text">{progressLabel}</span>
            </dd>
          </div>
        </dl>
        {snapshot.status === 'waiting_approval' && (
          <p className="chijie-policy-hint" data-testid="task-policy-hint">
            {t('chat_task_policy_external')}
          </p>
        )}
      </div>

      {/* Block 3: Collapsible execution steps (Tabbit-class) */}
      {showSteps && (
        <div data-testid="task-round-timeline" className="chijie-task-section">
          <button
            type="button"
            data-testid="task-steps-toggle"
            className={`${monoLabelClassName} flex w-full items-center justify-between gap-2 text-left`}
            aria-expanded={stepsExpanded}
            onClick={() => setStepsExpanded(open => !open)}>
            <span>
              {t('chat_task_steps_heading')} {stepsExpanded ? '⌃' : '⌄'}
            </span>
            <span className="opacity-70">{attempts.length}</span>
          </button>
          {stepsExpanded && (
            <ol data-testid="task-execution-steps" className="chijie-round-timeline">
              {attempts.map((attempt, index) => {
                const isPendingCommit =
                  Boolean(pendingCommitAttempt) &&
                  attempt.id === pendingCommitAttempt?.id &&
                  snapshot.status === 'waiting_approval';
                return (
                  <li
                    key={attempt.id}
                    data-testid="task-round-step"
                    data-state={attempt.state}
                    data-pending={isPendingCommit ? 'true' : 'false'}
                    className={isPendingCommit ? 'is-pending' : undefined}>
                    <span className="chijie-round-time">{formatTime(attempt.proposedAt)}</span>
                    <span className="chijie-round-body">
                      <span className="chijie-round-title">{humanActionLabel(attempt.actionName)}</span>
                      <span className="chijie-round-state">{attemptLineState(attempt, isPendingCommit)}</span>
                    </span>
                    <span className="chijie-round-index" aria-hidden>
                      {index + 1}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {/* Block 4: Approval (design/003) */}
      {snapshot.status === 'waiting_approval' && round && approval && (
        <div data-testid="task-approval-card" className="chijie-approval-card">
          <div className={monoLabelClassName}>{t('chat_task_section_approval')}</div>
          <p className="chijie-approval-title">{t('chat_task_approval_heading')}</p>
          <p className="chijie-approval-body">
            {t('chat_task_approval_explain')}
            {approval.summary ? `「${approval.summary}」` : ''}
          </p>
          <div className="chijie-approval-actions">
            <button
              type="button"
              data-testid="approval-approve"
              className={primaryButtonClassName}
              onClick={() =>
                send({
                  type: 'approve',
                  commandId: crypto.randomUUID(),
                  taskId: snapshot.id,
                  expectedRevision: snapshot.revision,
                  roundId: round.id,
                  approvalId: approval.id,
                })
              }>
              {t('chat_task_approve')}
            </button>
            <button
              type="button"
              data-testid="approval-reject"
              className={secondaryButtonClassName}
              onClick={() =>
                send({
                  type: 'reject',
                  commandId: crypto.randomUUID(),
                  taskId: snapshot.id,
                  expectedRevision: snapshot.revision,
                  roundId: round.id,
                  approvalId: approval.id,
                })
              }>
              {t('chat_task_reject')}
            </button>
          </div>
        </div>
      )}

      {/* Block 5: Verified completion only (receipt required) */}
      {showVerifiedDone && round?.receipt && (
        <div data-testid="completion-receipt" className="chijie-done-block">
          {completionText.split('\n').map(line => (
            <div key={line} className={line === t('chat_task_done_title') ? 'font-medium' : 'mt-0.5 text-xs opacity-90'}>
              {line}
            </div>
          ))}
          <dl className="chijie-receipt-meta" data-testid="completion-receipt-meta">
            <div>
              <dt>{t('chat_task_receipt_id')}</dt>
              <dd className="font-mono text-[11px] opacity-80">{round.receipt.id}</dd>
            </div>
            <div>
              <dt>{t('chat_task_receipt_time')}</dt>
              <dd>{new Date(round.receipt.verifiedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t('chat_task_current_site')}</dt>
              <dd>{siteLabel(snapshot)}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Optional outcome rating after verified done (Tabbit-class) */}
      {showRating && round?.receipt && (
        <div data-testid="task-outcome-rating" className="chijie-task-section">
          <div className={monoLabelClassName}>{t('chat_task_rating_prompt')}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="task-rate-success"
              data-active={outcomeRating === 'success' ? 'true' : 'false'}
              className={outcomeRating === 'success' ? primaryButtonClassName : secondaryButtonClassName}
              onClick={() => selectRating('success')}>
              {TASK_OUTCOME_RATING_LABELS.success}
            </button>
            <button
              type="button"
              data-testid="task-rate-partial"
              data-active={outcomeRating === 'partial' ? 'true' : 'false'}
              className={outcomeRating === 'partial' ? primaryButtonClassName : secondaryButtonClassName}
              onClick={() => selectRating('partial')}>
              {TASK_OUTCOME_RATING_LABELS.partial}
            </button>
            <button
              type="button"
              data-testid="task-rate-fail"
              data-active={outcomeRating === 'fail' ? 'true' : 'false'}
              className={outcomeRating === 'fail' ? primaryButtonClassName : secondaryButtonClassName}
              onClick={() => selectRating('fail')}>
              {TASK_OUTCOME_RATING_LABELS.fail}
            </button>
          </div>
        </div>
      )}

      {(snapshot.status === 'failed' ||
        snapshot.status === 'cancelled' ||
        snapshot.status === 'interrupted' ||
        snapshot.status === 'waiting_user' ||
        snapshot.status === 'inputs_required') && (
        <div data-testid="task-next-step" className="chijie-next-step">
          <div className="font-medium">{t('chat_task_next_step_title')}</div>
          <div className="mt-1" data-testid="task-failure-reason">
            {failureNextStep(snapshot)}
          </div>
          {snapshot.status === 'failed' && round?.failureCategory && (
            <div
              className="mt-1 text-[11px] opacity-70"
              data-testid="task-failure-category"
              data-product-code={toProductFailureCode(round.failureCategory)}>
              {productFailureLabel(round.failureCategory)}
            </div>
          )}
        </div>
      )}

      {snapshot.status === 'waiting_user' &&
        round?.waitReason === 'proof_required' &&
        confirmations.map(confirmation => (
          <button
            key={confirmation.id}
            type="button"
            data-testid="criterion-confirm"
            className={primaryButtonClassName}
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

      {round?.receipt && !showSkillForm && (
        <div className={actionStackClassName}>
          <button type="button" data-testid="skill-save" className={primaryButtonClassName} onClick={openSkillForm}>
            {t('chat_skills_save')}
          </button>
          <p className="text-xs opacity-80">{t('chat_task_skill_save_hint')}</p>
        </div>
      )}

      {round?.receipt && showSkillForm && (
        <div className={actionStackClassName}>
          <label className="flex flex-col gap-1 text-xs">
            {t('chat_skills_titlePlaceholder')}
            <input
              data-testid="skill-title"
              value={skillTitle}
              onChange={event => setSkillTitle(event.target.value)}
              placeholder={t('chat_skills_titlePlaceholder')}
              className="chijie-field"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('chat_skills_templatePlaceholder')}
            <textarea
              data-testid="skill-template"
              value={skillTemplate}
              onChange={event => setSkillTemplate(event.target.value)}
              rows={3}
              placeholder={t('chat_skills_templatePlaceholder')}
              className="chijie-field"
            />
          </label>
          <p className="text-xs opacity-70">{t('chat_task_skill_template_help')}</p>
          <button
            type="button"
            data-testid="skill-save-confirm"
            className={primaryButtonClassName}
            disabled={!skillTemplate.trim()}
            onClick={() => {
              send({
                type: 'save_skill',
                commandId: crypto.randomUUID(),
                taskId: snapshot.id,
                expectedRevision: snapshot.revision,
                roundId: round.id,
                title: skillTitle.trim() || t('chat_skills_defaultTitle'),
                instructionTemplate: skillTemplate,
              });
              setShowSkillForm(false);
              setSkillTitle('');
              setSkillTemplate('');
            }}>
            {t('chat_skills_saveConfirm')}
          </button>
          <button type="button" className={secondaryButtonClassName} onClick={() => setShowSkillForm(false)}>
            {t('chat_task_cancel_edit')}
          </button>
        </div>
      )}

      <div className={actionStackClassName}>
        {snapshot.status === 'running' && (
          <button
            type="button"
            className={secondaryButtonClassName}
            onClick={() =>
              send({
                type: 'pause',
                commandId: crypto.randomUUID(),
                taskId: snapshot.id,
                expectedRevision: snapshot.revision,
              })
            }>
            {t('chat_task_pause')}
          </button>
        )}
        {(snapshot.status === 'paused' || snapshot.status === 'interrupted') && (
          <button
            type="button"
            className={primaryButtonClassName}
            onClick={() =>
              send({
                type: 'resume',
                commandId: crypto.randomUUID(),
                taskId: snapshot.id,
                expectedRevision: snapshot.revision,
              })
            }>
            {t('chat_task_resume')}
          </button>
        )}
        {!isTerminal && (
          <button
            type="button"
            className={dangerButtonClassName}
            onClick={() =>
              send({
                type: 'cancel',
                commandId: crypto.randomUUID(),
                taskId: snapshot.id,
                expectedRevision: snapshot.revision,
              })
            }>
            {t('chat_task_stop')}
          </button>
        )}
      </div>
    </section>
  );
}
