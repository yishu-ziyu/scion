import type { TaskCommand, TaskSnapshot } from '@extension/storage';

export interface TaskStatusCardProps {
  snapshot: TaskSnapshot;
  send(command: TaskCommand): void;
}

export function TaskStatusCard({ snapshot, send }: TaskStatusCardProps) {
  return (
    <section data-testid="task-status" data-status={snapshot.status} className="flex items-center gap-2 p-2 text-sm">
      <span>{snapshot.status}</span>
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
