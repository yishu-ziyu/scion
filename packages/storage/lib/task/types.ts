export type TaskStatus =
  | 'running'
  | 'paused'
  | 'waiting_user'
  | 'inputs_required'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WaitReason =
  | 'login_required'
  | 'captcha_required'
  | 'proof_required'
  | 'commit_outcome_uncertain'
  | 'target_missing'
  | 'target_ambiguous'
  | 'confirm_execute'
  | 'skill_inputs_required';

export interface BrowserTargetRef {
  id: string;
  kind: 'page' | 'element' | 'media';
  tabId: number;
  frameId: 0;
  urlOrigin: string;
  /**
   * Query/hash-free http(s) URL observed for this page. Used only for
   * completion provenance; never persist query parameters or fragments.
   */
  normalizedUrl?: string;
  /**
   * Digest of the canonical query pair sequence. The query itself is never
   * durable task state; ordering remains significant for exact provenance.
   */
  queryIdentityDigest?: string;
  /** True only when this tab was created by the task, never for the user's initial source tab. */
  taskOwned?: true;
  /** Digest of the normalized visible body captured on this exact page. */
  bodyDigest?: string;
  /** Digests of bounded visible sentences/lines; raw page text is never persisted. */
  textDigests?: string[];
  /** Immutable page revision associated with the captured body evidence. */
  pageRevision?: string;
  /** Latest durable page-observation order within the task. */
  visitSeq?: number;
  observedAt?: number;
  digest: string;
  /** Optional human page title at bind time (UI). Verified title for the model and completion is `title`. */
  label?: string;
  /**
   * document.title from a verified observation (trimmed). Used in the next
   * control prompt and in completion checks. Empty title is never written.
   */
  title?: string;
  /**
   * One sentence from that observation's visible text, at most 160 characters.
   * Only when the instruction asks to quote. Must be a substring of that observation.
   */
  quote?: string;
}

type CriterionBase = {
  id: string;
  roundId: string;
  targetRefId: string;
  /** Optional immutable page revision for read-only body evidence. */
  pageRevision?: string;
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
  | (CriterionBase & { kind: 'tab_state'; operator: 'equals'; expected: 'closed' | 'active' })
  | (CriterionBase & { kind: 'download_state'; operator: 'equals'; expected: 'started' | 'finished' })
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

/** What the user can take when the task is done (`TaskRound.result`). */
export type TaskResultKind = 'table' | 'summary' | 'report' | 'draft' | 'file';

export interface TaskResult {
  kind: TaskResultKind;
  body: string;
}

export type AttemptState = 'proposed' | 'authorized' | 'executing' | 'observed' | 'uncertain' | 'blocked';

/** One row on a search board or opened page. Titles only; never page HTML. */
export interface AttemptFinding {
  title: string;
  url?: string;
  host?: string;
}

export interface ActionAttempt {
  id: string;
  roundId: string;
  actionName: string;
  effect: 'read' | 'reversible' | 'external_commit';
  targetDigest?: string;
  argsDigest: string;
  /**
   * Human one-liner for Activity UI (verb + object).
   * Never store digests, selectors, passwords, or raw form values here.
   */
  displaySummary?: string;
  /** Optional short object chip (hostname / field kind). */
  targetLabel?: string;
  /** http(s) page the attempt opened or acted on. Used so the side panel can open that page. */
  targetUrl?: string;
  /** Search hits or extracted titles left for the side panel board. */
  findings?: AttemptFinding[];
  state: AttemptState;
  proposedAt: number;
  authorizedAt?: number;
  executingAt?: number;
  observedAt?: number;
}

export type MissionPhaseStatus = 'planned' | 'active' | 'done' | 'blocked';

export interface MissionPhase {
  id: string;
  title: string;
  status: MissionPhaseStatus;
  criteriaIds: string[];
  evidenceIds: string[];
  notes: string[];
}

export interface MissionPlan {
  id: string;
  goal: string;
  phases: MissionPhase[];
  createdAt: number;
  updatedAt: number;
}

export type CommandAck =
  | { accepted: true; commandId: string; taskId: string; revision: number; userVisibleText?: string }
  | {
      accepted: false;
      commandId: string;
      taskId: string;
      revision: number;
      error: 'not_found' | 'stale_revision' | 'invalid_transition' | 'invalid_input' | 'not_executable';
      /** User-facing sentence when this command is not a page task. */
      userVisibleText?: string;
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
      /** Skip classify (再说一次 already knows this is the same task). */
      forceExecute?: boolean;
      /** Composer 仅聊天 / 执行. execute skips the extra confirm ask; chat never operates pages. */
      composerIntent?: 'chat' | 'execute';
    }
  | (ExistingTaskCommand & {
      type: 'follow_up';
      instruction: string;
      chatSessionId: string;
      instructionMessageId: string;
      changeType?: 'follow_up' | 'direction_change';
      /** Skip classify (再说一次 already knows this is the same task). */
      forceExecute?: boolean;
      /** Composer 仅聊天 / 执行. execute skips the extra confirm ask; chat never operates pages. */
      composerIntent?: 'chat' | 'execute';
    })
  | (ExistingTaskCommand & { type: 'pause' | 'resume' | 'cancel' | 'takeover' })
  | (ExistingTaskCommand & { type: 'set_follow'; follow: boolean })
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
  changeType?: 'follow_up' | 'direction_change';
  createdAt?: number;
  status: TaskStatus;
  commandAcks: Record<string, CommandAck>;
  criteria: CompletionCriterion[];
  attempts: ActionAttempt[];
  evidence: CompletionEvidence[];
  receipt?: CompletionReceipt;
  /** Take-away produced by steps. Done is derived from this matching the task. */
  result?: TaskResult;
  /**
   * Matching `produceResult` held while status is waiting_user (`proof_required`).
   * Not Done: `confirmCompletion` may persist this only after receipt commits.
   */
  produced?: TaskResult;
  waitReason?: WaitReason;
  /**
   * Last human page reading from a control decide (`observation`).
   * Empty / 思考中 / 获取页面快照 are never stored.
   */
  pageReading?: string;
  /**
   * Observed named choices when this round is waiting because a bind was not unique.
   * Labels and sendText only; never selectors, HTML, or secrets.
   */
  waitAsk?: {
    prompt: string;
    options: Array<{ label: string; sendText: string }>;
  };
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
  /** Chrome tab group that holds pages this task opened or bound. */
  tabGroupId?: number;
  /** When true, agent tab/window may come to the front so the user can watch. */
  followForeground?: boolean;
  currentRoundId: string;
  targetRefs: BrowserTargetRef[];
  rounds: TaskRound[];
  plan?: MissionPlan;
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
