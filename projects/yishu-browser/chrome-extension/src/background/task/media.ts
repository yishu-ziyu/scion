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
