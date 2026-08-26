import type { Capability, ModelDescriptor } from '@extension/contracts';
import type { AgentRuntime, ChatTurn } from '../types';

export interface PageContext {
  url: string;
  title: string;
  /** Extracted readable text of the page. */
  text: string;
}

export interface RecipeContext {
  runtime: AgentRuntime;
  model: ModelDescriptor;
  /** Conversation so far; recipes may append to or replace it. */
  messages: ChatTurn[];
  page?: PageContext;
  signal?: AbortSignal;
}

export type RecipeEvent = { type: 'token'; text: string } | { type: 'done' } | { type: 'error'; text: string };

/**
 * A named way of using a model. `requiredCapabilities` declares what the
 * model must support; `run` only sees an already-built runtime, so recipes
 * stay provider-agnostic.
 */
export interface Recipe {
  id: string;
  requiredCapabilities: Capability[];
  run(ctx: RecipeContext): AsyncIterable<RecipeEvent>;
}
