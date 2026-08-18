import { generalSettingsStore } from '@extension/storage';
import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import type { AgentEvent } from './event/types';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput } from '../task/contracts';
import { createNanoExecutorDriver } from './backends/nano';
import { createLlmControlDriver } from './backends/control-llm';
import {
  createControlLoopDriver,
  type ControlLoopOptions,
  type ControlScriptStep,
} from './backends/control-loop';
import {
  DEFAULT_AGENT_CORE_BACKEND,
  parseAgentCoreBackend,
  type AgentCoreBackend,
} from './backends/types';
import { PERSONAL_AGENT_CORE_BACKEND } from '../../personal/config';

const logger = createLogger('ExecutorFactory');

export const browserContext = new BrowserContext({});

export type { AgentCoreBackend, ControlScriptStep, ControlLoopOptions };

export interface CreateExecutorDriverOptions {
  /** Force backend (tests / explicit wiring). */
  backend?: AgentCoreBackend;
  /** Scripted control steps (tests / deterministic fixtures). */
  control?: ControlLoopOptions;
  onEvent?: (event: AgentEvent) => void;
}

/**
 * Resolve production backend: explicit option → personal config → general settings → default.
 * After LLM control ships, default may flip to `control` (design/002).
 */
export async function resolveAgentCoreBackend(explicit?: AgentCoreBackend): Promise<AgentCoreBackend> {
  if (explicit) return explicit;
  if (PERSONAL_AGENT_CORE_BACKEND) return parseAgentCoreBackend(PERSONAL_AGENT_CORE_BACKEND);
  try {
    const settings = await generalSettingsStore.getSettings();
    const fromSettings = (settings as { agentCoreBackend?: string }).agentCoreBackend;
    if (fromSettings) return parseAgentCoreBackend(fromSettings);
  } catch {
    // settings unavailable in unit tests
  }
  return DEFAULT_AGENT_CORE_BACKEND;
}

export async function createExecutorDriver(
  input: ExecutorInput,
  hooks: ExecutorHooks,
  onEventOrOptions?: ((event: AgentEvent) => void) | CreateExecutorDriverOptions,
  maybeOptions?: CreateExecutorDriverOptions,
): Promise<ExecutorDriver> {
  // Backward compatible: (input, hooks, onEvent) as used by background/index.ts
  let options: CreateExecutorDriverOptions = {};
  if (typeof onEventOrOptions === 'function') {
    options = { ...maybeOptions, onEvent: onEventOrOptions };
  } else if (onEventOrOptions) {
    options = onEventOrOptions;
  }

  const backend = await resolveAgentCoreBackend(options.backend);
  logger.info('createExecutorDriver', { backend, taskId: input.taskId });

  if (backend === 'control') {
    if (options.control?.steps?.length) {
      return createControlLoopDriver(input, hooks, options.control);
    }
    // Production: LLM control under TaskManager (G6)
    return createLlmControlDriver(input, hooks, browserContext);
  }

  return createNanoExecutorDriver(input, hooks, browserContext, options.onEvent);
}
