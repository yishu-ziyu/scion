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
import { extractJsonFromModelOutput } from '../messages/utils';
import { wrapUntrustedContent } from '../messages/utils';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput, ExecutorOutcome } from '../../task/contracts';
import { CONTROL_SYSTEM_PROMPT, parseControlPolicyDecision } from './control-policy';
import type { Action } from '../actions/builder';

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
  const elementsText =
    rawElementsText !== ''
      ? wrapUntrustedContent(rawElementsText)
      : 'empty interactive list';
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
  let followUps: string[] = [];
  let resumeWaiters: Array<() => void> = [];
  let criteriaLocked = false;

  const waitIfPaused = async () => {
    while (paused && !stopped) {
      await new Promise<void>(resolve => {
        resumeWaiters.push(resolve);
      });
    }
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
      let failures = 0;
      const maxFailures = generalSettings.maxFailures || DEFAULT_AGENT_OPTIONS.maxFailures;

      for (let step = 0; step < maxSteps; step++) {
        if (stopped) return { kind: 'cancelled' };
        await waitIfPaused();
        if (stopped) return { kind: 'cancelled' };

        agentContext.nSteps = step;
        agentContext.stepInfo = new AgentStepInfo({ stepNumber: step, maxSteps });

        let stateText: string;
        try {
          stateText = await buildStateText(agentContext);
        } catch (error) {
          logger.error('state observe failed', error);
          failures += 1;
          if (failures >= maxFailures) return { kind: 'failed', category: 'observe_failed' };
          continue;
        }

        const userPrompt = [
          `Task:\n${instruction}`,
          `Step: ${step + 1}/${maxSteps}`,
          criteriaLocked ? 'Completion criteria already frozen; do not change them.' : 'Propose completion_criteria if possible.',
          stateText,
        ].join('\n\n');

        let rawText = '';
        try {
          const response = await llm.invoke([
            new SystemMessage(CONTROL_SYSTEM_PROMPT),
            new HumanMessage(userPrompt),
          ]);
          rawText = await contentToString(response.content);
        } catch (error) {
          logger.error('LLM invoke failed', error);
          failures += 1;
          if (failures >= maxFailures) return { kind: 'failed', category: 'llm_failed' };
          continue;
        }

        let decision;
        try {
          const parsed = extractJsonFromModelOutput(rawText);
          decision = parseControlPolicyDecision(parsed);
        } catch (error) {
          logger.error('control JSON parse failed', error);
          failures += 1;
          if (failures >= maxFailures) return { kind: 'failed', category: 'json_parse_failed' };
          continue;
        }

        if (!criteriaLocked && decision.criteria.length > 0) {
          try {
            await hooks.onPlan(roundId, decision.criteria);
            criteriaLocked = true;
          } catch (error) {
            logger.error('onPlan failed', error);
            return { kind: 'failed', category: 'on_plan_failed' };
          }
        } else if (!criteriaLocked && step === 0) {
          // Ensure CompletionChecker has something; TaskManager can also infer from instruction.
          try {
            await hooks.onPlan(roundId, []);
            criteriaLocked = true;
          } catch {
            // stale round
            return { kind: 'failed', category: 'on_plan_failed' };
          }
        }

        if (decision.waitingUser) {
          return { kind: 'waiting_user', reason: decision.waitingUser };
        }

        if (decision.done) {
          return {
            kind: 'candidate_complete',
            summary: decision.observation || 'Control loop candidate complete',
          };
        }

        if (!decision.action) {
          failures += 1;
          if (failures >= maxFailures) return { kind: 'failed', category: 'no_action' };
          continue;
        }

        const action = registry.get(decision.action.name);
        if (!action) {
          logger.error('unknown action', decision.action.name);
          failures += 1;
          if (failures >= maxFailures) return { kind: 'failed', category: 'unknown_action' };
          continue;
        }

        try {
          const result = await hooks.dispatchAction(roundId, action, decision.action.args);
          agentContext.actionResults.push(result.actionResult);
          if (result.actionResult?.error) {
            failures += 1;
            if (failures >= maxFailures) return { kind: 'failed', category: 'action_failed' };
          } else {
            failures = 0;
          }
          if (result.actionResult?.isDone) {
            return {
              kind: 'candidate_complete',
              summary: result.actionResult.extractedContent || decision.observation || 'done',
            };
          }
        } catch (error) {
          logger.error('dispatchAction failed', error);
          failures += 1;
          if (failures >= maxFailures) return { kind: 'failed', category: 'dispatch_failed' };
        }
      }

      return { kind: 'failed', category: 'max_steps' };
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
