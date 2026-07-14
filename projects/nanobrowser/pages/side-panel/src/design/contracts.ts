import type { TaskStatus } from '@extension/storage';

/** DESIGN.md tokens required for the side panel shell. */
export const YISHU_TOKEN_NAMES = [
  '--yishu-background',
  '--yishu-foreground',
  '--yishu-muted',
  '--yishu-accent',
  '--yishu-surface',
  '--yishu-surface-raised',
  '--yishu-border',
  '--yishu-paper',
  '--yishu-paper-ink',
] as const;

export const taskCardClassName = 'yishu-paper-card';
export const primaryButtonClassName = 'yishu-btn-primary';
export const secondaryButtonClassName = 'yishu-btn-secondary';
export const dangerButtonClassName = 'yishu-btn-danger';
export const actionStackClassName = 'yishu-action-stack';
export const monoLabelClassName = 'yishu-mono-label';
export const shellClassName = 'yishu-shell';

export function statusLabelKey(status: TaskStatus): `chat_task_status_${TaskStatus}` {
  return `chat_task_status_${status}`;
}

export function completionVisibleText(input: {
  doneTitle: string;
  doneBody: string;
  receiptId: string;
}): string {
  void input.receiptId;
  return `${input.doneTitle}\n${input.doneBody}`;
}

export function stylesUseBoxShadow(css: string): boolean {
  return /box-shadow\s*:/i.test(css);
}
