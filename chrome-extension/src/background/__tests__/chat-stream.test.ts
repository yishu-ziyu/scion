import { Actors, AgentNameEnum } from '@extension/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatTurn, TurnStreamEvent } from '@extension/agent-core';
import {
  CHAT_STREAM_UNBOUND_ERROR,
  chatFeatureBinding,
  createChatStreamHandler,
  parseChatStreamRequest,
  type ChatStreamDeps,
  type ChatStreamEvent,
} from '../chat-stream';

function makePort() {
  const sent: ChatStreamEvent[] = [];
  return {
    sent,
    postMessage: vi.fn((message: ChatStreamEvent) => {
      sent.push(message);
    }),
  };
}

function stubRuntime(events: TurnStreamEvent[], seen?: { messages?: ChatTurn[] }) {
  return {
    async *streamTurn(messages: ChatTurn[]) {
      seen && (seen.messages = messages);
      for (const event of events) yield event;
    },
  };
}

const baseDeps: ChatStreamDeps = {
  getProviders: async () => ({
    minimax: {
      name: 'MiniMax',
      type: 'custom_openai' as never,
      apiKey: '',
      apiKeyRef: 'ref-minimax',
      baseUrl: 'https://api.minimaxi.com/v1',
      modelNames: ['MiniMax-M3'],
    },
  }),
  getAgentModels: async () => ({
    [AgentNameEnum.Navigator]: { provider: 'minimax', modelName: 'MiniMax-M3' },
  }),
  getApiKey: async ref => (ref === 'ref-minimax' ? 'sk-real' : null),
  getSessionMessages: async () => null,
  runtimeFactory: (model, apiKey) => {
    factoryCalls.push([model.modelId, apiKey]);
    return stubRuntime(runtimeEvents, seenTurns);
  },
};

let factoryCalls: Array<[string, string]>;
let runtimeEvents: TurnStreamEvent[];
let seenTurns: { messages?: ChatTurn[] };

beforeEach(() => {
  factoryCalls = [];
  runtimeEvents = [
    { type: 'delta', text: '你' },
    { type: 'delta', text: '好' },
    { type: 'done', finishReason: 'stop' },
  ];
  seenTurns = {};
});

describe('chat_stream handler', () => {
  it('resolves navigator model, reads key from vault, streams deltas to the port', async () => {
    const port = makePort();
    const handler = createChatStreamHandler(baseDeps);

    await handler({ sessionId: 's1', text: '你好' }, port);

    expect(port.sent).toEqual([
      { type: 'chat_stream_delta', sessionId: 's1', text: '你' },
      { type: 'chat_stream_delta', sessionId: 's1', text: '好' },
      { type: 'chat_stream_done', sessionId: 's1' },
    ]);
    // key material reached the factory, never the port
    expect(factoryCalls).toEqual([['MiniMax-M3', 'sk-real']]);
    const leaked = JSON.stringify(port.sent);
    expect(leaked).not.toContain('sk-real');
    // no history -> single user turn
    expect(seenTurns.messages).toEqual([{ role: 'user', content: '你好' }]);
  });

  it('builds conversation turns from session history without duplicating the current text', async () => {
    const port = makePort();
    const handler = createChatStreamHandler({
      ...baseDeps,
      getSessionMessages: async () => [
        { actor: Actors.USER, content: '之前的问题' },
        { actor: Actors.SYSTEM, content: '之前的回答' },
        { actor: Actors.USER, content: '你好' },
      ],
    });

    await handler({ sessionId: 's1', text: '你好' }, port);

    expect(seenTurns.messages).toEqual([
      { role: 'user', content: '之前的问题' },
      { role: 'assistant', content: '之前的回答' },
      { role: 'user', content: '你好' },
    ]);
    expect(port.sent.at(-1)).toEqual({ type: 'chat_stream_done', sessionId: 's1' });
  });

  it('grounds chat in saved sources and names the top source', async () => {
    const port = makePort();
    const handler = createChatStreamHandler({
      ...baseDeps,
      recallSavedSources: async () => [
        {
          sourceId: 'source:1',
          title: 'Plant energy',
          url: 'https://biology.example/photosynthesis',
          snippet: 'Photosynthesis turns sunlight into chemical energy.',
        },
      ],
    });

    await handler({ sessionId: 's1', text: '光合作用怎么工作' }, port);

    expect(port.sent[0]).toEqual({
      type: 'chat_stream_source',
      sessionId: 's1',
      source: { title: 'Plant energy', url: 'https://biology.example/photosynthesis' },
    });
    expect(seenTurns.messages?.[0]).toMatchObject({ role: 'system' });
    expect(seenTurns.messages?.[0]?.content).toContain('Photosynthesis turns sunlight');
    expect(seenTurns.messages?.at(-1)).toEqual({ role: 'user', content: '光合作用怎么工作' });
  });

  it('reports 未绑定 chat 模型 when neither navigator nor planner is configured', async () => {
    const port = makePort();
    const handler = createChatStreamHandler({ ...baseDeps, getAgentModels: async () => ({}) });

    await handler({ sessionId: 's1', text: '你好' }, port);

    expect(port.sent).toEqual([{ type: 'chat_stream_error', sessionId: 's1', error: CHAT_STREAM_UNBOUND_ERROR }]);
    expect(factoryCalls).toEqual([]);
  });

  it('reports a missing api key as a stream error', async () => {
    const port = makePort();
    const handler = createChatStreamHandler({ ...baseDeps, getApiKey: async () => null });

    await handler({ sessionId: 's1', text: '你好' }, port);

    expect(port.sent).toHaveLength(1);
    expect(port.sent[0].type).toBe('chat_stream_error');
    expect((port.sent[0] as { error: string }).error).toContain('API key');
    expect(factoryCalls).toEqual([]);
  });

  it('forwards runtime errors as chat_stream_error', async () => {
    runtimeEvents = [{ type: 'error', error: new Error('HTTP 401 — invalid api key') }];
    const port = makePort();
    const handler = createChatStreamHandler(baseDeps);

    await handler({ sessionId: 's1', text: '你好' }, port);

    expect(port.sent).toEqual([{ type: 'chat_stream_error', sessionId: 's1', error: 'HTTP 401 — invalid api key' }]);
  });

  it('falls back to planner when navigator is missing', () => {
    const binding = chatFeatureBinding({
      [AgentNameEnum.Planner]: { provider: 'minimax', modelName: 'MiniMax-M3' },
    });
    expect(binding).toEqual({ primaryModel: 'MiniMax-M3', fallbackModels: [] });
  });
});

describe('parseChatStreamRequest', () => {
  it('accepts a well-formed request and rejects the rest', () => {
    expect(parseChatStreamRequest({ type: 'chat_stream', sessionId: 's1', text: '你好' })).toEqual({
      sessionId: 's1',
      text: '你好',
    });
    expect(parseChatStreamRequest({ type: 'chat_stream', sessionId: '', text: '你好' })).toBeNull();
    expect(parseChatStreamRequest({ type: 'chat_stream', sessionId: 's1', text: '  ' })).toBeNull();
    expect(parseChatStreamRequest({ type: 'heartbeat' })).toBeNull();
    expect(parseChatStreamRequest(null)).toBeNull();
  });
});
