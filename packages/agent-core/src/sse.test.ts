import { describe, expect, it } from 'vitest';
import { parseChatCompletionsSse, parseChatCompletionPayload, SseStreamError } from './sse';

function streamOf(payload: string, chunkSize = 1024): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(payload);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

async function collect(payload: string, chunkSize?: number): Promise<string[]> {
  const contents: string[] = [];
  for await (const chunk of parseChatCompletionsSse(streamOf(payload, chunkSize))) {
    // role-only / final chunks carry no content; collect text deltas only
    if (chunk.content !== '') contents.push(chunk.content);
  }
  return contents;
}

const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`;

describe('parseChatCompletionsSse', () => {
  it('yields content deltas in order until [DONE]', async () => {
    const payload = delta('Hello') + delta(', ') + delta('world') + 'data: [DONE]\n\n';
    expect(await collect(payload)).toEqual(['Hello', ', ', 'world']);
  });

  it('stops at [DONE] and ignores trailing events', async () => {
    const payload = delta('a') + 'data: [DONE]\n\n' + delta('b');
    expect(await collect(payload)).toEqual(['a']);
  });

  it('handles events split across arbitrary byte boundaries', async () => {
    const payload = delta('split') + delta('chunks') + 'data: [DONE]\n\n';
    expect(await collect(payload, 7)).toEqual(['split', 'chunks']);
  });

  it('skips comment lines, non-data fields, and content-less chunks', async () => {
    const payload =
      ': keep-alive\n\n' +
      'event: message\n' +
      'id: 1\n' +
      delta('x') +
      `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' }, finish_reason: null }] })}\n\n` +
      delta('y') +
      'data: [DONE]\n\n';
    expect(await collect(payload)).toEqual(['x', 'y']);
  });

  it('joins multiple data: lines of one event with a newline', async () => {
    // Newline lands between JSON tokens, so the joined payload stays valid JSON.
    const payload =
      'data: {"choices":[{"delta":{"content":"joined"}\n' + 'data: ,"finish_reason":null}]}\n\n' + 'data: [DONE]\n\n';
    expect(await collect(payload)).toEqual(['joined']);
  });

  it('throws SseStreamError on an error payload', async () => {
    const payload =
      `data: ${JSON.stringify({ error: { message: 'model overloaded', type: 'server_error' } })}\n\n` +
      'data: [DONE]\n\n';
    await expect(collect(payload)).rejects.toThrowError(SseStreamError);
    await expect(collect(payload)).rejects.toThrowError('model overloaded');
  });

  it('throws SseStreamError on invalid JSON', async () => {
    await expect(collect('data: {not json\n\n')).rejects.toThrowError(SseStreamError);
  });

  it('flushes a trailing event that is not followed by a blank line', async () => {
    expect(await collect(delta('tail').replace(/\n\n$/, ''))).toEqual(['tail']);
  });
});

describe('parseChatCompletionPayload', () => {
  it('returns null for [DONE]', () => {
    expect(parseChatCompletionPayload('[DONE]')).toBeNull();
  });

  it('extracts finishReason', () => {
    const chunk = parseChatCompletionPayload(JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    expect(chunk?.finishReason).toBe('stop');
  });
});
