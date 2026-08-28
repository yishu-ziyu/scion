/**
 * Task-loop ExecutorDriver on AI SDK ToolLoopAgent.
 * Native tools (open / click / observe / done) replace JSON-in-text as the main path.
 * Source: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
 */
import { isStepCount, ToolLoopAgent, type LanguageModel } from 'ai';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  getApiKey,
  llmProviderStore,
  type ProviderConfig,
} from '@extension/storage';
import { t } from '@extension/i18n';
import type BrowserContext from '../../browser/context';
import { createLogger } from '../../log';
import { ensurePersonalDefaults } from '../../../personal/bootstrap';
import { ActionBuilder } from '../actions/builder';
import { AgentContext, DEFAULT_AGENT_OPTIONS } from '../types';
import MessageManager from '../messages/service';
import { EventManager } from '../event/manager';
import { createChatModel } from '../helper';
import type { WaitReason } from '@extension/storage/lib/task';
import type {
  CompletionCriterionDraft,
  ExecutorDriver,
  ExecutorHooks,
  ExecutorInput,
  ExecutorOutcome,
} from '../../task/contracts';
import { markSetupError } from '../../task/executor-start-error';
import { createBrowserKernel } from '../../browser/kernel';
import { createCompatibleLanguageModel } from '../../orchestrator/model';
import { parseFormFillSubmitInstruction, pageShowsFormSuccess } from '../../browser/sites/form-fill';
import { TOOL_LOOP_CONTROL_INSTRUCTIONS } from './tool-loop-control-prompts';
import { createToolLoopControlTools, type ToolLoopBrowser } from './tool-loop-control-tools';

const logger = createLogger('ToolLoopControl');

export interface ToolLoopControlOptions {
  model?: LanguageModel;
  runBrowser?: ToolLoopBrowser;
  maxSteps?: number;
}

function registryFromActions(actions: ReturnType<ActionBuilder['buildDefaultActions']>) {
  return new Map(actions.map(action => [action.name(), action]));
}

async function resolveLoopModel(): Promise<LanguageModel> {
  const providers = await llmProviderStore.getAllProviders();
  if (Object.keys(providers).length === 0) throw markSetupError(t('bg_setup_noApiKeys'));
  await agentModelStore.cleanupLegacyValidatorSettings();
  const agentModels = await agentModelStore.getAllAgentModels();
  const navigatorModel = agentModels[AgentNameEnum.Navigator] ?? agentModels[AgentNameEnum.Planner];
  if (!navigatorModel) throw markSetupError(t('bg_setup_noNavigatorModel'));
  const provider = providers[navigatorModel.provider];
  if (!provider) throw markSetupError(t('bg_setup_noProvider', [navigatorModel.provider]));
  const apiKey = provider.apiKeyRef ? ((await getApiKey(provider.apiKeyRef)) ?? provider.apiKey) : provider.apiKey;
  if (!apiKey) throw markSetupError(t('bg_setup_noApiKeys'));
  const model = createCompatibleLanguageModel({
    modelId: navigatorModel.modelName,
    apiKey,
    baseUrl: provider.baseUrl,
    providerId: navigatorModel.provider,
    adapterType: loopAdapterType(provider),
  });
  if (!model) throw markSetupError(t('bg_setup_noNavigatorModel'));
  return model;
}

function successCuesFromInstruction(instruction: string): string[] {
  const cues: string[] = [];
  const form = parseFormFillSubmitInstruction(instruction);
  if (form?.successText) cues.push(form.successText);
  for (const match of instruction.matchAll(/\bsuccess\s+is\s+["'“]?([^"'”.;\n]+)/gi)) {
    const text = match[1]?.replace(/\s+/g, ' ').trim();
    if (text) cues.push(text);
  }
  return [...new Set(cues.filter(Boolean))];
}

function planCriteriaFromInstruction(instruction: string): CompletionCriterionDraft[] {
  return successCuesFromInstruction(instruction).map(expected => ({
    kind: 'page_text',
    operator: 'present',
    expected,
    required: true,
  }));
}

async function doneIfPageAlreadyShowsSuccess(
  instruction: string,
  observe: ToolLoopBrowser['observe'],
): Promise<string | null> {
  const cues = successCuesFromInstruction(instruction);
  if (cues.length === 0) return null;
  const page = await observe().catch(() => null);
  if (!page) return null;
  const visible = (page.visibleText || page.text || '').trim();
  return cues.find(cue => pageShowsFormSuccess(visible, cue)) ?? null;
}

function loopAdapterType(provider: ProviderConfig): string {
  const type = String(provider.type || '');
  if (type === 'openai') return 'native_openai';
  return 'openai_compatible';
}

async function createKernelBrowser(
  input: ExecutorInput,
  hooks: ExecutorHooks,
  browserContext: BrowserContext,
  roundId: () => string,
): Promise<ToolLoopBrowser> {
  const providers = await llmProviderStore.getAllProviders();
  const agentModels = await agentModelStore.getAllAgentModels();
  const navigatorModel = agentModels[AgentNameEnum.Navigator] ?? agentModels[AgentNameEnum.Planner];
  if (!navigatorModel || !providers[navigatorModel.provider]) throw markSetupError(t('bg_setup_noNavigatorModel'));
  const extractor = await createChatModel(providers[navigatorModel.provider], navigatorModel);

  const firewall = await firewallStore.getFirewall();
  const generalSettings = await generalSettingsStore.getSettings();
  browserContext.updateConfig({
    allowedUrls: firewall.enabled ? firewall.allowList : [],
    deniedUrls: firewall.enabled ? firewall.denyList : [],
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000,
    displayHighlights: generalSettings.displayHighlights,
  });

  const agentContext = new AgentContext(input.taskId, browserContext, new MessageManager(), new EventManager(), {
    maxSteps: generalSettings.maxSteps,
    maxFailures: generalSettings.maxFailures,
    maxActionsPerStep: DEFAULT_AGENT_OPTIONS.maxActionsPerStep,
    useVision: generalSettings.useVision,
    planningInterval: generalSettings.planningInterval,
  });
  const registry = registryFromActions(new ActionBuilder(agentContext, extractor).buildDefaultActions());
  const kernel = createBrowserKernel({
    browserContext,
    agentContext,
    hooks,
    resolveAction: name => registry.get(name),
    defaultUseVision: generalSettings.useVision,
  });
  let attached = false;
  const attach = async () => {
    if (attached) return;
    await browserContext.switchTab(input.tabId);
    attached = true;
  };
  return {
    observe: async query => {
      await attach();
      const frame = await kernel.observe({ query, waitForLoad: false });
      return {
        text: frame.text,
        visibleText: frame.visibleText,
        url: frame.tab.url,
        title: frame.tab.title,
        pageRevision: frame.pageRevision,
      };
    },
    act: async (name, args) => {
      await attach();
      return kernel.act(roundId(), name, args, kernel.lastFrame()?.pageRevision);
    },
  };
}

export async function createToolLoopControlDriver(
  input: ExecutorInput,
  hooks: ExecutorHooks,
  browserContext: BrowserContext,
  options: ToolLoopControlOptions = {},
): Promise<ExecutorDriver> {
  await ensurePersonalDefaults();
  const model = options.model ?? (await resolveLoopModel());
  let activeRoundId = input.roundId;
  const runBrowser =
    options.runBrowser ?? (await createKernelBrowser(input, hooks, browserContext, () => activeRoundId));
  const generalSettings = await generalSettingsStore
    .getSettings()
    .catch(() => ({ maxSteps: DEFAULT_AGENT_OPTIONS.maxSteps }));
  const maxSteps = options.maxSteps ?? generalSettings.maxSteps ?? DEFAULT_AGENT_OPTIONS.maxSteps;

  const followUps: string[] = [];
  let paused = false;
  let stopped = false;
  let resumeWaiters: Array<() => void> = [];
  let doneSummary: string | null = null;
  let waitingUser: WaitReason | null = null;
  const runController = new AbortController();

  const waitIfPaused = async () => {
    while (paused && !stopped) {
      await new Promise<void>(resolve => {
        resumeWaiters.push(resolve);
      });
    }
  };
  const wakeWaiters = () => {
    const waiters = resumeWaiters;
    resumeWaiters = [];
    for (const wait of waiters) wait();
  };

  return {
    run: async (roundId: string): Promise<ExecutorOutcome> => {
      activeRoundId = roundId;
      logger.info('tool-loop control run', { taskId: input.taskId, roundId });
      try {
        await hooks.onPlan(roundId, planCriteriaFromInstruction(input.instruction));
      } catch (error) {
        logger.error('onPlan failed', error);
        return { kind: 'failed', category: 'on_plan_failed' };
      }

      const state = {
        stopped: () => stopped,
        waitIfPaused,
        setDone: (summary: string) => {
          doneSummary = summary;
        },
        setWaitingUser: (reason: WaitReason) => {
          waitingUser = reason;
        },
      };
      const tools = createToolLoopControlTools(runBrowser, state);
      const agent = new ToolLoopAgent({
        model,
        instructions: TOOL_LOOP_CONTROL_INSTRUCTIONS,
        tools,
        stopWhen: [isStepCount(Math.max(1, maxSteps)), () => stopped || doneSummary !== null || waitingUser !== null],
      });
      const prompt = [input.instruction, ...followUps].filter(Boolean).join('\n');
      try {
        await agent.generate({ prompt, abortSignal: runController.signal });
      } catch (error) {
        if (stopped || runController.signal.aborted) return { kind: 'cancelled' };
        logger.error('tool-loop generate failed', error);
        return { kind: 'failed', category: 'llm_failed' };
      }
      if (stopped) return { kind: 'cancelled' };
      if (waitingUser) return { kind: 'waiting_user', reason: waitingUser };
      if (!doneSummary) {
        doneSummary = await doneIfPageAlreadyShowsSuccess(prompt, runBrowser.observe);
      }
      if (doneSummary) return { kind: 'candidate_complete', summary: doneSummary };
      return { kind: 'failed', category: 'max_steps' };
    },
    addFollowUp: instruction => {
      followUps.push(instruction);
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      wakeWaiters();
    },
    stop: async () => {
      stopped = true;
      paused = false;
      runController.abort();
      wakeWaiters();
    },
  };
}
