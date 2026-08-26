/**
 * Minimal OpenAI-compatible `chat.completions` SSE stream parser.
 * No langchain, no SDK: `data:` line framing, `[DONE]` termination, error
 * payloads thrown. Used by local direct-to-provider adapters.
 */

export interface ChatCompletionChunk {
  /** `choices[0].delta.content`; may be empty for role-only or final chunks. */
  content: string;
  finishReason: string | null;
  /** The parsed JSON payload of this `data:` event. */
  raw: unknown;
}

export class SseStreamError extends Error {
  constructor(
    message: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'SseStreamError';
  }
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

function suffixPrefixLength(value: string, marker: string): number {
  const maxLength = Math.min(value.length, marker.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (value.endsWith(marker.slice(0, length))) return length;
  }
  return 0;
}

/** Remove model reasoning while retaining state across streamed content chunks. */
function createThinkFilter() {
  let inThink = false;
  let buffered = '';

  const push = (text: string): string => {
    buffered += text;
    let visible = '';

    while (buffered) {
      const marker = inThink ? THINK_CLOSE : THINK_OPEN;
      const markerIndex = buffered.indexOf(marker);
      if (markerIndex !== -1) {
        if (!inThink) visible += buffered.slice(0, markerIndex);
        buffered = buffered.slice(markerIndex + marker.length);
        inThink = !inThink;
        continue;
      }

      const partialLength = suffixPrefixLength(buffered, marker);
      if (inThink) {
        buffered = partialLength > 0 ? buffered.slice(-partialLength) : '';
      } else {
        visible += buffered.slice(0, buffered.length - partialLength);
        buffered = partialLength > 0 ? buffered.slice(-partialLength) : '';
      }
      break;
    }

    return visible;
  };

  return { push };
}

/**
 * Parse one SSE event payload (the joined `data:` lines). Returns the chunk,
 * or null when the payload was the `[DONE]` sentinel.
 */
export function parseChatCompletionPayload(payload: string): ChatCompletionChunk | null {
  const trimmed = payload.trim();
  if (trimmed === '[DONE]') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    throw new SseStreamError(`invalid JSON in SSE data: ${trimmed.slice(0, 120)}`, cause);
  }
  const record = parsed as {
    error?: { message?: string };
    choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string | null }>;
  };
  if (record.error) {
    throw new SseStreamError(record.error.message ?? 'provider returned an error payload', parsed);
  }
  const choice = record.choices?.[0];
  const content = typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
  return { content, finishReason: choice?.finish_reason ?? null, raw: parsed };
}

type AssembleResult = { chunk: ChatCompletionChunk } | { done: true } | null;

/**
 * Per-event state: `data:` lines accumulate until a blank line ends the
 * event; the joined payload is then parsed. Per the SSE spec, multiple
 * `data:` lines of one event join with a newline.
 */
function createEventAssembler() {
  let dataLines: string[] = [];

  const flushEvent = (): AssembleResult => {
    if (dataLines.length === 0) return null;
    const payload = dataLines.join('\n');
    dataLines = [];
    const chunk = parseChatCompletionPayload(payload);
    return chunk === null ? { done: true } : { chunk };
  };

  const pushLine = (rawLine: string): AssembleResult => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') return flushEvent();
    if (line.startsWith(':')) return null; // comment / keep-alive
    if (line.startsWith('data:')) {
      dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
    }
    // event:/id:/retry: fields carry no meaning for this protocol; ignore.
    return null;
  };

  return { pushLine, flushEvent };
}

/** Split a response body into lines, tolerating chunks that end mid-line. */
async function* streamLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (done && buffer !== '') buffer += '\n'; // treat an unterminated tail as a final line
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) yield line;
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream-parse a `chat.completions` response body. Yields one chunk per
 * `data:` event until `[DONE]` or the stream ends.
 */
export async function* parseChatCompletionsSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatCompletionChunk> {
  const assembler = createEventAssembler();
  const thinkFilter = createThinkFilter();
  for await (const line of streamLines(body)) {
    const result = assembler.pushLine(line);
    if (result && 'done' in result) return;
    if (result) yield { ...result.chunk, content: thinkFilter.push(result.chunk.content) };
  }
  const tail = assembler.flushEvent();
  if (tail && 'done' in tail) return;
  if (tail) yield { ...tail.chunk, content: thinkFilter.push(tail.chunk.content) };
}
