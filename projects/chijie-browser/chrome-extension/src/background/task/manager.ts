import { getActiveTask, getSkillSaveMeta, getTask, putSkillSaveMeta, saveTask } from '@extension/storage/lib/task';
import favoritesStorage, {
  assertExactSkillInputs,
  compileSkillTemplate,
  createSkillDefinition,
  type CompletionCriterionTemplate,
} from '@extension/storage/lib/prompt/favorites';
import type {
  CommandAck,
  ActionAttempt,
  CompletionCriterion,
  CompletionEvidence,
  TaskCommand,
  TaskEvent,
  TaskRound,
  TaskSession,
  TaskSnapshot,
  TaskStatus,
} from '@extension/storage/lib/task';
import type {
  CompletionCriterionDraft,
  DispatchResult,
  ExecutorDriver,
  ExecutorHooks,
  ExecutorInput,
  ExecutorOutcome,
  ObserveCriteria,
  ProbeObservation,
} from './contracts';
import { StaleTaskRoundError } from './contracts';
import { buildAttemptDisplaySummary, buildAttemptTargetLabel } from './attempt-display';
import { ActionDispatcher, recoverAttempt } from './action-dispatcher';
import { checkCompletion } from './completion';
import { sha256 } from './digest';
import { allowsVerifiedComplete } from './page-state';
import { resolveMediaArgs, resolveTabArgs } from './media';
import { ActionResult } from '../agent/types';

export type { ExecutorDriver } from './contracts';

/** Observed tab presence for tab_state completion criteria. */
export type TabStateProbe = 'closed' | 'active' | 'inactive';
/** Observed download progress for download_state criteria (stub-safe). */
export type DownloadStateProbe = 'none' | 'started' | 'finished';

interface TaskManagerDeps {
  createExecutor: (input: ExecutorInput, hooks: ExecutorHooks) => Promise<ExecutorDriver>;
  switchTab: (tabId: number) => Promise<void>;
  observeCriteria: ObserveCriteria;
  now: () => number;
  /** Backoff after external_commit before re-probe (ms). Default covers async form rewrites. */
  postCommitVerifyDelaysMs?: number[];
  /** Probe tab existence/focus without requiring page attach (closed tabs). */
  probeTabState?: (tabId: number) => Promise<TabStateProbe>;
  /** Probe recent downloads API state; default 'none' never false-completes. */
  probeDownloadState?: () => Promise<DownloadStateProbe>;
}

const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled'];

interface PendingApproval {
  taskId: string;
  roundId: string;
  attemptId: string;
  resolve: (decision: 'approved' | 'rejected') => void;
}

export class TaskManager {
  private readonly drivers = new Map<string, ExecutorDriver>();
  private readonly dispatchers = new Map<string, ActionDispatcher>();
  private readonly launches = new Map<string, symbol>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly instructions = new Map<string, string>();
  private readonly criterionTemplates = new Map<string, CompletionCriterionTemplate[]>();
  private readonly lockedCriteriaRounds = new Set<string>();
  private readonly unsafeSkillCriteriaRounds = new Set<string>();
  private readonly listeners = new Set<(event: TaskEvent) => void>();
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TaskManagerDeps) {}

  dispatch(command: TaskCommand): Promise<CommandAck> {
    const result = this.transition.then(() => this.dispatchNow(command));
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async snapshot(taskId: string): Promise<TaskSnapshot | null> {
    return getTask(taskId);
  }

  async activeSnapshot(): Promise<TaskSnapshot | null> {
    return getActiveTask();
  }

  subscribe(listener: (event: TaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async interruptActive(): Promise<void> {
    await this.queueTransition(async () => {
      const task = await getActiveTask();
      if (!task || !['running', 'paused', 'waiting_approval'].includes(task.status)) return;
      await this.stopTaskRuntime(task.id);
      task.status = 'interrupted';
      this.currentRound(task).status = 'interrupted';
      task.revision += 1;
      await this.persist(task);
    });
  }

  async recover(): Promise<void> {
    await this.queueTransition(async () => {
      const task = await getActiveTask();
      if (!task || !['running', 'paused', 'waiting_approval'].includes(task.status)) return;
      const round = this.currentRound(task);
      let hasUncertainCommit = false;
      for (const taskRound of task.rounds) {
        taskRound.attempts = taskRound.attempts.map(attempt => {
          if (attempt.state === 'executing') hasUncertainCommit = true;
          const recovered = recoverAttempt(attempt);
          return recovered;
        });
        for (const approval of taskRound.approvals) {
          if (approval.status !== 'pending') continue;
          approval.status = 'rejected';
          approval.decidedAt = this.deps.now();
          const attempt = taskRound.attempts.find(item => item.id === approval.attemptId);
          if (attempt?.state === 'proposed') attempt.state = 'blocked';
        }
      }
      if (hasUncertainCommit) {
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = 'commit_outcome_uncertain';
      } else if (task.sourceSkillId !== undefined) {
        task.status = 'inputs_required';
        round.status = 'inputs_required';
        round.waitReason = 'skill_inputs_required';
      } else {
        task.status = 'interrupted';
        round.status = 'interrupted';
      }
      task.revision += 1;
      await this.persist(task);
    });
  }

  private async dispatchNow(command: TaskCommand): Promise<CommandAck> {
    const existing = await getTask(command.taskId);
    const duplicate = existing ? this.findAck(existing, command.commandId) : undefined;
    if (duplicate) return duplicate;

    if (command.type === 'start') {
      if (existing) return this.reject(existing, command.commandId, 'invalid_transition');
      const active = await getActiveTask();
      if (active && !TERMINAL_STATUSES.includes(active.status)) {
        return {
          accepted: false,
          commandId: command.commandId,
          taskId: command.taskId,
          revision: 0,
          error: 'invalid_transition',
        };
      }
      if (active) await this.stopTaskRuntime(active.id);
      return this.start(command);
    }

    if (command.type === 'run_skill') {
      if (existing) return this.reject(existing, command.commandId, 'invalid_transition');
      return this.runSkill(command);
    }

    if (!existing) {
      return {
        accepted: false,
        commandId: command.commandId,
        taskId: command.taskId,
        revision: 0,
        error: 'not_found',
      };
    }

    if (command.expectedRevision !== existing.revision) {
      return this.reject(existing, command.commandId, 'stale_revision');
    }

    switch (command.type) {
      case 'pause':
        return this.pause(existing, command.commandId);
      case 'resume':
        return this.resume(existing, command.commandId);
      case 'follow_up':
        return this.followUp(existing, command);
      case 'cancel':
        return this.cancel(existing, command.commandId);
      case 'approve':
        return this.decideApproval(existing, command, true);
      case 'reject':
        return this.decideApproval(existing, command, false);
      case 'confirm_completion':
        return this.confirmCompletion(existing, command);
      case 'save_skill':
        return this.saveSkill(existing, command);
    }
  }

  private async start(command: Extract<TaskCommand, { type: 'start' }>): Promise<CommandAck> {
    if (!command.instruction.trim() || command.tabId < 0) {
      return {
        accepted: false,
        commandId: command.commandId,
        taskId: command.taskId,
        revision: 0,
        error: 'invalid_input',
      };
    }

    const now = this.deps.now();
    const roundId = crypto.randomUUID();
    const ack: CommandAck = {
      accepted: true,
      commandId: command.commandId,
      taskId: command.taskId,
      revision: 1,
    };
    // goalSummary/instructionSummary stay generic on purpose: snapshots must not
    // embed the raw instruction (secrets / success phrases). UI shows the user
    // text from the chat message via defaultInstruction.
    const round: TaskRound = {
      id: roundId,
      instructionMessageId: command.instructionMessageId,
      instructionSummary: 'User instruction',
      status: 'running',
      commandAcks: { [command.commandId]: ack },
      criteria: [],
      attempts: [],
      approvals: [],
      evidence: [],
    };
    const task: TaskSession = {
      id: command.taskId,
      goalSummary: 'User task',
      chatSessionId: command.chatSessionId,
      instructionMessageId: command.instructionMessageId,
      status: 'running',
      revision: 1,
      activeTabId: command.tabId,
      currentRoundId: roundId,
      targetRefs: [],
      rounds: [round],
      createdAt: now,
      updatedAt: now,
    };
    // Seed page bind evidence immediately so UI shows the same tab the user intended
    // (Phase 1 S1). Digest stays empty until observe; label is title-only for display.
    try {
      await this.deps.switchTab(command.tabId);
      const tab = await chrome.tabs.get(command.tabId);
      let urlOrigin = 'null';
      if (tab.url) {
        try {
          urlOrigin = new URL(tab.url).origin;
        } catch {
          urlOrigin = 'null';
        }
      }
      const label = (tab.title ?? '').trim() || undefined;
      task.targetRefs = [
        {
          id: `tab-${command.tabId}`,
          kind: 'page',
          tabId: command.tabId,
          frameId: 0,
          urlOrigin,
          digest: '',
          label,
        },
      ];
    } catch {
      // Keep empty targetRefs; runCurrentRound will attach or fail honestly.
    }
    this.instructions.set(task.id, command.instruction);
    await this.persist(task);
    void this.runCurrentRound(task.id);
    return ack;
  }

  private async saveSkill(
    task: TaskSession,
    command: Extract<TaskCommand, { type: 'save_skill' }>,
  ): Promise<CommandAck> {
    const round = task.rounds.find(item => item.id === command.roundId);
    const key = this.roundKey(task.id, command.roundId);
    const persisted = await getSkillSaveMeta(task.id, command.roundId);
    const templates = this.criterionTemplates.get(key) ?? persisted?.templates;
    if (
      task.status !== 'completed' ||
      task.currentRoundId !== command.roundId ||
      !round?.receipt ||
      !templates ||
      templates.length === 0
    ) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }
    if (this.unsafeSkillCriteriaRounds.has(key) || persisted?.unsafe) {
      return this.reject(task, command.commandId, 'invalid_input');
    }

    try {
      const definition = createSkillDefinition({
        title: command.title,
        instructionTemplate: command.instructionTemplate,
        criteria: templates,
        sourceTaskId: task.id,
      });
      await favoritesStorage.addSkill(definition);
    } catch {
      return this.reject(task, command.commandId, 'invalid_input');
    }

    const ack = this.accept(task, command.commandId);
    await this.persist(task);
    return ack;
  }

  private async runSkill(command: Extract<TaskCommand, { type: 'run_skill' }>): Promise<CommandAck> {
    if (command.tabId < 0) return this.commandError(command, 'invalid_input');
    const active = await getActiveTask();
    if (active && !TERMINAL_STATUSES.includes(active.status)) {
      return this.commandError(command, 'invalid_transition');
    }

    const skill = await favoritesStorage.getSkill(command.skillId);
    if (!skill) return this.commandError(command, 'not_found');

    let renderedInstruction = '';
    try {
      assertExactSkillInputs(skill.inputs, command.values);
      renderedInstruction = compileSkillTemplate(skill.instructionTemplate, command.values);
    } catch {
      return this.commandError(command, 'invalid_input');
    }

    if (active) await this.stopTaskRuntime(active.id);
    await this.deps.switchTab(command.tabId);

    const now = this.deps.now();
    const roundId = crypto.randomUUID();
    let criteria: CompletionCriterion[];
    try {
      criteria = await this.freezeSkillCriteria(skill.criteria, roundId, command.tabId);
    } catch {
      renderedInstruction = '';
      return this.commandError(command, 'invalid_input');
    }
    const ack: CommandAck = {
      accepted: true,
      commandId: command.commandId,
      taskId: command.taskId,
      revision: 1,
    };
    const task: TaskSession = {
      id: command.taskId,
      goalSummary: `Run Skill: ${skill.title}`,
      sourceSkillId: skill.id,
      status: 'running',
      revision: 1,
      activeTabId: command.tabId,
      currentRoundId: roundId,
      targetRefs: [],
      rounds: [
        {
          id: roundId,
          instructionSummary: `Run Skill: ${skill.title}`,
          status: 'running',
          commandAcks: { [command.commandId]: ack },
          criteria,
          attempts: [],
          approvals: [],
          evidence: [],
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    this.instructions.set(task.id, renderedInstruction);
    renderedInstruction = '';
    const templateKey = this.roundKey(task.id, roundId);
    this.criterionTemplates.set(templateKey, structuredClone(skill.criteria));
    this.lockedCriteriaRounds.add(templateKey);
    await putSkillSaveMeta(task.id, roundId, {
      templates: structuredClone(skill.criteria),
      unsafe: false,
    });
    await this.persist(task);
    void this.runCurrentRound(task.id);
    return ack;
  }

  private commandError(
    command: Extract<TaskCommand, { type: 'run_skill' }>,
    error: 'not_found' | 'invalid_transition' | 'invalid_input',
  ): CommandAck {
    return {
      accepted: false,
      commandId: command.commandId,
      taskId: command.taskId,
      revision: 0,
      error,
    };
  }

  private async pause(task: TaskSession, commandId: string): Promise<CommandAck> {
    if (task.status !== 'running') return this.reject(task, commandId, 'invalid_transition');
    task.status = 'paused';
    this.currentRound(task).status = 'paused';
    const ack = this.accept(task, commandId);
    await this.persist(task);
    this.drivers.get(task.id)?.pause();
    return ack;
  }

  private async resume(task: TaskSession, commandId: string): Promise<CommandAck> {
    if (!['paused', 'interrupted'].includes(task.status)) {
      return this.reject(task, commandId, 'invalid_transition');
    }
    task.status = 'running';
    this.currentRound(task).status = 'running';
    const ack = this.accept(task, commandId);
    await this.persist(task);
    const driver = this.drivers.get(task.id);
    if (driver) driver.resume();
    else void this.runCurrentRound(task.id);
    return ack;
  }

  private async followUp(task: TaskSession, command: Extract<TaskCommand, { type: 'follow_up' }>): Promise<CommandAck> {
    const round = this.currentRound(task);
    if (
      !['running', 'paused', 'waiting_user', 'completed'].includes(task.status) ||
      !command.instruction.trim() ||
      (task.status === 'waiting_user' && round.waitReason === 'commit_outcome_uncertain')
    ) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }
    const previousStatus = task.status;
    const roundId = crypto.randomUUID();
    task.status = 'running';
    task.currentRoundId = roundId;
    task.chatSessionId = command.chatSessionId;
    task.instructionMessageId = command.instructionMessageId;
    task.rounds.push({
      id: roundId,
      instructionMessageId: command.instructionMessageId,
      instructionSummary: 'User instruction',
      status: 'running',
      commandAcks: {},
      criteria: [],
      attempts: [],
      approvals: [],
      evidence: [],
    });
    const ack = this.accept(task, command.commandId);
    this.instructions.set(task.id, command.instruction);
    await this.persist(task);
    const driver = this.drivers.get(task.id);
    if (!driver) void this.runCurrentRound(task.id);
    else {
      driver.addFollowUp(command.instruction);
      if (previousStatus === 'paused') driver.resume();
      if (['waiting_user', 'completed'].includes(previousStatus)) void this.runDriver(task.id, driver, roundId);
    }
    return ack;
  }

  private async cancel(task: TaskSession, commandId: string): Promise<CommandAck> {
    if (TERMINAL_STATUSES.includes(task.status)) return this.reject(task, commandId, 'invalid_transition');
    task.status = 'cancelled';
    this.currentRound(task).status = 'cancelled';
    const ack = this.accept(task, commandId);
    await this.persist(task);
    await this.stopTaskRuntime(task.id);
    return ack;
  }

  private async decideApproval(
    task: TaskSession,
    command: Extract<TaskCommand, { type: 'approve' | 'reject' }>,
    approved: boolean,
  ): Promise<CommandAck> {
    const round = task.rounds.find(item => item.id === command.roundId);
    const approval = round?.approvals.find(item => item.id === command.approvalId);
    const pending = this.pendingApprovals.get(command.approvalId);
    if (
      task.status !== 'waiting_approval' ||
      task.currentRoundId !== command.roundId ||
      !round ||
      !approval ||
      approval.status !== 'pending' ||
      !pending ||
      pending.taskId !== task.id ||
      pending.roundId !== round.id ||
      pending.attemptId !== approval.attemptId
    ) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }

    const attempt = round.attempts.find(item => item.id === approval.attemptId);
    if (!attempt || attempt.state !== 'proposed') {
      return this.reject(task, command.commandId, 'invalid_transition');
    }

    const now = this.deps.now();
    if (approved) {
      attempt.state = 'approved';
      attempt.approvedAt = now;
      approval.status = 'consumed';
      task.status = 'running';
      round.status = 'running';
      round.waitReason = undefined;
    } else {
      attempt.state = 'blocked';
      approval.status = 'rejected';
      task.status = 'waiting_user';
      round.status = 'waiting_user';
      round.waitReason = 'approval_rejected';
    }
    approval.decidedAt = now;
    const ack = this.accept(task, command.commandId);
    await this.persist(task);
    this.pendingApprovals.delete(command.approvalId);
    pending.resolve(approved ? 'approved' : 'rejected');
    return ack;
  }

  private accept(task: TaskSession, commandId: string): CommandAck {
    task.revision += 1;
    const ack: CommandAck = {
      accepted: true,
      commandId,
      taskId: task.id,
      revision: task.revision,
    };
    this.currentRound(task).commandAcks[commandId] = ack;
    return ack;
  }

  private async reject(
    task: TaskSession,
    commandId: string,
    error: 'stale_revision' | 'invalid_transition' | 'invalid_input',
  ): Promise<CommandAck> {
    const ack: CommandAck = {
      accepted: false,
      commandId,
      taskId: task.id,
      revision: task.revision,
      error,
    };
    this.currentRound(task).commandAcks[commandId] = ack;
    await this.persist(task);
    return ack;
  }

  private findAck(task: TaskSession, commandId: string): CommandAck | undefined {
    for (const round of task.rounds) {
      const ack = round.commandAcks[commandId];
      if (ack) return ack;
    }
    return undefined;
  }

  private currentRound(task: TaskSession): TaskRound {
    const round = task.rounds.find(item => item.id === task.currentRoundId);
    if (!round) throw new Error('Task current round is missing');
    return round;
  }

  private executorHooks(taskId: string): ExecutorHooks {
    const dispatcher = new ActionDispatcher({
      now: this.deps.now,
      persistAttempt: attempt => this.persistAttempt(taskId, attempt),
      requestApproval: (attempt, summary) => this.requestApproval(taskId, attempt, summary),
      observe: async (request, parsedArgs, phase) => {
        const { browserContext } = await import('../agent/factory');
        const page = await browserContext.getCurrentPage();
        if (request.action.name() === 'control_media') {
          const targetDigest = this.readStringField(parsedArgs, 'target_digest');
          const observed = await page.observeMedia(targetDigest);
          if (observed.kind !== 'bound') {
            return { effectTarget: { tag: 'video' }, evidence: [] };
          }
          let urlOrigin = 'null';
          try {
            urlOrigin = new URL(page.url()).origin;
          } catch {
            // Keep the redacted null origin for non-URL pages.
          }
          const targetRefId = `media:${observed.targetDigest}`;
          // After-act digest evidence feeds continuous control; completion still needs criteria.
          const evidence =
            phase === 'after'
              ? [
                  {
                    criterionId: `media-state:${request.roundId}`,
                    roundId: request.roundId,
                    targetRefId,
                    observedAt: this.deps.now(),
                    source: 'page' as const,
                    value: observed.state,
                    passed: true,
                  },
                ]
              : [];
          return {
            target: {
              id: targetRefId,
              kind: 'media',
              tabId: page.tabId,
              frameId: 0,
              urlOrigin,
              digest: observed.targetDigest,
            },
            effectTarget: { tag: 'video' },
            evidence,
          };
        }
        if (request.action.name() === 'close_tab' || request.action.name() === 'switch_tab') {
          const tabId =
            this.readNumberField(parsedArgs, 'tab_id') ??
            (Number.isSafeInteger(page.tabId) ? page.tabId : undefined);
          const targetRefId = tabId !== undefined ? `tab-${tabId}` : `tab-${page.tabId}`;
          let urlOrigin = 'null';
          try {
            urlOrigin = new URL(page.url()).origin;
          } catch {
            // Keep redacted null origin.
          }
          const digest = await sha256(`${request.action.name()}:${targetRefId}`);
          let evidence: CompletionEvidence[] = [];
          if (phase === 'after' && tabId !== undefined) {
            const tabState = await this.probeTabState(tabId);
            const expected = request.action.name() === 'close_tab' ? 'closed' : 'active';
            evidence = [
              {
                criterionId: `tab-state:${request.roundId}`,
                roundId: request.roundId,
                targetRefId,
                observedAt: this.deps.now(),
                source: 'page',
                value: tabState === 'inactive' && expected === 'active' ? 'inactive' : tabState,
                passed: tabState === expected,
              },
            ];
          }
          return {
            target: {
              id: targetRefId,
              kind: 'page',
              tabId: tabId ?? page.tabId,
              frameId: 0,
              urlOrigin,
              digest,
            },
            effectTarget: { tag: 'tab' },
            evidence,
          };
        }
        const observation = await page.observeActionTarget(request.action.name(), parsedArgs, phase);
        return {
          target: observation.target,
          effectTarget: observation,
          evidence: [],
        };
      },
    });
    this.dispatchers.set(taskId, dispatcher);
    return {
      onPlan: async (roundId, criteria) => {
        let task = await getTask(taskId);
        if (!task || task.status !== 'running' || task.currentRoundId !== roundId) {
          throw new StaleTaskRoundError();
        }
        if (!this.lockedCriteriaRounds.has(this.roundKey(taskId, roundId))) {
          // Models often return empty completion_criteria; fall back to instruction cues
          // so external_commit can still settle with a verified receipt.
          const drafts =
            criteria.length > 0
              ? criteria
              : this.extractImplicitCompletionCriteria(
                  this.instructions.get(taskId) ?? '',
                  task.targetRefs.find(ref => ref.kind === 'page')?.urlOrigin,
                );
          await this.freezeCriteria(taskId, roundId, drafts);
        } else if (this.currentRound(task).criteria.length === 0) {
          throw new Error('Locked Skill criteria are missing');
        }
        task = await getTask(taskId);
        if (!task || task.status !== 'running' || task.currentRoundId !== roundId) {
          throw new StaleTaskRoundError();
        }
      },
      dispatchAction: async (roundId, action, rawArgs) => {
        const task = await getTask(taskId);
        if (!task || task.status !== 'running' || task.currentRoundId !== roundId) {
          throw new StaleTaskRoundError();
        }
        let resolvedArgs = rawArgs;
        if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
          const withTab = resolveTabArgs(action.name(), rawArgs as Record<string, unknown>, task);
          const resolution = resolveMediaArgs(action.name(), withTab, task);
          if (resolution.kind === 'waiting_user') {
            return this.blockMediaAction(taskId, roundId, action.name(), rawArgs, resolution.reason);
          }
          resolvedArgs = resolution.args;
        }
        if (
          action.name() === 'control_media' &&
          resolvedArgs &&
          typeof resolvedArgs === 'object' &&
          !Array.isArray(resolvedArgs) &&
          !this.readStringField(resolvedArgs, 'target_digest')
        ) {
          const { browserContext } = await import('../agent/factory');
          const page = await browserContext.getCurrentPage();
          const observed = await page.observeMedia();
          if (observed.kind !== 'bound') {
            const reason = observed.kind === 'ambiguous' ? 'target_ambiguous' : 'target_missing';
            return this.blockMediaAction(taskId, roundId, action.name(), resolvedArgs, reason);
          }
          resolvedArgs = { ...(resolvedArgs as Record<string, unknown>), target_digest: observed.targetDigest };
        }
        const result = await dispatcher.dispatch({
          taskId,
          roundId,
          action,
          rawArgs: resolvedArgs,
        });
        if (result.targetRef) await this.persistTarget(taskId, roundId, result.targetRef);
        if (result.actionResult.error === 'media_target_missing') {
          await this.persistMediaWait(taskId, roundId, 'target_missing');
        } else if (result.actionResult.error === 'media_target_ambiguous') {
          await this.persistMediaWait(taskId, roundId, 'target_ambiguous');
        } else if (!result.actionResult.error && result.attempt.state === 'observed') {
          // Page evidence beats model "done": settle when criteria already hold.
          // external_commit: retry with backoff (async form rewrite).
          // reversible/read (nav, video click): one immediate probe so we stop on /watch
          // without stalling the next step behind multi-second backoff.
          if (result.attempt.effect === 'external_commit') {
            await this.tryVerifyAfterSuccessfulAct(taskId, roundId);
          } else {
            await this.tryVerifyAfterSuccessfulActOnce(taskId, roundId);
          }
        }
        return result;
      },
    };
  }

  /**
   * After a successful act (navigate, click, or approved external commit), re-probe
   * frozen criteria. Real MiniMax loops often keep stepping without emitting
   * candidate_complete; page evidence is enough for a verified receipt.
   * Fixture/real forms often rewrite DOM after an async fetch - one immediate
   * probe races the update, so retry with short backoff.
   * Only automatic criteria participate - user_confirmed still needs the panel.
   */
  private async tryVerifyAfterSuccessfulAct(taskId: string, roundId: string): Promise<void> {
    // Immediate + short backoff: form fixtures rewrite after async fetch; do not block long.
    const delaysMs = this.deps.postCommitVerifyDelaysMs ?? [0, 250, 600, 1200];
    for (const delayMs of delaysMs) {
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      const settled = await this.tryVerifyAfterSuccessfulActOnce(taskId, roundId);
      if (settled) return;
    }
  }

  /** @returns true when the task was completed (or is no longer verifiable). */
  private async tryVerifyAfterSuccessfulActOnce(taskId: string, roundId: string): Promise<boolean> {
    const task = await getTask(taskId);
    if (!task || task.status !== 'running' || task.currentRoundId !== roundId) return true;
    const round = this.currentRound(task);
    const automaticCriteria = round.criteria.filter(item => item.kind !== 'user_confirmed');
    if (automaticCriteria.length === 0) return true;
    // Mixed plans still need a user click; only pure automatic sets can settle here.
    if (round.criteria.some(item => item.kind === 'user_confirmed')) return true;
    let observations: ProbeObservation[] = [];
    try {
      observations = await this.observeTaskCriteria(task, automaticCriteria);
    } catch {
      return false;
    }
    const checked = checkCompletion({
      now: this.deps.now(),
      currentRoundId: round.id,
      criteria: automaticCriteria,
      observations,
    });
    // product/007: no verified complete without required criteria evidence (expect / page proof).
    if (
      !allowsVerifiedComplete({
        completionPassed: checked.passed,
        hasRequiredCriteria: automaticCriteria.some(c => c.required),
      })
    ) {
      return false;
    }
    // Multi-intent goals (play + copy comment) must not settle on media criteria alone.
    // Keep the loop alive so the agent can still extract/return text.
    const instructionForRound =
      this.instructions.get(taskId) ||
      task.goalSummary ||
      (round.instructionSummary && round.instructionSummary !== 'User instruction'
        ? round.instructionSummary
        : '') ||
      '';
    if (this.instructionRequestsUserDeliverable(instructionForRound)) {
      const answer = round.instructionSummary?.trim() ?? '';
      if (!this.hasSubstantiveDeliverableAnswer(answer, instructionForRound)) {
        return false;
      }
    }
    await this.queueTransition(async () => {
      const current = await getTask(taskId);
      if (!current || current.status !== 'running' || current.currentRoundId !== roundId) return;
      const currentRound = this.currentRound(current);
      currentRound.evidence.push(...checked.evidence);
      await this.persistVerifiedReceipt(current, currentRound, checked.evidence);
    });
    await this.stopTaskRuntime(taskId);
    return true;
  }

  private readStringField(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object' || !(key in value)) return undefined;
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' ? field : undefined;
  }

  private readNumberField(value: unknown, key: string): number | undefined {
    if (!value || typeof value !== 'object' || !(key in value)) return undefined;
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === 'number' && Number.isFinite(field)) return field;
    if (typeof field === 'string' && field.trim() !== '') {
      const n = Number(field.trim());
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  }

  private async probeTabState(tabId: number): Promise<TabStateProbe> {
    if (this.deps.probeTabState) return this.deps.probeTabState(tabId);
    return 'inactive';
  }

  private async probeDownloadState(): Promise<DownloadStateProbe> {
    if (this.deps.probeDownloadState) return this.deps.probeDownloadState();
    return 'none';
  }

  private async blockMediaAction(
    taskId: string,
    roundId: string,
    actionName: string,
    rawArgs: unknown,
    reason: 'target_missing' | 'target_ambiguous',
  ): Promise<DispatchResult> {
    const proposedAt = this.deps.now();
    const displayInput = { actionName, args: rawArgs };
    let attempt: ActionAttempt = {
      id: crypto.randomUUID(),
      roundId,
      actionName,
      effect: 'reversible',
      argsDigest: await sha256(JSON.stringify(rawArgs)),
      displaySummary: buildAttemptDisplaySummary(displayInput),
      targetLabel: buildAttemptTargetLabel(displayInput),
      state: 'proposed',
      proposedAt,
    };
    await this.persistAttempt(taskId, attempt);
    attempt = { ...attempt, state: 'blocked' };
    await this.persistAttempt(taskId, attempt);
    await this.persistMediaWait(taskId, roundId, reason);
    return {
      actionResult: new ActionResult({
        error: reason === 'target_ambiguous' ? 'media_target_ambiguous' : 'media_target_missing',
      }),
      attempt,
      evidence: [],
    };
  }

  private async persistMediaWait(
    taskId: string,
    roundId: string,
    reason: 'target_missing' | 'target_ambiguous',
  ): Promise<void> {
    await this.queueTransition(async () => {
      const task = await getTask(taskId);
      if (!task || task.status !== 'running' || task.currentRoundId !== roundId) return;
      await this.persistWaitingUser(task, this.currentRound(task), reason);
    });
  }

  private async persistAttempt(taskId: string, attempt: ActionAttempt): Promise<void> {
    let stopDriver = false;
    await this.queueTransition(async () => {
      const task = await getTask(taskId);
      const round = task?.rounds.find(item => item.id === attempt.roundId);
      if (!task || !round) return;
      const isCurrentRound = task.currentRoundId === attempt.roundId;
      if (attempt.state === 'executing' && (task.status !== 'running' || !isCurrentRound)) {
        throw new Error('Task is not running');
      }
      const index = round.attempts.findIndex(item => item.id === attempt.id);
      if (index === -1) round.attempts.push(structuredClone(attempt));
      else round.attempts[index] = structuredClone(attempt);
      if (attempt.state === 'executing') {
        const notBefore = attempt.executingAt ?? this.deps.now();
        for (const criterion of round.criteria) criterion.notBefore = Math.max(criterion.notBefore, notBefore);
      }
      if (attempt.state === 'uncertain' && isCurrentRound && !TERMINAL_STATUSES.includes(task.status)) {
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = 'commit_outcome_uncertain';
        stopDriver = true;
      }
      task.revision += 1;
      await this.persist(task);
    });
    if (stopDriver) {
      await this.stopTaskRuntime(taskId);
    }
  }

  private async persistTarget(
    taskId: string,
    roundId: string,
    target: TaskSession['targetRefs'][number],
  ): Promise<void> {
    await this.queueTransition(async () => {
      const task = await getTask(taskId);
      if (!task) return;
      if (task.currentRoundId !== roundId) {
        const sourceIndex = task.rounds.findIndex(item => item.id === roundId);
        const currentIndex = task.rounds.findIndex(item => item.id === task.currentRoundId);
        const currentRound = task.rounds[currentIndex];
        if (
          sourceIndex !== currentIndex - 1 ||
          !currentRound ||
          currentRound.criteria.length > 0 ||
          currentRound.attempts.length > 0
        ) {
          return;
        }
      }
      const index = task.targetRefs.findIndex(item => item.id === target.id);
      if (index === -1) task.targetRefs.push(target);
      else if (target.kind === 'media') {
        task.targetRefs.splice(index, 1);
        task.targetRefs.push(target);
      } else task.targetRefs[index] = target;
      task.activeTabId = target.tabId;
      task.revision += 1;
      await this.persist(task);
    });
  }

  private async requestApproval(
    taskId: string,
    attempt: ActionAttempt,
    summary: string,
  ): Promise<'approved' | 'rejected'> {
    const approvalId = crypto.randomUUID();
    let resolve!: (decision: 'approved' | 'rejected') => void;
    const decision = new Promise<'approved' | 'rejected'>(done => {
      resolve = done;
    });
    this.pendingApprovals.set(approvalId, {
      taskId,
      roundId: attempt.roundId,
      attemptId: attempt.id,
      resolve,
    });

    let accepted = false;
    try {
      await this.queueTransition(async () => {
        const task = await getTask(taskId);
        const round = task?.rounds.find(item => item.id === attempt.roundId);
        if (!task || !round || task.currentRoundId !== round.id || task.status !== 'running') return;
        round.approvals.push({
          id: approvalId,
          attemptId: attempt.id,
          roundId: round.id,
          summary,
          status: 'pending',
        });
        task.status = 'waiting_approval';
        round.status = 'waiting_approval';
        task.revision += 1;
        accepted = true;
        await this.persist(task);
      });
    } catch (error) {
      this.pendingApprovals.delete(approvalId);
      resolve('rejected');
      throw error;
    }
    if (!accepted) {
      this.pendingApprovals.delete(approvalId);
      return 'rejected';
    }
    return decision;
  }

  private interruptTaskRuntime(taskId: string): void {
    this.dispatchers.get(taskId)?.interrupt();
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.taskId !== taskId) continue;
      this.pendingApprovals.delete(approvalId);
      pending.resolve('rejected');
    }
  }

  private async stopTaskRuntime(taskId: string): Promise<void> {
    this.interruptTaskRuntime(taskId);
    const driver = this.drivers.get(taskId);
    this.drivers.delete(taskId);
    this.dispatchers.delete(taskId);
    this.instructions.delete(taskId);
    for (const key of this.lockedCriteriaRounds) {
      if (key.startsWith(`${taskId}:`)) this.lockedCriteriaRounds.delete(key);
    }
    for (const key of this.unsafeSkillCriteriaRounds) {
      if (key.startsWith(`${taskId}:`)) this.unsafeSkillCriteriaRounds.delete(key);
    }
    if (driver) await driver.stop();
  }

  private async runCurrentRound(taskId: string): Promise<void> {
    if (this.launches.has(taskId)) return;
    const launch = Symbol(taskId);
    this.launches.set(taskId, launch);

    try {
      let task = await getTask(taskId);
      if (!task || task.status !== 'running') return;
      await this.deps.switchTab(task.activeTabId);

      task = await getTask(taskId);
      if (!task || task.status !== 'running' || this.launches.get(taskId) !== launch) return;
      let round = this.currentRound(task);
      let instruction = this.instructions.get(taskId);
      if (!instruction && task.chatSessionId && round.instructionMessageId) {
        const { chatHistoryStore } = await import('@extension/storage/lib/chat');
        const session = await chatHistoryStore.getSession(task.chatSessionId);
        instruction = session?.messages.find(message => message.id === round.instructionMessageId)?.content;

        task = await getTask(taskId);
        if (!task || task.status !== 'running' || this.launches.get(taskId) !== launch) return;
        round = this.currentRound(task);
        instruction =
          this.instructions.get(taskId) ??
          session?.messages.find(message => message.id === round.instructionMessageId)?.content;
      }
      if (!instruction) {
        // Dead-end if we wait for "proof" with no criteria UI. Fail honestly.
        task.status = 'failed';
        round.status = 'failed';
        round.failureCategory = 'missing_instruction';
        task.revision += 1;
        await this.persist(task);
        return;
      }

      const roundId = round.id;
      const isSkillRun = task.sourceSkillId !== undefined;
      // Freeze instruction-derived success text before the agent acts so baseline is pre-submit.
      if (!isSkillRun && !this.lockedCriteriaRounds.has(this.roundKey(taskId, roundId))) {
        const tabOrigin = task.targetRefs.find(ref => ref.kind === 'page')?.urlOrigin;
        const implicit = this.extractImplicitCompletionCriteria(instruction, tabOrigin);
        if (implicit.length > 0) {
          await this.freezeCriteria(taskId, roundId, implicit);
        }
      }
      let driver: ExecutorDriver;
      try {
        driver = await this.deps.createExecutor(
          { taskId, roundId, instruction, tabId: task.activeTabId },
          this.executorHooks(taskId),
        );
      } finally {
        if (isSkillRun) this.instructions.delete(taskId);
      }

      task = await getTask(taskId);
      if (
        !task ||
        task.status !== 'running' ||
        this.launches.get(taskId) !== launch ||
        task.currentRoundId !== roundId
      ) {
        await driver.stop();
        if (task?.status === 'running' && this.launches.get(taskId) === launch) {
          this.launches.delete(taskId);
          void this.runCurrentRound(taskId);
        }
        return;
      }

      this.drivers.set(taskId, driver);
      this.launches.delete(taskId);
      await this.runDriver(taskId, driver, roundId);
    } catch (error) {
      // Surface start failures (missing model, createExecutor throw) on the round for UI.
      const category =
        error instanceof Error && /noApiKeys|noNavigator|noProvider|setup/i.test(error.message)
          ? 'setup_failed'
          : 'executor_start_failed';
      await this.queueTransition(async () => {
        const task = await getTask(taskId);
        if (!task || task.status !== 'running') return;
        task.status = 'failed';
        const round = this.currentRound(task);
        round.status = 'failed';
        round.failureCategory = category;
        task.revision += 1;
        await this.persist(task);
      });
    } finally {
      if (this.launches.get(taskId) === launch) this.launches.delete(taskId);
    }
  }

  private async runDriver(taskId: string, driver: ExecutorDriver, initialRoundId: string): Promise<void> {
    let runRoundId = initialRoundId;
    let verificationRetries = 0;
    for (;;) {
      const outcome = await driver.run(runRoundId);
      let task = await getTask(taskId);
      if (!this.canApplyDriverOutcome(task, taskId, driver)) return;
      if (task.currentRoundId !== runRoundId) {
        runRoundId = task.currentRoundId;
        verificationRetries = 0;
        continue;
      }
      if (outcome.kind !== 'candidate_complete') {
        let handoffRoundId: string | undefined;
        await this.queueTransition(async () => {
          const current = await getTask(taskId);
          if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
          if (current.currentRoundId !== runRoundId) {
            handoffRoundId = current.currentRoundId;
            return;
          }
          await this.persistTerminalOrWaiting(current, outcome);
        });
        if (handoffRoundId) {
          runRoundId = handoffRoundId;
          verificationRetries = 0;
          continue;
        }
        return;
      }

      let round = task.rounds.find(item => item.id === runRoundId);
      if (!round) return;
      if (round.criteria.length === 0) {
        // Live open-site goals often omit planner criteria; re-derive from the instruction
        // while still running so we can verify the page URL and emit a receipt.
        const instruction = this.instructions.get(taskId) ?? '';
        const recoveryDrafts = this.extractImplicitCompletionCriteria(
          instruction,
          task.targetRefs.find(ref => ref.kind === 'page')?.urlOrigin,
        );
        if (recoveryDrafts.length > 0) {
          await this.freezeCriteria(taskId, runRoundId, recoveryDrafts);
          const afterFreeze = await getTask(taskId);
          if (
            afterFreeze &&
            this.canApplyDriverOutcome(afterFreeze, taskId, driver) &&
            afterFreeze.currentRoundId === runRoundId &&
            this.currentRound(afterFreeze).criteria.length > 0
          ) {
            // Freeze may have run after navigate, so baseline already matches the page.
            // Clear baselines so post-act page evidence can pass checkCompletion.
            await this.queueTransition(async () => {
              const current = await getTask(taskId);
              if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
              if (current.currentRoundId !== runRoundId) return;
              if (current.status !== 'running') return;
              const currentRound = this.currentRound(current);
              for (const criterion of currentRound.criteria) {
                if (criterion.kind === 'url') criterion.baseline = '';
                else if (typeof criterion.baseline === 'boolean') criterion.baseline = false;
              }
              current.revision += 1;
              await this.persist(current);
            });
            const recovered = await getTask(taskId);
            if (
              recovered &&
              this.canApplyDriverOutcome(recovered, taskId, driver) &&
              recovered.currentRoundId === runRoundId &&
              this.currentRound(recovered).criteria.length > 0
            ) {
              task = recovered;
              round = this.currentRound(recovered);
            }
          }
        }
      }
      if (round.criteria.length === 0) {
        // Understanding / open-ended goals often have no freezeable criteria.
        // Prefer complete with the model summary (answer) over hang or opaque fail.
        const answer = outcome.kind === 'candidate_complete' ? outcome.summary.trim() : '';
        let handoffRoundId: string | undefined;
        await this.queueTransition(async () => {
          const current = await getTask(taskId);
          if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
          if (current.currentRoundId !== runRoundId) {
            handoffRoundId = current.currentRoundId;
            return;
          }
          const currentRound = this.currentRound(current);
          if (answer.length > 0) {
            // Surface the answer on the round for UI; keep goalSummary generic.
            currentRound.instructionSummary = answer.slice(0, 2000);
            delete currentRound.waitReason;
            delete currentRound.failureCategory;
            await this.persistVerifiedReceipt(current, currentRound, []);
            return;
          }
          // No answer either — fail honestly (never proof_required with 0 buttons).
          current.status = 'failed';
          currentRound.status = 'failed';
          currentRound.failureCategory = 'no_completion_criteria';
          delete currentRound.waitReason;
          current.revision += 1;
          current.updatedAt = this.deps.now();
          await this.persist(current);
        });
        if (handoffRoundId) {
          runRoundId = handoffRoundId;
          verificationRetries = 0;
          continue;
        }
        return;
      }
      if (round.criteria.some(item => item.kind === 'user_confirmed')) {
        const automaticCriteria = round.criteria.filter(item => item.kind !== 'user_confirmed');
        let automaticEvidence: CompletionEvidence[] = [];
        if (automaticCriteria.length > 0) {
          let observations: ProbeObservation[] = [];
          try {
            observations = await this.observeTaskCriteria(task, automaticCriteria);
          } catch {
            observations = [];
          }
          automaticEvidence = checkCompletion({
            now: this.deps.now(),
            currentRoundId: round.id,
            criteria: automaticCriteria,
            observations,
          }).evidence;
        }
        let handoffRoundId: string | undefined;
        await this.queueTransition(async () => {
          const current = await getTask(taskId);
          if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
          if (current.currentRoundId !== runRoundId) {
            handoffRoundId = current.currentRoundId;
            return;
          }
          const currentRound = this.currentRound(current);
          currentRound.evidence.push(...automaticEvidence);
          await this.persistWaitingUser(current, currentRound, 'proof_required');
        });
        if (handoffRoundId) {
          runRoundId = handoffRoundId;
          verificationRetries = 0;
          continue;
        }
        return;
      }

      let observations: ProbeObservation[] = [];
      try {
        observations = await this.observeTaskCriteria(task, round.criteria);
      } catch {
        observations = [];
      }
      const checked = checkCompletion({
        now: this.deps.now(),
        currentRoundId: round.id,
        criteria: round.criteria,
        observations,
      });
      const outcomeAnswer = outcome.kind === 'candidate_complete' ? outcome.summary.trim() : '';
      // Multi-intent goals like "play + copy first comment" must not complete on media alone.
      const instructionForRound =
        this.instructions.get(taskId) ||
        task.goalSummary ||
        (round.instructionSummary && round.instructionSummary !== 'User instruction'
          ? round.instructionSummary
          : '') ||
        '';
      const needsDeliverable = this.instructionRequestsUserDeliverable(instructionForRound);
      const deliverableOk =
        !needsDeliverable || this.hasSubstantiveDeliverableAnswer(outcomeAnswer, instructionForRound);
      let retry = false;
      let handoffRoundId: string | undefined;
      await this.queueTransition(async () => {
        const current = await getTask(taskId);
        if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
        if (current.currentRoundId !== round.id) {
          handoffRoundId = current.currentRoundId;
          return;
        }
        const currentRound = this.currentRound(current);
        currentRound.evidence.push(...checked.evidence);
        // Optional-only criteria must not mint a verified receipt (sticky false complete).
        if (
          allowsVerifiedComplete({
            completionPassed: checked.passed,
            hasRequiredCriteria: currentRound.criteria.some(criterion => criterion.required),
          }) &&
          deliverableOk
        ) {
          if (outcomeAnswer.length > 0) {
            currentRound.instructionSummary = outcomeAnswer.slice(0, 2000);
          }
          await this.persistVerifiedReceipt(current, currentRound, checked.evidence);
          return;
        }
        // Criteria green but user still asked for text we never got — keep working, do not fake done.
        if (
          allowsVerifiedComplete({
            completionPassed: checked.passed,
            hasRequiredCriteria: currentRound.criteria.some(criterion => criterion.required),
          }) &&
          needsDeliverable &&
          !deliverableOk
        ) {
          current.revision += 1;
          await this.persist(current);
          retry = true;
          return;
        }
        if (verificationRetries >= 1) {
          if (needsDeliverable && !deliverableOk && checked.passed) {
            // Do not hang on proof_required with no button — fail with a clear product category.
            current.status = 'failed';
            currentRound.status = 'failed';
            currentRound.failureCategory = 'no_action';
            delete currentRound.waitReason;
            current.revision += 1;
            current.updatedAt = this.deps.now();
            await this.persist(current);
            return;
          }
          await this.persistWaitingUser(current, currentRound, 'proof_required');
          return;
        }
        current.revision += 1;
        await this.persist(current);
        retry = true;
      });
      if (handoffRoundId) {
        runRoundId = handoffRoundId;
        verificationRetries = 0;
        continue;
      }
      if (!retry) return;
      const latest = await getTask(taskId);
      if (!this.canApplyDriverOutcome(latest, taskId, driver)) return;
      if (latest.currentRoundId !== runRoundId) {
        runRoundId = latest.currentRoundId;
        verificationRetries = 0;
        continue;
      }
      verificationRetries += 1;
      if (needsDeliverable && !deliverableOk && checked.passed) {
        driver.addFollowUp(
          'Page checks passed but the user also asked for extracted text (comment/copy/summary). Read the page, copy the requested content, and reply with that text before finishing.',
        );
      } else {
        driver.addFollowUp('Completion was not verified; inspect the current page and continue.');
      }
    }
  }

  /** User expects content returned in chat (comment, copy, summary), not only page side-effects. */
  private instructionRequestsUserDeliverable(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /复制/.test(text) ||
      /发给我|发我|告诉我|回复我|贴给我/.test(text) ||
      /第一条评论|评论内容|热评/.test(text) ||
      /摘录|摘要|总结/.test(text) ||
      /把.{1,40}给(我|你)/.test(text) ||
      /\b(copy|tell me|send me|first comment)\b/i.test(text) ||
      // R1-class: table/CSV extract must land as chat deliverable, not page-only done.
      /\bextract\b.+\b(csv|table)\b/i.test(text) ||
      /\b(csv|table)\b.+\b(name|price|rating)\b/i.test(text) ||
      /(?:抽取|提取|导出).{0,24}(?:表|CSV|csv)/i.test(text)
    );
  }

  private hasSubstantiveDeliverableAnswer(summary: string, goalText = ''): boolean {
    const s = summary.replace(/\s+/g, ' ').trim();
    if (s.length < 8) return false;
    if (/^(done|完成|ok|已完成|success|好了|opened|playing|paused)[.!。！]*$/i.test(s)) return false;
    // Media/page status is evidence, not the comment/copy the user asked for.
    if (/^(视频|媒体).{0,12}(播放|暂停|核对)/.test(s)) return false;
    if (/^(目标)?标签已关闭/.test(s)) return false;
    if (/^页面(地址|状态)已/.test(s)) return false;
    if (/^下载已(开始|完成)/.test(s)) return false;
    if (/^(Browser opened|Switched to|Playing video|Opened |Paused video)/i.test(s)) return false;
    if (/User instruction/i.test(s)) return false;
    const goal = goalText.replace(/\s+/g, ' ').trim();
    if (goal && (s === goal || s.includes(goal) || (s.length <= goal.length + 4 && goal.includes(s)))) {
      return false;
    }
    return true;
  }

  private canApplyDriverOutcome(task: TaskSession | null, taskId: string, driver: ExecutorDriver): task is TaskSession {
    return Boolean(task && this.drivers.get(taskId) === driver && task.status === 'running');
  }

  /**
   * Probe completion against the task's bound tab, not whatever tab is currently
   * focused (side-panel tabs / e2e focus steal would otherwise miss page_text).
   * tab_state / download_state do not require a live page attach (closed tabs).
   */
  private async observeTaskCriteria(task: TaskSession, criteria: CompletionCriterion[]): Promise<ProbeObservation[]> {
    const now = this.deps.now();
    const tabCriteria = criteria.filter(criterion => criterion.kind === 'tab_state');
    const downloadCriteria = criteria.filter(criterion => criterion.kind === 'download_state');
    const pageCriteria = criteria.filter(
      criterion => criterion.kind !== 'tab_state' && criterion.kind !== 'download_state',
    );

    const tabObservations: ProbeObservation[] = [];
    for (const criterion of tabCriteria) {
      const tabId = this.tabIdFromTargetRef(criterion.targetRefId) ?? task.activeTabId;
      const state = await this.probeTabState(tabId);
      tabObservations.push({
        criterionId: criterion.id,
        roundId: criterion.roundId,
        targetRefId: criterion.targetRefId.startsWith('tab-') ? criterion.targetRefId : `tab-${tabId}`,
        observedAt: now,
        source: 'page',
        value: state === 'closed' ? 'closed' : state === 'active' ? 'active' : 'inactive',
      });
    }

    const downloadObservations: ProbeObservation[] = [];
    for (const criterion of downloadCriteria) {
      const state = await this.probeDownloadState();
      downloadObservations.push({
        criterionId: criterion.id,
        roundId: criterion.roundId,
        targetRefId: criterion.targetRefId,
        observedAt: now,
        source: 'page',
        value: state,
      });
    }

    let pageObservations: ProbeObservation[] = [];
    if (pageCriteria.length > 0) {
      if (Number.isSafeInteger(task.activeTabId)) {
        try {
          await this.deps.switchTab(task.activeTabId);
        } catch {
          // Tab may have been closed; page criteria then simply miss.
        }
      }
      pageObservations = await this.deps.observeCriteria(pageCriteria);
    }
    return [...tabObservations, ...downloadObservations, ...pageObservations];
  }

  private tabIdFromTargetRef(targetRefId: string): number | undefined {
    if (!targetRefId.startsWith('tab-')) return undefined;
    const n = Number(targetRefId.slice(4));
    return Number.isSafeInteger(n) ? n : undefined;
  }

  private applyOutcome(task: TaskSession, outcome: ExecutorOutcome): void {
    const round = this.currentRound(task);
    switch (outcome.kind) {
      case 'candidate_complete':
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = 'proof_required';
        break;
      case 'waiting_user':
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = outcome.reason;
        break;
      case 'paused':
        task.status = 'paused';
        round.status = 'paused';
        break;
      case 'cancelled':
        task.status = 'cancelled';
        round.status = 'cancelled';
        break;
      case 'failed':
        task.status = 'failed';
        round.status = 'failed';
        round.failureCategory = outcome.category || 'unknown';
        break;
    }
  }

  private async freezeCriteria(
    taskId: string,
    expectedRoundId: string,
    drafts: CompletionCriterionDraft[],
  ): Promise<void> {
    await this.queueTransition(async () => {
      const task = await getTask(taskId);
      if (!task || task.status !== 'running' || task.currentRoundId !== expectedRoundId) return;
      const round = this.currentRound(task);
      if (round.criteria.length > 0 || drafts.length === 0) return;
      const frozenAt = this.deps.now();
      const tabTargetRefId = `tab-${task.activeTabId}`;
      const latestMediaTarget = [...task.targetRefs].reverse().find(target => target.kind === 'media');
      const userFieldValues = this.extractUserFieldValues(this.instructions.get(taskId) ?? '');
      const copiedFieldCriterion = drafts.some(
        draft => draft.kind === 'page_text' && userFieldValues.has(draft.expected.replace(/\s+/g, ' ').trim()),
      );
      const criteria = await Promise.all(
        drafts
          .slice(0, 8)
          .map(draft =>
            this.freezeCriterion(
              draft,
              round.id,
              draft.kind === 'media_state' && latestMediaTarget
                ? latestMediaTarget.id
                : draft.kind === 'download_state'
                  ? 'download:session'
                  : tabTargetRefId,
              frozenAt,
              userFieldValues,
            ),
          ),
      );
      // Baseline must probe the task tab. Side-panel / e2e focus would otherwise
      // rewrite targetRefId + activeTabId to the wrong page and break post-commit verify.
      const baseline = await this.observeTaskCriteria(task, criteria);
      const pageObservations = baseline.filter(
        observation =>
          observation.source === 'page' &&
          observation.roundId === round.id &&
          /^(?:tab-\d+|media:[a-f0-9]{64}|download:session)$/.test(observation.targetRefId),
      );
      const observedTabTargets = new Set(
        pageObservations.map(observation => observation.targetRefId).filter(target => target.startsWith('tab-')),
      );
      for (const criterion of criteria) {
        const observation = pageObservations.find(item => item.criterionId === criterion.id);
        if (observation) criterion.targetRefId = observation.targetRefId;
        criterion.baseline = observation?.value ?? false;
      }
      if (observedTabTargets.size === 1) {
        const observedTabId = Number([...observedTabTargets][0].slice(4));
        if (Number.isSafeInteger(observedTabId)) task.activeTabId = observedTabId;
      }
      if (task.currentRoundId !== expectedRoundId) return;
      round.criteria = criteria;
      const key = this.roundKey(task.id, round.id);
      const templates = this.templatesFromCriteria(drafts, criteria);
      this.criterionTemplates.set(key, templates);
      if (copiedFieldCriterion) this.unsafeSkillCriteriaRounds.add(key);
      else this.unsafeSkillCriteriaRounds.delete(key);
      await putSkillSaveMeta(task.id, round.id, {
        templates: structuredClone(templates),
        unsafe: copiedFieldCriterion,
      });
      task.revision += 1;
      await this.persist(task);
    });
  }

  private async freezeSkillCriteria(
    templates: CompletionCriterionTemplate[],
    roundId: string,
    tabId: number,
  ): Promise<CompletionCriterion[]> {
    if (templates.length === 0 || templates.some(template => JSON.stringify(template).includes('{{'))) {
      throw new Error('invalid_skill_criterion');
    }
    const drafts = templates.map(template => this.skillTemplateDraft(template));
    const frozenAt = this.deps.now();
    const criteria = await Promise.all(
      drafts.map(draft => this.freezeCriterion(draft, roundId, `tab-${tabId}`, frozenAt, new Set())),
    );
    // Skill freeze is bound to the start command tab; never baseline against focus drift.
    if (Number.isSafeInteger(tabId)) {
      await this.deps.switchTab(tabId);
    }
    const baseline = await this.deps.observeCriteria(criteria);
    const observations = baseline.filter(
      observation =>
        observation.source === 'page' &&
        observation.roundId === roundId &&
        /^(?:tab-\d+|media:[a-f0-9]{64}|download:session)$/.test(observation.targetRefId),
    );
    for (const criterion of criteria) {
      const observation = observations.find(item => item.criterionId === criterion.id);
      if (observation) criterion.targetRefId = observation.targetRefId;
      criterion.baseline = observation?.value ?? false;
    }
    return criteria;
  }

  private skillTemplateDraft(template: CompletionCriterionTemplate): CompletionCriterionDraft {
    switch (template.kind) {
      case 'url':
      case 'page_text':
        return { ...template, expected: template.expectedTemplate };
      case 'element_state':
      case 'media_state':
      case 'tab_state':
      case 'download_state':
      case 'user_confirmed':
        return template;
    }
  }

  private templatesFromCriteria(
    drafts: CompletionCriterionDraft[],
    criteria: CompletionCriterion[],
  ): CompletionCriterionTemplate[] {
    return criteria.map((criterion, index) => {
      const draft = drafts[index];
      switch (criterion.kind) {
        case 'url':
          return {
            kind: 'url',
            operator: criterion.operator,
            expectedTemplate: criterion.expected,
            required: criterion.required,
          };
        case 'page_text': {
          if (draft?.kind !== 'page_text') throw new Error('Page-text criterion draft is missing');
          return {
            kind: 'page_text',
            operator: criterion.operator,
            expectedTemplate: draft.expected.replace(/\s+/g, ' ').trim(),
            required: criterion.required,
          };
        }
        case 'element_state':
          return {
            kind: 'element_state',
            operator: criterion.operator,
            expected: criterion.expected,
            required: criterion.required,
          };
        case 'media_state':
          return {
            kind: 'media_state',
            operator: criterion.operator,
            expected: criterion.expected,
            required: criterion.required,
          };
        case 'tab_state':
          return {
            kind: 'tab_state',
            operator: criterion.operator,
            expected: criterion.expected,
            required: criterion.required,
          };
        case 'download_state':
          return {
            kind: 'download_state',
            operator: criterion.operator,
            expected: criterion.expected,
            required: criterion.required,
          };
        case 'user_confirmed':
          return { kind: 'user_confirmed', operator: 'equals', expected: true, required: criterion.required };
      }
    });
  }

  private roundKey(taskId: string, roundId: string): string {
    return `${taskId}:${roundId}`;
  }

  private async freezeCriterion(
    draft: CompletionCriterionDraft,
    roundId: string,
    targetRefId: string,
    frozenAt: number,
    userFieldValues: Set<string>,
  ): Promise<CompletionCriterion> {
    const base = {
      id: crypto.randomUUID(),
      roundId,
      targetRefId,
      required: draft.required,
      frozenAt,
      notBefore: frozenAt,
      // Real agent loops + async page rewrites need more than a few seconds after commit.
      timeoutMs: 120_000,
      baseline: false,
    };
    switch (draft.kind) {
      case 'url': {
        const expected = this.normalizeUrl(draft.expected);
        return expected
          ? { ...base, kind: 'url', operator: draft.operator, expected }
          : { ...base, kind: 'user_confirmed', operator: 'equals', expected: true };
      }
      case 'page_text': {
        const normalized = draft.expected.replace(/\s+/g, ' ').trim();
        if (!normalized || normalized.length > 160 || userFieldValues.has(normalized)) {
          return { ...base, kind: 'user_confirmed', operator: 'equals', expected: true };
        }
        return {
          ...base,
          kind: 'page_text',
          operator: draft.operator,
          expectedDigest: await sha256(normalized),
        };
      }
      case 'user_confirmed':
        return { ...base, kind: 'user_confirmed', operator: 'equals', expected: true };
      case 'element_state':
        return { ...base, kind: 'user_confirmed', operator: 'equals', expected: true };
      case 'media_state':
        return { ...base, kind: 'media_state', operator: draft.operator, expected: draft.expected };
      case 'tab_state':
        return { ...base, kind: 'tab_state', operator: draft.operator, expected: draft.expected };
      case 'download_state':
        return { ...base, kind: 'download_state', operator: draft.operator, expected: draft.expected };
    }
  }

  private normalizeUrl(value: string): string | null {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return `${url.origin}${url.pathname}`;
    } catch {
      return null;
    }
  }

  /**
   * When the planner omits completion_criteria, recover observable success signals from the user goal.
   * - Open-site goals ("打开 YouTube" / "open youtube") → url starts_with origin
   * - Open + open first video ("打开YouTube并点击第一个视频") → url starts_with /watch (or site equivalent)
   * - Explicit success text ("success is Saved successfully" / "until you see Done") → page_text
   */
  private extractImplicitCompletionCriteria(
    instruction: string,
    tabOrigin?: string,
  ): CompletionCriterionDraft[] {
    const drafts: CompletionCriterionDraft[] = [];
    const seen = new Set<string>();
    const fieldValues = this.extractUserFieldValues(instruction);

    let completionUrl = this.extractOpenSiteCompletionUrl(instruction);
    // Already on bilibili/youtube + "open first video" (no "打开 bilibili" in text).
    if (!completionUrl && tabOrigin && this.instructionRequestsOpenMedia(instruction)) {
      try {
        const originUrl =
          tabOrigin.startsWith('http://') || tabOrigin.startsWith('https://')
            ? tabOrigin
            : `https://${tabOrigin}`;
        completionUrl = this.mediaWatchUrlForSite(originUrl);
      } catch {
        completionUrl = null;
      }
    }
    if (completionUrl && !seen.has(completionUrl)) {
      seen.add(completionUrl);
      drafts.push({ kind: 'url', operator: 'starts_with', expected: completionUrl, required: true });
    }

    const patterns = [
      /\bsuccess\s+is\s+["'“]?([^"'”.;\n]+)/gi,
      /\buntil\s+(?:you\s+)?(?:see|seeing)\s+["'“]?([^"'”.;\n]+)/gi,
      /成功(?:标志|信号|文案|是|为)?\s*[:：]?\s*["'「]?([^"'」.;。\n]+)/g,
      /看到\s*["'“「]?([^"'”」.;。\n]{2,80}?)(?=\s*["'”」]?\s*后\s*(?:[，,]\s*)?(?:完成|结束)|["'”」.;。\n]|$)/g,
    ];
    for (const pattern of patterns) {
      for (const match of instruction.matchAll(pattern)) {
        const expected = match[1]?.replace(/\s+/g, ' ').trim();
        if (!expected || expected.length > 160 || seen.has(expected) || fieldValues.has(expected)) continue;
        seen.add(expected);
        drafts.push({ kind: 'page_text', operator: 'present', expected, required: true });
      }
    }

    // T0 control goals: freeze observable criteria so model verbal done cannot complete alone.
    if (this.instructionRequestsCloseTab(instruction) && !seen.has('tab_state:closed')) {
      seen.add('tab_state:closed');
      drafts.push({ kind: 'tab_state', operator: 'equals', expected: 'closed', required: true });
    }
    if (this.instructionRequestsDownload(instruction) && !seen.has('download_state:finished')) {
      seen.add('download_state:finished');
      drafts.push({ kind: 'download_state', operator: 'equals', expected: 'finished', required: true });
    }
    // Media play/pause only when not an "open first video" navigation goal.
    if (!this.instructionRequestsOpenMedia(instruction) && !completionUrl) {
      if (this.instructionRequestsMediaPause(instruction) && !seen.has('media_state:paused')) {
        seen.add('media_state:paused');
        drafts.push({ kind: 'media_state', operator: 'equals', expected: 'paused', required: true });
      } else if (this.instructionRequestsMediaPlay(instruction) && !seen.has('media_state:playing')) {
        seen.add('media_state:playing');
        drafts.push({ kind: 'media_state', operator: 'equals', expected: 'playing', required: true });
      }
    }

    return drafts.slice(0, 3);
  }

  private instructionRequestsCloseTab(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /关掉(这个)?(页|标签|标签页|tab)?/i.test(text) ||
      /关闭(这个)?(页|标签|标签页|窗口)/.test(text) ||
      /关页/.test(text) ||
      /close\s+(this\s+)?(tab|page|window)/i.test(text) ||
      /close\s+the\s+(current\s+)?(tab|page)/i.test(text)
    );
  }

  private instructionRequestsDownload(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /下载(这个|该|一下)?(视频|影片|音频|文件|内容)?/.test(text) ||
      /\bdownload\s+(this\s+)?(video|audio|file|media)?\b/i.test(text)
    );
  }

  private instructionRequestsMediaPause(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /暂停/.test(text) ||
      /停一下/.test(text) ||
      /停下/.test(text) ||
      /停止播放/.test(text) ||
      /\bpause\b/i.test(text) ||
      /\bstop\s+(the\s+)?(video|audio|media|playback)\b/i.test(text)
    );
  }

  private instructionRequestsMediaPlay(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /播放/.test(text) ||
      /继续播/.test(text) ||
      /开始播/.test(text) ||
      /\bplay\b/i.test(text) ||
      /\bresume\s+(the\s+)?(video|audio|media|playback)\b/i.test(text)
    );
  }

  /**
   * Resolve the strongest url criterion for an open-site style goal.
   * Plain open → site origin. Open + click/play first video → watch/player path.
   */
  private extractOpenSiteCompletionUrl(instruction: string): string | null {
    const siteUrl = this.extractOpenSiteUrl(instruction);
    if (!siteUrl) return null;
    if (this.instructionRequestsOpenMedia(instruction)) {
      return this.mediaWatchUrlForSite(siteUrl) ?? siteUrl;
    }
    return siteUrl;
  }

  /** True when the user asked to open/click/play a video, not only land on the site home. */
  private instructionRequestsOpenMedia(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /点击.{0,32}(视频|影片)/.test(text) ||
      /打开.{0,48}(视频|影片)/.test(text) ||
      /看.{0,16}(一个|第一个|首个)?(视频|影片)/.test(text) ||
      /click.{0,40}(the\s+)?(first\s+)?video/i.test(text) ||
      /open.{0,48}(and\s+)?(play|watch).{0,24}video/i.test(text) ||
      /watch\s+(the\s+)?(first\s+)?video/i.test(text) ||
      /play\s+(the\s+)?(first\s+)?video/i.test(text)
    );
  }

  /** Site-specific watch/player URL prefix used as starts_with evidence. */
  private mediaWatchUrlForSite(siteUrl: string): string | null {
    try {
      const host = new URL(siteUrl).hostname.toLowerCase();
      if (
        host === 'youtu.be' ||
        host === 'www.youtube.com' ||
        host === 'youtube.com' ||
        host.endsWith('.youtube.com')
      ) {
        return 'https://www.youtube.com/watch';
      }
      if (host === 'www.bilibili.com' || host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
        return 'https://www.bilibili.com/video';
      }
    } catch {
      return null;
    }
    return null;
  }

  /** Map well-known "open / 打开 <site>" goals to a stable https origin for url criteria. */
  private extractOpenSiteUrl(instruction: string): string | null {
    const OPEN_SITE_URLS: Record<string, string> = {
      youtube: 'https://www.youtube.com',
      'you tube': 'https://www.youtube.com',
      油管: 'https://www.youtube.com',
      google: 'https://www.google.com',
      github: 'https://github.com',
      bilibili: 'https://www.bilibili.com',
      哔哩哔哩: 'https://www.bilibili.com',
      b站: 'https://www.bilibili.com',
    };
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    // Optional whitespace: users often write "打开YouTube" without a space.
    const match =
      text.match(/^\s*(?:打开|open)\s*(?:一下\s*|the\s+)?(.+?)\s*$/i) ||
      text.match(/(?:打开|open)\s*(?:一下\s*|the\s+)?(youtube|you\s*tube|google|github|bilibili|油管|哔哩哔哩|b站)\b/i);
    if (!match?.[1]) return null;
    const raw = match[1].replace(/\s+/g, ' ').trim().toLowerCase();
    if (!raw) return null;
    if (OPEN_SITE_URLS[raw]) return OPEN_SITE_URLS[raw];
    for (const [name, url] of Object.entries(OPEN_SITE_URLS)) {
      if (raw.includes(name)) return url;
    }
    // Bare host / URL fragment: "open example.com" or "打开 https://example.com/foo"
    try {
      const asUrl = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
      const parsed = new URL(asUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      if (!parsed.hostname.includes('.')) return null;
      return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    } catch {
      return null;
    }
  }

  private extractUserFieldValues(instruction: string): Set<string> {
    const values = new Set<string>();
    const addValue = (candidate: string | undefined) => {
      const value = candidate
        ?.replace(/\s+/g, ' ')
        .trim()
        .replace(/^["'“]|["'”]$/g, '');
      if (value) values.add(value);
    };
    for (const match of instruction.matchAll(/(?:=|:|：)\s*["']?([^,;\n"']{1,160})/g)) {
      addValue(match[1]);
    }
    const naturalLanguagePatterns = [
      /\b(?:fill|enter|type|put)\s+["“']?(.{1,160}?)["”']?\s+(?:into|in)\b/gi,
      /\bwith\s+["“']?(.{1,160}?)["”']?(?=\s+(?:and|then|at)\b|[,;.\n]|$)/gi,
      /\bset\s+[^,;\n]{1,60}?\s+to\s+["“']?(.{1,160}?)["”']?(?=\s+(?:and|then)\b|[,;.\n]|$)/gi,
      /(?:字段|栏)(?:中)?(?:填写|输入|填入|设为)\s*["“']?([^,，;；。\n"”']{1,80})/g,
      /(?:填写|输入|填入)\s*["“']?([^,，;；。\n"”']{1,80}?)["”']?\s*(?:到|至|进|在)/g,
    ];
    for (const pattern of naturalLanguagePatterns) {
      for (const match of instruction.matchAll(pattern)) addValue(match[1]);
    }
    for (const match of instruction.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d{3}-\d{2}-\d{4}\b/g)) {
      addValue(match[0]);
    }
    return values;
  }

  private async confirmCompletion(
    task: TaskSession,
    command: Extract<TaskCommand, { type: 'confirm_completion' }>,
  ): Promise<CommandAck> {
    const round = task.rounds.find(item => item.id === command.roundId);
    const criterion = round?.criteria.find(item => item.id === command.criterionId);
    const alreadyConfirmed = round?.evidence.some(
      item => item.criterionId === command.criterionId && item.source === 'user' && item.passed,
    );
    if (
      task.status !== 'waiting_user' ||
      task.currentRoundId !== command.roundId ||
      round?.waitReason !== 'proof_required' ||
      !criterion ||
      criterion.kind !== 'user_confirmed' ||
      alreadyConfirmed
    ) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }
    const observation: ProbeObservation = {
      criterionId: criterion.id,
      roundId: round.id,
      targetRefId: criterion.targetRefId,
      observedAt: this.deps.now(),
      source: 'user',
      value: true,
    };
    const priorObservations = round.evidence
      .filter(item => item.passed)
      .map(item => ({
        criterionId: item.criterionId,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: item.observedAt,
        source: item.source,
        value: item.value,
      }));
    const checked = checkCompletion({
      now: this.deps.now(),
      currentRoundId: round.id,
      criteria: round.criteria,
      observations: [...priorObservations, observation],
    });
    const confirmedEvidence = checked.evidence.find(
      item => item.criterionId === criterion.id && item.source === 'user' && item.passed,
    );
    if (!confirmedEvidence) return this.reject(task, command.commandId, 'invalid_transition');
    round.evidence.push(confirmedEvidence);
    const ack = this.accept(task, command.commandId);
    if (checked.passed) await this.persistVerifiedReceipt(task, round, checked.evidence, false);
    else await this.persist(task);
    return ack;
  }

  private async persistTerminalOrWaiting(task: TaskSession, outcome: ExecutorOutcome): Promise<void> {
    this.applyOutcome(task, outcome);
    task.revision += 1;
    await this.persist(task);
  }

  private async persistWaitingUser(
    task: TaskSession,
    round: TaskRound,
    reason: TaskRound['waitReason'],
  ): Promise<void> {
    task.status = 'waiting_user';
    round.status = 'waiting_user';
    round.waitReason = reason;
    task.revision += 1;
    await this.persist(task);
  }

  private async persistVerifiedReceipt(
    task: TaskSession,
    round: TaskRound,
    evidence: CompletionEvidence[],
    incrementRevision = true,
  ): Promise<void> {
    round.receipt = {
      id: crypto.randomUUID(),
      taskId: task.id,
      roundId: round.id,
      verifiedAt: this.deps.now(),
      criterionIds: round.criteria.filter(item => item.required).map(item => item.id),
      evidenceDigests: await Promise.all(evidence.map(item => sha256(JSON.stringify(item)))),
    };
    task.status = 'completed';
    round.status = 'completed';
    round.waitReason = undefined;
    this.lockedCriteriaRounds.delete(this.roundKey(task.id, round.id));
    if (incrementRevision) task.revision += 1;
    await this.persist(task);
    const snapshot = structuredClone(task);
    for (const listener of this.listeners) {
      listener({
        type: 'task_completed_verified',
        taskId: task.id,
        roundId: task.currentRoundId,
        revision: task.revision,
        receiptId: round.receipt.id,
        snapshot,
      });
    }
  }

  private async persist(task: TaskSession): Promise<void> {
    task.updatedAt = this.deps.now();
    await saveTask(task);
    const snapshot = structuredClone(task);
    for (const listener of this.listeners) {
      listener({
        type: 'snapshot',
        taskId: task.id,
        roundId: task.currentRoundId,
        revision: task.revision,
        snapshot,
      });
    }
  }

  private queueTransition(work: () => Promise<void>): Promise<void> {
    const result = this.transition.then(work);
    this.transition = result.catch(() => undefined);
    return result;
  }
}
