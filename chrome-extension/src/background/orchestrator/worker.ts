import { isStepCount, ToolLoopAgent, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import { DEFAULT_VISIBLE_TEXT_CHARS } from '../browser/kernel/visible-text';
import { WORKER_INSTRUCTIONS } from './prompts';
import { runBrowserWork } from './operate';
import { toDelegateResult } from './result';
import type { DelegateResult, OrchestratorHost, WorkBrief } from './types';

function capPageText(text: string): string {
  return text.length <= DEFAULT_VISIBLE_TEXT_CHARS ? text : text.slice(0, DEFAULT_VISIBLE_TEXT_CHARS);
}

/** Drop a pasted page body from the worker's user-facing summary. */
function withoutRawPage(summary: string, pageText: string): string {
  const needle = capPageText(pageText).slice(0, 80);
  if (needle.length < 80) return summary.trim();
  const at = summary.indexOf(needle);
  return (at === -1 ? summary : summary.slice(0, at)).trim();
}

function readPageTool(host: OrchestratorHost, capture: { text: string; url?: string }) {
  return tool({
    description: 'Read visible text from the current web page. Use this when the brief needs the current page.',
    inputSchema: z.object({
      reason: z.string().optional(),
    }),
    execute: async () => {
      const page = await host.readCurrentPage?.();
      if (!page) return { ok: false as const, error: 'Current page is not available.' };
      if (!page.ok) return page;
      capture.text = page.text;
      capture.url = page.url;
      return { ok: true as const, title: page.title, url: page.url, text: capPageText(page.text) };
    },
  });
}

function operateBrowserTool(brief: WorkBrief, sessionId: string, host: OrchestratorHost) {
  return tool({
    description: 'Start or continue the browser operator for this session. Call once and wait for the outcome.',
    inputSchema: z.object({
      reason: z.string().optional(),
    }),
    execute: async (_input, { abortSignal }) => runBrowserWork(brief, sessionId, host, abortSignal),
  });
}

export async function runWorker(input: {
  brief: WorkBrief;
  model: LanguageModel;
  host: OrchestratorHost;
  sessionId: string;
  abortSignal?: AbortSignal;
}): Promise<DelegateResult> {
  const tools: Record<string, ReturnType<typeof tool>> = {};
  const capture = { text: '', url: undefined as string | undefined };
  if (input.brief.needs_current_page) tools.read_current_page = readPageTool(input.host, capture);
  if (input.brief.may_operate_browser) {
    tools.operate_browser = operateBrowserTool(input.brief, input.sessionId, input.host);
  }

  const worker = new ToolLoopAgent({
    model: input.model,
    instructions: WORKER_INSTRUCTIONS,
    tools,
    stopWhen: isStepCount(8),
  });
  const prompt = [
    `Goal: ${input.brief.goal}`,
    `Instructions: ${input.brief.instructions}`,
    `Success criteria: ${input.brief.success_criteria}`,
  ].join('\n');
  const result = await worker.generate({ prompt, abortSignal: input.abortSignal });
  return toDelegateResult({
    summary: withoutRawPage(result.text ?? '', capture.text),
    did_operate_browser: Boolean(
      result.steps?.some(step => step.toolCalls?.some(call => call.toolName === 'operate_browser')),
    ),
    page_url: capture.url,
  });
}
