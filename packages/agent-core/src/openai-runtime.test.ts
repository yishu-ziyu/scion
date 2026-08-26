import type { ModelDescriptor, ProviderProfile } from '@extension/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleRuntime } from './openai-runtime';
import type { TurnStreamEvent } from './types';

const provider: ProviderProfile = {
  id: 'minimax',
  adapterType: 'openai_compatible',
  baseUrl: 'https://api.minimaxi.com/v1',
  apiKeyRef: 'ref-minimax',
  enabled: true,
  declaredCapabilities: ['chat'],
};

const model: ModelDescriptor = {
  providerId: 'minimax',
  modelId: 'MiniMax-M3',
  capabilities: ['chat'],
  supportsStreaming: true,
};

function sseBody(payload: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(payload);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function fetchReturning(response: Partial<Response>): typeof fetch {
  return vi.fn(async () => response as Response) as unknown as typeof fetch;
}

async function collect(runtime: ReturnType<typeof createOpenAICompatibleRuntime>): Promise<TurnStreamEvent[]> {
  const events: TurnStreamEvent[] = [];
  for await (const event of runtime.streamTurn([{ role: 'user', content: '你好' }], model)) {
    events.push(event);
  }
  return events;
}

describe('createOpenAICompatibleRuntime', () => {
  it('streams deltas then done from an SSE body', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const fetchImpl = fetchReturning({ ok: true, status: 200, body: sseBody(sse) });
    const runtime = createOpenAICompatibleRuntime(model, 'sk-test', provider, { fetchImpl });

    const events = await collect(runtime);

    expect(events).toEqual([
      { type: 'delta', text: '你' },
      { type: 'delta', text: '好' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://api.minimaxi.com/v1/chat/completions');
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'MiniMax-M3',
      stream: true,
      messages: [{ role: 'user', content: '你好' }],
    });
  });

  it('emits done once when the stream ends without a finish reason', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\ndata: [DONE]\n\n';
    const runtime = createOpenAICompatibleRuntime(model, 'sk-test', provider, {
      fetchImpl: fetchReturning({ ok: true, status: 200, body: sseBody(sse) }),
    });

    const events = await collect(runtime);

    expect(events).toEqual([{ type: 'delta', text: 'hi' }, { type: 'done' }]);
  });

  it('turns a non-200 response into one error event with the body excerpt', async () => {
    const runtime = createOpenAICompatibleRuntime(model, 'sk-bad', provider, {
      fetchImpl: fetchReturning({
        ok: false,
        status: 401,
        text: async () => '{"error":{"message":"invalid api key"}}',
      }),
    });

    const events = await collect(runtime);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect((events[0] as { error: Error }).error.message).toContain('HTTP 401');
    expect((events[0] as { error: Error }).error.message).toContain('invalid api key');
  });

  it('turns an SSE error payload into an error event', async () => {
    const sse = 'data: {"error":{"message":"rate limited"}}\n\n';
    const runtime = createOpenAICompatibleRuntime(model, 'sk-test', provider, {
      fetchImpl: fetchReturning({ ok: true, status: 200, body: sseBody(sse) }),
    });

    const events = await collect(runtime);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect((events[0] as { error: Error }).error.message).toContain('rate limited');
  });

  it('yields an error when the provider has no baseUrl', async () => {
    const runtime = createOpenAICompatibleRuntime(model, 'sk-test', { ...provider, baseUrl: undefined });
    const events = await collect(runtime);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect((events[0] as { error: Error }).error.message).toContain('baseUrl');
  });

  it('yields an error when fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const runtime = createOpenAICompatibleRuntime(model, 'sk-test', provider, { fetchImpl });

    const events = await collect(runtime);

    expect(events).toEqual([{ type: 'error', error: new Error('network down') }]);
  });
});
