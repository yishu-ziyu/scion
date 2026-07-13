import type { Action } from '../agent/actions/builder';
import type { ActionResult } from '../agent/types';
import type {
  ActionAttempt,
  BrowserTargetRef,
  CompletionCriterion,
  CompletionEvidence,
  WaitReason,
} from '@extension/storage/lib/task';

export type CompletionCriterionDraft =
  | { kind: 'url'; operator: 'equals' | 'starts_with'; expected: string; required: boolean }
  | { kind: 'page_text'; operator: 'present' | 'absent'; expected: string; required: boolean }
  | {
      kind: 'element_state';
      operator: 'equals';
      expected: 'visible' | 'hidden' | 'enabled' | 'disabled';
      required: boolean;
    }
  | { kind: 'media_state'; operator: 'equals'; expected: 'playing' | 'paused'; required: boolean }
  | { kind: 'user_confirmed'; operator: 'equals'; expected: true; required: boolean };

export interface ProbeObservation {
  criterionId: string;
  roundId: string;
  targetRefId: string;
  observedAt: number;
  source: 'page' | 'user';
  value: boolean | string;
}

export interface DispatchResult {
  actionResult: ActionResult;
  attempt: ActionAttempt;
  targetRef?: BrowserTargetRef;
  evidence: CompletionEvidence[];
}

export interface ExecutorInput {
  taskId: string;
  roundId: string;
  instruction: string;
  tabId: number;
}

export interface ExecutorHooks {
  onPlan(criteria: CompletionCriterionDraft[]): Promise<void>;
  dispatchAction(action: Action, rawArgs: unknown): Promise<DispatchResult>;
}

export interface ExecutorDriver {
  run(): Promise<ExecutorOutcome>;
  addFollowUp(instruction: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export type ExecutorOutcome =
  | { kind: 'candidate_complete'; summary: string }
  | { kind: 'waiting_user'; reason: WaitReason }
  | { kind: 'paused' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; category: string };

export type ObserveCriteria = (criteria: CompletionCriterion[]) => Promise<ProbeObservation[]>;
