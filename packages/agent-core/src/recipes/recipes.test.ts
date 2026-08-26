import type { ModelDescriptor } from '@extension/contracts';
import { describe, expect, it } from 'vitest';
import { pageSummaryRecipe, runRecipe, webChatRecipe, type RecipeEvent } from '.';
import type { AgentRuntime, ChatTurn, TurnStreamEvent } from '../types';

const model: ModelDescriptor = { providerId: 'p', modelId: 'm', capabilities: ['chat'], supportsStreaming: true };

function mockRuntime(events: TurnStreamEvent[], captured?: { messages?: ChatTurn[] }): AgentRuntime {
  return {
    async *streamTurn(messages: ChatTurn[]): AsyncGenerator<TurnStreamEvent> {
      if (captured) captured.messages = messages;
      for (const event of events) yield event;
    },
  };
}

async function collect(iterable: AsyncIterable<RecipeEvent>): Promise<RecipeEvent[]> {
  const events: RecipeEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('web_chat recipe', () => {
  it('streams delta/token text, then done', async () => {
    const events = await collect(
      runRecipe(webChatRecipe, {
        runtime: mockRuntime([
          { type: 'delta', text: 'Hel' },
          { type: 'token', text: 'lo' },
          { type: 'done', finishReason: 'stop' },
        ]),
        model,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(events).toEqual([{ type: 'token', text: 'Hel' }, { type: 'token', text: 'lo' }, { type: 'done' }]);
  });

  it('passes the conversation through unchanged', async () => {
    const captured: { messages?: ChatTurn[] } = {};
    const messages: ChatTurn[] = [
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi', attachments: [{ kind: 'text', data: 'note' }] },
    ];
    await collect(runRecipe(webChatRecipe, { runtime: mockRuntime([{ type: 'done' }], captured), model, messages }));

    expect(captured.messages).toBe(messages);
  });

  it('turns runtime errors and throws into error events', async () => {
    const viaEvent = await collect(
      runRecipe(webChatRecipe, {
        runtime: mockRuntime([{ type: 'error', error: new Error('boom') }]),
        model,
        messages: [],
      }),
    );
    expect(viaEvent).toEqual([{ type: 'error', text: 'boom' }]);

    const viaThrow = await collect(
      runRecipe(webChatRecipe, {
        runtime: {
          // eslint-disable-next-line require-yield
          async *streamTurn(): AsyncGenerator<TurnStreamEvent> {
            throw new Error('network down');
          },
        },
        model,
        messages: [],
      }),
    );
    expect(viaThrow).toEqual([{ type: 'error', text: 'network down' }]);
  });

  it('refuses to run when the model lacks a required capability', async () => {
    const blind: ModelDescriptor = { ...model, capabilities: ['embedding'] };
    const events = await collect(runRecipe(webChatRecipe, { runtime: mockRuntime([]), model: blind, messages: [] }));

    expect(events).toEqual([{ type: 'error', text: 'model m lacks capabilities: chat' }]);
  });
});

describe('page_summary recipe', () => {
  const page = { url: 'https://example.com/a', title: 'An article', text: 'Full article text.' };

  it('sends page context plus the last user question to the runtime', async () => {
    const captured: { messages?: ChatTurn[] } = {};
    const events = await collect(
      runRecipe(pageSummaryRecipe, {
        runtime: mockRuntime([{ type: 'delta', text: 'summary' }, { type: 'done' }], captured),
        model,
        messages: [{ role: 'user', content: '重点是什么？' }],
        page,
      }),
    );

    expect(events).toEqual([{ type: 'token', text: 'summary' }, { type: 'done' }]);
    const [system, user] = captured.messages ?? [];
    expect(system?.role).toBe('system');
    expect(user?.role).toBe('user');
    expect(user?.content).toContain('https://example.com/a');
    expect(user?.content).toContain('Full article text.');
    expect(user?.content).toContain('重点是什么？');
  });

  it('yields an error event when no page is attached', async () => {
    const events = await collect(runRecipe(pageSummaryRecipe, { runtime: mockRuntime([]), model, messages: [] }));

    expect(events).toEqual([{ type: 'error', text: 'page_summary recipe requires ctx.page' }]);
  });
});
