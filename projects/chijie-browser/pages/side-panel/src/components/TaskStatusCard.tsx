import type { TaskCommand, TaskSnapshot, WaitReason } from '@extension/storage';
import { t } from '@extension/i18n';
import { useState } from 'react';
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

  const withMatch = text.match(/\bwith\s+([A-Za-z0-9._@+-]{2,80})(?=\s+(?:and|then)\b|[,;.]|$)/i);
  if (withMatch?.[1] && !/^(the|a|an|this|that|my|your)$/i.test(withMatch[1])) {
    return text.replace(withMatch[1], '{{name}}');
  }

  return text;
}

export function TaskStatusCard({ snapshot, send, defaultInstruction = '' }: TaskStatusCardProps) {
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

  return (
    <section
      data-testid="task-status"
      data-status={snapshot.status}
      data-attention={needsAttention ? 'true' : 'false'}
      className={taskCardClassName}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-medium leading-tight" data-testid="task-status-label">
            {t(statusLabelKey(snapshot.status))}
          </span>
          {!isTerminal && <span className={monoLabelClassName}>{t('chat_task_working_on_page')}</span>}
        </div>
        {snapshot.goalSummary && <p className="line-clamp-2 text-xs opacity-80">{snapshot.goalSummary}</p>}
      </div>

      {round?.receipt && (
        <div data-testid="completion-receipt" className="chijie-done-block">
          {completionText.split('\n').map(line => (
            <div key={line} className={line === t('chat_task_done_title') ? 'font-medium' : 'mt-0.5 text-xs opacity-90'}>
              {line}
            </div>
          ))}
        </div>
      )}

      {(snapshot.status === 'failed' ||
        snapshot.status === 'cancelled' ||
        snapshot.status === 'interrupted' ||
        snapshot.status === 'waiting_user' ||
        snapshot.status === 'inputs_required') && (
        <div data-testid="task-next-step" className="chijie-next-step">
          <div className="font-medium">{t('chat_task_next_step_title')}</div>
          <div className="mt-1">{failureNextStep(snapshot)}</div>
        </div>
      )}

      {snapshot.status === 'waiting_approval' && round && approval && (
        <div className={actionStackClassName}>
          <p className="text-xs leading-relaxed opacity-90">
            {t('chat_task_approval_explain')}
            {approval.summary ? `「${approval.summary}」` : ''}
          </p>
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
            className={dangerButtonClassName}
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
