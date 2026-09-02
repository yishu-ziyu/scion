// @vitest-environment jsdom
// EPIC D4 mount-level integration tests:
//  - AC6: after the service worker restarts (port disconnect) the side panel
//    automatically reconnects and re-subscribes with a fresh snapshot request.
//  - AC3: a duplicated task_event (same or stale revision) must not change the
//    rendered task surface.
// All heavy child components are stubbed; only SidePanel's own connection +
// snapshot-merge wiring is under test.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskSnapshot } from '@extension/storage';

const mocks = vi.hoisted(() => {
  const createdPorts: Array<{
    name: string;
    posted: unknown[];
    messageListeners: Array<(message: unknown) => void>;
    disconnectListeners: Array<() => void>;
  }> = [];
  const makePort = () => {
    const port = {
      name: 'side-panel-connection',
      posted: [] as unknown[],
      messageListeners: [] as Array<(message: unknown) => void>,
      disconnectListeners: [] as Array<() => void>,
      onMessage: {
        addListener: (fn: (message: unknown) => void) => port.messageListeners.push(fn),
        removeListener: () => undefined,
      },
      onDisconnect: {
        addListener: (fn: () => void) => port.disconnectListeners.push(fn),
        removeListener: () => undefined,
      },
      postMessage: (message: unknown) => port.posted.push(message),
      disconnect: () => undefined,
    };
    createdPorts.push(port);
    return port;
  };
  return { createdPorts, connect: vi.fn(() => makePort()) };
});

vi.mock('@extension/storage', () => ({
  Actors: { SYSTEM: 'system', USER: 'user', PLANNER: 'planner', NAVIGATOR: 'navigator', VALIDATOR: 'validator' },
  ProviderTypeEnum: { OpenAI: 'openai', Ollama: 'ollama' },
  chatHistoryStore: {
    addMessage: vi.fn(async (_sessionId: string, message: unknown) => message),
    createSession: vi.fn(async () => ({ id: 'session-1', messages: [] })),
    getSession: vi.fn(async () => null),
    getSessionsMetadata: vi.fn(async () => []),
    deleteSession: vi.fn(async () => undefined),
  },
  agentModelStore: { getModel: vi.fn(async () => ({ provider: 'openai', modelName: 'gpt-test' })) },
  llmProviderStore: { getProvider: vi.fn(async () => ({ type: 'openai', apiKey: 'sk-test' })) },
  getEvidenceSpace: vi.fn(async () => null),
}));

vi.mock('@extension/storage/lib/prompt/favorites', () => ({
  default: {
    getAllPrompts: vi.fn(async () => []),
    subscribe: vi.fn(() => () => undefined),
    addPrompt: vi.fn(async () => undefined),
    removePrompt: vi.fn(async () => undefined),
    reorderPrompts: vi.fn(async () => undefined),
    updatePromptTitle: vi.fn(async () => undefined),
  },
}));

vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

vi.mock('../components/MessageList', () => ({
  default: () => createElement('div', { 'data-testid': 'message-list' }),
}));
vi.mock('../components/ChatInput', () => ({ default: () => createElement('div', { 'data-testid': 'chat-input' }) }));
vi.mock('../components/ChatHistoryList', () => ({ default: () => null }));
vi.mock('../components/BookmarkList', () => ({ default: () => null }));
vi.mock('../components/SidePanelHeader', () => ({ SidePanelHeader: () => null }));
vi.mock('../components/FirstRunSetup', () => ({ default: () => null }));
vi.mock('../components/IdleHome', () => ({ IdleHome: () => null }));
vi.mock('../components/MotionPrimitives', () => ({
  MatrixLoader: () => null,
  PanelReveal: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));
// The stub renders exactly what SidePanel decided to display; the real card's
// internals are covered elsewhere. Revision in the DOM proves the merge result.
vi.mock('../components/TaskStatusCard', () => ({
  TaskStatusCard: ({ snapshot }: { snapshot: { revision: number; status: string } }) =>
    createElement('div', {
      'data-testid': 'task-card',
      'data-revision': String(snapshot.revision),
      'data-status': snapshot.status,
    }),
}));

type FakePort = (typeof mocks.createdPorts)[number];

const completedSnapshot = (revision: number) =>
  ({
    id: 'task-d4-mount',
    goalSummary: 'Keep the durable task visible',
    status: 'completed',
    revision,
    activeTabId: 1,
    currentRoundId: 'round-1',
    targetRefs: [],
    rounds: [],
    createdAt: 1,
    updatedAt: 1,
  }) as unknown as TaskSnapshot;

const taskEventMessage = (snapshot: TaskSnapshot) => ({
  type: 'task_event',
  event: {
    taskId: snapshot.id,
    roundId: snapshot.currentRoundId,
    revision: snapshot.revision,
    snapshot,
  },
});

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

const deliver = async (port: FakePort, message: unknown) => {
  await act(async () => {
    for (const listener of port.messageListeners) listener(message);
  });
};

const cardRevision = (container: HTMLElement) =>
  container.querySelector('[data-testid="task-card"]')?.getAttribute('data-revision') ?? null;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  mocks.connect.mockClear();
  mocks.createdPorts.length = 0;
  vi.stubGlobal('chrome', {
    runtime: { connect: mocks.connect, lastError: undefined, getURL: (path: string) => `chrome-extension://x/${path}` },
    storage: { onChanged: { addListener: () => undefined, removeListener: () => undefined } },
    tabs: { query: async () => [] },
    windows: { create: () => undefined, onRemoved: { addListener: () => undefined, removeListener: () => undefined } },
  });
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement((await import('../SidePanel')).default));
  });
  await flush();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe('SidePanel task subscription (mount)', () => {
  it('AC6: re-subscribes with a fresh snapshot request after the service worker disconnect', async () => {
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledWith({ name: 'side-panel-connection' });
    const firstPort = mocks.createdPorts[0];
    // The initial subscription is a reconnect-style active-task snapshot request.
    expect(firstPort.posted).toContainEqual({ type: 'get_active_task' });

    // Simulate the service worker restarting: the port drops.
    await act(async () => {
      for (const listener of firstPort.disconnectListeners) listener();
    });
    // scheduleReconnect waits 500ms before re-running setupConnection.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
    });

    expect(mocks.connect).toHaveBeenCalledTimes(2);
    const secondPort = mocks.createdPorts[1];
    expect(secondPort).not.toBe(firstPort);
    expect(secondPort.posted).toContainEqual({ type: 'get_active_task' });
  });

  it('AC3: duplicate and stale-revision task_events never change the rendered task', async () => {
    const revision5 = completedSnapshot(5);
    await deliver(mocks.createdPorts[0], { type: 'task_snapshot', snapshot: revision5 });
    expect(cardRevision(container)).toBe('5');

    // Exact same revision re-broadcast: the surface must not move.
    await deliver(mocks.createdPorts[0], taskEventMessage(revision5));
    expect(cardRevision(container)).toBe('5');

    // A newer revision does advance the surface...
    const revision6 = completedSnapshot(6);
    await deliver(mocks.createdPorts[0], taskEventMessage(revision6));
    expect(cardRevision(container)).toBe('6');

    // ...and a late duplicate of the older revision must not roll it back.
    await deliver(mocks.createdPorts[0], taskEventMessage(revision5));
    expect(cardRevision(container)).toBe('6');
    // No duplicate event may trigger an extra snapshot request on the port.
    expect(mocks.createdPorts[0].posted).toEqual([{ type: 'get_active_task' }]);
  });
});
