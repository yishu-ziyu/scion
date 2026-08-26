import type { ModelDescriptor, ProviderProfile } from '@extension/contracts';
import { parseChatCompletionsSse } from './sse';
import type { AgentRuntime, ChatTurn } from './types';

export interface OpenAICompatibleRuntimeOptions {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

/**
 * Direct OpenAI-compatible `chat.completions` streaming over fetch + SSE.
 * Matches `RuntimeFactory`: build one per (model, apiKey, provider) triple.
 * The api key material enters here and never leaves the request headers.
 */
export function createOpenAICompatibleRuntime(
  model: ModelDescriptor,
  apiKey: string,
  provider: ProviderProfile,
  options: OpenAICompatibleRuntimeOptions = {},
): AgentRuntime {
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  return {
    async *streamTurn(messages: ChatTurn[], _model: ModelDescriptor, signal?: AbortSignal) {
      if (!provider.baseUrl) {
        yield { type: 'error', error: new Error(`provider "${provider.id}" has no baseUrl`) };
        return;
      }
      let response: Response;
      try {
        response = await fetchImpl(chatCompletionsUrl(provider.baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            ...provider.customHeaders,
          },
          body: JSON.stringify({
            model: model.modelId,
            stream: true,
            messages: messages.map(message => ({ role: message.role, content: message.content })),
          }),
          signal: signal ?? null,
        });
      } catch (cause) {
        yield { type: 'error', error: toError(cause) };
        return;
      }
      if (!response.ok || !response.body) {
        const detail = await readErrorBody(response);
        yield {
          type: 'error',
          error: new Error(`chat.completions failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`),
        };
        return;
      }
      try {
        let finished = false;
        for await (const chunk of parseChatCompletionsSse(response.body)) {
          if (chunk.content) yield { type: 'delta', text: chunk.content };
          if (chunk.finishReason) {
            finished = true;
            yield { type: 'done', finishReason: chunk.finishReason };
          }
        }
        if (!finished) yield { type: 'done' };
      } catch (cause) {
        yield { type: 'error', error: toError(cause) };
      }
    },
  };
}
