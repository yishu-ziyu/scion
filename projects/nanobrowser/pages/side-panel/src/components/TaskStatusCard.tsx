import type { TaskCommand, TaskSnapshot } from '@extension/storage';
import { t } from '@extension/i18n';
import { useState } from 'react';

export interface TaskStatusCardProps {
  snapshot: TaskSnapshot;
  send(command: TaskCommand): void;
}

export function TaskStatusCard({ snapshot, send }: TaskStatusCardProps) {
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

  return (
    <section data-testid="task-status" data-status={snapshot.status} className="flex items-center gap-2 p-2 text-sm">
      <span>{snapshot.status}</span>
      {round?.receipt && !showSkillForm && (
        <button type="button" data-testid="skill-save" onClick={() => setShowSkillForm(true)}>
          {t('chat_skills_save')}
        </button>
      )}
      {round?.receipt && showSkillForm && (
        <div className="flex flex-col gap-2">
          <input
            data-testid="skill-title"
            value={skillTitle}
            onChange={event => setSkillTitle(event.target.value)}
            placeholder={t('chat_skills_titlePlaceholder')}
          />
          <textarea
            data-testid="skill-template"
            value={skillTemplate}
            onChange={event => setSkillTemplate(event.target.value)}
            placeholder={t('chat_skills_templatePlaceholder')}
          />
          <button
            type="button"
            data-testid="skill-save-confirm"
            disabled={!skillTitle.trim() || !skillTemplate.trim()}
            onClick={() => {
              send({
                type: 'save_skill',
                commandId: crypto.randomUUID(),
                taskId: snapshot.id,
                expectedRevision: snapshot.revision,
                roundId: round.id,
                title: skillTitle,
                instructionTemplate: skillTemplate,
              });
              setShowSkillForm(false);
              setSkillTitle('');
              setSkillTemplate('');
            }}>
            {t('chat_skills_saveConfirm')}
          </button>
        </div>
      )}
      {snapshot.status === 'waiting_approval' && round && approval && (
        <>
          <button
            type="button"
            data-testid="approval-approve"
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
            Approve {approval.summary}
          </button>
          <button
            type="button"
            data-testid="approval-reject"
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
            Reject
          </button>
        </>
      )}
      {snapshot.status === 'running' && (
        <button
          type="button"
          onClick={() =>
            send({
              type: 'pause',
              commandId: crypto.randomUUID(),
              taskId: snapshot.id,
              expectedRevision: snapshot.revision,
            })
          }>
          Pause
        </button>
      )}
      {snapshot.status === 'waiting_user' &&
        round?.waitReason === 'proof_required' &&
        confirmations.map(confirmation => (
          <button
            key={confirmation.id}
            type="button"
            data-testid="criterion-confirm"
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
            Confirm completion
          </button>
        ))}
      {(snapshot.status === 'paused' || snapshot.status === 'interrupted') && (
        <button
          type="button"
          onClick={() =>
            send({
              type: 'resume',
              commandId: crypto.randomUUID(),
              taskId: snapshot.id,
              expectedRevision: snapshot.revision,
            })
          }>
          Resume
        </button>
      )}
      {!['completed', 'failed', 'cancelled'].includes(snapshot.status) && (
        <button
          type="button"
          onClick={() =>
            send({
              type: 'cancel',
              commandId: crypto.randomUUID(),
              taskId: snapshot.id,
              expectedRevision: snapshot.revision,
            })
          }>
          Cancel
        </button>
      )}
    </section>
  );
}
