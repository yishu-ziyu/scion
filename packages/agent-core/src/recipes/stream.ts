import type { ModelDescriptor } from '@extension/contracts';
import type { AgentRuntime, ChatTurn } from '../types';
import type { Recipe, RecipeContext, RecipeEvent } from './types';

/** Collapse runtime stream events into the recipe vocabulary. */
export async function* streamAsRecipeEvents(
  runtime: AgentRuntime,
  model: ModelDescriptor,
  messages: ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<RecipeEvent> {
  try {
    for await (const event of runtime.streamTurn(messages, model, signal)) {
      if (event.type === 'delta' || event.type === 'token') {
        yield { type: 'token', text: event.text };
      } else if (event.type === 'done') {
        yield { type: 'done' };
      } else if (event.type === 'error') {
        yield { type: 'error', text: event.error.message };
      }
      // tool_call events are runtime-level; recipes that need them will
      // consume the runtime directly.
    }
  } catch (error) {
    yield { type: 'error', text: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Run a recipe after checking the resolved model declares every capability
 * the recipe needs. A missing capability yields a single error event instead
 * of running the recipe against a model that cannot serve it.
 */
export async function* runRecipe(recipe: Recipe, ctx: RecipeContext): AsyncGenerator<RecipeEvent> {
  const missing = recipe.requiredCapabilities.filter(capability => !ctx.model.capabilities.includes(capability));
  if (missing.length > 0) {
    yield { type: 'error', text: `model ${ctx.model.modelId} lacks capabilities: ${missing.join(', ')}` };
    return;
  }
  for await (const event of recipe.run(ctx)) {
    yield event;
  }
}
