import { Actors, AgentNameEnum } from '@extension/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatTurn } from '@extension/agent-core';
import {
  CHAT_STREAM_UNBOUND_ERROR,
  chatFeatureBinding,
  createChatStreamHandler,
  parseChatStreamRequest,
  type ChatStreamDeps,
  type ChatStreamEvent,
} from '../chat-stream';
import {
  MockLanguageModelV4,
  textGenerateResult,
  textStreamResult,
  toolCallGenerateResult,
  toolCallStreamResult,
} from '../orchestrator/__tests__/mock-model';

function makePort() {
  const sent: ChatStreamEvent[] = [];
  return {
    sent,
    postMessage: vi.fn((message: ChatStreamEvent) => {
      sent.push(message);
    }),
  };
}

function stubRuntime() {
  return {
    async *streamTurn(_messages: ChatTurn[]) {
      yield { type: 'done' as const, finishReason: 'stop' };
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
    return stubRuntime();
  },
  createLanguageModel: ({ modelId, apiKey }) => {
    modelCalls.push([modelId, apiKey]);
    return languageModel;
  },
};

let factoryCalls: Array<[string, string]>;
let modelCalls: Array<[string, string]>;
let languageModel: MockLanguageModelV4;

beforeEach(() => {
  factoryCalls = [];
  modelCalls = [];
  languageModel = new MockLanguageModelV4({
    doStream: async () => textStreamResult(['你', '好']),
  });
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
    expect(modelCalls).toEqual([['MiniMax-M3', 'sk-real']]);
    const leaked = JSON.stringify(port.sent);
    expect(leaked).not.toContain('sk-real');
    expect(JSON.stringify(languageModel.doStreamCalls[0]?.prompt)).toContain('你好');
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

    const prompt = JSON.stringify(languageModel.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('之前的问题');
    expect(prompt).toContain('之前的回答');
    expect(prompt).toContain('你好');
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
    const prompt = JSON.stringify(languageModel.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('Photosynthesis turns sunlight');
    expect(prompt).toContain('光合作用怎么工作');
  });

  it('reports 未绑定 chat 模型 when neither navigator nor planner is configured', async () => {
    const port = makePort();
    const handler = createChatStreamHandler({ ...baseDeps, getAgentModels: async () => ({}) });

    await handler({ sessionId: 's1', text: '你好' }, port);

    expect(port.sent).toEqual([{ type: 'chat_stream_error', sessionId: 's1', error: CHAT_STREAM_UNBOUND_ERROR }]);
    expect(factoryCalls).toEqual([]);
    expect(modelCalls).toEqual([]);
  });

  it('reports a missing api key as a stream error', async () => {
    const port = makePort();
    const handler = createChatStreamHandler({ ...baseDeps, getApiKey: async () => null });

    await handler({ sessionId: 's1', text: '你好' }, port);

    expect(port.sent).toHaveLength(1);
    expect(port.sent[0].type).toBe('chat_stream_error');
    expect((port.sent[0] as { error: string }).error).toContain('API key');
    expect(factoryCalls).toEqual([]);
    expect(modelCalls).toEqual([]);
  });

  it('forwards runtime errors as chat_stream_error', async () => {
    languageModel = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('HTTP 401 — invalid api key');
      },
    });
    const port = makePort();
    const handler = createChatStreamHandler(baseDeps);

    await handler({ sessionId: 's1', text: '你好' }, port);

    expect(port.sent).toEqual([{ type: 'chat_stream_error', sessionId: 's1', error: 'HTTP 401 — invalid api key' }]);
  });

  it('does not read the page or dispatch a browser task for a chat-only 你好', async () => {
    const port = makePort();
    const readCurrentPage = vi.fn(async () => {
      throw new Error('chat-only must not read the page');
    });
    const dispatchTask = vi.fn(async () => {
      throw new Error('chat-only must not operate the browser');
    });
    const handler = createChatStreamHandler({ ...baseDeps, readCurrentPage, dispatchTask });

    await handler({ sessionId: 's1', text: '你好' }, port);

    expect(readCurrentPage).not.toHaveBeenCalled();
    expect(dispatchTask).not.toHaveBeenCalled();
    expect(port.sent.some(message => message.type === 'chat_stream_worker_started')).toBe(false);
    expect(port.sent.at(-1)).toEqual({ type: 'chat_stream_done', sessionId: 's1' });
  });

  it('delegates a page-needed turn without leaking the page dump to the orchestrator or user', async () => {
    const PAGE_MARKER = 'RAW_PAGE_DUMP_MARKER';
    const HUGE_PAGE = `${PAGE_MARKER} ${'x'.repeat(20_000)}`;
    const brief = {
      goal: 'Read the current page and answer',
      instructions: 'Read the current page and say what it is about.',
      success_criteria: 'A short answer about the page.',
      needs_current_page: true,
      may_operate_browser: false,
    };
    const worker = new MockLanguageModelV4({
      doGenerate: [toolCallGenerateResult('read_current_page', {}), textGenerateResult('The page is about widgets.')],
    });
    languageModel = new MockLanguageModelV4({
      doStream: [toolCallStreamResult('delegate_work', brief), textStreamResult(['The page is about widgets.'])],
    });
    let reads = 0;
    const port = makePort();
    const handler = createChatStreamHandler({
      ...baseDeps,
      workerModel: worker,
      readCurrentPage: async () => {
        reads += 1;
        return { ok: true, title: 'Example', url: 'https://example.test/', text: HUGE_PAGE };
      },
    });

    await handler({ sessionId: 's1', text: '这一页讲什么' }, port);

    expect(reads).toBe(1);
    expect(port.sent.some(message => message.type === 'chat_stream_worker_started')).toBe(true);
    const userText = port.sent
      .filter(
        (message): message is Extract<ChatStreamEvent, { type: 'chat_stream_delta' }> =>
          message.type === 'chat_stream_delta',
      )
      .map(message => message.text)
      .join('');
    expect(userText).toContain('The page is about widgets.');
    expect(userText).not.toContain(PAGE_MARKER);
    expect(JSON.stringify(port.sent)).not.toContain(PAGE_MARKER);
    expect(JSON.stringify(languageModel.doStreamCalls)).not.toContain(PAGE_MARKER);
    expect(JSON.stringify(languageModel.doStreamCalls[0]?.prompt)).toContain('这一页讲什么');
    expect(JSON.stringify(worker.doGenerateCalls)).toContain(PAGE_MARKER);
  });

  it('cancels a running task on a whole-message 停止 without calling the model', async () => {
    const cancelled: string[] = [];
    const port = makePort();
    const handler = createChatStreamHandler({
      ...baseDeps,
      createLanguageModel: () => {
        throw new Error('model must not be created');
      },
      getActiveTask: async () =>
        ({
          id: 's1',
          chatSessionId: 's1',
          status: 'running',
          revision: 3,
        }) as never,
      dispatchTask: async command => {
        cancelled.push(command.type);
        return { accepted: true, commandId: command.commandId, taskId: command.taskId, revision: 4 };
      },
    });

    await handler({ sessionId: 's1', text: '停止' }, port);

    expect(cancelled).toEqual(['cancel']);
    expect(port.sent).toEqual([
      { type: 'chat_stream_delta', sessionId: 's1', text: '好的，已停止。' },
      { type: 'chat_stream_done', sessionId: 's1' },
    ]);
    expect(modelCalls).toEqual([]);
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
