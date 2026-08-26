import type { ModelDescriptor, ProviderProfile } from '@extension/contracts';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatAttachment {
  kind: 'text' | 'image';
  /** Plain text for `text`; a data/blob URL for `image`. */
  data: string;
  name?: string;
}

export interface ChatTurn {
  role: ChatRole;
  content: string;
  attachments?: ChatAttachment[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  /** Raw JSON string of the tool arguments, exactly as streamed by the model. */
  argumentsJson: string;
}

/**
 * Incremental events of one streamed turn. `delta` and `token` both carry
 * generated text; `token` is kept for runtimes that emit one event per token
 * while `delta` may carry larger chunks. Consumers should treat them alike.
 */
export type TurnStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'token'; text: string }
  | { type: 'tool_call'; call: ToolCallRequest }
  | { type: 'done'; finishReason?: string }
  | { type: 'error'; error: Error };

/**
 * One model behind one provider, able to stream a turn. Implementations live
 * outside this package (chrome-extension adapters, local fetch adapters); the
 * core never imports chrome.* or a concrete SDK.
 */
export interface AgentRuntime {
  streamTurn(messages: ChatTurn[], model: ModelDescriptor, signal?: AbortSignal): AsyncIterable<TurnStreamEvent>;
}

/** Build a runtime for a concrete model once the api key material is known. */
export type RuntimeFactory = (model: ModelDescriptor, apiKey: string, provider: ProviderProfile) => AgentRuntime;
