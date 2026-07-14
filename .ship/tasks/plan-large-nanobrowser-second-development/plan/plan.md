# Browser Action Agent Cycle 1 Implementation Plan

> **For agentic workers:** Use `/yishuship:dev` to implement this plan story-by-story. Keep every checkbox and stop when a story's check is red.

**Goal:** Turn the existing Nanobrowser side panel into a dependable single-task browser action Agent with durable follow-up control, crash-safe approvals, verified completion, generic media control, and local semantic Skills.

**Architecture:** Keep the Manifest V3 extension and current BrowserContext/Planner/Navigator/action stack. Add one deep TaskManager interface over a concrete local store, one shared ActionDispatcher before every remaining action, and one pure CompletionChecker. Delete raw replay before introducing the new seams; do not add a browser fork, cloud runtime, site adapter, parallel scheduler, repository layer, factory class, generated-script runner, or marketplace.

**Tech Stack:** TypeScript 5.5, Chrome Manifest V3 APIs, React 18, Zod, existing `createStorage`, Vitest 2, Puppeteer Core 24, Node standard library.

**Matt upstream used:** `vendor/mattpocock-skills/skills/engineering/to-tickets/SKILL.md`, `vendor/mattpocock-skills/skills/engineering/codebase-design/SKILL.md`, and `codebase-design/DEEPENING.md`.

## Story graph

1. Remove unsafe replay — no blockers.
2. Durable task lifecycle — blocked by Story 1.
3. Crash-safe action approval — blocked by Story 2.
4. Verified form completion — blocked by Story 3.
5. Continuous HTML media control — blocked by Story 4.
6. Local semantic Skills — blocked by Story 4; execute after Story 5 because both touch SidePanel/TaskManager.
7. Unpacked-extension acceptance and hardening — blocked by Stories 5 and 6.

## Canonical contracts used by every story

Persisted definitions from `TaskStatus` through `TaskEvent` live in `projects/nanobrowser/packages/storage/lib/task/types.ts`. Runtime-only definitions live from Story 2 onward in `projects/nanobrowser/chrome-extension/src/background/task/contracts.ts`, which imports `Action`, `ActionResult`, and persisted task types. Later stories implement behavior, not new names or incompatible shapes.

```ts
export type TaskStatus =
  | 'running' | 'paused' | 'waiting_approval' | 'waiting_user' | 'inputs_required'
  | 'interrupted' | 'completed' | 'failed' | 'cancelled';
export type WaitReason =
  | 'login_required' | 'captcha_required' | 'approval_rejected' | 'proof_required'
  | 'commit_outcome_uncertain' | 'target_missing' | 'target_ambiguous' | 'skill_inputs_required';

export interface BrowserTargetRef {
  id: string;
  kind: 'page' | 'element' | 'media';
  tabId: number;
  frameId: 0;
  urlOrigin: string;
  digest: string;
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
  | (CriterionBase & { kind: 'element_state'; operator: 'equals'; expected: 'visible' | 'hidden' | 'enabled' | 'disabled' })
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
  | { accepted: false; commandId: string; taskId: string; revision: number; error: 'not_found' | 'stale_revision' | 'invalid_transition' | 'invalid_input' };
type ExistingTaskCommand = { commandId: string; taskId: string; expectedRevision: number };
export type TaskCommand =
  | { type: 'start'; commandId: string; taskId: string; instruction: string; chatSessionId: string; instructionMessageId: string; tabId: number }
  | (ExistingTaskCommand & { type: 'follow_up'; instruction: string; chatSessionId: string; instructionMessageId: string })
  | (ExistingTaskCommand & { type: 'pause' | 'resume' | 'cancel' })
  | (ExistingTaskCommand & { type: 'approve' | 'reject'; roundId: string; approvalId: string })
  | (ExistingTaskCommand & { type: 'confirm_completion'; roundId: string; criterionId: string })
  | (ExistingTaskCommand & { type: 'save_skill'; roundId: string; title: string; instructionTemplate: string })
  | { type: 'run_skill'; commandId: string; taskId: string; skillId: number; values: Record<string, string>; tabId: number };

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
  | { type: 'task_completed_verified'; taskId: string; roundId: string; revision: number; receiptId: string; snapshot: TaskSnapshot };

export type CompletionCriterionDraft =
  | { kind: 'url'; operator: 'equals' | 'starts_with'; expected: string; required: boolean }
  | { kind: 'page_text'; operator: 'present' | 'absent'; expected: string; required: boolean }
  | { kind: 'element_state'; operator: 'equals'; expected: 'visible' | 'hidden' | 'enabled' | 'disabled'; required: boolean }
  | { kind: 'media_state'; operator: 'equals'; expected: 'playing' | 'paused'; required: boolean }
  | { kind: 'user_confirmed'; operator: 'equals'; expected: true; required: boolean };
export interface ProbeObservation {
  criterionId: string; roundId: string; targetRefId: string; observedAt: number;
  source: 'page' | 'user'; value: boolean | string;
}
export interface DispatchResult {
  actionResult: ActionResult;
  attempt: ActionAttempt;
  targetRef?: BrowserTargetRef;
  evidence: CompletionEvidence[];
}
export interface ExecutorInput { taskId: string; roundId: string; instruction: string; tabId: number }
export interface ExecutorHooks {
  onPlan(roundId: string, criteria: CompletionCriterionDraft[]): Promise<void>;
  dispatchAction(roundId: string, action: Action, rawArgs: unknown): Promise<DispatchResult>;
}
export interface ExecutorDriver {
  run(roundId: string): Promise<ExecutorOutcome>;
  addFollowUp(instruction: string): void;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
}
export type ExecutorOutcome =
  | { kind: 'candidate_complete'; summary: string }
  | { kind: 'waiting_user'; reason: WaitReason }
  | { kind: 'paused' } | { kind: 'cancelled' }
  | { kind: 'failed'; category: string };
```

One `TaskSession.revision` is authoritative. A new task starts at revision 1. Every accepted non-duplicate command is persisted with its ACK in the current round and increments the session revision exactly once; every later Executor/dispatcher transition that persists a new state also increments it once. A rejected stale/invalid command against an existing task is also persisted in the current round's `commandAcks`, but does not increment revision or perform an effect. `not_found` has no task in which to persist and deterministically returns revision 0. The ACK records the revision of the command decision, while snapshots expose the latest revision. A repeated `commandId` is looked up across all rounds and returns the stored ACK before checking `expectedRevision`, so a later revision cannot change the answer. Every other existing-task command must match the latest snapshot revision. State transitions are fixed:

| Command / event | Allowed from | Result |
|---|---|---|
| `start`, `run_skill` | no task with ID | `running` |
| `follow_up` | `running`, `paused`, `waiting_user`, `completed` | append round, `running` |
| `pause` | `running` | `paused` |
| `resume` | `paused`, `interrupted` | `running` |
| `cancel` | every non-terminal state | `cancelled` |
| `approve` | `waiting_approval` + matching pending approval | consume once, `running` |
| `reject` | `waiting_approval` + matching pending approval | `waiting_user/approval_rejected` |
| `confirm_completion` | matching `user_confirmed` criterion | recompute to `completed` or remain `waiting_user` |
| `save_skill` | `completed` + matching receipt | status unchanged |
| service-worker recovery | `running`, `paused`, `waiting_approval` | normal task: `interrupted`; Skill task: `inputs_required/skill_inputs_required`; cold `executing` attempt also becomes `uncertain` and `waiting_user` |

---

### Story 1: Remove raw replay and delete stored action histories

**What it delivers:** No UI, command, Executor, Navigator, setting, or stored key can replay old element indexes or form values.

**Files:**

- Modify: `projects/nanobrowser/packages/storage/lib/chat/types.ts:32-71`
- Modify: `projects/nanobrowser/packages/storage/lib/chat/history.ts:32-49,156-163,228-255`
- Modify: `projects/nanobrowser/packages/storage/lib/settings/generalSettings.ts:5-67`
- Modify: `projects/nanobrowser/pages/options/src/components/GeneralSettings.tsx:200-231`
- Modify: `projects/nanobrowser/pages/side-panel/src/SidePanel.tsx:24-44,78-93,400-531,552-644,1123-1182`
- Modify: `projects/nanobrowser/pages/side-panel/src/components/ChatInput.tsx:1-330`
- Modify: `projects/nanobrowser/chrome-extension/src/background/index.ts:1-31,235-259`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/executor.ts:24-27,224-235,368-440`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/agents/navigator.ts:28-39,461-627`
- Modify: `projects/nanobrowser/packages/i18n/locales/{en,pt_BR,zh_CN,zh_TW}/messages.json`
- Test: `projects/nanobrowser/chrome-extension/src/background/task/__tests__/replay-migration.test.ts`

- [x] **Step 1: Write the failing prefix-migration test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('legacy replay migration', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({
              chat_agent_step_a: { history: 'secret' },
              chat_agent_step_b: { history: 'secret' },
              chat_messages_a: [{ content: 'user-authored instruction' }],
            }),
            set: vi.fn(),
            remove: vi.fn(),
            onChanged: { addListener: vi.fn() },
          },
        },
      },
    });
  });

  it('removes only raw agent-step keys', async () => {
    const { removeLegacyAgentStepHistories } = await import('@extension/storage/lib/chat/history');
    await removeLegacyAgentStepHistories();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['chat_agent_step_a', 'chat_agent_step_b']);
  });

  it('contains no replay caller or raw action-argument logger', () => {
    const root = resolve(process.cwd(), 'src/background');
    const source = [
      'index.ts', 'agent/executor.ts', 'agent/agents/navigator.ts', 'agent/actions/builder.ts',
    ].map(file => readFileSync(resolve(root, file), 'utf8')).join('\n');
    expect(source).not.toMatch(/replayHistory|executeHistoryStep|JSON\.stringify\(actionArgs/);
    expect(source).not.toContain("logger.info('Actions'");
  });
});
```

- [x] **Step 2: Run the migration test and confirm the missing export**

Run: `pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/replay-migration.test.ts`

Expected: FAIL because `removeLegacyAgentStepHistories` is not exported.

- [x] **Step 3: Implement the native Chrome-storage cleanup**

Add this concrete function to `packages/storage/lib/chat/history.ts`; expose it through the existing chat barrel. Keep user chat keys untouched.

```ts
export async function removeLegacyAgentStepHistories(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith('chat_agent_step_'));
  if (keys.length > 0) await chrome.storage.local.remove(keys);
}
```

Call it once from background startup with logged failure but without blocking extension startup.

- [x] **Step 4: Delete the complete replay surface**

Delete `ChatAgentStepHistory`, `storeAgentStepHistory`, `loadAgentStepHistory`, Executor `replayHistory`, Navigator history parsing/execution, the background `replay` case, SidePanel replay command/state/handlers, ChatInput replay props/button, the general setting/toggle, and replay locale keys. Do not leave a disabled command or compatibility wrapper.

- [x] **Step 5: Remove raw action/history logging**

Delete Navigator `logger.info('Actions', actions)`, action-argument error serialization, Executor development history serialization, and all remaining action-history persistence branches. Replace value-bearing input/keyboard events and the Navigator error logger with these exact redacted forms:

```ts
const inputMessage = `Entered text into element ${input.index}`;
this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, inputMessage);
return new ActionResult({ extractedContent: inputMessage, includeInMemory: true });

const keyKind = /^enter$/i.test(input.keys) ? 'Enter' : 'keyboard input';
const keyMessage = `Sent ${keyKind}`;
this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, keyMessage);
return new ActionResult({ extractedContent: keyMessage, includeInMemory: true });

logger.error('doAction error', {
  actionName,
  category: error instanceof Error ? error.name : 'unknown_error',
});
```

The runtime event allowlist is `actionName`, `elementIndex`, `effect`, `state`, `errorCategory`, `targetDigest`, and timestamps. Never emit or persist `text`, `keys`, raw arguments, DOM text, page body, form values, or credentials.

- [x] **Step 6: Re-run checks and prove no caller remains**

Run:

```bash
pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/replay-migration.test.ts
rg -n "replayHistoricalTasks|replayHistory|executeHistoryStep|storeAgentStepHistory|loadAgentStepHistory|chat_agent_step_" projects/nanobrowser --glob '!pnpm-lock.yaml'
pnpm --dir projects/nanobrowser --filter chrome-extension type-check
pnpm --dir projects/nanobrowser --filter @extension/sidepanel type-check
pnpm --dir projects/nanobrowser --filter @extension/storage type-check
```

Expected: migration test PASS; `rg` returns only the migration prefix and its test; type checks PASS or reproduce only a separately recorded pre-existing error unchanged by this story.

- [x] **Step 7: Commit**

```bash
git add projects/nanobrowser
git commit -m "security: remove raw task replay"
```

---

### Story 2: Route one durable task through the side panel

**What it delivers:** Start, follow-up, pause, resume, cancel, reconnect, and interruption operate through one persisted task snapshot without changing browser action behavior yet.

**Files:**

- Create: `projects/nanobrowser/packages/storage/lib/task/types.ts`
- Create: `projects/nanobrowser/packages/storage/lib/task/runtime.ts`
- Create: `projects/nanobrowser/packages/storage/lib/task/index.ts`
- Create: `projects/nanobrowser/chrome-extension/src/background/task/contracts.ts`
- Modify: `projects/nanobrowser/packages/storage/lib/index.ts:1-8`
- Fill: `projects/nanobrowser/chrome-extension/src/background/task/manager.ts`
- Create: `projects/nanobrowser/chrome-extension/src/background/agent/factory.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/executor.ts:31-128,135-237,323-365`
- Modify: `projects/nanobrowser/chrome-extension/src/background/index.ts:1-31,91-163,274-383`
- Create: `projects/nanobrowser/pages/side-panel/src/components/TaskStatusCard.tsx`
- Modify: `projects/nanobrowser/pages/side-panel/src/SidePanel.tsx:24-188,298-398,552-670,1123-1188`
- Test: `projects/nanobrowser/chrome-extension/src/background/task/__tests__/manager.test.ts`

- [x] **Step 1: Write failing lifecycle/idempotency tests through the TaskManager interface**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../manager';
import type { ExecutorDriver, ExecutorOutcome } from '../contracts';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  saveTask: vi.fn(async (task: { id: string }) => { store.sessions.set(task.id, structuredClone(task)); }),
}));

vi.mock('@extension/storage/lib/task', () => ({
  getTask: async (id: string) => store.sessions.get(id) ?? null,
  getActiveTask: async () => [...store.sessions.values()].at(-1) ?? null,
  saveTask: store.saveTask,
}));

const fakeDriver = (): ExecutorDriver => ({
  run: vi.fn(() => new Promise<ExecutorOutcome>(() => {})),
  addFollowUp: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
});

describe('TaskManager lifecycle', () => {
  beforeEach(() => {
    store.sessions.clear();
    store.saveTask.mockClear();
  });

  it('persists one start and returns the original ack for a duplicate command', async () => {
    const createExecutor = vi.fn(async () => fakeDriver());
    const manager = new TaskManager({ createExecutor, switchTab: vi.fn(), observeCriteria: vi.fn(async () => []), now: () => 100 });
    const command = {
      type: 'start' as const,
      commandId: 'cmd-1',
      taskId: 'task-1',
      instruction: 'open the form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    };
    const first = await manager.dispatch(command);
    const duplicate = await manager.dispatch(command);
    expect(duplicate).toEqual(first);
    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
    expect(store.sessions.get('task-1')).toMatchObject({
      rounds: [{ commandAcks: { 'cmd-1': first } }],
    });
  });

  it('recovers stored running work as interrupted', async () => {
    store.sessions.set('task-1', {
      id: 'task-1', goalSummary: 'open form', status: 'running', revision: 1, activeTabId: 7,
      currentRoundId: 'round-1', targetRefs: [], createdAt: 1, updatedAt: 1,
      rounds: [{
        id: 'round-1', instructionSummary: 'open form', status: 'running', commandAcks: {},
        criteria: [], attempts: [], approvals: [], evidence: [],
      }],
    });
    const manager = new TaskManager({ createExecutor: async () => fakeDriver(), switchTab: vi.fn(), observeCriteria: vi.fn(async () => []), now: () => 100 });
    await manager.recover();
    await expect(manager.snapshot('task-1')).resolves.toMatchObject({ status: 'interrupted' });
  });

  it('applies revisioned pause, resume, follow-up, and cancel exactly once', async () => {
    const driver = fakeDriver();
    const manager = new TaskManager({ createExecutor: async () => driver, switchTab: vi.fn(), observeCriteria: vi.fn(async () => []), now: () => 100 });
    await manager.dispatch({
      type: 'start', commandId: 'start-1', taskId: 'task-2', instruction: 'open form',
      chatSessionId: 'chat-1', instructionMessageId: 'message-1', tabId: 7,
    });
    const stale = await manager.dispatch({
      type: 'pause', commandId: 'pause-stale', taskId: 'task-2', expectedRevision: 0,
    });
    expect(stale).toMatchObject({ accepted: false, error: 'stale_revision', revision: 1 });

    const pause = { type: 'pause' as const, commandId: 'pause-1', taskId: 'task-2', expectedRevision: 1 };
    const pauseAck = await manager.dispatch(pause);
    expect(await manager.dispatch(pause)).toEqual(pauseAck);
    expect(driver.pause).toHaveBeenCalledTimes(1);

    await manager.dispatch({ type: 'resume', commandId: 'resume-1', taskId: 'task-2', expectedRevision: 2 });
    await manager.dispatch({
      type: 'follow_up', commandId: 'follow-1', taskId: 'task-2', expectedRevision: 3,
      instruction: 'then pause it', chatSessionId: 'chat-1', instructionMessageId: 'message-2',
    });
    await manager.dispatch({ type: 'cancel', commandId: 'cancel-1', taskId: 'task-2', expectedRevision: 4 });
    expect(await manager.dispatch({
      type: 'pause', commandId: 'pause-stale', taskId: 'task-2', expectedRevision: 0,
    })).toEqual(stale);
    await expect(manager.snapshot('task-2')).resolves.toMatchObject({
      status: 'cancelled', revision: 5, currentRoundId: expect.any(String),
      rounds: [{ id: expect.any(String) }, { instructionMessageId: 'message-2' }],
    });
    expect(driver.resume).toHaveBeenCalledTimes(1);
    expect(driver.addFollowUp).toHaveBeenCalledWith('then pause it');
    expect(driver.stop).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Run the manager test and confirm the task module is absent**

Run: `pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/manager.test.ts`

Expected: FAIL because TaskManager and task storage types do not exist.

- [x] **Step 3: Add the persisted wire/state types**

Copy the persisted definitions from `TaskStatus` through `TaskEvent` in **Canonical contracts used by every story** exactly into `packages/storage/lib/task/types.ts`. Put `CompletionCriterionDraft` through `ExecutorOutcome` in `chrome-extension/src/background/task/contracts.ts`; Story 3/4 modules import/re-export their owned types from there instead of redefining them. Raw `instruction` and `run_skill.values` exist only on the in-memory command path, never `TaskSession`/`TaskRound`/events.

- [x] **Step 4: Add one concrete local task store**

Use `createStorage<Record<string, TaskSession>>('task-runtime-v1', {}, { storageEnum: StorageEnum.Local, liveUpdate: true })`. Export only `getTask`, `getActiveTask`, and `saveTask`; tests mock this concrete module. Do not add a repository interface; TaskManager is the only writer.

- [x] **Step 5: Implement the deep TaskManager and typed Executor seam**

The public interface is exactly; import the canonical `TaskCommand`, `CommandAck`, `TaskSnapshot`, `TaskEvent`, and `WaitReason` types from storage:

```ts
export class TaskManager {
  constructor(deps: {
    createExecutor: (input: ExecutorInput, hooks: ExecutorHooks) => Promise<ExecutorDriver>;
    switchTab: (tabId: number) => Promise<void>;
    observeCriteria: (criteria: CompletionCriterion[]) => Promise<ProbeObservation[]>;
    now: () => number;
  });
  dispatch(command: TaskCommand): Promise<CommandAck>;
  snapshot(taskId: string): Promise<TaskSnapshot | null>;
  activeSnapshot(): Promise<TaskSnapshot | null>;
  subscribe(listener: (event: TaskEvent) => void): () => void;
  interruptActive(): Promise<void>;
  recover(): Promise<void>;
}
```

Story 2 preserves current action behavior with this non-persisting compatibility hook; Story 3 replaces it with the only persisted dispatcher path:

```ts
private executorHooks(): ExecutorHooks {
  return {
    onPlan: async () => {},
    dispatchAction: async (action, rawArgs) => ({
      actionResult: await action.call(rawArgs),
      attempt: {
        id: crypto.randomUUID(), roundId: 'compatibility', actionName: action.name(),
        effect: 'read', argsDigest: 'not-persisted-in-story-2', state: 'observed', proposedAt: this.deps.now(),
      },
      evidence: [],
    }),
  };
}
```

Use one Promise chain for command transitions. ACK after validation and persistence; invoke `void runCurrentRound(taskId)` after ACK. Persist normal-task `goalSummary: 'User task'` and `instructionSummary: 'User instruction'`, never the raw string. Cold resume loads `chatHistory.getSession(task.chatSessionId)`, finds the user message by `instructionMessageId`, and passes that in memory to the new Executor; a missing message becomes `waiting_user/proof_required`. `candidate_complete` stays `waiting_user` until Story 4 provides evidence, so this slice cannot create false success.

- [x] **Step 6: Move current Executor construction into one function**

Move `setupExecutor` from `background/index.ts:283-359` to `background/agent/factory.ts` as `createExecutorDriver(input, hooks)`. Keep the existing MiniMax/default/firewall/settings logic unchanged. Add no factory class and no generic container.

- [x] **Step 7: Replace background command branches and bind the declared tab**

Keep heartbeat, screenshot, state, nohighlight, and speech-to-text. Replace legacy task message branches with:

```ts
case 'task_command':
  return port.postMessage({ type: 'command_ack', ack: await taskManager.dispatch(message.command) });
case 'get_active_task':
  return port.postMessage({ type: 'task_snapshot', snapshot: await taskManager.activeSnapshot() });
```

TaskManager start must call existing `browserContext.switchTab(command.tabId)` before Executor creation. On disconnect call `interruptActive()`, not cancel. On service-worker boot call `recover()`.

- [x] **Step 8: Render authoritative snapshots in the side panel**

Make `appendMessage` return the stored `ChatMessage` for user sends, then include its ID in start/follow-up commands. Generate `commandId` with `crypto.randomUUID()`. Send `get_active_task` after connect and render this authoritative component contract; do not infer task truth from `isFollowUpMode`:

```tsx
export interface TaskStatusCardProps {
  snapshot: TaskSnapshot;
  send(command: TaskCommand): void;
}
export function TaskStatusCard({ snapshot, send }: TaskStatusCardProps) {
  return <section data-testid="task-status" data-status={snapshot.status}>
    <span>{snapshot.status}</span>
    {snapshot.status === 'running' && <button onClick={() => send({ type: 'pause', commandId: crypto.randomUUID(), taskId: snapshot.id, expectedRevision: snapshot.revision })}>Pause</button>}
    {(snapshot.status === 'paused' || snapshot.status === 'interrupted') && <button onClick={() => send({ type: 'resume', commandId: crypto.randomUUID(), taskId: snapshot.id, expectedRevision: snapshot.revision })}>Resume</button>}
    {!['completed', 'failed', 'cancelled'].includes(snapshot.status) && <button onClick={() => send({ type: 'cancel', commandId: crypto.randomUUID(), taskId: snapshot.id, expectedRevision: snapshot.revision })}>Cancel</button>}
  </section>;
}
```

- [x] **Step 9: Run lifecycle, regression, and type checks**

Run:

```bash
pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/manager.test.ts src/background/browser/__tests__/context.test.ts
pnpm --dir projects/nanobrowser --filter chrome-extension type-check
pnpm --dir projects/nanobrowser --filter @extension/sidepanel type-check
pnpm --dir projects/nanobrowser --filter @extension/storage type-check
```

Expected: tests PASS; type checks PASS or only the recorded unchanged pre-existing failure remains.

- [x] **Step 10: Commit**

```bash
git add projects/nanobrowser
git commit -m "feat: add durable browser task lifecycle"
```

---

### Story 3: Gate consequential actions through one crash-safe dispatcher

**What it delivers:** Click and Enter submission paths stop for one-use approval; crash recovery never automatically repeats an unknown external commit.

**Files:**

- Create: `projects/nanobrowser/chrome-extension/src/background/task/action-dispatcher.ts`
- Create: `projects/nanobrowser/chrome-extension/src/background/task/digest.ts`
- Modify: `projects/nanobrowser/packages/storage/lib/task/types.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/task/manager.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/actions/builder.ts:44-127,152-330,568-579`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/agents/navigator.ts:41-91,158-220,366-459`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/executor.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/browser/page.ts:723-760,1285-1335`
- Modify: `projects/nanobrowser/pages/side-panel/src/components/TaskStatusCard.tsx`
- Test: `projects/nanobrowser/chrome-extension/src/background/task/__tests__/action-dispatcher.test.ts`
- Test: `projects/nanobrowser/chrome-extension/src/background/task/__tests__/commit-recovery.test.ts`

- [x] **Step 1: Write failing policy and bypass tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { Action } from '../../agent/actions/builder';
import { clickElementActionSchema } from '../../agent/actions/schemas';
import { ActionResult } from '../../agent/types';
import { ActionDispatcher, decideEffect } from '../action-dispatcher';

describe('EffectPolicy', () => {
  it.each([
    ['done', {}, 'allow'],
    ['search_google', {}, 'allow'],
    ['go_to_url', { url: 'https://example.com' }, 'allow'],
    ['go_back', {}, 'allow'],
    ['click_element', { tag: 'button', type: 'submit', inForm: true }, 'approval'],
    ['click_element', { tag: 'a', type: '', inForm: false }, 'allow'],
    ['send_keys', { activeTag: 'input', inForm: true, keys: 'Enter' }, 'approval'],
    ['send_keys', { activeTag: 'body', inForm: false, keys: 'PageDown' }, 'allow'],
    ['input_text', { tag: 'input', type: 'password' }, 'block'],
    ['input_text', { tag: 'input', type: 'text' }, 'allow'],
    ['switch_tab', {}, 'allow'], ['open_tab', {}, 'allow'], ['close_tab', {}, 'allow'],
    ['cache_content', {}, 'allow'], ['scroll_to_percent', {}, 'allow'],
    ['scroll_to_top', {}, 'allow'], ['scroll_to_bottom', {}, 'allow'],
    ['previous_page', {}, 'allow'], ['next_page', {}, 'allow'], ['scroll_to_text', {}, 'allow'],
    ['get_dropdown_options', {}, 'allow'], ['select_dropdown_option', {}, 'allow'],
    ['wait', {}, 'allow'], ['control_media', {}, 'allow'],
  ] as const)('%s resolves to %s', (actionName, target, expected) => {
    expect(decideEffect({ actionName, target, skillPolicy: 'default' }).kind).toBe(expected);
  });
});

it('does not invoke an external commit before approval and invokes it once after approval', async () => {
  let decide!: (value: 'approved' | 'rejected') => void;
  const approval = new Promise<'approved' | 'rejected'>(resolve => { decide = resolve; });
  const executeExternalCommit = vi.fn(async () => new ActionResult({ success: true }));
  const action = new Action(executeExternalCommit, clickElementActionSchema, true);
  const dispatcher = new ActionDispatcher({
    now: () => 100,
    persistAttempt: vi.fn(),
    requestApproval: vi.fn(async () => approval),
    observe: vi.fn(async (_request, _args, phase) => ({
      target: { id: 'target-1', kind: 'element', tabId: 7, frameId: 0, urlOrigin: 'https://example.test', digest: 'button-1' },
      effectTarget: { tag: 'button', type: 'submit', inForm: true },
      evidence: phase === 'after' ? [] : [],
    })),
  });
  const pending = dispatcher.dispatch({
    taskId: 'task-1', roundId: 'round-1', action,
    rawArgs: { intent: 'submit form', index: 4 },
  });
  await vi.waitFor(() => expect(executeExternalCommit).toHaveBeenCalledTimes(0));
  decide('approved');
  const result = await pending;
  expect(result.actionResult.success).toBe(true);
  expect(executeExternalCommit).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 2: Run the dispatcher tests and confirm the seam is absent**

Run: `pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/action-dispatcher.test.ts`

Expected: FAIL because ActionDispatcher/EffectPolicy do not exist.

- [x] **Step 3: Reuse Action validation, then execute parsed input**

Change `Action` without changing its schemas:

```ts
parse(input: unknown): unknown {
  const parsed = this.schema.schema.safeParse(input);
  if (!parsed.success) throw new InvalidInputError(parsed.error.message);
  return parsed.data;
}

executeParsed(input: unknown): Promise<ActionResult> {
  return this.handler(input);
}

call(input: unknown): Promise<ActionResult> {
  return this.executeParsed(this.parse(input));
}
```

Preserve the empty-schema behavior inside `parse`.

- [x] **Step 4: Implement the single ActionDispatcher and internal pure policy**

```ts
// digest.ts
export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// action-dispatcher.ts
export type EffectDecision =
  | { kind: 'allow'; effect: 'read' | 'reversible' }
  | { kind: 'approval'; effect: 'external_commit'; summary: string }
  | { kind: 'block'; reason: string };

export interface DispatchRequest {
  taskId: string;
  roundId: string;
  action: Action;
  rawArgs: unknown;
}

export interface TargetObservation {
  target?: BrowserTargetRef;
  effectTarget: { tag?: string; type?: string; role?: string; inForm?: boolean; activeTag?: string };
  evidence: CompletionEvidence[];
}
export interface ActionDispatcherDeps {
  now(): number;
  observe(request: DispatchRequest, parsedArgs: unknown, phase: 'before' | 'after'): Promise<TargetObservation>;
  persistAttempt(attempt: ActionAttempt): Promise<void>;
  requestApproval(attempt: ActionAttempt, summary: string): Promise<'approved' | 'rejected'>;
}

export class ActionDispatcher {
  constructor(deps: ActionDispatcherDeps);
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
  interrupt(): void;
}
```

Order is fixed: `action.parse(rawArgs)` → `observe(..., 'before')` → redacted `proposed` write → policy → `requestApproval` or direct continuation → `executing` write → `action.executeParsed(parsedArgs)` exactly once → `observe(..., 'after')` → `observed` write and `DispatchResult`. A rejection returns an `ActionResult` error without calling the handler. An exception after the `executing` write persists `uncertain` and rethrows. Use `crypto.subtle.digest('SHA-256', ...)` for argument/target digests. Keep parsed arguments and the live approved action only in memory.

TaskManager implements `requestApproval`: create a pending `ApprovalSummary`, persist task status `waiting_approval`, and return a Promise held only in memory. The `approve` command performs one atomic task-store write containing: original accepted ACK, `attempt.state='approved'`, `approval.status='consumed'`, and task/round status `running`; only after that write resolves may it resolve the live Promise. The dispatcher then persists `executing` before calling the handler. `reject` atomically persists its ACK, `approval.status='rejected'`, and `waiting_user/approval_rejected`, then resolves rejection. A duplicate approval command returns the stored ACK, and the already-consumed approval cannot resolve twice. On cold recovery, the reducer below performs no handler call:

```ts
export function recoverAttempt(attempt: ActionAttempt): ActionAttempt {
  if (attempt.state !== 'executing') return attempt;
  return { ...attempt, state: 'uncertain' };
}
```

- [x] **Step 5: Route every remaining Navigator action through the dispatcher**

Inject one dispatcher function into Navigator from Executor. Replace `actionInstance.call(actionArgs)` in `doMultiAction` with:

```ts
const dispatched = await this.context.dispatchAction(actionInstance, actionArgs);
const result = dispatched.actionResult;
results.push(result);
if (dispatched.attempt.state === 'blocked' || result.error) break;
```

On approval wait/block, stop the rest of the batch. Verify no live runtime caller invokes `Action.call()` outside the dispatcher compatibility method.

- [x] **Step 6: Add fixed target observation for click and Enter**

Add this fixed Page interface; it returns only tag/type/role/name digest, form membership, active element, URL origin, and tab ID:

```ts
export interface ActionTargetObservation {
  target: BrowserTargetRef;
  tag?: string;
  type?: string;
  role?: string;
  inForm: boolean;
  activeTag?: string;
  nameDigest?: string;
}
observeActionTarget(
  actionName: string,
  parsedArgs: unknown,
  phase: 'before' | 'after',
): Promise<ActionTargetObservation>;
```

`ActionDispatcherDeps.observe` delegates to this method. Block password/current-password targets. Treat unknown Enter and ambiguous button clicks as approval, not allow. Do not persist input text or raw page content.

- [x] **Step 7: Wire approval commands and UI**

TaskManager validates task/round/approval/revision, persists the one-use approval before resolving the live dispatcher promise, and emits a redacted snapshot. `TaskStatusCard` renders the pending approval with this exact command payload (the reject payload differs only by `type` and test id):

```tsx
<button data-testid="approval-approve" onClick={() => send({
  type: 'approve', commandId: crypto.randomUUID(), taskId: snapshot.id,
  expectedRevision: snapshot.revision, roundId: round.id, approvalId: approval.id,
})}>Approve {approval.summary}</button>
<button data-testid="approval-reject" onClick={() => send({
  type: 'reject', commandId: crypto.randomUUID(), taskId: snapshot.id,
  expectedRevision: snapshot.revision, roundId: round.id, approvalId: approval.id,
})}>Reject</button>
```

- [x] **Step 8: Add restart-injection tests at every commit boundary**

Add this reducer test to `commit-recovery.test.ts`, then seed the same attempts into the concrete task store and call the Story 2 `manager.recover()` once to assert the task containing `executing` becomes `waiting_user/commit_outcome_uncertain`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { recoverAttempt } from '../action-dispatcher';

describe('external commit recovery', () => {
  it.each([
    ['proposed', 'proposed'], ['approved', 'approved'], ['executing', 'uncertain'], ['observed', 'observed'],
  ] as const)('recovers %s without executing as %s', (before, after) => {
    const executeExternalCommit = vi.fn();
    const recovered = recoverAttempt({
      id: 'attempt-1', roundId: 'round-1', actionName: 'click_element',
      effect: 'external_commit', argsDigest: 'args-digest', state: before, proposedAt: 100,
    });
    expect(recovered.state).toBe(after);
    expect(executeExternalCommit).toHaveBeenCalledTimes(0);
  });
});
```

Only cold `executing` becomes `uncertain`; no cold state calls the effect. TaskManager maps `uncertain` to task/round status `waiting_user` and wait reason `commit_outcome_uncertain` in the same persistence transaction.

- [x] **Step 9: Run security and regression checks**

Run:

```bash
pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/action-dispatcher.test.ts src/background/task/__tests__/commit-recovery.test.ts src/background/services/guardrails/__tests__/guardrails.test.ts
rg -n "\.call\(actionArgs\)|JSON\.stringify\(actionArgs" projects/nanobrowser/chrome-extension/src/background
pnpm --dir projects/nanobrowser --filter chrome-extension type-check
```

Expected: tests PASS; `rg` returns no execution bypass or raw-arg log; type check PASS or only the recorded unrelated baseline error.

- [x] **Step 10: Commit**

```bash
git add projects/nanobrowser
git commit -m "feat: require crash-safe action approval"
```

---

### Story 4: Verify form completion with fresh evidence and receipts

**What it delivers:** A form task completes only after current-round, current-target, post-action evidence or a dedicated explicit user confirmation.

**Files:**

- Create: `projects/nanobrowser/chrome-extension/src/background/task/completion.ts`
- Modify: `projects/nanobrowser/packages/storage/lib/task/types.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/task/manager.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/agents/planner.ts:21-110`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/prompts/templates/planner.ts:3-84`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/prompts/templates/navigator.ts:62-69,121-124`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/executor.ts:116-190,239-320`
- Modify: `projects/nanobrowser/chrome-extension/src/background/browser/page.ts`
- Modify: `projects/nanobrowser/pages/side-panel/src/components/TaskStatusCard.tsx`
- Test: `projects/nanobrowser/chrome-extension/src/background/task/__tests__/completion.test.ts`
- Test: `projects/nanobrowser/chrome-extension/src/background/task/__tests__/form-journey.test.ts`

- [x] **Step 1: Write failing baseline, round, freshness, and confirmation tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { checkCompletion } from '../completion';

describe('CompletionChecker', () => {
  it('rejects evidence already true at baseline', () => {
    const result = checkCompletion({
      now: 200,
      currentRoundId: 'round-1',
      criteria: [{
        id: 'c1', kind: 'page_text', operator: 'present', expectedDigest: 'saved-digest', required: true,
        roundId: 'round-1', targetRefId: 'tab-1', baseline: true, frozenAt: 100,
        notBefore: 150, timeoutMs: 5000,
      }],
      observations: [{
        criterionId: 'c1', roundId: 'round-1', targetRefId: 'tab-1', observedAt: 200,
        source: 'page', value: true,
      }],
    });
    expect(result.passed).toBe(false);
    expect(result.evidence[0].reason).toBe('already_true_at_baseline');
  });

  it.each([
    ['old round', { roundId: 'round-0' }, {}, 'wrong_round'],
    ['wrong target', {}, { targetRefId: 'tab-2' }, 'wrong_target'],
    ['before commit', {}, { observedAt: 149 }, 'stale'],
    ['after timeout', {}, { observedAt: 5201 }, 'timed_out'],
    ['value mismatch', {}, { value: false }, 'mismatch'],
  ] as const)('rejects %s evidence', (_name, criterionPatch, observationPatch, reason) => {
    const criterion = {
      id: 'c1', kind: 'page_text' as const, operator: 'present' as const,
      expectedDigest: 'saved-digest', required: true, roundId: 'round-1', targetRefId: 'tab-1',
      baseline: false, frozenAt: 100, notBefore: 150, timeoutMs: 5000, ...criterionPatch,
    };
    const observation = {
      criterionId: 'c1', roundId: 'round-1', targetRefId: 'tab-1', observedAt: 200,
      source: 'page' as const, value: true, ...observationPatch,
    };
    const result = checkCompletion({ now: 5201, currentRoundId: 'round-1', criteria: [criterion], observations: [observation] });
    expect(result.passed).toBe(false);
    expect(result.evidence[0].reason).toBe(reason);
  });

  it('accepts only a dedicated user observation for user_confirmed', () => {
    const criterion = {
      id: 'confirm-1', kind: 'user_confirmed' as const, operator: 'equals' as const,
      expected: true as const, required: true, roundId: 'round-1', targetRefId: 'tab-1',
      baseline: false, frozenAt: 100, notBefore: 100, timeoutMs: 5000,
    };
    const result = checkCompletion({
      now: 200, currentRoundId: 'round-1', criteria: [criterion],
      observations: [{
        criterionId: 'confirm-1', roundId: 'round-1', targetRefId: 'tab-1',
        observedAt: 200, source: 'user', value: true,
      }],
    });
    expect(result.passed).toBe(true);
  });

  it('never completes an empty criterion set', () => {
    expect(checkCompletion({ now: 200, currentRoundId: 'round-1', criteria: [], observations: [] }))
      .toEqual({ passed: false, evidence: [] });
  });
});
```

- [x] **Step 2: Run completion tests and confirm the checker is absent**

Run: `pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/completion.test.ts`

Expected: FAIL because CompletionChecker does not exist.

- [x] **Step 3: Add Planner completion proposals and correct waiting-user prompts**

Extend `plannerOutputSchema` with this exact addition. Criteria describe observable success, never user field values; TaskManager hashes allowed `page_text.expected` before persistence. Login/CAPTCHA must set `done=false`.

```ts
import type { CompletionCriterionDraft } from '../../task/contracts';

const completionCriterionDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), operator: z.enum(['equals', 'starts_with']), expected: z.string().max(2048), required: z.boolean().default(true) }),
  z.object({ kind: z.literal('page_text'), operator: z.enum(['present', 'absent']), expected: z.string().max(160), required: z.boolean().default(true) }),
  z.object({ kind: z.literal('element_state'), operator: z.literal('equals'), expected: z.enum(['visible', 'hidden', 'enabled', 'disabled']), required: z.boolean().default(true) }),
  z.object({ kind: z.literal('media_state'), operator: z.literal('equals'), expected: z.enum(['playing', 'paused']), required: z.boolean().default(true) }),
  z.object({ kind: z.literal('user_confirmed'), operator: z.literal('equals'), expected: z.literal(true), required: z.boolean().default(true) }),
]) satisfies z.ZodType<CompletionCriterionDraft>;
const waitingUserSchema = z.object({
  reason: z.enum(['login_required', 'captcha_required']),
  message: z.string().max(160),
}).nullable().default(null);
export const plannerCompletionFields = {
  completion_criteria: z.array(completionCriterionDraftSchema).max(8).default([]),
  waiting_user: waitingUserSchema,
};
// Spread plannerCompletionFields into the existing planner output z.object shape.
```

- [x] **Step 4: Freeze criteria before the first relevant action**

Add `ExecutorHooks.onPlan(criteria: CompletionCriterionDraft[]): Promise<void>` immediately after Planner output and before Navigator execution. TaskManager assigns criterion IDs, round ID, target reference, baseline, `frozenAt`, `notBefore`, and a 10-second timeout. If a `page_text.expected` exactly matches any normalized user field value or exceeds 160 characters, replace it with `user_confirmed`; unsupported proof follows the same path.

- [x] **Step 5: Implement fixed Page observation probes and pure checking**

Page accepts a bounded array of probes and returns only booleans, normalized state, or SHA-256 digests. It never returns body text or raw input values. Add these exact runtime contracts to `completion.ts`:

```ts
export interface CompletionCheckInput {
  now: number;
  currentRoundId: string;
  criteria: CompletionCriterion[];
  observations: ProbeObservation[];
}
export interface CompletionCheckResult { passed: boolean; evidence: CompletionEvidence[] }
export function checkCompletion(input: CompletionCheckInput): CompletionCheckResult;
```

`passed` is false when `criteria.length === 0`. Otherwise it is true only when every required criterion has one matching current-round/current-target observation, `observedAt >= notBefore`, `observedAt <= frozenAt + timeoutMs`, the baseline did not already satisfy a positive criterion, and the operator matches. Optional failures remain evidence but do not block.

- [x] **Step 6: Replace Planner success with verified receipt creation**

`candidate_complete` runs this exact control flow; `driver.run()` is made re-entrant by resetting only its loop-local step counter, never Planner/Navigator memory:

```ts
let verificationRetries = 0;
for (;;) {
  const outcome = await driver.run();
  if (outcome.kind !== 'candidate_complete') return persistTerminalOrWaiting(outcome);
  if (round.criteria.length === 0) return persistWaitingUser(task, round, 'proof_required');
  const observations = await deps.observeCriteria(round.criteria);
  const checked = checkCompletion({
    now: deps.now(), currentRoundId: round.id, criteria: round.criteria, observations,
  });
  round.evidence.push(...checked.evidence);
  if (checked.passed) return persistVerifiedReceipt(task, round, checked.evidence);
  if (round.criteria.some(item => item.kind === 'user_confirmed')) {
    return persistWaitingUser(task, round, 'proof_required');
  }
  if (verificationRetries++ >= 1) return persistWaitingUser(task, round, 'proof_required');
  driver.addFollowUp('Completion was not verified; inspect the current page and continue.');
}
```

These are private TaskManager methods with fixed signatures: `persistTerminalOrWaiting(outcome: ExecutorOutcome): Promise<void>`, `persistWaitingUser(task: TaskSession, round: TaskRound, reason: WaitReason): Promise<void>`, and `persistVerifiedReceipt(task: TaskSession, round: TaskRound, evidence: CompletionEvidence[]): Promise<void>`. `persistVerifiedReceipt` is the only function that writes `completed` and emits `task_completed_verified`; Planner `done` never does.

- [x] **Step 7: Implement dedicated completion confirmation UI/command**

Only this button attached to a displayed `user_confirmed` criterion sends:

```ts
{
  type: 'confirm_completion',
  commandId: crypto.randomUUID(),
  taskId,
  roundId,
  criterionId,
  expectedRevision: snapshot.revision,
}
```

Render it with `data-testid="criterion-confirm"`. Ordinary follow-up text cannot confirm. Persist evidence source `user` before recomputing completion.

- [x] **Step 8: Add the deterministic form journey at the TaskManager seam**

Use a fake Executor whose first `run()` returns `candidate_complete` and a fake `observeCriteria` returning a fresh matching observation. The complete happy-path assertion is:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { CompletionCriterion } from '@extension/storage/lib/task';
import { TaskManager, type ExecutorDriver } from '../manager';

it('creates a receipt only from fresh current-round evidence', async () => {
  const driver: ExecutorDriver = {
    run: vi.fn().mockResolvedValue({ kind: 'candidate_complete', summary: 'submitted' }),
    addFollowUp: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
  };
  let observationCall = 0;
  const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) => {
    const value = observationCall++ > 0; // baseline false, post-submit true
    return criteria.map(item => ({
      criterionId: item.id, roundId: item.roundId, targetRefId: item.targetRefId,
      observedAt: 220, source: 'page' as const, value,
    }));
  });
  const manager = new TaskManager({
    createExecutor: async (_input, hooks) => {
      await hooks.onPlan([{ kind: 'page_text', operator: 'present', expected: 'Saved successfully', required: true }]);
      return driver;
    },
    switchTab: vi.fn(), observeCriteria, now: () => 220,
  });
  await manager.dispatch({
    type: 'start', commandId: 'start-form', taskId: 'task-form', tabId: 7,
    instruction: 'submit with FIELD_SENTINEL_8472', chatSessionId: 'chat-form', instructionMessageId: 'message-form',
  });
  await vi.waitFor(async () => {
    expect(await manager.snapshot('task-form')).toMatchObject({
      status: 'completed', rounds: [{ receipt: { taskId: 'task-form', criterionIds: [expect.any(String)] } }],
    });
  });
  expect(JSON.stringify(await manager.snapshot('task-form'))).not.toContain('FIELD_SENTINEL_8472');
});

it('accepts one idempotent dedicated confirmation command', async () => {
  const driver: ExecutorDriver = {
    run: vi.fn().mockResolvedValue({ kind: 'candidate_complete', summary: 'needs confirmation' }),
    addFollowUp: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
  };
  const manager = new TaskManager({
    createExecutor: async (_input, hooks) => {
      await hooks.onPlan([{ kind: 'user_confirmed', operator: 'equals', expected: true, required: true }]);
      return driver;
    },
    switchTab: vi.fn(), observeCriteria: vi.fn(async () => []), now: () => 300,
  });
  await manager.dispatch({
    type: 'start', commandId: 'start-confirm', taskId: 'task-confirm', tabId: 7,
    instruction: 'perform an outcome that needs my confirmation', chatSessionId: 'chat-confirm', instructionMessageId: 'message-confirm',
  });
  await vi.waitFor(async () => expect((await manager.snapshot('task-confirm'))?.status).toBe('waiting_user'));
  const waiting = await manager.snapshot('task-confirm');
  const round = waiting!.rounds.at(-1)!;
  const command = {
    type: 'confirm_completion' as const, commandId: 'confirm-1', taskId: 'task-confirm',
    expectedRevision: waiting!.revision, roundId: round.id, criterionId: round.criteria[0].id,
  };
  const first = await manager.dispatch(command);
  expect(await manager.dispatch(command)).toEqual(first);
  await expect(manager.snapshot('task-confirm')).resolves.toMatchObject({
    status: 'completed',
    rounds: [{ evidence: [expect.objectContaining({ source: 'user' })], receipt: expect.any(Object) }],
  });
});
```

The CompletionChecker table in Step 1 covers rejected, old-round, wrong-target, stale, timeout, baseline, and mismatch evidence; none may create a receipt because `persistVerifiedReceipt` is reachable only when `checked.passed` is true.

- [x] **Step 9: Run completion, form, guardrail, and type checks**

Run:

```bash
pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/completion.test.ts src/background/task/__tests__/form-journey.test.ts src/background/services/guardrails/__tests__/guardrails.test.ts
pnpm --dir projects/nanobrowser --filter chrome-extension type-check
pnpm --dir projects/nanobrowser --filter @extension/sidepanel type-check
```

Expected: all listed tests PASS; no false completion case passes.

- [x] **Step 10: Commit**

```bash
git add projects/nanobrowser
git commit -m "feat: verify browser task completion"
```

---

### Story 5: Keep controlling the same generic HTML media target

**What it delivers:** A task can play an HTML media element, accept “暂停这个视频” as a new round, bind the same target, pause it, and verify `paused=true` without Bilibili-specific code.

**Files:**

- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/actions/schemas.ts:1-216`
- Modify: `projects/nanobrowser/chrome-extension/src/background/agent/actions/builder.ts:1-30,143-707`
- Modify: `projects/nanobrowser/chrome-extension/src/background/browser/page.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/task/action-dispatcher.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/task/completion.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/task/manager.ts`
- Modify: `projects/nanobrowser/packages/storage/lib/task/types.ts`
- Test: `projects/nanobrowser/chrome-extension/src/background/task/__tests__/media-journey.test.ts`

- [x] **Step 1: Write the failing continuous-control journey**

```ts
import { describe, expect, it, vi } from 'vitest';
import { Action } from '../../agent/actions/builder';
import { controlMediaActionSchema } from '../../agent/actions/schemas';
import { ActionResult } from '../../agent/types';
import { ActionDispatcher } from '../action-dispatcher';

describe('continuous media control', () => {
  it('binds pause to the last played media target', async () => {
    let state: 'playing' | 'paused' = 'paused';
    const page = {
      observeMedia: vi.fn(async () => ({ kind: 'bound' as const, targetDigest: 'media-1', state })),
      controlMedia: vi.fn(async (command: 'play' | 'pause', digest?: string) => {
        expect(digest === undefined || digest === 'media-1').toBe(true);
        state = command === 'play' ? 'playing' : 'paused';
        return { kind: 'bound' as const, targetDigest: 'media-1', state };
      }),
    };
    const action = new Action(async args => {
      await page.controlMedia(args.command, args.target_digest);
      return new ActionResult({ success: true });
    }, controlMediaActionSchema);
    const dispatcher = new ActionDispatcher({
      now: () => 100,
      persistAttempt: vi.fn(),
      requestApproval: vi.fn(async () => 'approved' as const),
      observe: vi.fn(async (request, _args, phase) => {
        const observed = await page.observeMedia();
        return {
          target: { id: 'media-target', kind: 'media', tabId: 7, frameId: 0, urlOrigin: 'https://example.test', digest: observed.targetDigest },
          effectTarget: { tag: 'video' },
          evidence: phase === 'after' ? [{
            criterionId: `criterion-${request.roundId}`, roundId: request.roundId,
            targetRefId: 'media-target', observedAt: 100, source: 'page' as const,
            value: observed.state, passed: true,
          }] : [],
        };
      }),
    });
    const played = await dispatcher.dispatch({
      taskId: 'task-1', roundId: 'round-1', action,
      rawArgs: { intent: 'play selected media', command: 'play' },
    });
    const paused = await dispatcher.dispatch({
      taskId: 'task-1', roundId: 'round-2', action,
      rawArgs: { intent: 'pause the same media', command: 'pause', target_digest: played.targetRef?.digest },
    });
    expect(page.controlMedia).toHaveBeenCalledWith('pause', 'media-1');
    expect(paused).toMatchObject({
      targetRef: { digest: 'media-1' },
      evidence: [{ value: 'paused', roundId: 'round-2' }],
    });
  });
});
```

- [x] **Step 2: Run the media test and confirm the action/page methods are absent**

Run: `pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/media-journey.test.ts`

Expected: FAIL because `control_media`, `observeMedia`, and `controlMedia` do not exist.

- [x] **Step 3: Add the site-neutral media action through the normal dispatcher**

```ts
export const controlMediaActionSchema: ActionSchema = {
  name: 'control_media',
  description: 'Play or pause the currently bound visible HTML audio/video element',
  schema: z.object({
    intent: z.string().default(''),
    command: z.enum(['play', 'pause']),
    target_digest: z.string().optional(),
  }),
};
```

The builder handler is exact:

```ts
const result = await page.controlMedia(input.command, input.target_digest);
if (result.kind !== 'bound') {
  return new ActionResult({ error: result.kind === 'ambiguous' ? 'media_target_ambiguous' : 'media_target_missing' });
}
return new ActionResult({ success: true, extractedContent: `Media ${input.command} requested` });
```

The dispatcher classifies it reversible and records only action name, effect, tab, state, and target digest.

- [x] **Step 4: Add fixed media selection/observation to Page**

Add this exact Page surface:

```ts
export type MediaBindingResult =
  | { kind: 'bound'; targetDigest: string; state: 'playing' | 'paused' }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; candidateCount: number };
observeMedia(targetDigest?: string): Promise<MediaBindingResult>;
controlMedia(command: 'play' | 'pause', targetDigest?: string): Promise<MediaBindingResult>;
```

Use trusted Puppeteer evaluation over same-origin main-frame `audio,video` only; cross-origin frames are excluded in cycle 1. Candidate order is: exact digest, then the only currently playing visible item, then the only largest-visible-area item. Digest `tagName|currentSrc origin+pathname|duration rounded to seconds|DOM sibling ordinal` with SHA-256; never include query strings, titles, or page text. Zero candidates or a rejected `HTMLMediaElement.play()` returns `missing`; any tie returns `ambiguous`; never fake `playing`.

- [x] **Step 5: Preserve/rebind the target across a new round**

After play, append the returned `BrowserTargetRef` with `kind: 'media'`. Before dispatcher parsing, the TaskManager hook applies this pure resolver:

```ts
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
  return previous
    ? { kind: 'ready', args: { ...rawArgs, target_digest: previous.digest } }
    : { kind: 'waiting_user', reason: 'target_missing' };
}
```

`ExecutorHooks.dispatchAction` uses `ready.args`; on `waiting_user` it persists task/round `waiting_user/target_missing` and returns a blocked `DispatchResult` without calling the Action. If Page returns `ambiguous`, map it to `waiting_user/target_ambiguous`; do not choose silently or create a site-specific selector. Add this assertion to the media test:

```ts
const rebound = resolveMediaArgs('control_media', { command: 'pause' }, {
  targetRefs: [{
    id: 'media-target', kind: 'media', tabId: 7, frameId: 0,
    urlOrigin: 'https://example.test', digest: 'media-1',
  }],
} as TaskSession);
expect(rebound).toMatchObject({ kind: 'ready', args: { target_digest: 'media-1' } });
```

- [x] **Step 6: Verify media completion through CompletionChecker**

`media_state` evidence must match the current round, stored target digest, post-command `notBefore`, and expected `playing|paused`. A Planner statement or click result alone cannot complete the round.

- [x] **Step 7: Run media, action, and browser regressions**

Run:

```bash
pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/media-journey.test.ts src/background/task/__tests__/action-dispatcher.test.ts src/background/browser/__tests__/context.test.ts
pnpm --dir projects/nanobrowser --filter chrome-extension type-check
```

Expected: listed tests PASS; no `bilibili`, `b23`, or site selector appears in new runtime code.

- [x] **Step 8: Commit**

```bash
git add projects/nanobrowser
git commit -m "feat: add continuous html media control"
```

---

### Story 6: Save and rerun a verified task as a local semantic Skill

**What it delivers:** A completed task can become a parameterized local Skill, collect only declared inputs, and replan on the current DOM without storing resolved values.

**Files:**

- Modify: `projects/nanobrowser/packages/storage/lib/prompt/favorites.ts:1-208`
- Modify: `projects/nanobrowser/packages/storage/lib/task/types.ts`
- Modify: `projects/nanobrowser/chrome-extension/src/background/task/manager.ts`
- Modify: `projects/nanobrowser/pages/side-panel/src/components/BookmarkList.tsx:1-199`
- Modify: `projects/nanobrowser/pages/side-panel/src/components/TaskStatusCard.tsx`
- Modify: `projects/nanobrowser/pages/side-panel/src/SidePanel.tsx:731-810,1123-1188`
- Modify: `projects/nanobrowser/packages/i18n/locales/{en,pt_BR,zh_CN,zh_TW}/messages.json`
- Test: `projects/nanobrowser/chrome-extension/src/background/task/__tests__/skill-journey.test.ts`

- [x] **Step 1: Write failing template and value-retention tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  compileSkillTemplate,
  createSkillDefinition,
  parseSkillInputs,
} from '@extension/storage/lib/prompt/favorites';

describe('local semantic Skill', () => {
  it('derives inputs from placeholders and renders in memory', () => {
    const template = 'Fill {{name}} into the form at {{url}}';
    expect(parseSkillInputs(template).map(input => input.name)).toEqual(['name', 'url']);
    expect(compileSkillTemplate(template, { name: 'Ada', url: 'https://example.test' }))
      .toBe('Fill Ada into the form at https://example.test');
  });

  it('never places resolved values in the stored Skill definition', () => {
    const skill = createSkillDefinition({
      title: 'Fill form',
      instructionTemplate: 'Fill {{name}} into the form at {{url}}',
      criteria: [{ kind: 'page_text', operator: 'present', expectedTemplate: 'Saved successfully', required: true }],
      sourceTaskId: 'task-1',
    });
    const rendered = compileSkillTemplate(skill.instructionTemplate, {
      name: 'Ada', url: 'https://example.test',
    });
    expect(rendered).toContain('Ada');
    expect(JSON.stringify(skill)).not.toContain('Ada');
  });
});
```

- [x] **Step 2: Run the Skill test and confirm the union/helpers are absent**

Run: `pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/skill-journey.test.ts`

Expected: FAIL because Skill storage/template helpers do not exist.

- [x] **Step 3: Extend favorites in place with a backward-compatible union**

```ts
export interface SkillInput { name: string; label: string; required: true }
export type CompletionCriterionTemplate =
  | { kind: 'url'; operator: 'equals' | 'starts_with'; expectedTemplate: string; required: boolean }
  | { kind: 'page_text'; operator: 'present' | 'absent'; expectedTemplate: string; required: boolean }
  | { kind: 'element_state'; operator: 'equals'; expected: 'visible' | 'hidden' | 'enabled' | 'disabled'; required: boolean }
  | { kind: 'media_state'; operator: 'equals'; expected: 'playing' | 'paused'; required: boolean }
  | { kind: 'user_confirmed'; operator: 'equals'; expected: true; required: boolean };

export type FavoriteItem =
  | { kind?: 'prompt'; id: number; title: string; content: string }
  | {
      kind: 'skill'; id: number; title: string; instructionTemplate: string;
      inputs: SkillInput[]; criteria: CompletionCriterionTemplate[];
      approvalPolicy: 'default' | 'always_confirm_commits'; sourceTaskId: string; version: 1;
    };
export type FavoritePrompt = Extract<FavoriteItem, { kind?: 'prompt' }>;
export interface FavoritesStorage { nextId: number; prompts: FavoriteItem[] }

export function parseSkillInputs(template: string): SkillInput[];
export function compileSkillTemplate(template: string, values: Record<string, string>): string;
export function assertExactSkillInputs(inputs: SkillInput[], values: Record<string, string>): void;
export type NewSkillDefinition = Omit<Extract<FavoriteItem, { kind: 'skill' }>, 'id'>;
export function createSkillDefinition(input: {
  title: string; instructionTemplate: string;
  criteria: CompletionCriterionTemplate[]; sourceTaskId: string;
}): NewSkillDefinition;

// Add to the existing FavoritePromptsStorage interface and implementation:
addSkill(skill: NewSkillDefinition): Promise<Extract<FavoriteItem, { kind: 'skill' }>>;
getSkill(id: number): Promise<Extract<FavoriteItem, { kind: 'skill' }> | undefined>;
```

Stored entries without `kind` remain prompt favorites. Placeholder names must match `/^[a-z][a-z0-9_]{0,31}$/`; duplicate placeholders collapse; missing/extra inputs fail before start. No secret input type exists in cycle 1.

- [x] **Step 4: Allow save only from a verified receipt**

TaskManager accepts `save_skill` only when the current round is completed with a receipt. It calls `createSkillDefinition`, then `favoritesStorage.addSkill()` with the returned union member. Reject when the template contains `/\b(password|token|secret|credential)\b/i`, a numeric DOM index token like `[12]`, any placeholder not matching `/^[a-z][a-z0-9_]{0,31}$/`, or a criterion copied from a field value.

Completion templates may not contain `{{...}}`; cycle 1 Skills reuse only static success proof, so resolved input values can never enter stored criteria. `TaskManager.freezeSkillCriteria(templates, taskId, roundId, tabId): Promise<CompletionCriterion[]>` assigns IDs/target/freshness, hashes static `page_text` expectations, and records a baseline through `observeCriteria` before Executor creation. For Skill runs, `executorHooks(taskId, { criteriaLocked: true })` ignores Planner replacement criteria and keeps these saved required criteria authoritative.

```ts
private async freezeSkillCriteria(
  templates: CompletionCriterionTemplate[], _taskId: string, roundId: string, tabId: number,
): Promise<CompletionCriterion[]> {
  if (templates.some(template => JSON.stringify(template).includes('{{'))) throw new Error('invalid_skill_criterion');
  const frozenAt = this.deps.now();
  const targetRefId = `tab:${tabId}`;
  const withoutBaseline = await Promise.all(templates.map(async template => ({
    ...template,
    id: crypto.randomUUID(), roundId, targetRefId, frozenAt,
    notBefore: frozenAt, timeoutMs: 10_000, baseline: false,
    ...(template.kind === 'page_text'
      ? { expectedDigest: await sha256(template.expectedTemplate), expectedTemplate: undefined }
      : template.kind === 'url'
        ? { expected: template.expectedTemplate, expectedTemplate: undefined }
        : {}),
  } as CompletionCriterion)));
  const baseline = await this.deps.observeCriteria(withoutBaseline);
  return withoutBaseline.map(criterion => ({
    ...criterion,
    baseline: baseline.find(item => item.criterionId === criterion.id)?.value ?? false,
  }));
}
```

Import `sha256` from `chrome-extension/src/background/task/digest.ts`; do not add another digest implementation.

- [x] **Step 5: Add Save/Run/Edit/Delete UI to the existing favorites surface**

`TaskStatusCard` exposes `data-testid="skill-save"` only when `round.receipt` exists. The save form binds `data-testid="skill-template"` to `instructionTemplate` and sends canonical `save_skill` through `data-testid="skill-save-confirm"`. `BookmarkList` keeps prompt behavior and renders Skills with this discriminated branch:

```tsx
{item.kind === 'skill' ? <>
  <button data-testid="skill-run" onClick={() => setRunningSkill(item)}>Run Skill</button>
  {item.inputs.map(input => <input
    key={input.name} data-testid={`skill-input-${input.name}`}
    value={skillValues[input.name] ?? ''}
    onChange={event => setSkillValues(values => ({ ...values, [input.name]: event.target.value }))}
  />)}
  <button data-testid="skill-run-confirm" onClick={() => send({
    type: 'run_skill', commandId: crypto.randomUUID(), taskId: crypto.randomUUID(),
    skillId: item.id, values: skillValues, tabId: activeTabId,
  })}>Run</button>
</> : <button onClick={() => onBookmarkSelect(item.content)}>{item.title}</button>}
```

Edit/delete/reorder dispatch to the extended favorites store and never render or cache resolved values after the run command is sent.

- [x] **Step 6: Run Skills with values only in memory**

`run_skill` follows this exact sequence:

```ts
const skill = await favoritesStorage.getSkill(command.skillId);
if (!skill) return {
  accepted: false, commandId: command.commandId, taskId: command.taskId,
  revision: 0, error: 'not_found',
};
try {
  assertExactSkillInputs(skill.inputs, command.values);
} catch {
  return {
    accepted: false, commandId: command.commandId, taskId: command.taskId,
    revision: 0, error: 'invalid_input',
  };
}
let renderedInstruction = compileSkillTemplate(skill.instructionTemplate, command.values);
const roundId = crypto.randomUUID();
const ack: CommandAck = { accepted: true, commandId: command.commandId, taskId: command.taskId, revision: 1 };
const criteria = await this.freezeSkillCriteria(skill.criteria, command.taskId, roundId, command.tabId);
const task: TaskSession = {
  id: command.taskId, goalSummary: `Run Skill: ${skill.title}`, sourceSkillId: skill.id,
  status: 'running', revision: 1, activeTabId: command.tabId, currentRoundId: roundId,
  targetRefs: [], createdAt: this.deps.now(), updatedAt: this.deps.now(),
  rounds: [{
    id: roundId, instructionSummary: `Run Skill: ${skill.title}`, status: 'running',
    commandAcks: { [command.commandId]: ack }, criteria, attempts: [], approvals: [], evidence: [],
  }],
};
await saveTask(task);
await this.deps.switchTab(command.tabId);
const driver = await this.deps.createExecutor({
  taskId: task.id, roundId, instruction: renderedInstruction, tabId: command.tabId,
}, this.executorHooks(task.id, { criteriaLocked: true }));
renderedInstruction = '';
this.liveExecutors.set(task.id, driver);
void this.runCurrentRound(task.id, driver);
return ack;
```

`assertExactSkillInputs(inputs, values)` is a pure exported helper in `favorites.ts`; it rejects missing/extra names and values over 2,000 characters before task creation. `TaskManager.executorHooks(taskId, options?: { criteriaLocked?: boolean }): ExecutorHooks` returns the Story 3 dispatcher/Story 4 plan hooks; `TaskManager.runCurrentRound(taskId, driver): Promise<void>` is the verified loop defined in Story 4; `liveExecutors` is `Map<string, ExecutorDriver>`. Neither the rendered instruction nor `command.values` is passed to `saveTask`, events, logs, receipts, analytics, or chat. On cold recovery, `sourceSkillId` plus a non-terminal state becomes `inputs_required/skill_inputs_required`; the side panel collects every value again and sends a new `run_skill` task ID.

- [x] **Step 7: Add changed-DOM-order journey coverage**

Write this complete test in `skill-journey.test.ts`; the fake Executor resolves the field by current label on each run, so a stored DOM index cannot make it pass:

```ts
import favoritesStorage from '@extension/storage/lib/prompt/favorites';
import { TaskManager, type ExecutorDriver, type ExecutorHooks, type ExecutorInput } from '../manager';

it('replans a Skill when DOM indexes change and retains no resolved value', async () => {
  const storedSkill = await favoritesStorage.addSkill({
    kind: 'skill', title: 'Fill form', instructionTemplate: 'Fill {{name}} at {{url}}',
    inputs: [{ name: 'name', label: 'name', required: true }, { name: 'url', label: 'url', required: true }],
    criteria: [{ kind: 'page_text', operator: 'present', expectedTemplate: 'Saved successfully', required: true }],
    approvalPolicy: 'default', sourceTaskId: 'source-task', version: 1,
  });
  const pages = [new Map([['Name', 2], ['Submit', 5]]), new Map([['Submit', 1], ['Name', 9]])];
  const usedIndexes: number[] = [];
  let pageRun = 0;
  let observationCall = 0;
  const createExecutor = vi.fn(async (input: ExecutorInput, hooks: ExecutorHooks): Promise<ExecutorDriver> => {
    const page = pages[pageRun++];
    await hooks.onPlan([{ kind: 'page_text', operator: 'present', expected: 'Saved successfully', required: true }]);
    return {
      run: vi.fn(async () => {
        expect(input.instruction).toContain(pageRun === 1 ? 'Ada' : 'Grace');
        usedIndexes.push(page.get('Name')!);
        return { kind: 'candidate_complete', summary: 'saved' };
      }),
      addFollowUp: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
    };
  });
  const manager = new TaskManager({
    createExecutor, switchTab: vi.fn(), now: () => 300,
    observeCriteria: vi.fn(async criteria => {
      const value = observationCall++ % 2 === 1; // baseline false, post-action true, per run
      return criteria.map(item => ({
        criterionId: item.id, roundId: item.roundId, targetRefId: item.targetRefId,
        observedAt: 300, source: 'page' as const, value,
      }));
    }),
  });
  for (const [taskId, name] of [['skill-run-1', 'Ada'], ['skill-run-2', 'Grace']] as const) {
    await manager.dispatch({
      type: 'run_skill', commandId: `command-${taskId}`, taskId, skillId: storedSkill.id,
      values: { name, url: 'https://example.test' }, tabId: 7,
    });
    await vi.waitFor(async () => expect((await manager.snapshot(taskId))?.status).toBe('completed'));
    expect(JSON.stringify(await manager.snapshot(taskId))).not.toContain(name);
  }
  expect(usedIndexes).toEqual([2, 9]);
});
```

- [x] **Step 8: Run Skill, form, privacy, and type checks**

Run:

```bash
pnpm --dir projects/nanobrowser --filter chrome-extension test -- src/background/task/__tests__/skill-journey.test.ts src/background/task/__tests__/form-journey.test.ts src/background/task/__tests__/replay-migration.test.ts
pnpm --dir projects/nanobrowser --filter @extension/storage type-check
pnpm --dir projects/nanobrowser --filter @extension/sidepanel type-check
```

Expected: tests and type checks PASS; sentinel values are absent from persisted/runtime-generated artifacts.

- [x] **Step 9: Commit**

```bash
git add projects/nanobrowser
git commit -m "feat: save verified tasks as local skills"
```

---

### Story 7: Prove the real unpacked extension and publish acceptance evidence

**What it delivers:** Real Chrome exercises side panel → background → page → approval/evidence/receipt for local fixtures, then records fixed-protocol Feishu and Bilibili results.

**Files:**

- Create: `projects/nanobrowser/chrome-extension/test/fixtures/form.html`
- Create: `projects/nanobrowser/chrome-extension/test/fixtures/media.html`
- Create: `projects/nanobrowser/chrome-extension/scripts/action-agent-e2e.mjs`
- Modify: `projects/nanobrowser/chrome-extension/package.json:6-16`
- Modify: `projects/nanobrowser/package.json:11-28`
- Modify: `projects/nanobrowser/pages/side-panel/src/components/TaskStatusCard.tsx`
- Modify: `projects/nanobrowser/pages/side-panel/src/SidePanel.tsx`
- Create: `reports/nanobrowser/action-agent-cycle-1.md`
- Modify: `docs/design/001-browser-action-task-runtime.md:1-16,365-405`

- [ ] **Step 1: Write the failing unpacked-extension runner**

Create `scripts/action-agent-e2e.mjs` first. It uses Node built-ins plus installed `puppeteer-core`; the first run must fail on missing fixture files or missing `data-testid` selectors, proving the acceptance path is active. Use this exact launch/server/tab orchestration and helper surface:

```js
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const extensionPath = path.resolve(__dirname, '../../dist');
const profilePath = path.join(os.tmpdir(), `scion-action-e2e-${process.pid}`);
const runs = Number(process.env.RUNS || 1);
const timeout = 60_000;
let submissions = 0;
let browser;

function silentWav() {
  const dataBytes = 8000;
  const out = Buffer.alloc(44 + dataBytes);
  out.write('RIFF', 0); out.writeUInt32LE(36 + dataBytes, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24); out.writeUInt32LE(8000, 28); out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34); out.write('data', 36); out.writeUInt32LE(dataBytes, 40); out.fill(128, 44);
  return out;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname === '/submit') {
    submissions += 1; response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname === '/count') return response.end(String(submissions));
  if (url.pathname === '/audio.wav') {
    response.writeHead(200, { 'content-type': 'audio/wav' }); return response.end(silentWav());
  }
  const fixture = url.pathname === '/media' ? 'media.html' : 'form.html';
  const html = await readFile(path.resolve(__dirname, '../test/fixtures', fixture));
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function waitForTestId(page, testId) {
  return page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
}
async function setValue(page, testId, value) {
  const input = await waitForTestId(page, testId);
  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await input.type(value);
}
async function click(page, testId) {
  await page.$eval(`[data-testid="${testId}"]`, element => element.click());
}
async function waitStatus(panel, status) {
  await panel.waitForSelector(`[data-testid="task-status"][data-status="${status}"]`, { timeout });
}
async function openPanelForTarget(extensionId, target) {
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`);
  await target.bringToFront();
  await panel.reload({ waitUntil: 'domcontentloaded' }); // panel stays background; active tab remains target
  await waitForTestId(panel, 'goal-input');
  return panel;
}
async function sendGoal(panel, instruction) {
  await setValue(panel, 'goal-input', instruction); await click(panel, 'goal-send');
}
async function seedMiniMax(panel) {
  const apiKey = process.env.MINIMAX_API_KEY;
  assert(apiKey, 'MINIMAX_API_KEY is required');
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
  const baseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
  await panel.evaluate(async ({ apiKey, model, baseUrl }) => chrome.storage.local.set({
    'llm-api-keys': { providers: { minimax: { name: 'MiniMax', type: 'custom_openai', apiKey, baseUrl, modelNames: [model], createdAt: Date.now() } } },
    'agent-models': { agents: {
      planner: { provider: 'minimax', modelName: model, parameters: { temperature: 0.1, topP: 0.1 } },
      navigator: { provider: 'minimax', modelName: model, parameters: { temperature: 0.1, topP: 0.1 } },
    } },
  }), { apiKey, model, baseUrl });
}

try {
  browser = await puppeteer.launch({
    executablePath: chromePath, headless: false, userDataDir: profilePath,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--no-first-run', '--disable-default-apps'],
  });
  const worker = await browser.waitForTarget(
    target => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
    { timeout },
  );
  const extensionId = new URL(worker.url()).host;
  for (let run = 0; run < runs; run += 1) await runAllScenarios(extensionId, run);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profilePath, { recursive: true, force: true });
}
```

`openPanelForTarget` is mandatory: the fixture page is brought to front before panel reload, so SidePanel captures the fixture `tabId` while Puppeteer can still drive the background panel page.

- [ ] **Step 2: Run once and verify the runner fails before fixtures/selectors exist**

Run: `pnpm --dir projects/nanobrowser build && MINIMAX_API_KEY="$MINIMAX_API_KEY" RUNS=1 node projects/nanobrowser/chrome-extension/scripts/action-agent-e2e.mjs`

Expected: FAIL with `ENOENT .../test/fixtures/form.html` or timeout for `[data-testid="goal-input"]`; it must not report a passing scenario.

- [ ] **Step 3: Add fixtures, selectors, and the four scenario functions**

Add `data-testid` values `goal-input`, `goal-send`, `task-status` plus `data-status`, `approval-approve`, `approval-reject`, `criterion-confirm`, `completion-receipt`, `skill-save`, `skill-template`, `skill-save-confirm`, `skill-run`, `skill-input-<name>`, and `skill-run-confirm`. `TaskStatusCard` renders `data-status={snapshot.status}` from the authoritative snapshot.

Create these fixture bodies:

```html
<!-- test/fixtures/form.html -->
<!doctype html><html><body><form id="fixture-form">
  <label id="name-label">Name <input id="name" name="name" autocomplete="off"></label>
  <button id="submit" type="submit">Submit</button>
</form><script>
  const form = document.querySelector('#fixture-form');
  if (new URLSearchParams(location.search).get('order') === 'reversed') form.prepend(document.querySelector('#submit'));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const response = await fetch('/submit', { method: 'POST' });
    if (response.ok) form.outerHTML = '<p id="saved">Saved successfully</p>';
  });
</script></body></html>
```

```html
<!-- test/fixtures/media.html -->
<!doctype html><html><body>
  <label for="fixture-audio">Fixture audio</label>
  <audio id="fixture-audio" controls muted src="/audio.wav"></audio>
</body></html>
```

Append these complete scenario functions to the runner:

```js
async function runAllScenarios(extensionId, run) {
  submissions = 0;
  const target = await browser.newPage();
  await target.goto(`${origin}/form?run=${run}`);
  let panel = await openPanelForTarget(extensionId, target);
  await seedMiniMax(panel);
  await sendGoal(panel, 'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.');
  await waitForTestId(panel, 'approval-approve');
  assert.equal(Number(await (await fetch(`${origin}/count`)).text()), 0);
  await click(panel, 'approval-approve');
  await waitStatus(panel, 'completed');
  await waitForTestId(panel, 'completion-receipt');
  assert.equal(Number(await (await fetch(`${origin}/count`)).text()), 1);

  const beforeReconnect = await panel.$eval('[data-testid="completion-receipt"]', element => element.textContent);
  await panel.close();
  panel = await openPanelForTarget(extensionId, target);
  await waitStatus(panel, 'completed');
  assert.equal(await panel.$eval('[data-testid="completion-receipt"]', element => element.textContent), beforeReconnect);

  await click(panel, 'skill-save');
  await setValue(panel, 'skill-template', 'Fill Name with {{name}} and submit; success is Saved successfully.');
  await click(panel, 'skill-save-confirm');
  await target.goto(`${origin}/form?order=reversed&run=${run}`);
  await target.bringToFront(); await panel.reload({ waitUntil: 'domcontentloaded' });
  await click(panel, 'skill-run');
  await setValue(panel, 'skill-input-name', 'FIELD_SENTINEL_CHANGED_9521');
  await click(panel, 'skill-run-confirm');
  await waitStatus(panel, 'completed');
  await waitForTestId(panel, 'completion-receipt');
  assert.equal(Number(await (await fetch(`${origin}/count`)).text()), 2);

  const media = await browser.newPage();
  await media.goto(`${origin}/media?run=${run}`);
  const mediaPanel = await openPanelForTarget(extensionId, media);
  await sendGoal(mediaPanel, 'Play the visible audio.');
  await waitStatus(mediaPanel, 'completed');
  await sendGoal(mediaPanel, '暂停这个音频');
  await waitStatus(mediaPanel, 'completed');
  assert.equal(await media.$eval('#fixture-audio', element => element.paused), true);

  const stored = await panel.evaluate(() => chrome.storage.local.get(null));
  const nonChat = Object.fromEntries(Object.entries(stored).filter(([key]) => !key.startsWith('chat_messages_')));
  assert(!Object.keys(stored).some(key => key.startsWith('chat_agent_step_')));
  assert(!JSON.stringify(nonChat).includes('FIELD_SENTINEL_8472'));
  assert(!JSON.stringify(nonChat).includes('FIELD_SENTINEL_CHANGED_9521'));
  await Promise.all([target.close(), media.close(), panel.close(), mediaPanel.close()]);
}
```

Do not add a test-only runtime branch, fake LLM, site-specific selector, or direct background command. The runner must operate only through SidePanel DOM and assert target-page/server state.

- [ ] **Step 4: Add exact scripts and run one fixture pass**

Add Chrome-extension script `"e2e:action-agent": "node scripts/action-agent-e2e.mjs"` and root script `"e2e:action-agent": "pnpm build && pnpm --filter chrome-extension e2e:action-agent"`.

Run: `RUNS=1 pnpm --dir projects/nanobrowser e2e:action-agent`

Expected: one form, media, reconnect, and Skill scenario PASS in real unpacked Chrome using the configured MiniMax model.

- [ ] **Step 5: Run the complete automated gate**

Run:

```bash
pnpm --dir projects/nanobrowser --filter chrome-extension test
pnpm --dir projects/nanobrowser type-check
pnpm --dir projects/nanobrowser lint
pnpm --dir projects/nanobrowser build
RUNS=10 pnpm --dir projects/nanobrowser e2e:action-agent
```

Expected: all unit/integration checks and build PASS; fixture scenarios pass 10/10. Any unchanged pre-existing type/lint failure must be recorded with exact file/line and cannot hide a new failure.

- [ ] **Step 6: Run fixed-protocol owner acceptance in real Feishu and Bilibili**

Build and launch a dedicated persistent acceptance profile:

```bash
pnpm --dir projects/nanobrowser build
mkdir -p .tmp/scion-owner-acceptance
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PWD/.tmp/scion-owner-acceptance" \
  --disable-extensions-except="$PWD/projects/nanobrowser/dist" \
  --load-extension="$PWD/projects/nanobrowser/dist"
```

Log in manually once; credentials/CAPTCHA must leave the task in typed `waiting_user`, never be entered by the Agent. Then execute this fixed protocol 10 times per journey:

1. Feishu: open the same owner-created sandbox form, start `填写这个测试表单；提交前让我确认；成功标准是页面出现提交成功`, verify the approval appears before the server-side submission, approve once, and record whether one verified receipt appears.
2. Bilibili: open the same owner-selected favorite HTML5 video, start `播放当前收藏视频`, wait for the verified play receipt, send `暂停这个视频`, and record whether the same target pauses with a second verified receipt.
3. After each attempt, close/reopen SidePanel and verify the same terminal snapshot remains. Record build SHA, Chrome/extension version, login precondition, declared criterion, outcome, intervention count, receipt ID, and exactly one failure category from `product|model|site|login|environment` in `reports/nanobrowser/action-agent-cycle-1.md`. Never record field values, credentials, URLs with query strings, or page bodies.

Expected: Feishu and Bilibili each reach at least 8/10 verified completions; zero false positives; zero unapproved commits; no more than two root-cause repair rounds before applying the documented kill criteria.

- [ ] **Step 7: Inspect persisted privacy and migration state**

The runner's `chrome.storage.local.get(null)` assertion is the executable privacy check. Add this source/storage sweep and keep the JSON output only on failure:

```bash
rg -n "chat_agent_step_|FIELD_SENTINEL_8472|FIELD_SENTINEL_CHANGED_9521|JSON\.stringify\(actionArgs" projects/nanobrowser --glob '!**/test/**' --glob '!**/scripts/action-agent-e2e.mjs'
```

Expected: no runtime match for replay keys, sentinels, or raw action serialization. The runner already asserts resolved Skill/form values are absent from all non-user-chat storage.

- [ ] **Step 8: Update durable design status only after evidence passes**

Change `docs/design/001-browser-action-task-runtime.md` status from `not-implemented` to `current`, add the acceptance report link, regenerate `docs/DOCS_INDEX.md`, and update the task run state. If any gate fails, keep status `not-implemented` and record the red evidence instead.

Run: `bash /Users/mahaoxuan/Developer/yishuship/scripts/generate-docs-index.sh`

Expected: index generation succeeds and links the current design and decision records.

- [ ] **Step 9: Commit**

```bash
git add projects/nanobrowser reports/nanobrowser/action-agent-cycle-1.md docs
git commit -m "test: verify browser action agent cycle one"
```

## Final self-review gate

- Every product acceptance criterion maps to at least one story and runnable check.
- No task stores a raw normal-task instruction outside user chat; no Skill run stores resolved inputs.
- No action path or replay path bypasses ActionDispatcher.
- No completion path bypasses CompletionChecker or dedicated confirmation.
- No story adds a hypothetical repository, factory class, multi-task scheduler, cloud adapter, site adapter, generated script, or marketplace.
- Actual Chrome E2E is kept distinct from fake-adapter tests and real-site owner acceptance.
