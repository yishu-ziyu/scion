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
import { buildAgentStatusBar, parseControlPolicyDecision, renderControlSystemPrompt } from './control-policy';
import type { Action } from '../actions/builder';
import { isForbiddenTaskContentUrl, runObserveActLoop, type LoopDecision, type LoopOutcome } from './observe-act-loop';
import { markSetupError } from '../../task/executor-start-error';
import { createBrowserKernel, diffMetrics, renderContextForModel, type ObservationFrame } from '../../browser/kernel';
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

const logger = createLogger('ControlLlmBackend');

/** Default no-progress budget for control path (contracts 010/011). */
export const CONTROL_MAX_NO_PROGRESS = 3;

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
            const response = await llm.invoke([
              new SystemMessage(renderControlSystemPrompt()),
              new HumanMessage(userPrompt),
            ]);
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
            const openPublic =
              /wikipedia\.org|example\.com|localhost|127\.0\.0\.1/i.test(currentFrame?.tab.url ?? '') ||
              /wikipedia\.org|example\.com|localhost|127\.0\.0\.1/i.test(decision.observation);
            if (decision.waitingUser === 'login_required' && openPublic) {
              logger.warning('ignored login_required on open public URL', {
                url: currentFrame?.tab.url,
                observation: decision.observation.slice(0, 160),
              });
            } else {
              return { kind: 'waiting_user', reason: decision.waitingUser };
            }
          }

          if (decision.done) {
            return {
              kind: 'done',
              summary: decision.observation || 'Control loop candidate complete',
            };
          }

          if (!decision.action) {
            return { kind: 'recoverable', category: 'no_action' };
          }

          if (!registry.get(decision.action.name)) {
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

            await traceStore.finishSpan(actSpan, result.error ? 'fail' : 'ok');
            if (enableContextCompression) {
              trajectorySteps.push({
                step: trajectorySteps.length + 1,
                action: name,
                result: summarizeActionResultForTrajectory(name, result.summary ?? null, result.error ?? null),
                url: currentFrame?.tab.url,
              });
            }
            return {
              error: result.error ?? null,
              isDone: Boolean(result.isDone),
              summary: result.summary ?? null,
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
