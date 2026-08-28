/**
 * LLM-backed control ExecutorDriver (design/002 + product/022).
 * Single mid-model loop → Browser Kernel → Skill Runtime → TaskManager hooks.
 * Core must NOT import browser/sites/* — site knowledge lives in skills/.
 */
import {
  agentModelStore,
  evalSettingsStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  isHumanPageReading,
  type AttemptFinding,
} from '@extension/storage';
import { t } from '@extension/i18n';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type BrowserContext from '../../browser/context';
import { createLogger } from '../../log';
import { ensurePersonalDefaults } from '../../../personal/bootstrap';
import { createChatModel } from '../helper';
import { ActionBuilder } from '../actions/builder';
import { AgentContext, AgentStepInfo, DEFAULT_AGENT_OPTIONS } from '../types';
import MessageManager from '../messages/service';
import { EventManager } from '../event/manager';
import { extractJsonFromModelOutput } from '../messages/utils';
import type {
  ExecutorDriver,
  ExecutorHooks,
  ExecutorInput,
  ExecutorMissionPlan,
  ExecutorOutcome,
  ObservedPageSnapshot,
  VerifiedPageRecord,
} from '../../task/contracts';
import {
  filterPageSummaryActions,
  formatVerifiedPagesForPrompt,
  isPureCurrentPageSummaryInstruction,
  observationFrameForPageSummary,
  pageSummaryDeliverable,
} from '../../task/verified-step-records';
import {
  applyInaccessibleIframeGate,
  applyLoginWallGate,
  buildAgentStatusBar,
  instructionLooksLikeResearch,
  observationSupportsWaitingUser,
  CONTROL_MAX_ACTIONS_PER_TURN,
  parseControlPolicyDecision,
  renderControlSystemPrompt,
} from './control-policy';
import { parseUsualMailboxConfirmation, resolveMailboxOpen, webmailHostFromUrl } from '../mailbox-open';
import { formatUserMemoryForPrompt } from '../user-memory';
import {
  clearPendingMailboxHost,
  listUserMemoryFacts,
  readPendingMailboxHost,
  readUsualMailboxHost,
  writePendingMailboxHost,
  writeUsualMailboxHost,
} from '../user-memory-store';
import { rewriteInventedLookupNavigation } from './lookup-navigation';
import { JUDGE_PAGE_THEN_WRITE, resolveControlDelivery } from './control-delivery';
import {
  SUPERVISE_SYSTEM_PROMPT,
  applySuperviseVerdict,
  pageTextForSupervisor,
  parseSuperviseVerdict,
  renderSuperviseUserPrompt,
} from './control-supervise';
import { Actors, ExecutionState } from '../event/types';
import type { Action } from '../actions/builder';
import {
  isForbiddenTaskContentUrl,
  NO_PAGE_SNAPSHOT,
  runObserveActLoop,
  type LoopAction,
  type LoopDecision,
  type LoopOutcome,
} from './observe-act-loop';
import { captureQueuedActionTarget, resolveQueuedActionIndex, type QueuedActionTarget } from './queued-action-target';
import { markSetupError } from '../../task/executor-start-error';
import {
  buildObservationFrame,
  createBrowserKernel,
  diffMetrics,
  hasUsablePageBody,
  normalizeVisiblePageText,
  renderContextForModel,
  type ObservationFrame,
} from '../../browser/kernel';
import { createDefaultSkillRegistry, createSkillRuntime } from '../skills';
import type { TaskArtifact } from '../../task/artifact';
import { traceStore } from '../../task/trace';
import { classifyRetry } from '../retry-policy';
import {
  buildLongHorizonContext,
  buildPlanMemory,
  compactStateText,
  summarizeActionResultForTrajectory,
  type TrajectoryStep,
} from '../context';
import { numberedStepSegments } from '../../task/mission-plan';
import { instructionUrlPlanFromText, openAndDescribeIndependentPages } from '../../task/independent-urls';
import { collectSearchFindings, isSearchResultsUrl, searchObserveLoopPhase } from '../../browser/search-results';

const logger = createLogger('ControlLlmBackend');

/** Default no-progress budget for control path (contracts 010/011). */
export const CONTROL_MAX_NO_PROGRESS = 3;

export interface CurrentMissionContext {
  planMemory: string;
  activePhaseId?: string;
}

export function buildControlUserPrompt(input: {
  instruction: string;
  step: number;
  maxSteps: number;
  criteriaLocked: boolean;
  contextBlock: string;
  lastActionMemory: string | null;
  statusBar: string;
  verifiedPages: VerifiedPageRecord[];
  userMemory?: string;
}): string {
  return [
    `Task:\n${input.instruction}`,
    input.userMemory?.trim() ? input.userMemory.trim() : '',
    formatVerifiedPagesForPrompt(input.verifiedPages),
    `Step: ${input.step + 1}/${input.maxSteps}`,
    input.criteriaLocked
      ? 'Completion criteria already frozen; do not change them.'
      : 'Propose completion_criteria if possible.',
    input.contextBlock,
    input.lastActionMemory ? `<last_action_result>\n${input.lastActionMemory}\n</last_action_result>` : '',
    input.statusBar,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function missionContextFromPlan(plan: ExecutorMissionPlan | undefined): CurrentMissionContext {
  return {
    planMemory: buildPlanMemory(plan),
    activePhaseId: plan?.phases.find(phase => phase.status === 'active')?.id,
  };
}

/** Resolve plan state at decision time so a long run never repeats a phase that already advanced. */
export async function readCurrentMissionContext(
  hooks: Pick<ExecutorHooks, 'getMissionPlan'>,
  roundId: string,
  initialPlan?: ExecutorMissionPlan,
): Promise<CurrentMissionContext> {
  if (!hooks.getMissionPlan) return missionContextFromPlan(initialPlan);
  try {
    return missionContextFromPlan(await hooks.getMissionPlan(roundId));
  } catch {
    return missionContextFromPlan(undefined);
  }
}

const SEMANTIC_PROGRESS_ACTIONS = new Set([
  'cache_content',
  'record_evidence',
  'inspect_evidence_space',
  'read_page_text',
  'inspect_open_tabs',
  'find_tab',
  'snapshot',
  'record_research_decision',
  'record_research_delivery',
  'save_screenshot',
  'observe',
  'extract_content',
]);

const CONTENT_RESULT_ACTIONS = new Set([
  'record_evidence',
  'read_page_text',
  'inspect_open_tabs',
  'find_tab',
  'snapshot',
  'inspect_evidence_space',
  'inspect_github_repository',
  'record_research_decision',
  'record_research_delivery',
  'observe',
  'extract_content',
]);

const CONTROL_LLM_TIMEOUT_MS = 90_000;

export function shouldKeepActionResultInContext(actionName: string): boolean {
  return CONTENT_RESULT_ACTIONS.has(actionName);
}

/**
 * Next-turn lastActionMemory after one act.
 * Failures always feed decide; click/nav success must not keep a summary or a prior failure.
 */
export function memoryAfterAction(
  name: string,
  result: { error?: string | null; summary?: string | null },
): string | null {
  if (result.error) {
    return compactStateText(`${name} failed: ${result.error}`, 24_000);
  }
  if (result.summary && shouldKeepActionResultInContext(name)) {
    return compactStateText(result.summary, 24_000);
  }
  return null;
}

export async function invokeWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = CONTROL_LLM_TIMEOUT_MS,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error('llm_timeout');
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

/** Visible page, no action: ask again. Must not terminate as no_action. */
export function decideVisiblePageWithoutAction(feedback: string): {
  memory: string;
  decision: Extract<LoopDecision, { kind: 'recoverable' }>;
} {
  return { memory: feedback, decision: { kind: 'recoverable', category: 'judge_retry' } };
}

/**
 * Map observe-act loop terminal outcome → TaskManager ExecutorOutcome.
 * Contract 011: no_progress / max_steps must keep category (never collapse to other/unknown).
 */
export function mapLoopOutcomeToExecutor(
  outcome: LoopOutcome,
  extras?: { artifacts?: TaskArtifact[] },
): ExecutorOutcome {
  if (outcome.kind === 'waiting_user') {
    return { kind: 'waiting_user', reason: outcome.reason };
  }
  if (outcome.kind === 'failed') {
    const category = outcome.category?.trim() || 'unknown';
    return { kind: 'failed', category };
  }
  if (outcome.kind === 'cancelled') {
    return { kind: 'cancelled' };
  }
  // candidate_complete — Executor proposes only; Verifier decides.
  return {
    kind: 'candidate_complete',
    summary: outcome.summary,
    ...(extras?.artifacts && extras.artifacts.length > 0 ? { artifacts: extras.artifacts } : {}),
  };
}

async function contentToString(content: unknown): Promise<string> {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const record = part as Record<string, unknown>;
          if (typeof record.text === 'string') return record.text;
          if (typeof record.type === 'string') {
            return record.type === 'text' ? '' : `[${record.type}]`;
          }
        }
        return '';
      })
      .join('\n');
  }
  return JSON.stringify(content ?? '');
}

function registryFromActions(actions: Action[]): Map<string, Action> {
  const map = new Map<string, Action>();
  for (const action of actions) {
    map.set(action.name(), action);
  }
  return map;
}

export async function createLlmControlDriver(
  input: ExecutorInput,
  hooks: ExecutorHooks,
  browserContext: BrowserContext,
): Promise<ExecutorDriver> {
  await ensurePersonalDefaults();

  const providers = await llmProviderStore.getAllProviders();
  if (Object.keys(providers).length === 0) throw markSetupError(t('bg_setup_noApiKeys'));

  await agentModelStore.cleanupLegacyValidatorSettings();
  const agentModels = await agentModelStore.getAllAgentModels();
  const navigatorModel = agentModels[AgentNameEnum.Navigator] ?? agentModels[AgentNameEnum.Planner];
  if (!navigatorModel) throw markSetupError(t('bg_setup_noNavigatorModel'));
  if (!providers[navigatorModel.provider]) {
    throw markSetupError(t('bg_setup_noProvider', [navigatorModel.provider]));
  }

  const llm: BaseChatModel = await createChatModel(providers[navigatorModel.provider], navigatorModel);
  const supervisorModel =
    agentModels[AgentNameEnum.Validator] && providers[agentModels[AgentNameEnum.Validator].provider]
      ? agentModels[AgentNameEnum.Validator]
      : navigatorModel;
  const supervisorLlm: BaseChatModel =
    supervisorModel.provider === navigatorModel.provider && supervisorModel.modelName === navigatorModel.modelName
      ? llm
      : await createChatModel(providers[supervisorModel.provider], supervisorModel);
  logger.info('LLM control backend model', {
    provider: navigatorModel.provider,
    model: navigatorModel.modelName,
    supervisorProvider: supervisorModel.provider,
    supervisorModel: supervisorModel.modelName,
  });

  const firewall = await firewallStore.getFirewall();
  browserContext.updateConfig({
    allowedUrls: firewall.enabled ? firewall.allowList : [],
    deniedUrls: firewall.enabled ? firewall.denyList : [],
  });

  const generalSettings = await generalSettingsStore.getSettings();
  const evalSettings = await evalSettingsStore.getSettings();
  browserContext.updateConfig({
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000,
    displayHighlights: generalSettings.displayHighlights,
  });

  const messageManager = new MessageManager();
  const eventManager = new EventManager();
  const agentContext = new AgentContext(input.taskId, browserContext, messageManager, eventManager, {
    maxSteps: generalSettings.maxSteps,
    maxFailures: generalSettings.maxFailures,
    maxActionsPerStep: CONTROL_MAX_ACTIONS_PER_TURN,
    useVision: generalSettings.useVision,
    planningInterval: generalSettings.planningInterval,
  });

  const actionBuilder = new ActionBuilder(agentContext, llm);
  const registry = registryFromActions(actionBuilder.buildDefaultActions());

  const enableKernel = evalSettings.featureFlags.enableBrowserKernelV1 !== false;
  const enableDiff = evalSettings.featureFlags.enableObservationDiff === true;
  const enableSkillRuntime = evalSettings.featureFlags.enableSkillRuntime !== false;
  const enableContextCompression = evalSettings.featureFlags.enableContextCompression !== false;

  const kernel = createBrowserKernel({
    browserContext,
    agentContext,
    hooks,
    resolveAction: name => registry.get(name),
    defaultUseVision: generalSettings.useVision,
  });

  const skillRuntime = createSkillRuntime({
    registry: createDefaultSkillRegistry(),
    kernel,
    taskId: input.taskId,
    flags: {
      enableSkillRuntime,
      enableDeterministicFormFill: evalSettings.featureFlags.enableDeterministicFormFill,
      enableDeterministicBilibili: evalSettings.featureFlags.enableDeterministicBilibili,
      enableDeterministicYouTube: evalSettings.featureFlags.enableDeterministicYouTube,
    },
    hasAction: name => registry.has(name),
  });

  let paused = false;
  let pauseVersion = 0;
  let stopped = false;
  const followUps: string[] = [];
  let resumeWaiters: Array<() => void> = [];
  let criteriaLocked = false;
  let currentPageRevision: string | null = null;
  let currentFrame: ObservationFrame | null = null;
  let previousFrame: ObservationFrame | null = null;
  const queuedActionTargets = new WeakMap<Record<string, unknown>, QueuedActionTarget | null>();
  let lastRenderedMode: 'full' | 'diff' = 'full';
  const trajectorySteps: TrajectoryStep[] = [];
  const skillState = new Map<string, unknown>();
  const artifacts: TaskArtifact[] = [];
  let lastActionMemory: string | null = null;
  let pageBodyRead = false;
  let observeQuery: string | undefined;
  let pendingUsualMailboxHost: string | undefined;
  let mailboxConfirmationConsumed = false;
  let mailboxTabOpened = false;

  const rememberQueuedActionTargets = (decision: LoopDecision): LoopDecision => {
    if (decision.kind !== 'action') return decision;
    const actions: LoopAction[] = [{ name: decision.name, args: decision.args }, ...(decision.followup ?? [])];
    for (const action of actions) {
      if (typeof action.args.index !== 'number' || !Number.isFinite(action.args.index)) continue;
      queuedActionTargets.set(action.args, captureQueuedActionTarget(currentFrame, action.args));
    }
    return decision;
  };

  const waitIfPaused = async () => {
    let waited = false;
    while (paused && !stopped) {
      waited = true;
      await new Promise<void>(resolve => {
        resumeWaiters.push(resolve);
      });
    }
    return waited;
  };

  const markPageBodyFromFrame = (frame: ObservationFrame) => {
    if (hasUsablePageBody(frame.visibleText)) {
      pageBodyRead = true;
    }
  };

  const snapshotFromFrame = (frame: ObservationFrame): ObservedPageSnapshot => ({
    url: frame.tab.url,
    title: frame.tab.title,
    visibleText: frame.visibleText ?? '',
  });

  const recordObservedPageIfNeeded = async (roundId: string, frame: ObservationFrame): Promise<void> => {
    if (!hooks.recordObservedPage) return;
    try {
      await hooks.recordObservedPage(roundId, snapshotFromFrame(frame));
    } catch {
      // Provenance write must not abort observe.
    }
  };

  const persistSerpObserve = async (roundId: string, frame: ObservationFrame): Promise<AttemptFinding[]> => {
    if (!isSearchResultsUrl(frame.tab.url)) return [];
    const step = agentContext.nSteps ?? 0;
    const queryPhase = searchObserveLoopPhase({
      url: frame.tab.url,
      step,
      title: frame.tab.title,
    });
    if (queryPhase) {
      try {
        await hooks.reportLoopPhase?.(roundId, queryPhase);
      } catch {
        // Stream persist is UI-only.
      }
    }
    let findings: AttemptFinding[] = [];
    try {
      findings = await collectSearchFindings(await browserContext.getCurrentPage());
    } catch {
      findings = [];
    }
    const findingsPhase = searchObserveLoopPhase({
      url: frame.tab.url,
      step,
      title: frame.tab.title,
      findings,
    });
    if (findingsPhase && findings.length > 0) {
      try {
        await hooks.reportLoopPhase?.(roundId, findingsPhase);
      } catch {
        // Stream persist is UI-only.
      }
    }
    return findings;
  };

  const observeFrame = async (opts?: { waitForLoad?: boolean }): Promise<ObservationFrame> => {
    if (enableKernel) {
      const frame = await kernel.observe({ query: observeQuery, waitForLoad: opts?.waitForLoad });
      previousFrame = currentFrame;
      currentFrame = frame;
      currentPageRevision = frame.pageRevision;
      markPageBodyFromFrame(frame);
      return frame;
    }
    // Legacy path (flag off): same frame shape as kernel observe, including wording.
    const browserState = await agentContext.browserContext.getState(agentContext.options.useVision, false, {
      waitForLoad: opts?.waitForLoad,
    });
    const rawElementsText = browserState.elementTree.clickableElementsToString(agentContext.options.includeAttributes);
    let visibleText = '';
    try {
      const page = await agentContext.browserContext.getCurrentPage();
      const raw = await page.evaluate(() => document.body?.innerText || '');
      visibleText = normalizeVisiblePageText(raw);
    } catch {
      // wording optional
    }
    const frame = await buildObservationFrame({
      browserState,
      elementsText: rawElementsText,
      visibleText,
      query: observeQuery,
    });
    previousFrame = currentFrame;
    currentFrame = frame;
    currentPageRevision = frame.pageRevision;
    markPageBodyFromFrame(frame);
    return frame;
  };

  const renderObservationForModel = (frame: ObservationFrame, forceFull: boolean): string => {
    if (!enableDiff || !previousFrame || forceFull) {
      lastRenderedMode = 'full';
      return frame.text;
    }
    const diff = kernel.diff(previousFrame, frame);
    // Full frame on navigation; otherwise prefer diff + relevant elements.
    if (diff.urlChanged) {
      lastRenderedMode = 'full';
      return frame.text;
    }
    const rendered = renderContextForModel({
      frame,
      diffText: diff.text,
      useDiff: true,
      forceFull: false,
    });
    lastRenderedMode = rendered.mode;
    return rendered.rendered;
  };

  return {
    run: async (roundId: string): Promise<ExecutorOutcome> => {
      logger.info('LLM control run', { taskId: input.taskId, roundId, enableKernel, enableSkillRuntime, enableDiff });
      let pageAttached = false;
      const attachPageIfNeeded = async () => {
        if (pageAttached) return;
        await browserContext.switchTab(input.tabId);
        pageAttached = true;
      };

      const instruction = [input.instruction, ...followUps].filter(Boolean).join('\n');
      const maxSteps = generalSettings.maxSteps || DEFAULT_AGENT_OPTIONS.maxSteps;
      const maxFailures = generalSettings.maxFailures || DEFAULT_AGENT_OPTIONS.maxFailures;
      const maxNoProgress = CONTROL_MAX_NO_PROGRESS;

      const settleProposedDone = async (summary: string, stateText: string): Promise<LoopDecision> => {
        if (stateText === NO_PAGE_SNAPSHOT) {
          return { kind: 'done', summary };
        }
        if (isPureCurrentPageSummaryInstruction(instruction)) {
          return {
            kind: 'done',
            summary: pageSummaryDeliverable(summary, {
              title: currentFrame?.tab.title,
              visibleText: currentFrame?.visibleText,
            }),
          };
        }
        const pageText = pageTextForSupervisor({
          url: currentFrame?.tab.url,
          title: currentFrame?.tab.title,
          visibleText: currentFrame?.visibleText,
          formFieldsText: currentFrame?.formFieldsText,
          fallback: stateText,
        });
        await agentContext.emitEvent(Actors.VALIDATOR, ExecutionState.STEP_START, '正在核对页面上的结果');
        try {
          const response = await invokeWithTimeout(
            signal =>
              supervisorLlm.invoke(
                [
                  new SystemMessage(SUPERVISE_SYSTEM_PROMPT),
                  new HumanMessage(
                    renderSuperviseUserPrompt({
                      instruction,
                      claimedResult: summary,
                      pageText,
                    }),
                  ),
                ],
                { signal },
              ),
            CONTROL_LLM_TIMEOUT_MS,
            agentContext.controller.signal,
          );
          const verdict = parseSuperviseVerdict(extractJsonFromModelOutput(await contentToString(response.content)));
          await agentContext.emitEvent(
            Actors.VALIDATOR,
            ExecutionState.STEP_OK,
            verdict.accept ? verdict.reason : `还没做完：${verdict.reason}`,
          );
          const applied = applySuperviseVerdict(verdict, summary);
          if (applied.lastActionMemory) lastActionMemory = applied.lastActionMemory;
          return applied.decision;
        } catch (error) {
          logger.warning('supervisor failed; reject completion', error);
          await agentContext.emitEvent(Actors.VALIDATOR, ExecutionState.STEP_OK, '监督这一轮没看清，先继续做。');
          const applied = applySuperviseVerdict({ accept: false, reason: '监督没看清，先继续。' }, summary);
          lastActionMemory = applied.lastActionMemory;
          return applied.decision;
        }
      };

      const loopOutcome = await runObserveActLoop({
        skipInitialObserve: true,
        maxSteps,
        maxFailures,
        maxNoProgress,
        isStopped: () => stopped,
        waitIfPaused,
        pauseVersion: () => pauseVersion,
        shouldRetryFailure: evalSettings.featureFlags.enableRetryRecovery
          ? error => classifyRetry(error) === 'retry'
          : () => false,
        onStuck: async () => {
          lastActionMemory = [
            'Previous actions did not change the page.',
            'Replan from the user request and the current page.',
            'Do not repeat the last click or URL.',
          ].join(' ');
          return 'continue';
        },
        onPhase: async event => {
          await hooks.reportLoopPhase?.(roundId, event);
        },
        observe: async () => {
          await attachPageIfNeeded();
          agentContext.nSteps = agentContext.nSteps ?? 0;
          const frame = await observeFrame({ waitForLoad: false });
          await recordObservedPageIfNeeded(roundId, frame);
          const findings = await persistSerpObserve(roundId, frame);
          if (isSearchResultsUrl(frame.tab.url)) {
            try {
              const opened = await openAndDescribeIndependentPages({
                instruction,
                plan: instructionUrlPlanFromText(instruction),
                browserContext,
                currentUrl: frame.tab.url,
                searchFindings: findings,
              });
              if (opened.length > 0) {
                await hooks.recordOpenedPages?.(
                  roundId,
                  opened.map(tab => ({ tabId: tab.tabId, url: tab.pageUrl, title: tab.title })),
                );
              }
            } catch {
              // Search-result opens are best-effort.
            }
          }
          const stateText = renderObservationForModel(frame, true);
          if (isForbiddenTaskContentUrl(frame.tab.url)) {
            logger.warning('observed forbidden content url; continue with state', { url: frame.tab.url });
          }
          const obsSpan = await traceStore.beginSpan({
            taskId: input.taskId,
            roundId,
            kind: 'observe',
            name: 'kernel.observe',
            startedAt: Date.now(),
            data: {
              frame_id: frame.frameId,
              page_revision: frame.pageRevision,
              full_chars: frame.text.length,
              rendered_chars: stateText.length,
              material_change: true,
            },
          });
          await traceStore.finishSpan(obsSpan, 'ok');
          return stateText;
        },
        decide: async (stateText, step): Promise<LoopDecision> => {
          agentContext.nSteps = step;
          agentContext.stepInfo = new AgentStepInfo({ stepNumber: step, maxSteps });
          const persistPageReading = async (text: string | undefined) => {
            const trimmed = text?.replace(/\s+/g, ' ').trim() ?? '';
            if (!isHumanPageReading(trimmed)) return;
            try {
              await hooks.reportLoopPhase?.(roundId, { phase: 'decide', step, detail: trimmed });
            } catch {
              // Stream persist is UI-only.
            }
          };

          if (!mailboxTabOpened) {
            const latestLine =
              instruction
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .at(-1) ?? '';
            if (!mailboxConfirmationConsumed) {
              const pendingHost = pendingUsualMailboxHost ?? (await readPendingMailboxHost(input.taskId));
              const mailboxConfirm = parseUsualMailboxConfirmation(latestLine, pendingHost);
              if (mailboxConfirm.confirmed) {
                mailboxConfirmationConsumed = true;
                mailboxTabOpened = true;
                pendingUsualMailboxHost = undefined;
                await clearPendingMailboxHost(input.taskId);
                await writeUsualMailboxHost(mailboxConfirm.host);
                const observation = `打开已确认的网页邮箱 ${mailboxConfirm.host}`;
                await persistPageReading(observation);
                return {
                  kind: 'action',
                  name: 'open_tab',
                  args: { url: `https://${mailboxConfirm.host}/` },
                  observation,
                };
              }
            }

            const tabInfos = await browserContext.getTabInfos().catch(() => []);
            const mailbox = resolveMailboxOpen({
              instruction,
              currentUrl: currentFrame?.tab.url ?? '',
              confirmedHost: await readUsualMailboxHost(),
              openWebmailHosts: tabInfos
                .map(tab => webmailHostFromUrl(tab.url))
                .filter((host): host is string => Boolean(host)),
            });
            if (mailbox.kind === 'ask') {
              pendingUsualMailboxHost = mailbox.pendingHost;
              if (mailbox.pendingHost) await writePendingMailboxHost(input.taskId, mailbox.pendingHost);
              await persistPageReading(mailbox.userVisibleText);
              await agentContext.emitEvent(Actors.SYSTEM, ExecutionState.STEP_OK, mailbox.userVisibleText);
              return { kind: 'waiting_user', reason: 'target_ambiguous' };
            }
            if (mailbox.kind === 'open') {
              mailboxTabOpened = true;
              const observation = `打开 ${mailbox.url}`;
              await persistPageReading(observation);
              return {
                kind: 'action',
                name: 'open_tab',
                args: { url: mailbox.url },
                observation,
              };
            }
          }

          const { planMemory, activePhaseId } = await readCurrentMissionContext(hooks, roundId, input.plan);
          const stepWording = numberedStepSegments(instruction);
          const planBlock = [
            planMemory,
            stepWording.length
              ? [
                  '## Current step wording (not stored on the plan)',
                  ...stepWording.map((label, index) => `- phase-${index + 1}: ${label}`),
                ].join('\n')
              : '',
          ]
            .filter(Boolean)
            .join('\n\n');

          // Skill Runtime first — site/task knowledge never inlined in this file.
          if (enableSkillRuntime) {
            const skillSpan = await traceStore.beginSpan({
              taskId: input.taskId,
              roundId,
              kind: 'skill',
              name: 'skill.discover',
              startedAt: Date.now(),
              data: { step },
            });
            try {
              const skillTry = await skillRuntime.tryDecide({
                roundId,
                instruction,
                url: currentFrame?.tab.url ?? '',
                observationText: stateText,
                frame: currentFrame,
                phaseId: activePhaseId,
                skillState,
              });

              if (skillTry.record) {
                await traceStore.finishSpan(skillSpan, skillTry.handled ? 'ok' : 'fail', skillTry.record.failureClass);
                const runSpan = await traceStore.beginSpan({
                  taskId: input.taskId,
                  roundId,
                  kind: 'skill',
                  name: 'skill.run',
                  startedAt: Date.now(),
                  data: {
                    skill_id: skillTry.record.skillId,
                    skill_version: skillTry.record.skillVersion,
                    candidate_count: skillTry.record.candidateCount,
                    selected_reason: skillTry.record.selectedReason,
                    duration: skillTry.record.durationMs,
                    outcome: skillTry.record.outcome,
                    fallback_used: skillTry.record.fallbackUsed,
                  },
                });
                await traceStore.finishSpan(runSpan, skillTry.handled ? 'ok' : 'fail');
              } else {
                await traceStore.finishSpan(skillSpan, 'ok');
              }

              if (skillTry.handled && skillTry.decision) {
                const decision = skillTry.decision;
                if (decision.kind === 'done') {
                  const settled = await settleProposedDone(decision.summary, stateText);
                  if (settled.kind !== 'done') return settled;
                  if (skillTry.artifact) {
                    artifacts.push(skillTry.artifact);
                    const artSpan = await traceStore.beginSpan({
                      taskId: input.taskId,
                      roundId,
                      kind: 'artifact',
                      name: 'artifact.create',
                      startedAt: Date.now(),
                      data: {
                        artifact_id: skillTry.artifact.id,
                        artifact_type: skillTry.artifact.type,
                      },
                    });
                    await traceStore.finishSpan(artSpan, 'ok');
                  }
                  if (!criteriaLocked && skillTry.criteria && skillTry.criteria.length > 0) {
                    try {
                      await hooks.onPlan(roundId, skillTry.criteria);
                      criteriaLocked = true;
                    } catch {
                      /* still complete */
                    }
                  }
                  logger.info('skill done', {
                    skill: skillTry.record?.skillId,
                    summary: decision.summary.slice(0, 120),
                  });
                  return settled;
                }
                if (decision.kind === 'action') {
                  if (!criteriaLocked && skillTry.criteria && skillTry.criteria.length > 0) {
                    try {
                      await hooks.onPlan(roundId, skillTry.criteria);
                      criteriaLocked = true;
                    } catch (error) {
                      logger.error('onPlan failed (skill)', error);
                      return { kind: 'fatal', category: 'on_plan_failed' };
                    }
                  }
                  if (!registry.get(decision.name)) {
                    logger.warning('skill action missing from registry; fallback', { name: decision.name });
                  } else {
                    logger.info('skill action', { skill: skillTry.record?.skillId, name: decision.name });
                    await persistPageReading(decision.observation);
                    return rememberQueuedActionTargets(decision);
                  }
                }
              }
            } catch (error) {
              logger.warning('skill runtime failed; fall through to LLM', error);
              await traceStore.finishSpan(skillSpan, 'fail', 'skill_runtime_error');
            }
          }

          const statusBar = evalSettings.featureFlags.enableAgentStatusBar
            ? [
                '<agent_status>',
                buildAgentStatusBar({
                  url: currentFrame?.tab.url,
                  title: currentFrame?.tab.title,
                  pageRevision: currentFrame?.pageRevision,
                  step,
                  maxSteps,
                  attemptCount: agentContext.actionResults.length,
                  criteriaCount: criteriaLocked ? 1 : 0,
                  activePhaseId,
                }),
                '</agent_status>',
              ].join('\n')
            : '';

          const contextBlock = enableContextCompression
            ? buildLongHorizonContext({
                observation: stateText,
                trajectory: trajectorySteps,
                planMemory: planBlock || undefined,
                maxChars: 28_000,
                compressOptions: { keepRecent: 3, fieldMaxChars: 80 },
              })
            : [stateText, planBlock].filter(Boolean).join('\n\n');
          let verifiedPages: VerifiedPageRecord[] = [];
          if (hooks.getVerifiedPages) {
            try {
              verifiedPages = await hooks.getVerifiedPages(roundId);
            } catch {
              verifiedPages = [];
            }
          }
          const userPrompt = buildControlUserPrompt({
            instruction,
            step,
            maxSteps,
            criteriaLocked,
            contextBlock,
            lastActionMemory,
            statusBar,
            verifiedPages,
            userMemory: formatUserMemoryForPrompt(await listUserMemoryFacts()),
          });

          let rawText = '';
          const llmSpan = await traceStore.beginSpan({
            taskId: input.taskId,
            roundId,
            kind: 'llm',
            name: 'control_llm_invoke',
            startedAt: Date.now(),
            data: {
              step,
              model: navigatorModel.modelName,
            },
          });
          try {
            const response = await invokeWithTimeout(
              signal =>
                llm.invoke(
                  [
                    new SystemMessage(
                      renderControlSystemPrompt({ research: instructionLooksLikeResearch(instruction) }),
                    ),
                    new HumanMessage(userPrompt),
                  ],
                  { signal },
                ),
              CONTROL_LLM_TIMEOUT_MS,
              agentContext.controller.signal,
            );
            rawText = await contentToString(response.content);
            await traceStore.finishSpan(llmSpan, 'ok');
          } catch (error) {
            logger.error('LLM invoke failed', error);
            await traceStore.finishSpan(llmSpan, 'fail', 'llm_failed');
            return { kind: 'recoverable', category: 'llm_failed' };
          }

          let decision;
          try {
            const parsed = extractJsonFromModelOutput(rawText);
            decision = parseControlPolicyDecision(parsed);
            const queued = filterPageSummaryActions(
              instruction,
              (decision.actions.length > 0 ? decision.actions : decision.action ? [decision.action] : [])
                .map(item => rewriteInventedLookupNavigation(instruction, item))
                .filter((item): item is { name: string; args: Record<string, unknown> } => item !== null),
              { pageBodyRead },
            );
            decision = {
              ...decision,
              action: queued[0] ?? null,
              actions: queued,
            };
            decision = applyLoginWallGate(decision, currentFrame);
            decision = applyInaccessibleIframeGate(
              decision,
              observationFrameForPageSummary(instruction, currentFrame),
            );
          } catch (error) {
            logger.error('control JSON parse failed', error);
            return { kind: 'recoverable', category: 'json_parse_failed' };
          }
          await persistPageReading(decision.observation);

          if (!criteriaLocked && decision.criteria.length > 0) {
            try {
              await hooks.onPlan(roundId, decision.criteria);
              criteriaLocked = true;
            } catch (error) {
              logger.error('onPlan failed', error);
              return { kind: 'fatal', category: 'on_plan_failed' };
            }
          } else if (!criteriaLocked && step === 0) {
            try {
              await hooks.onPlan(roundId, []);
              criteriaLocked = true;
            } catch {
              return { kind: 'fatal', category: 'on_plan_failed' };
            }
          }

          if (decision.waitingUser) {
            if (
              !observationSupportsWaitingUser(
                observationFrameForPageSummary(instruction, currentFrame),
                decision.waitingUser,
              )
            ) {
              logger.warning('ignored waiting_user without page blocker evidence', {
                url: currentFrame?.tab.url,
                reason: decision.waitingUser,
                observation: decision.observation.slice(0, 160),
              });
            } else {
              return { kind: 'waiting_user', reason: decision.waitingUser };
            }
          }

          const delivery = resolveControlDelivery({
            done: decision.done,
            observation: decision.observation,
            hasAction: Boolean(decision.action),
            hasPageBody: pageBodyRead,
            pageAttached: stateText !== NO_PAGE_SNAPSHOT,
            pageSummaryReady: isPureCurrentPageSummaryInstruction(instruction),
          });
          if (delivery.kind === 'read_page') {
            return {
              kind: 'action',
              name: 'read_page_text',
              args: { max_chars: 20_000 },
              observation: delivery.observation,
            };
          }
          if (delivery.kind === 'retry') {
            const retry = decideVisiblePageWithoutAction(delivery.feedback);
            lastActionMemory = retry.memory;
            return retry.decision;
          }
          if (delivery.kind === 'missing_action') {
            const retry = decideVisiblePageWithoutAction(JUDGE_PAGE_THEN_WRITE);
            lastActionMemory = retry.memory;
            return retry.decision;
          }
          if (delivery.kind === 'complete') {
            return settleProposedDone(decision.observation || 'Control loop candidate complete', stateText);
          }

          if (decision.done) {
            return settleProposedDone(decision.observation || 'Control loop candidate complete', stateText);
          }

          const queued = filterPageSummaryActions(instruction, decision.actions, { pageBodyRead });
          const first = queued[0];
          if (!first) {
            if (pageBodyRead) {
              return settleProposedDone(
                pageSummaryDeliverable(decision.observation, {
                  title: currentFrame?.tab.title,
                  visibleText: currentFrame?.visibleText,
                }),
                stateText,
              );
            }
            return { kind: 'recoverable', category: 'no_action' };
          }

          const unknown = queued.find(item => !registry.get(item.name));
          if (unknown) {
            logger.error('unknown action', unknown.name);
            return { kind: 'recoverable', category: 'unknown_action' };
          }

          return rememberQueuedActionTargets({
            kind: 'action',
            name: first.name,
            args: first.args,
            observation: decision.observation,
            ...(queued.length > 1 ? { followup: queued.slice(1) } : {}),
          });
        },
        act: async ({ name, args }) => {
          await attachPageIfNeeded();
          if (name === 'observe') {
            const rawQuery = args && typeof args === 'object' ? (args as { query?: unknown }).query : undefined;
            observeQuery = typeof rawQuery === 'string' && rawQuery.trim() ? rawQuery.trim() : undefined;
          } else {
            observeQuery = undefined;
          }
          const actSpan = await traceStore.beginSpan({
            taskId: input.taskId,
            roundId,
            kind: 'act',
            name: `kernel.act_${name}`,
            startedAt: Date.now(),
            data: { action: name },
          });
          try {
            const result = enableKernel
              ? await kernel.act(roundId, name, args, currentPageRevision ?? undefined)
              : await (async () => {
                  const action = registry.get(name);
                  if (!action) return { error: `unknown action ${name}` };
                  const { bindIndexedActionToFrame } = await import('../../task/action-frame');
                  const boundArgs = bindIndexedActionToFrame(
                    (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
                    currentPageRevision,
                  );
                  const dispatched = await hooks.dispatchAction(roundId, action, boundArgs);
                  agentContext.actionResults.push(dispatched.actionResult);
                  return {
                    error: dispatched.actionResult?.error ?? null,
                    isDone: Boolean(dispatched.actionResult?.isDone),
                    summary: dispatched.actionResult?.extractedContent ?? null,
                  };
                })();

            await traceStore.finishSpan(actSpan, result.error ? 'fail' : 'ok', result.error ?? undefined);
            if (enableContextCompression) {
              trajectorySteps.push({
                step: trajectorySteps.length + 1,
                action: name,
                result: summarizeActionResultForTrajectory(name, result.summary ?? null, result.error ?? null),
                url: currentFrame?.tab.url,
              });
            }
            if (!result.error && name === 'read_page_text') {
              pageBodyRead = true;
            }
            if (!result.error && name === 'extract_content') {
              const last = agentContext.actionResults[agentContext.actionResults.length - 1];
              if (last?.artifact) artifacts.push(last.artifact);
            }
            lastActionMemory = memoryAfterAction(name, result);
            return {
              error: result.error ?? null,
              isDone: Boolean(result.isDone),
              summary: result.summary ?? null,
              progressKey:
                !result.error && result.summary && SEMANTIC_PROGRESS_ACTIONS.has(name)
                  ? `${name}:${result.summary}`
                  : null,
            };
          } catch (error) {
            logger.error('dispatchAction failed', error);
            await traceStore.finishSpan(actSpan, 'fail');
            const message =
              error instanceof Error
                ? error.name === 'StaleTaskRoundError'
                  ? 'stale_task_round'
                  : error.message || error.name
                : String(error);
            if (enableContextCompression) {
              trajectorySteps.push({
                step: trajectorySteps.length + 1,
                action: name,
                result: summarizeActionResultForTrajectory(name, null, message),
                url: currentFrame?.tab.url,
              });
            }
            lastActionMemory = memoryAfterAction(name, { error: message });
            return { error: message };
          }
        },
        reobserve: async () => {
          const frame = await observeFrame();
          await recordObservedPageIfNeeded(roundId, frame);
          await persistSerpObserve(roundId, frame);
          const forceFull = !previousFrame || previousFrame.tab.url !== frame.tab.url;
          const stateText = renderObservationForModel(frame, forceFull);
          if (enableDiff && previousFrame) {
            const diff = kernel.diff(previousFrame, frame);
            const metrics = diffMetrics(frame.text, stateText, diff);
            const diffSpan = await traceStore.beginSpan({
              taskId: input.taskId,
              roundId,
              kind: 'diff',
              name: 'observation.diff',
              startedAt: Date.now(),
              data: {
                frame_id: frame.frameId,
                page_revision: frame.pageRevision,
                ...metrics,
                mode: lastRenderedMode,
              },
            });
            await traceStore.finishSpan(diffSpan, 'ok');
          }
          return stateText;
        },
        resolveQueuedAction: action => {
          if (!queuedActionTargets.has(action.args)) return null;
          const target = queuedActionTargets.get(action.args);
          if (!target) return null;
          const index = resolveQueuedActionIndex(target, currentFrame);
          if (index === null) return null;
          return index === action.args.index ? action : { ...action, args: { ...action.args, index } };
        },
      });

      return mapLoopOutcomeToExecutor(loopOutcome, { artifacts });
    },
    addFollowUp: instruction => {
      followUps.push(instruction);
    },
    pause: () => {
      pauseVersion += 1;
      paused = true;
      void agentContext.pause();
    },
    resume: () => {
      paused = false;
      void agentContext.resume();
      const waiters = resumeWaiters;
      resumeWaiters = [];
      for (const w of waiters) w();
    },
    stop: async () => {
      stopped = true;
      paused = false;
      await agentContext.stop();
      const waiters = resumeWaiters;
      resumeWaiters = [];
      for (const w of waiters) w();
    },
  };
}
