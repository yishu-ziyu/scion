import type { TaskCommand, TaskSnapshot, TaskStatus, WaitReason } from '@extension/storage';
import { t } from '@extension/i18n';
import { useState } from 'react';

export interface TaskStatusCardProps {
  snapshot: TaskSnapshot;
  send(command: TaskCommand): void;
  /** Last user goal text - used to prefill skill template. */
  defaultInstruction?: string;
  isDarkMode?: boolean;
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'running':
      return t('chat_task_status_running');
    case 'paused':
      return t('chat_task_status_paused');
    case 'waiting_approval':
      return t('chat_task_status_waiting_approval');
    case 'waiting_user':
      return t('chat_task_status_waiting_user');
    case 'inputs_required':
      return t('chat_task_status_inputs_required');
    case 'interrupted':
      return t('chat_task_status_interrupted');
    case 'completed':
      return t('chat_task_status_completed');
    case 'failed':
      return t('chat_task_status_failed');
    case 'cancelled':
      return t('chat_task_status_cancelled');
  }
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

function failureNextStep(snapshot: TaskSnapshot): string {
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  const hint = waitReasonHint(round?.waitReason);
  if (hint) return hint;
  if (snapshot.status === 'failed') return t('chat_task_hint_failed_generic');
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

  // "with Ada" / "with VALUE" before and/then/punctuation
  const withMatch = text.match(/\bwith\s+([A-Za-z0-9._@+-]{2,80})(?=\s+(?:and|then)\b|[,;.]|$)/i);
  if (withMatch?.[1] && !/^(the|a|an|this|that|my|your)$/i.test(withMatch[1])) {
    return text.replace(withMatch[1], '{{name}}');
  }

  return text;
}

const primaryBtn =
  'w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryBtn =
  'w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-sky-900 hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:hover:bg-slate-700';
const dangerBtn =
  'w-full rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-slate-800 dark:text-red-300';

export function TaskStatusCard({
  snapshot,
  send,
  defaultInstruction = '',
  isDarkMode = false,
}: TaskStatusCardProps) {
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [skillTitle, setSkillTitle] = useState('');
  const [skillTemplate, setSkillTemplate] = useState('');
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  const approval = round?.approvals.find(item => item.status === 'pending');
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

  const shell = isDarkMode
    ? 'border-sky-900 bg-slate-800/90 text-gray-100'
    : needsAttention
      ? 'border-amber-200 bg-amber-50 text-amber-950'
      : snapshot.status === 'completed'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
        : 'border-sky-100 bg-white text-sky-950';

  const openSkillForm = () => {
    setShowSkillForm(true);
    setSkillTitle(previous => previous || snapshot.goalSummary.slice(0, 48) || t('chat_skills_defaultTitle'));
    setSkillTemplate(previous => {
      if (previous.trim()) return previous;
      return instructionToSkillTemplate(defaultInstruction) || defaultInstruction;
    });
  };

  return (
    <section
      data-testid="task-status"
      data-status={snapshot.status}
      className={`mx-2 mt-2 flex flex-col gap-3 rounded-lg border p-3 text-sm shadow-sm ${shell}`}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-semibold" data-testid="task-status-label">
            {statusLabel(snapshot.status)}
          </span>
          {!isTerminal && (
            <span className="text-xs opacity-70">{t('chat_task_working_on_page')}</span>
          )}
        </div>
        {snapshot.goalSummary && (
          <p className="line-clamp-2 text-xs opacity-80">{snapshot.goalSummary}</p>
        )}
      </div>

      {round?.receipt && (
        <div
          data-testid="completion-receipt"
          className={`rounded-md px-3 py-2 text-sm ${
            isDarkMode ? 'bg-emerald-900/40 text-emerald-100' : 'bg-emerald-100 text-emerald-900'
          }`}>
          <div className="font-medium">{t('chat_task_done_title')}</div>
          <div className="mt-0.5 text-xs opacity-90">{t('chat_task_done_body')}</div>
        </div>
      )}

      {(snapshot.status === 'failed' ||
        snapshot.status === 'cancelled' ||
        snapshot.status === 'interrupted' ||
        snapshot.status === 'waiting_user' ||
        snapshot.status === 'inputs_required') && (
        <div
          data-testid="task-next-step"
          className={`rounded-md px-3 py-2 text-xs leading-relaxed ${
            isDarkMode ? 'bg-slate-900/60 text-gray-200' : 'bg-white/80 text-gray-800'
          }`}>
          <div className="font-medium">{t('chat_task_next_step_title')}</div>
          <div className="mt-1">{failureNextStep(snapshot)}</div>
        </div>
      )}

      {snapshot.status === 'waiting_approval' && round && approval && (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-relaxed opacity-90">
            {t('chat_task_approval_explain')}
            {approval.summary ? `「${approval.summary}」` : ''}
          </p>
          <button
            type="button"
            data-testid="approval-approve"
            className={primaryBtn}
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
            className={dangerBtn}
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
      )}

      {snapshot.status === 'waiting_user' &&
        round?.waitReason === 'proof_required' &&
        confirmations.map(confirmation => (
          <button
            key={confirmation.id}
            type="button"
            data-testid="criterion-confirm"
            className={primaryBtn}
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
        <div className="flex flex-col gap-2">
          <button type="button" data-testid="skill-save" className={primaryBtn} onClick={openSkillForm}>
            {t('chat_skills_save')}
          </button>
          <p className="text-xs opacity-80">{t('chat_task_skill_save_hint')}</p>
        </div>
      )}

      {round?.receipt && showSkillForm && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs">
            {t('chat_skills_titlePlaceholder')}
            <input
              data-testid="skill-title"
              value={skillTitle}
              onChange={event => setSkillTitle(event.target.value)}
              placeholder={t('chat_skills_titlePlaceholder')}
              className={`rounded border px-2 py-1.5 text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-900 text-gray-100' : 'border-sky-100 bg-white text-gray-900'
              }`}
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
              className={`rounded border px-2 py-1.5 text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-900 text-gray-100' : 'border-sky-100 bg-white text-gray-900'
              }`}
            />
          </label>
          <p className="text-xs opacity-70">{t('chat_task_skill_template_help')}</p>
          <button
            type="button"
            data-testid="skill-save-confirm"
            className={primaryBtn}
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
          <button type="button" className={secondaryBtn} onClick={() => setShowSkillForm(false)}>
            {t('chat_task_cancel_edit')}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {snapshot.status === 'running' && (
          <button
            type="button"
            className={secondaryBtn}
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
            className={primaryBtn}
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
            className={dangerBtn}
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
