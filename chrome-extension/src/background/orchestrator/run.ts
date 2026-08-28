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

function createOrchestratorAgent(input: {
  model: LanguageModel;
  workerModel: LanguageModel;
  host: OrchestratorHost;
  sessionId: string;
  onWorkerStart?: () => boolean;
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
          return runWorker({
            brief,
            model: input.workerModel,
            host: input.host,
            sessionId: input.sessionId,
            abortSignal,
          });
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
  const agent = createOrchestratorAgent({
    model: input.model,
    workerModel,
    host: input.host,
    sessionId: input.sessionId,
    onWorkerStart: () => input.onEvent({ type: 'worker_started' }),
  });
  const result = await agent.stream({ messages: input.messages });
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      const text = deltaText(part);
      if (text && !input.onEvent({ type: 'delta', text })) return;
    } else if (part.type === 'error') {
      input.onEvent({ type: 'error', error: part.error instanceof Error ? part.error.message : String(part.error) });
      return;
    }
  }
  input.onEvent({ type: 'done' });
}
