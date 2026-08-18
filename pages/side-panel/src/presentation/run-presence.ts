/** Follow = user allows the agent to bring its tab to the front. Off by default. */

export function isFollowingForeground(task: { followForeground?: boolean } | null | undefined): boolean {
  return task?.followForeground === true;
}

export function setFollowCommand(
  task: { id: string; revision: number },
  follow: boolean,
  commandId: string,
): { type: 'set_follow'; commandId: string; taskId: string; expectedRevision: number; follow: boolean } {
  return {
    type: 'set_follow',
    commandId,
    taskId: task.id,
    expectedRevision: task.revision,
    follow,
  };
}

export function takeoverCommand(
  task: { id: string; revision: number },
  commandId: string,
): { type: 'takeover'; commandId: string; taskId: string; expectedRevision: number } {
  return {
    type: 'takeover',
    commandId,
    taskId: task.id,
    expectedRevision: task.revision,
  };
}
