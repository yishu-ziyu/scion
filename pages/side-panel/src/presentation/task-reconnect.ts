export type TaskSnapshotRequest = { type: 'get_task'; taskId: string } | { type: 'get_active_task' };

interface ReconnectTaskSnapshotInput {
  pendingReset: { taskId: string } | null;
  pendingStart: { taskId: string } | null;
  /** True only after the user explicitly chose New Chat in this mounted panel. */
  blankComposerSession: boolean;
}

/** A late cold-restore response must not undo New Chat in the same mounted panel. */
export function canBootstrapReconnectSnapshot(blankComposerSession: boolean): boolean {
  return !blankComposerSession;
}

/** Decide which durable task a newly connected side panel must hydrate. */
export function reconnectTaskSnapshotRequest(input: ReconnectTaskSnapshotInput): TaskSnapshotRequest | null {
  if (input.pendingReset) return { type: 'get_task', taskId: input.pendingReset.taskId };
  if (input.pendingStart) return { type: 'get_task', taskId: input.pendingStart.taskId };
  if (input.blankComposerSession) return null;
  return { type: 'get_active_task' };
}
