import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
} from '@extension/storage';
import { t } from '@extension/i18n';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import { ensurePersonalDefaults } from '../../personal/bootstrap';
import { createChatModel } from './helper';
import { Executor } from './executor';
import { ExecutionState } from './event/types';
import type { AgentEvent } from './event/types';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput, ExecutorOutcome } from '../task/contracts';

const logger = createLogger('ExecutorFactory');

export const browserContext = new BrowserContext({});

export async function createExecutorDriver(
  input: ExecutorInput,
  hooks: ExecutorHooks,
  onEvent?: (event: AgentEvent) => void,
): Promise<ExecutorDriver> {
  await ensurePersonalDefaults();

  const providers = await llmProviderStore.getAllProviders();
  if (Object.keys(providers).length === 0) throw new Error(t('bg_setup_noApiKeys'));

  await agentModelStore.cleanupLegacyValidatorSettings();
  const agentModels = await agentModelStore.getAllAgentModels();
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) throw new Error(t('bg_setup_noProvider', [agentModel.provider]));
  }

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) throw new Error(t('bg_setup_noNavigatorModel'));
  const navigatorProviderConfig = providers[navigatorModel.provider];
  logger.info('Creating Navigator model', {
    provider: navigatorModel.provider,
    model: navigatorModel.modelName,
  });
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) plannerLLM = createChatModel(providers[plannerModel.provider], plannerModel);

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

  const executor = new Executor(input.instruction, input.taskId, browserContext, navigatorLLM, {
    hooks,
    plannerLLM: plannerLLM ?? navigatorLLM,
    navigatorProviderId: navigatorModel.provider,
    plannerProviderId: plannerModel?.provider ?? navigatorModel.provider,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
  });

  return {
    run: () =>
      new Promise<ExecutorOutcome>(resolve => {
        let settled = false;
        const finish = (outcome: ExecutorOutcome) => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        };
        executor.clearExecutionEvents();
        executor.subscribeExecutionEvents(async event => {
          onEvent?.(event);
          switch (event.state) {
            case ExecutionState.TASK_OK:
              finish({ kind: 'candidate_complete', summary: 'Candidate completion' });
              break;
            case ExecutionState.TASK_FAIL:
              finish({ kind: 'failed', category: 'execution_failed' });
              break;
            case ExecutionState.TASK_CANCEL:
              finish({ kind: 'cancelled' });
              break;
          }
        });
        void executor.execute().then(() => {
          if (!settled) finish({ kind: 'failed', category: 'missing_terminal_event' });
          void executor.cleanup();
        });
      }),
    addFollowUp: instruction => executor.addFollowUpTask(instruction),
    pause: () => {
      void executor.pause();
    },
    resume: () => {
      void executor.resume();
    },
    stop: () => {
      void executor.cancel();
    },
  };
}
