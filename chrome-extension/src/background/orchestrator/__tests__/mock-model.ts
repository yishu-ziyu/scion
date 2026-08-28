import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

export const MOCK_USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

export function textStreamResult(chunks: string[]) {
  const parts: unknown[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'text-1' },
  ];
  for (const chunk of chunks) {
    parts.push({ type: 'text-delta', id: 'text-1', delta: chunk });
  }
  parts.push(
    { type: 'text-end', id: 'text-1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: MOCK_USAGE },
  );
  return {
    stream: simulateReadableStream({ chunks: parts, initialDelayInMs: null, chunkDelayInMs: null }),
  };
}

export function toolCallStreamResult(toolName: string, input: unknown) {
  const json = JSON.stringify(input);
  return {
    stream: simulateReadableStream({
      initialDelayInMs: null,
      chunkDelayInMs: null,
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-input-start', id: 'call-1', toolName },
        { type: 'tool-input-delta', id: 'call-1', delta: json },
        { type: 'tool-input-end', id: 'call-1' },
        { type: 'tool-call', toolCallId: 'call-1', toolName, input: json },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: MOCK_USAGE },
      ],
    }),
  };
}

export function textGenerateResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: MOCK_USAGE,
    warnings: [],
  };
}

export function toolCallGenerateResult(toolName: string, input: unknown) {
  return {
    content: [
      {
        type: 'tool-call' as const,
        toolCallId: 'call-1',
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: 'tool-calls' as const, raw: undefined },
    usage: MOCK_USAGE,
    warnings: [],
  };
}

export { MockLanguageModelV4 };
