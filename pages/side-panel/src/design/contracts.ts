import type { TaskStatus } from '@extension/storage';

/** DESIGN.md tokens required for the side panel shell. */
export const YISHU_TOKEN_NAMES = [
  '--chijie-background',
  '--chijie-foreground',
  '--chijie-muted',
  '--chijie-accent',
  '--chijie-surface',
  '--chijie-surface-raised',
  '--chijie-border',
  '--chijie-paper',
  '--chijie-paper-ink',
] as const;

export const taskCardClassName = 'chijie-paper-card';
export const primaryButtonClassName = 'chijie-btn-primary';
export const secondaryButtonClassName = 'chijie-btn-secondary';
export const dangerButtonClassName = 'chijie-btn-danger';
export const actionStackClassName = 'chijie-action-stack';
export const monoLabelClassName = 'chijie-mono-label';
export const shellClassName = 'chijie-shell';
export const welcomeClassName = 'chijie-welcome';
export const welcomeCardClassName = 'chijie-welcome-card';
export const optionsLayoutClassName = 'chijie-options-layout';
export const optionsNavClassName = 'chijie-options-nav';
export const optionsMainClassName = 'chijie-options-main';
export const settingsCardClassName = 'chijie-settings-card';

/** Banned stock SaaS chrome fragments for side panel + options shell. */
export const BANNED_SKY_CHROME = [
  'text-sky-',
  'bg-sky-',
  'border-sky-',
  '#0EA5E9',
  '#0ea5e9',
  '#19C2FF',
  'bg-[#0EA5E9]',
] as const;

export function sourceHasBannedSkyChrome(source: string): boolean {
  return BANNED_SKY_CHROME.some(token => source.includes(token));
}

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
