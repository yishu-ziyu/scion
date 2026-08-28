import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Actors, type Message } from '@extension/storage';
import { applyChatStreamDelta } from '../chat-turn';

const here = dirname(fileURLToPath(import.meta.url));
const sidePanelSource = readFileSync(resolve(here, '../../SidePanel.tsx'), 'utf8');
const chatTurnSource = readFileSync(resolve(here, '../chat-turn.ts'), 'utf8');

describe('composer send path', () => {
  it('does not regex-route SidePanel sends via classifyChatTurn', () => {
    expect(sidePanelSource).not.toContain('classifyChatTurn');
    expect(chatTurnSource).not.toContain('classifyChatTurn');
    expect(sidePanelSource).not.toContain('OPERATION_INTENT');
    expect(sidePanelSource).not.toContain('PAGE_SUMMARY_INTENT');
    expect(sidePanelSource).not.toContain("route === 'task'");
    expect(sidePanelSource).not.toContain('page_summary_stream');
    expect(sidePanelSource).toContain("type: 'chat_stream'");
    expect(sidePanelSource).toContain('sendChatStreamMessage');
  });

  it('must not hardcode translation or 这一页 as a product route in the send path', () => {
    expect(sidePanelSource).not.toMatch(/translate this page/);
    expect(sidePanelSource).not.toContain('这一页');
    expect(chatTurnSource).not.toContain('这一页');
  });
});

describe('applyChatStreamDelta', () => {
  const stream = { sessionId: 's1', timestamp: 100, text: '' };
  const user: Message = { actor: Actors.USER, content: '你好', timestamp: 99 };

  it('creates the assistant message on the first delta', () => {
    const next = applyChatStreamDelta([user], stream, '你');
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ actor: Actors.SYSTEM, content: '你', timestamp: 100 });
  });

  it('appends later deltas to the same message', () => {
    const start = applyChatStreamDelta([user], stream, '你');
    const next = applyChatStreamDelta(start, stream, '好');
    expect(next).toHaveLength(2);
    expect(next[1].content).toBe('你好');
  });

  it('never grows the user message', () => {
    const colliding = { ...user, timestamp: 100 };
    const next = applyChatStreamDelta([colliding], stream, 'x');
    expect(next).toHaveLength(2);
    expect(next[0].content).toBe('你好');
  });
});
