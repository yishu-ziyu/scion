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
import { extractJsonFromModelOutput, wrapUntrustedContent } from '../messages/utils';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput, ExecutorOutcome } from '../../task/contracts';
import {
  buildAgentStatusBar,
  observationSupportsWaitingUser,
  parseControlPolicyDecision,
  renderControlSystemPrompt,
} from './control-policy';
import type { Action } from '../actions/builder';
import { isForbiddenTaskContentUrl, runObserveActLoop, type LoopDecision, type LoopOutcome } from './observe-act-loop';
import { markSetupError } from '../../task/executor-start-error';
import { createBrowserKernel, diffMetrics, renderContextForModel, type ObservationFrame } from '../../browser/kernel';
import { createDefaultSkillRegistry, createSkillRuntime } from '../skills';
import type { TaskArtifact } from '../../task/artifact';
import { traceStore } from '../../task/trace';
import { classifyRetry } from '../retry-policy';
import {
  canonicalizeEvidenceSource,
  evidenceSpaceProgress,
  getEvidenceSpace,
  isPrivateDashboardEvidenceSource,
  isSearchResultsEvidenceSource,
} from '@extension/storage/lib/task/evidence-space';
import {
  extractResearchQuotas,
  researchContinuationQuery,
  researchQuotasMet,
  renderResearchDecisionEvidenceShortlist,
  requiresStructuredResearchDecision,
  shouldGoBackFromUnavailableResearchPage,
  shouldLeavePrivateResearchDashboard,
  shouldRequireEvidenceBeforeNavigation,
} from '../../task/research-checkpoint';
import { pageLooksUnavailable } from '../../browser/page-availability';
import {
  buildLongHorizonContext,
  buildPlanMemory,
  compactStateText,
  summarizeActionResultForTrajectory,
  type TrajectoryStep,
} from '../context';

const logger = createLogger('ControlLlmBackend');

/** Default no-progress budget for control path (contracts 010/011). */
export const CONTROL_MAX_NO_PROGRESS = 3;

const SEMANTIC_PROGRESS_ACTIONS = new Set([
  'cache_content',
  'record_evidence',
  'inspect_evidence_space',
  'read_page_text',
  'inspect_open_tabs',
  'record_research_decision',
  'record_research_delivery',
  'save_screenshot',
]);

const CONTENT_RESULT_ACTIONS = new Set([
  'record_evidence',
  'read_page_text',
  'inspect_open_tabs',
  'inspect_evidence_space',
  'inspect_github_repository',
  'record_research_decision',
  'record_research_delivery',
]);

const CONTROL_LLM_TIMEOUT_MS = 90_000;

const RESEARCH_DECISION_REASON_CODES = [
  'exactly_three_capabilities_required',
  'capability_titles_must_be_unique',
  'deferred_items_required',
  'seven_answers_required',
  'two_user_sources_required',
  'product_evidence_required',
  'repository_evidence_required',
  'evidence_space_missing',
] as const;

/** Preserve only fixed validator codes, never raw capability text or action values. */
export function researchDecisionFailureFeedback(error: string): string {
  const codes = RESEARCH_DECISION_REASON_CODES.filter(code => error.includes(code));
  if (codes.length > 0) {
    return `record_research_decision was rejected. Correct only these validation failures: ${codes.join(', ')}. Do not inspect, browse, wait, or finish; retry record_research_decision now.`;
  }
  return 'record_research_decision failed before acceptance. Use exactly 3 capabilities with the exact documented keys, top-level deferred and contradictions, and only IDs from decision_evidence_shortlist. Do not inspect, browse, wait, or finish; retry the action now.';
}

export function shouldKeepActionResultInContext(actionName: string): boolean {
  return CONTENT_RESULT_ACTIONS.has(actionName);
}

export function shouldRetryUnrecordedResearchSource(input: {
  hasResearchQuotas: boolean;
  collectionComplete?: boolean;
  currentSourceRecorded: boolean;
  pageUrl: string;
  pageUnavailable: boolean;
  textLength: number;
}): boolean {
  return (
    input.hasResearchQuotas &&
    !input.collectionComplete &&
    !input.currentSourceRecorded &&
    !input.pageUnavailable &&
    input.textLength >= 300 &&
    !isSearchResultsEvidenceSource(input.pageUrl) &&
    !isPrivateDashboardEvidenceSource(input.pageUrl)
  );
}

export function shouldRedirectSearchResultEvidenceAttempt(input: {
  pageUrl: string;
  actionName?: string;
}): boolean {
  return input.actionName === 'record_evidence' && isSearchResultsEvidenceSource(input.pageUrl);
}

export interface ResearchEvidenceRetryBudget {
  consume: (source: string) => boolean;
}

/** Allow one evidence reminder per source, then let the agent leave an irrelevant page. */
export function createResearchEvidenceRetryBudget(maxRetriesPerSource = 1): ResearchEvidenceRetryBudget {
  const retries = new Map<string, number>();
  return {
    consume(source: string): boolean {
      const key = canonicalizeEvidenceSource(source) || source || 'unknown-source';
      const used = retries.get(key) ?? 0;
      if (used >= maxRetriesPerSource) return false;
      retries.set(key, used + 1);
      return true;
    },
  };
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

  const llm: BaseChatModel = createChatModel(providers[navigatorModel.provider], navigatorModel);
  logger.info('LLM control backend model', {
    provider: navigatorModel.provider,
    model: navigatorModel.modelName,
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
    maxActionsPerStep: 1,
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
  let stopped = false;
  const followUps: string[] = [];
  let resumeWaiters: Array<() => void> = [];
  let criteriaLocked = false;
  let currentPageRevision: string | null = null;
  let currentFrame: ObservationFrame | null = null;
  let previousFrame: ObservationFrame | null = null;
  let lastRenderedMode: 'full' | 'diff' = 'full';
  const trajectorySteps: TrajectoryStep[] = [];
  const planMemory = buildPlanMemory(input.plan);
  const activePhaseId = input.plan?.phases.find(phase => phase.status === 'active')?.id;
  const skillState = new Map<string, unknown>();
  const artifacts: TaskArtifact[] = [];
  const researchQuotas = extractResearchQuotas(input.instruction);
  const evidenceRetryBudget = createResearchEvidenceRetryBudget();
  let lastActionMemory: string | null = null;

  const waitIfPaused = async () => {
    while (paused && !stopped) {
      await new Promise<void>(resolve => {
        resumeWaiters.push(resolve);
      });
    }
  };

  const observeFrame = async (): Promise<ObservationFrame> => {
    if (enableKernel) {
      const frame = await kernel.observe();
      previousFrame = currentFrame;
      currentFrame = frame;
      currentPageRevision = frame.pageRevision;
      return frame;
    }
    // Legacy path (flag off): still produce a frame-shaped observation via kernel-less build.
    const browserState = await agentContext.browserContext.getState(agentContext.options.useVision);
    const rawElementsText = browserState.elementTree.clickableElementsToString(agentContext.options.includeAttributes);
    const elementsText = rawElementsText !== '' ? wrapUntrustedContent(rawElementsText) : 'empty interactive list';
    const { captureActionFrame } = await import('../../task/action-frame');
    const actionFrame = await captureActionFrame(browserState);
    const text = compactStateText(
      [
        `Current tab: {id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`,
        `Snapshot frame: ${actionFrame.pageRevision} (${actionFrame.targetCount} indexed targets)`,
        'media: none',
        `Interactive elements:\n${elementsText}`,
      ].join('\n'),
    );
    const frame: ObservationFrame = {
      frameId: `legacy-${Date.now()}`,
      observedAt: Date.now(),
      tab: { id: browserState.tabId, url: browserState.url, title: browserState.title },
      pageRevision: actionFrame.pageRevision,
      targetCount: actionFrame.targetCount,
      interactiveElements: [],
      text,
      signals: [],
    };
    previousFrame = currentFrame;
    currentFrame = frame;
    currentPageRevision = frame.pageRevision;
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
      try {
        await browserContext.switchTab(input.tabId);
      } catch (error) {
        logger.error('switchTab failed', error);
      }

      const instruction = [input.instruction, ...followUps].filter(Boolean).join('\n');
      const maxSteps = generalSettings.maxSteps || DEFAULT_AGENT_OPTIONS.maxSteps;
      const maxFailures = generalSettings.maxFailures || DEFAULT_AGENT_OPTIONS.maxFailures;
      const maxNoProgress = CONTROL_MAX_NO_PROGRESS;

      const loopOutcome = await runObserveActLoop({
        maxSteps,
        maxFailures,
        maxNoProgress,
        isStopped: () => stopped,
        waitIfPaused,
        shouldRetryFailure: evalSettings.featureFlags.enableRetryRecovery
          ? error => classifyRetry(error) === 'retry'
          : () => false,
        observe: async () => {
          agentContext.nSteps = agentContext.nSteps ?? 0;
          const frame = await observeFrame();
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

          const pageUrl = currentFrame?.tab.url ?? '';
          let researchStatus = '';
          let researchDecisionEvidenceShortlist = '';
          let currentSourceRecorded = false;
          let researchProgress: ReturnType<typeof evidenceSpaceProgress> | null = null;
          let researchCollectionComplete = false;
          if (researchQuotas) {
            const evidenceSpace = await getEvidenceSpace(input.taskId);
            const progress = evidenceSpaceProgress(evidenceSpace);
            researchProgress = progress;
            researchCollectionComplete = researchQuotasMet(researchQuotas, progress);
            if (researchCollectionComplete && requiresStructuredResearchDecision(instruction)) {
              researchDecisionEvidenceShortlist = renderResearchDecisionEvidenceShortlist(evidenceSpace);
            }
            const canonicalPage = canonicalizeEvidenceSource(pageUrl);
            currentSourceRecorded = Boolean(
              canonicalPage && evidenceSpace?.records.some(record => record.canonicalSource === canonicalPage),
            );
            const recordedSources = Array.from(
              new Set((evidenceSpace?.records ?? []).map(record => record.canonicalSource)),
            ).slice(-24);
            const discussionHosts = Array.from(
              new Set(
                (evidenceSpace?.records ?? [])
                  .filter(record => record.recordType === 'user_discussion')
                  .map(record => {
                    try {
                      return new URL(record.canonicalSource).hostname;
                    } catch {
                      return '';
                    }
                  })
                  .filter(Boolean),
              ),
            );
            const recordedProducts = Array.from(
              new Set(
                (evidenceSpace?.records ?? [])
                  .filter(record => record.recordType === 'product')
                  .map(record => record.relatedProduct?.replace(/\s+/g, ' ').trim())
                  .filter((value): value is string => Boolean(value)),
              ),
            );
            researchStatus = [
              '<research_status>',
              `user_discussions: ${progress.userDiscussions}/${researchQuotas.userDiscussions}`,
              `products: ${progress.products}/${researchQuotas.products}`,
              `repository_records: ${progress.repository}`,
              `collection_complete: ${researchCollectionComplete}`,
              `current_source_recorded: ${currentSourceRecorded}`,
              `recorded_sources: ${recordedSources.length > 0 ? recordedSources.join(' | ') : 'none'}`,
              `recorded_products: ${recordedProducts.length > 0 ? recordedProducts.join(' | ') : 'none'}`,
              `user_discussion_hosts: ${discussionHosts.length > 0 ? discussionHosts.join(' | ') : 'none'}`,
              ...(researchCollectionComplete && requiresStructuredResearchDecision(instruction)
                ? [
                    'The collection gates are complete. Stop browsing and do not record the current page.',
                    'Use inspect_evidence_space only to obtain valid durable IDs, then call record_research_decision with exactly three complete capabilities.',
                  ]
                : [
                    'If the current page is a useful source and current_source_recorded is false, record it before any navigation.',
                    'Do not revisit a recorded source merely to gather more evidence. Open an unread source, and prioritize any user_discussions or products quota still at zero.',
                  ]),
              ...(progress.repository > 0 &&
              (progress.userDiscussions < researchQuotas.userDiscussions || progress.products < researchQuotas.products)
                ? [
                    'The Living Reader repository audit is already recorded. Do not open repository files again until both external quotas are met.',
                  ]
                : []),
              'User-discussion quota progress counts distinct source + raw-basis cases; repeating the same quote under another key does not count. Product quota counts distinct product identities. Batch independent comments from one page in one record_evidence action, then move to a new URL.',
              'Do not open or record a product identity already listed in recorded_products; choose a different product.',
              'Rotate discussion platforms. Once one host has supplied three sources, choose another available host before returning to it.',
              '</research_status>',
            ].join('\n');
          }

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
                url: pageUrl,
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
                  if (decision.artifact) {
                    artifacts.push(decision.artifact);
                    const artSpan = await traceStore.beginSpan({
                      taskId: input.taskId,
                      roundId,
                      kind: 'artifact',
                      name: 'artifact.create',
                      startedAt: Date.now(),
                      data: {
                        artifact_id: decision.artifact.id,
                        artifact_type: decision.artifact.type,
                      },
                    });
                    await traceStore.finishSpan(artSpan, 'ok');
                  }
                  if (!criteriaLocked && decision.criteria) {
                    try {
                      await hooks.onPlan(roundId, decision.criteria);
                      criteriaLocked = true;
                    } catch {
                      /* still complete */
                    }
                  } else if (!criteriaLocked) {
                    try {
                      await hooks.onPlan(roundId, []);
                      criteriaLocked = true;
                    } catch {
                      /* still complete */
                    }
                  }
                  logger.info('skill done', { skill: skillTry.record?.skillId, summary: decision.summary.slice(0, 120) });
                  return { kind: 'done', summary: decision.summary };
                }
                if (decision.kind === 'action') {
                  if (!criteriaLocked && decision.criteria && decision.criteria.length > 0) {
                    try {
                      await hooks.onPlan(roundId, decision.criteria);
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
                    return {
                      kind: 'action',
                      name: decision.name,
                      args: decision.args,
                      observation: decision.observation,
                    };
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
                planMemory: planMemory || undefined,
                maxChars: 28_000,
                compressOptions: { keepRecent: 3, fieldMaxChars: 80 },
              })
            : [stateText, planMemory].filter(Boolean).join('\n\n');
          const userPrompt = [
            `Task:\n${instruction}`,
            `Step: ${step + 1}/${maxSteps}`,
            criteriaLocked
              ? 'Completion criteria already frozen; do not change them.'
              : 'Propose completion_criteria if possible.',
            contextBlock,
            lastActionMemory ? `<last_action_result>\n${lastActionMemory}\n</last_action_result>` : '',
            researchStatus,
            researchDecisionEvidenceShortlist,
            statusBar,
          ]
            .filter(Boolean)
            .join('\n\n');

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
                  [new SystemMessage(renderControlSystemPrompt()), new HumanMessage(userPrompt)],
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
          } catch (error) {
            logger.error('control JSON parse failed', error);
            if (
              shouldRetryUnrecordedResearchSource({
                hasResearchQuotas: Boolean(researchQuotas),
                collectionComplete: researchCollectionComplete,
                currentSourceRecorded,
                pageUrl,
                pageUnavailable: pageLooksUnavailable({
                  url: pageUrl,
                  title: currentFrame?.tab.title ?? '',
                  bodyText: currentFrame?.text ?? '',
                }),
                textLength: currentFrame?.text.length ?? 0,
              }) && evidenceRetryBudget.consume(pageUrl)
            ) {
              return { kind: 'recoverable', category: 'evidence_required' };
            }
            if (researchQuotas && researchProgress) {
              const query = researchContinuationQuery(researchQuotas, researchProgress);
              if (query) {
                return {
                  kind: 'action',
                  name: 'search_google',
                  args: { query, intent: 'recover malformed model output and continue research quotas' },
                  observation: 'The model output was malformed while durable research quotas remain; continuing discovery.',
                };
              }
            }
            return { kind: 'recoverable', category: 'json_parse_failed' };
          }

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
            if (!observationSupportsWaitingUser(currentFrame, decision.waitingUser)) {
              logger.warning('ignored waiting_user without page blocker evidence', {
                url: currentFrame?.tab.url,
                reason: decision.waitingUser,
                observation: decision.observation.slice(0, 160),
              });
            } else {
              return { kind: 'waiting_user', reason: decision.waitingUser };
            }
          }

          const currentPageUnavailable = pageLooksUnavailable({
            url: pageUrl,
            title: currentFrame?.tab.title ?? '',
            bodyText: currentFrame?.text ?? '',
          });
          const continuationQuery =
            researchQuotas && researchProgress
              ? researchContinuationQuery(researchQuotas, researchProgress)
              : null;
          const currentNeedsEvidence = shouldRetryUnrecordedResearchSource({
            hasResearchQuotas: Boolean(researchQuotas),
            collectionComplete: researchCollectionComplete,
            currentSourceRecorded,
            pageUrl,
            pageUnavailable: currentPageUnavailable,
            textLength: currentFrame?.text.length ?? 0,
          });

          if (
            researchQuotas &&
            shouldRedirectSearchResultEvidenceAttempt({ pageUrl, actionName: decision.action?.name })
          ) {
            return { kind: 'recoverable', category: 'source_required' };
          }

          if (
            researchQuotas &&
            shouldGoBackFromUnavailableResearchPage({
              pageUnavailable: currentPageUnavailable,
              actionName: decision.action?.name,
              done: decision.done,
            })
          ) {
            return {
              kind: 'action',
              name: 'go_back',
              args: { intent: 'return to the last valid research source after an unavailable page' },
              observation: 'The current research source is unavailable; returning to the last valid source.',
            };
          }

          if (
            researchQuotas &&
            shouldLeavePrivateResearchDashboard({
              url: pageUrl,
              bodyText: currentFrame?.text ?? '',
              actionName: decision.action?.name,
              done: decision.done,
            })
          ) {
            return {
              kind: 'action',
              name: 'go_back',
              args: { intent: 'leave a private dashboard and use public product documentation instead' },
              observation: 'The signed-in dashboard contains private user material and is not a research source.',
            };
          }

          if (decision.done && continuationQuery) {
              if (currentNeedsEvidence && evidenceRetryBudget.consume(pageUrl)) {
                return { kind: 'recoverable', category: 'evidence_required' };
              }
              return {
                kind: 'action',
                name: 'search_google',
                args: { query: continuationQuery, intent: 'continue the unmet durable research quotas' },
                observation: 'The model tried to finish before the durable research quotas were met; continuing research.',
              };
          }

          if (decision.done) {
            return {
              kind: 'done',
              summary: decision.observation || 'Control loop candidate complete',
            };
          }

          if (!decision.action) {
            if (currentNeedsEvidence && evidenceRetryBudget.consume(pageUrl)) {
              return { kind: 'recoverable', category: 'evidence_required' };
            }
            if (continuationQuery) {
              return {
                kind: 'action',
                name: 'search_google',
                args: { query: continuationQuery, intent: 'recover a missing research action and continue quotas' },
                observation: 'No usable research action was proposed while durable quotas remain; continuing discovery.',
              };
            }
            return { kind: 'recoverable', category: 'no_action' };
          }

          if (
            researchQuotas &&
            shouldRequireEvidenceBeforeNavigation({
              actionName: decision.action.name,
              currentUrl: pageUrl,
              sourceRecorded: currentSourceRecorded,
              pageUnavailable: currentPageUnavailable,
              hasSubstantiveText: (currentFrame?.text.length ?? 0) >= 300,
            }) &&
            evidenceRetryBudget.consume(pageUrl)
          ) {
            trajectorySteps.push({
              step: trajectorySteps.length + 1,
              action: 'research_checkpoint',
              result: 'Navigation blocked: record the useful current source in the evidence space first.',
              url: pageUrl,
            });
            return { kind: 'recoverable', category: 'evidence_required' };
          }

          if (!registry.get(decision.action.name)) {
            if (currentNeedsEvidence && evidenceRetryBudget.consume(pageUrl)) {
              return { kind: 'recoverable', category: 'evidence_required' };
            }
            if (continuationQuery) {
              return {
                kind: 'action',
                name: 'search_google',
                args: { query: continuationQuery, intent: 'replace an unknown action and continue research quotas' },
                observation: 'The proposed action is unavailable; continuing research through source discovery.',
              };
            }
            logger.error('unknown action', decision.action.name);
            return { kind: 'recoverable', category: 'unknown_action' };
          }

          return {
            kind: 'action',
            name: decision.action.name,
            args: decision.action.args,
            observation: decision.observation,
          };
        },
        act: async ({ name, args }) => {
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

            const decisionFailureFeedback =
              result.error && name === 'record_research_decision'
                ? researchDecisionFailureFeedback(result.error)
                : '';
            await traceStore.finishSpan(actSpan, result.error ? 'fail' : 'ok', decisionFailureFeedback || undefined);
            if (enableContextCompression) {
              trajectorySteps.push({
                step: trajectorySteps.length + 1,
                action: name,
                result: summarizeActionResultForTrajectory(name, result.summary ?? null, result.error ?? null),
                url: currentFrame?.tab.url,
              });
            }
            if (!result.error && result.summary && shouldKeepActionResultInContext(name)) {
              lastActionMemory = compactStateText(result.summary, 24_000);
            } else if (decisionFailureFeedback) {
              lastActionMemory = decisionFailureFeedback;
            }
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
            return { error: message };
          }
        },
        reobserve: async () => {
          const frame = await observeFrame();
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
      });

      return mapLoopOutcomeToExecutor(loopOutcome, { artifacts });
    },
    addFollowUp: instruction => {
      followUps.push(instruction);
    },
    pause: () => {
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
