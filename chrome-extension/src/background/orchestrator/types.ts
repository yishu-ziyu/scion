import type { LanguageModel } from 'ai';
import type { CommandAck, TaskCommand, TaskEvent, TaskSnapshot } from '@extension/storage';

export interface WorkBrief {
  goal: string;
  instructions: string;
  success_criteria: string;
  needs_current_page: boolean;
  may_operate_browser: boolean;
}

export interface DelegateResult {
  summary: string;
  did_operate_browser: boolean;
  page_url?: string;
}

export type PageRead = { ok: true; title: string; url: string; text: string } | { ok: false; error: string };

export interface OrchestratorHost {
  createLanguageModel?: (input: {
    modelId: string;
    apiKey: string;
    baseUrl?: string;
    providerId: string;
    adapterType?: string;
  }) => LanguageModel | null;
  workerModel?: LanguageModel;
  getActiveTask?: () => Promise<TaskSnapshot | null>;
  getTask?: (taskId: string) => Promise<TaskSnapshot | null>;
  dispatchTask?: (command: TaskCommand) => Promise<CommandAck>;
  subscribeTask?: (listener: (event: TaskEvent) => void) => () => void;
  readCurrentPage?: () => Promise<PageRead>;
  getActiveTabId?: () => Promise<number>;
}

export type OrchestratorStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'worker_started' }
  | { type: 'done' }
  | { type: 'error'; error: string };
