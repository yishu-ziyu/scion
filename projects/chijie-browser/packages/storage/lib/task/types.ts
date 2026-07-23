export type TaskStatus =
  | 'running'
  | 'paused'
  | 'waiting_approval'
  | 'waiting_user'
  | 'inputs_required'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WaitReason =
  | 'login_required'
  | 'captcha_required'
  | 'approval_rejected'
  | 'proof_required'
  | 'commit_outcome_uncertain'
  | 'target_missing'
  | 'target_ambiguous'
  | 'skill_inputs_required';

export interface BrowserTargetRef {
  id: string;
  kind: 'page' | 'element' | 'media';
  tabId: number;
  frameId: 0;
  urlOrigin: string;
  digest: string;
  /** Optional human page title at bind time (UI only; not used for act/observe matching). */
  label?: string;
}

type CriterionBase = {
  id: string;
  roundId: string;
  targetRefId: string;
  required: boolean;
  frozenAt: number;
  notBefore: number;
  timeoutMs: number;
  baseline: boolean | string;
};

export type CompletionCriterion =
  | (CriterionBase & { kind: 'url'; operator: 'equals' | 'starts_with'; expected: string })
  | (CriterionBase & { kind: 'page_text'; operator: 'present' | 'absent'; expectedDigest: string })
  | (CriterionBase & {
      kind: 'element_state';
      operator: 'equals';
      expected: 'visible' | 'hidden' | 'enabled' | 'disabled';
    })
  | (CriterionBase & { kind: 'media_state'; operator: 'equals'; expected: 'playing' | 'paused' })
  | (CriterionBase & { kind: 'user_confirmed'; operator: 'equals'; expected: true });

export interface CompletionEvidence {
  criterionId: string;
  roundId: string;
  targetRefId: string;
  observedAt: number;
  source: 'page' | 'user';
  value: boolean | string;
  passed: boolean;
  reason?: 'already_true_at_baseline' | 'stale' | 'wrong_round' | 'wrong_target' | 'timed_out' | 'mismatch';
}

export interface CompletionReceipt {
  id: string;
  taskId: string;
  roundId: string;
  verifiedAt: number;
  criterionIds: string[];
  evidenceDigests: string[];
}

export type AttemptState = 'proposed' | 'approved' | 'executing' | 'observed' | 'uncertain' | 'blocked';

export interface ActionAttempt {
  id: string;
  roundId: string;
  actionName: string;
  effect: 'read' | 'reversible' | 'external_commit';
  targetDigest?: string;
  argsDigest: string;
  state: AttemptState;
  proposedAt: number;
  approvedAt?: number;
  executingAt?: number;
  observedAt?: number;
}

export interface ApprovalSummary {
  id: string;
  attemptId: string;
  roundId: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  decidedAt?: number;
}

export type CommandAck =
  | { accepted: true; commandId: string; taskId: string; revision: number }
  | {
      accepted: false;
      commandId: string;
      taskId: string;
      revision: number;
      error: 'not_found' | 'stale_revision' | 'invalid_transition' | 'invalid_input';
    };

type ExistingTaskCommand = { commandId: string; taskId: string; expectedRevision: number };

export type TaskCommand =
  | {
      type: 'start';
      commandId: string;
      taskId: string;
      instruction: string;
      chatSessionId: string;
      instructionMessageId: string;
      tabId: number;
    }
  | (ExistingTaskCommand & {
      type: 'follow_up';
      instruction: string;
      chatSessionId: string;
      instructionMessageId: string;
    })
  | (ExistingTaskCommand & { type: 'pause' | 'resume' | 'cancel' })
  | (ExistingTaskCommand & { type: 'approve' | 'reject'; roundId: string; approvalId: string })
  | (ExistingTaskCommand & { type: 'confirm_completion'; roundId: string; criterionId: string })
  | (ExistingTaskCommand & { type: 'save_skill'; roundId: string; title: string; instructionTemplate: string })
  | {
      type: 'run_skill';
      commandId: string;
      taskId: string;
      skillId: number;
      values: Record<string, string>;
      tabId: number;
    };

export interface TaskRound {
  id: string;
  instructionMessageId?: string;
  instructionSummary: string;
  status: TaskStatus;
  commandAcks: Record<string, CommandAck>;
  criteria: CompletionCriterion[];
  attempts: ActionAttempt[];
  approvals: ApprovalSummary[];
  evidence: CompletionEvidence[];
  receipt?: CompletionReceipt;
  waitReason?: WaitReason;
  /**
   * Machine category when status is failed (e.g. llm_failed, observe_failed).
   * UI maps this to human copy; do not store raw secrets.
   */
  failureCategory?: string;
}

export interface TaskSession {
  id: string;
  goalSummary: string;
  chatSessionId?: string;
  instructionMessageId?: string;
  sourceSkillId?: number;
  status: TaskStatus;
  revision: number;
  activeTabId: number;
  currentRoundId: string;
  targetRefs: BrowserTargetRef[];
  rounds: TaskRound[];
  createdAt: number;
  updatedAt: number;
}

export type TaskSnapshot = TaskSession;
export type TaskEvent =
  | { type: 'snapshot'; taskId: string; roundId: string; revision: number; snapshot: TaskSnapshot }
  | {
      type: 'task_completed_verified';
      taskId: string;
      roundId: string;
      revision: number;
      receiptId: string;
      snapshot: TaskSnapshot;
    };
