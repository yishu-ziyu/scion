import BrowserContext from '../browser/context';
import { createLogger } from '../log';
import type { AgentEvent } from './event/types';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput } from '../task/contracts';
import { createLlmControlDriver } from './backends/control-llm';
import { createControlLoopDriver, type ControlLoopOptions, type ControlScriptStep } from './backends/control-loop';

const logger = createLogger('ExecutorFactory');

export const browserContext = new BrowserContext({});

export type { ControlScriptStep, ControlLoopOptions };

export interface CreateExecutorDriverOptions {
  /** Scripted control steps (tests / deterministic fixtures). */
  control?: ControlLoopOptions;
}

/**
 * Production driver: LLM control under TaskManager.
 * Pass `control.steps` only in tests for a scripted loop.
 */
export async function createExecutorDriver(
  input: ExecutorInput,
  hooks: ExecutorHooks,
  onEventOrOptions?: ((event: AgentEvent) => void) | CreateExecutorDriverOptions,
  maybeOptions?: CreateExecutorDriverOptions,
): Promise<ExecutorDriver> {
  let options: CreateExecutorDriverOptions = {};
  if (typeof onEventOrOptions === 'function') {
    options = { ...maybeOptions };
  } else if (onEventOrOptions) {
    options = onEventOrOptions;
  }

  logger.info('createExecutorDriver', { taskId: input.taskId });

  if (options.control?.steps?.length) {
    return createControlLoopDriver(input, hooks, options.control);
  }
  return createLlmControlDriver(input, hooks, browserContext);
}
