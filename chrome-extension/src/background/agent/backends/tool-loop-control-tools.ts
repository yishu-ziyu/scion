import { tool } from 'ai';
import { z } from 'zod';
import { ALL_ACTION_SCHEMAS } from '../actions/schemas';
import { EVERYDAY_CONTROL_ACTION_NAMES } from './control-policy';
import { DEFAULT_VISIBLE_TEXT_CHARS, normalizeVisiblePageText } from '../../browser/kernel/visible-text';
import type { KernelActionResult } from '../../browser/kernel/types';

export type ToolLoopPage = {
  text: string;
  visibleText?: string;
  url?: string;
  title?: string;
  pageRevision?: string;
};

export interface ToolLoopBrowser {
  observe: (query?: string) => Promise<ToolLoopPage>;
  act: (name: string, args: Record<string, unknown>) => Promise<KernelActionResult>;
}

export interface ToolLoopRunState {
  stopped: () => boolean;
  waitIfPaused: () => Promise<void>;
  setDone: (summary: string) => void;
  setWaitingUser: (reason: 'login_required' | 'captcha_required' | 'target_missing' | 'target_ambiguous') => void;
}

const WAIT_REASON = z.enum(['login_required', 'captcha_required', 'target_missing', 'target_ambiguous']);

function capPage(page: ToolLoopPage): ToolLoopPage {
  return {
    ...page,
    text: normalizeVisiblePageText(page.text, DEFAULT_VISIBLE_TEXT_CHARS),
  };
}

function toolDescription(name: string, description: string, whenToUse?: string): string {
  return whenToUse ? `${description} ${whenToUse}` : description;
}

/** Native tools for open / click / observe / done. Execute goes through the existing kernel. */
export function createToolLoopControlTools(browser: ToolLoopBrowser, state: ToolLoopRunState) {
  const tools: Record<string, ReturnType<typeof tool>> = {};

  const runAct = async (name: string, args: Record<string, unknown>) => {
    await state.waitIfPaused();
    if (state.stopped()) return { error: 'stopped' };
    if (name === 'done') {
      const summary = (typeof args.text === 'string' ? args.text.trim() : '') || 'Done.';
      state.setDone(summary);
      return { ok: true, summary };
    }
    if (name === 'observe' || name === 'read_page_text') {
      const query = typeof args.query === 'string' ? args.query : undefined;
      return capPage(await browser.observe(query));
    }
    const result = await browser.act(name, args);
    const page = capPage(await browser.observe());
    return { error: result.error ?? null, isDone: Boolean(result.isDone), summary: result.summary ?? null, page };
  };

  for (const spec of ALL_ACTION_SCHEMAS) {
    if (!EVERYDAY_CONTROL_ACTION_NAMES.includes(spec.name as (typeof EVERYDAY_CONTROL_ACTION_NAMES)[number])) continue;
    const schema = spec.schema;
    tools[spec.name] = tool({
      description: toolDescription(spec.name, spec.description, spec.whenToUse),
      inputSchema: schema as z.ZodType,
      execute: async (args: Record<string, unknown>) => runAct(spec.name, args && typeof args === 'object' ? args : {}),
    });
  }

  tools.wait_for_user = tool({
    description: 'Stop and wait when the page needs login, a captcha, or a missing/ambiguous target.',
    inputSchema: z.object({ reason: WAIT_REASON }),
    execute: async ({ reason }: { reason: z.infer<typeof WAIT_REASON> }) => {
      await state.waitIfPaused();
      if (state.stopped()) return { error: 'stopped' };
      state.setWaitingUser(reason);
      return { ok: true, reason };
    },
  });

  return tools;
}
