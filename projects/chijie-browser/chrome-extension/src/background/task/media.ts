import type { TaskSession } from '@extension/storage/lib/task';

export type MediaArgResolution =
  | { kind: 'ready'; args: Record<string, unknown> }
  | { kind: 'waiting_user'; reason: 'target_missing' };

export function resolveMediaArgs(
  actionName: string,
  rawArgs: Record<string, unknown>,
  task: TaskSession,
): MediaArgResolution {
  if (actionName !== 'control_media' || rawArgs.target_digest) return { kind: 'ready', args: rawArgs };
  const previous = [...task.targetRefs].reverse().find(target => target.kind === 'media');
  if (previous) return { kind: 'ready', args: { ...rawArgs, target_digest: previous.digest } };
  return rawArgs.command === 'play'
    ? { kind: 'ready', args: rawArgs }
    : { kind: 'waiting_user', reason: 'target_missing' };
}

/**
 * Bind close_tab / switch_tab / focus_tab to the task's active tab when tab_id is omitted.
 * focus_tab is an alias of switch_tab at the action surface.
 */
export function resolveTabArgs(
  actionName: string,
  rawArgs: Record<string, unknown>,
  task: TaskSession,
): Record<string, unknown> {
  if (actionName !== 'close_tab' && actionName !== 'switch_tab' && actionName !== 'focus_tab') {
    return rawArgs;
  }
  const raw = rawArgs.tab_id;
  if (typeof raw === 'number' && Number.isFinite(raw)) return rawArgs;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return { ...rawArgs, tab_id: n };
  }
  // Default: task-bound tab (wrong_tab is worse than asking for id on "close this page").
  return { ...rawArgs, tab_id: task.activeTabId };
}
