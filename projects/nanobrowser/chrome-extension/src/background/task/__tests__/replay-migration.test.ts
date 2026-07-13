import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('legacy replay migration', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({
              chat_agent_step_a: { history: 'secret' },
              chat_agent_step_b: { history: 'secret' },
              chat_messages_a: [{ content: 'user-authored instruction' }],
            }),
            set: vi.fn(),
            remove: vi.fn(),
            onChanged: { addListener: vi.fn() },
          },
        },
      },
    });
  });

  it('removes only raw agent-step keys', async () => {
    const { removeLegacyAgentStepHistories } = await import('@extension/storage/lib/chat/history');
    await removeLegacyAgentStepHistories();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['chat_agent_step_a', 'chat_agent_step_b']);
  });

  it('contains no replay caller or raw action-argument logger', () => {
    const root = resolve(process.cwd(), 'src/background');
    const source = [
      'index.ts',
      'agent/executor.ts',
      'agent/agents/navigator.ts',
      'agent/actions/builder.ts',
      'browser/page.ts',
    ]
      .map(file => readFileSync(resolve(root, file), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/replayHistory|executeHistoryStep|JSON\.stringify\(actionArgs/);
    expect(source).not.toContain("logger.info('Actions'");
    expect(source).not.toMatch(/logger\.info\('sendKeys complete', keys|logger\.info\('convertedKey'/);
  });
});
