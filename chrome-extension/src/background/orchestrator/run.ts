import { isStepCount, ToolLoopAgent, tool, type LanguageModel, type ModelMessage } from 'ai';
import { z } from 'zod';
import { ORCHESTRATOR_INSTRUCTIONS } from './prompts';
import { toDelegateResult } from './result';
import type { OrchestratorHost, OrchestratorStreamEvent, WorkBrief } from './types';
import { runWorker } from './worker';

const briefSchema = z.object({
  goal: z.string(),
  instructions: z.string(),
  success_criteria: z.string(),
  needs_current_page: z.boolean(),
  may_operate_browser: z.boolean(),
});

function deltaText(part: { type: string; text?: unknown; delta?: unknown }): string {
  if (typeof part.text === 'string' && part.text) return part.text;
  if (typeof part.delta === 'string' && part.delta) return part.delta;
  return '';
}

function lastUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    if (!Array.isArray(message.content)) continue;
    return message.content
      .map(part => (typeof part === 'object' && part && 'text' in part ? String(part.text ?? '') : ''))
      .join('');
  }
  return '';
}

function createOrchestratorAgent(input: {
  model: LanguageModel;
  workerModel: LanguageModel;
  host: OrchestratorHost;
  sessionId: string;
  userText?: string;
  onWorkerStart?: () => boolean;
  onWorkSummary?: (summary: string) => void;
}): ToolLoopAgent {
  return new ToolLoopAgent({
    model: input.model,
    instructions: ORCHESTRATOR_INSTRUCTIONS,
    allowSystemInMessages: true,
    stopWhen: isStepCount(8),
    tools: {
      delegate_work: tool({
        description:
          'Delegate page reading or browser operation to a worker. The worker returns only a short summary. You must call this when the user needs the current page or the browser.',
        inputSchema: briefSchema,
        execute: async (brief: WorkBrief, { abortSignal }) => {
          if (input.onWorkerStart && !input.onWorkerStart()) {
            return toDelegateResult({ summary: 'Stopped.', did_operate_browser: false });
          }
          const output = await runWorker({
            brief,
            model: input.workerModel,
            host: input.host,
            sessionId: input.sessionId,
            abortSignal,
            userText: input.userText,
          });
          if (output.summary) input.onWorkSummary?.(output.summary);
          return output;
        },
        toModelOutput: ({ output }) => ({ type: 'text' as const, value: JSON.stringify(toDelegateResult(output)) }),
      }),
    },
  });
}

/** Stream one orchestrator turn onto onEvent. Tool results are summaries only. */
export async function runOrchestratorTurn(input: {
  model: LanguageModel;
  messages: ModelMessage[];
  host: OrchestratorHost;
  sessionId: string;
  onEvent: (event: OrchestratorStreamEvent) => boolean;
}): Promise<void> {
  const workerModel = input.host.workerModel ?? input.model;
  let workSummary = '';
  const agent = createOrchestratorAgent({
    model: input.model,
    workerModel,
    host: input.host,
    sessionId: input.sessionId,
    userText: lastUserText(input.messages),
    onWorkerStart: () => input.onEvent({ type: 'worker_started' }),
    onWorkSummary: summary => {
      workSummary = summary;
    },
  });
  const result = await agent.stream({ messages: input.messages });
  let spoken = '';
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      const text = deltaText(part);
      if (text) {
        spoken += text;
        if (!input.onEvent({ type: 'delta', text })) return;
      }
    } else if (part.type === 'error') {
      input.onEvent({ type: 'error', error: part.error instanceof Error ? part.error.message : String(part.error) });
      return;
    }
  }
  if (!spoken.trim() && workSummary && !input.onEvent({ type: 'delta', text: workSummary })) return;
  input.onEvent({ type: 'done' });
}
