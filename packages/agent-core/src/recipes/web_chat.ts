import { streamAsRecipeEvents } from './stream';
import type { Recipe, RecipeContext } from './types';

/** Plain chat: pass the conversation through to the runtime. */
export const webChatRecipe: Recipe = {
  id: 'web_chat',
  requiredCapabilities: ['chat'],
  run(ctx: RecipeContext) {
    return streamAsRecipeEvents(ctx.runtime, ctx.model, ctx.messages, ctx.signal);
  },
};
