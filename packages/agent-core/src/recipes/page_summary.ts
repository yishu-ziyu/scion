import type { ChatTurn } from '../types';
import { streamAsRecipeEvents } from './stream';
import type { Recipe, RecipeContext, RecipeEvent } from './types';

const SYSTEM_PROMPT =
  'You summarize web pages for a busy reader. Answer in the language of the user message. ' +
  'Lead with the main point, then a short bullet list of supporting facts. Do not invent content that is not on the page.';

export function buildPageSummaryMessages(ctx: RecipeContext): ChatTurn[] {
  const page = ctx.page;
  if (!page) {
    throw new Error('page_summary recipe requires ctx.page');
  }
  const lastUser = ctx.messages.at(-1);
  const question = lastUser?.content ?? '';
  const userContent = [
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    '',
    'Page text:',
    page.text,
    '',
    question ? `Reader question: ${question}` : 'Summarize this page.',
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent, attachments: lastUser?.attachments },
  ];
}

/** Summarize the currently attached page, optionally steered by the last user message. */
export const pageSummaryRecipe: Recipe = {
  id: 'page_summary',
  requiredCapabilities: ['chat'],
  async *run(ctx: RecipeContext): AsyncGenerator<RecipeEvent> {
    let messages: ChatTurn[];
    try {
      messages = buildPageSummaryMessages(ctx);
    } catch (error) {
      yield { type: 'error', text: error instanceof Error ? error.message : String(error) };
      return;
    }
    yield* streamAsRecipeEvents(ctx.runtime, ctx.model, messages, ctx.signal);
  },
};
