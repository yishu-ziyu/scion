import type { TaskCommand, TaskSnapshot } from '@extension/storage';

export interface TaskStatusCardProps {
  snapshot: TaskSnapshot;
  send(command: TaskCommand): void;
}

export function TaskStatusCard({ snapshot, send }: TaskStatusCardProps) {
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  const approval = round?.approvals.find(item => item.status === 'pending');
  const confirmation = round?.criteria.find(item => item.kind === 'user_confirmed');

  return (
    <section data-testid="task-status" data-status={snapshot.status} className="flex items-center gap-2 p-2 text-sm">
      <span>{snapshot.status}</span>
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
      {snapshot.status === 'waiting_user' && round?.waitReason === 'proof_required' && confirmation && (
        <button
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
      )}
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
