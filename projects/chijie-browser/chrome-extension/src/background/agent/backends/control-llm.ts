/**
 * LLM-backed control ExecutorDriver (design/002).
 * Single mid-model loop → TaskManager hooks → ActionDispatcher.
 * Real DOM actions via ActionBuilder; media via Page.controlMedia (element API).
 */
import {
  agentModelStore,
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
import { CONTROL_SYSTEM_PROMPT, parseControlPolicyDecision } from './control-policy';
import type { Action } from '../actions/builder';
import { isForbiddenTaskContentUrl, runObserveActLoop, type LoopDecision, type LoopOutcome } from './observe-act-loop';

const logger = createLogger('ControlLlmBackend');

async function contentToString(content: unknown): Promise<string> {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as { text: unknown }).text);
        return '';
      })
      .join('\n');
  }
  return JSON.stringify(content ?? '');
}

async function buildStateText(context: AgentContext): Promise<string> {
  const browserState = await context.browserContext.getState(context.options.useVision);
  const rawElementsText = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);
  const elementsText = rawElementsText !== '' ? wrapUntrustedContent(rawElementsText) : 'empty interactive list';
  let mediaLine = 'media: none';
  try {
    const page = await context.browserContext.getCurrentPage();
    const media = await page.observeMedia();
    if (media.kind === 'bound') {
      mediaLine = `media: bound digest=${media.targetDigest} state=${media.state}`;
    } else if (media.kind === 'ambiguous') {
      mediaLine = `media: ambiguous count=${media.candidateCount}`;
    }
  } catch {
    // ignore media probe failures
  }
  return [
    `Current tab: {id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`,
    mediaLine,
    `Interactive elements:\n${elementsText}`,
  ].join('\n');
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
  if (Object.keys(providers).length === 0) throw new Error(t('bg_setup_noApiKeys'));

  await agentModelStore.cleanupLegacyValidatorSettings();
  const agentModels = await agentModelStore.getAllAgentModels();
  const navigatorModel = agentModels[AgentNameEnum.Navigator] ?? agentModels[AgentNameEnum.Planner];
  if (!navigatorModel) throw new Error(t('bg_setup_noNavigatorModel'));
  if (!providers[navigatorModel.provider]) throw new Error(t('bg_setup_noProvider', [navigatorModel.provider]));

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

  let paused = false;
  let stopped = false;
  const followUps: string[] = [];
  let resumeWaiters: Array<() => void> = [];
  let criteriaLocked = false;

  const waitIfPaused = async () => {
    while (paused && !stopped) {
      await new Promise<void>(resolve => {
        resumeWaiters.push(resolve);
      });
    }
  };

  const toExecutorOutcome = (outcome: LoopOutcome): ExecutorOutcome => {
    if (outcome.kind === 'waiting_user') {
      return { kind: 'waiting_user', reason: outcome.reason };
    }
    return outcome;
  };

  return {
    run: async (roundId: string): Promise<ExecutorOutcome> => {
      logger.info('LLM control run', { taskId: input.taskId, roundId });
      try {
        await browserContext.switchTab(input.tabId);
      } catch (error) {
        logger.error('switchTab failed', error);
      }

      const instruction = [input.instruction, ...followUps].filter(Boolean).join('\n');
      const maxSteps = generalSettings.maxSteps || DEFAULT_AGENT_OPTIONS.maxSteps;
      const maxFailures = generalSettings.maxFailures || DEFAULT_AGENT_OPTIONS.maxFailures;

      const loopOutcome = await runObserveActLoop({
        maxSteps,
        maxFailures,
        isStopped: () => stopped,
        waitIfPaused,
        observe: async () => {
          agentContext.nSteps = agentContext.nSteps ?? 0;
          const stateText = await buildStateText(agentContext);
          // Never treat extension side panel as the task content page.
          const urlMatch = stateText.match(/url:\s*([^,}]+)/);
          const url = urlMatch?.[1]?.trim();
          if (isForbiddenTaskContentUrl(url)) {
            logger.warning('observed forbidden content url; continue with state', { url });
          }
          return stateText;
        },
        decide: async (stateText, step): Promise<LoopDecision> => {
          agentContext.nSteps = step;
          agentContext.stepInfo = new AgentStepInfo({ stepNumber: step, maxSteps });

          const userPrompt = [
            `Task:\n${instruction}`,
            `Step: ${step + 1}/${maxSteps}`,
            criteriaLocked
              ? 'Completion criteria already frozen; do not change them.'
              : 'Propose completion_criteria if possible.',
            stateText,
          ].join('\n\n');

          let rawText = '';
          try {
            const response = await llm.invoke([new SystemMessage(CONTROL_SYSTEM_PROMPT), new HumanMessage(userPrompt)]);
            rawText = await contentToString(response.content);
          } catch (error) {
            logger.error('LLM invoke failed', error);
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
            return { kind: 'waiting_user', reason: decision.waitingUser };
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
          const action = registry.get(name);
          if (!action) {
            return { error: `unknown action ${name}` };
          }
          try {
            const result = await hooks.dispatchAction(roundId, action, args);
            agentContext.actionResults.push(result.actionResult);
            return {
              error: result.actionResult?.error ?? null,
              isDone: Boolean(result.actionResult?.isDone),
              summary: result.actionResult?.extractedContent ?? null,
            };
          } catch (error) {
            logger.error('dispatchAction failed', error);
            throw error;
          }
        },
        reobserve: async () => buildStateText(agentContext),
      });

      return toExecutorOutcome(loopOutcome);
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
