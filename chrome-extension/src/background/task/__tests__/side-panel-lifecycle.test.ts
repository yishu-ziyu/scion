import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const backgroundSource = readFileSync(resolve(here, '../../index.ts'), 'utf8');

describe('side-panel task lifecycle', () => {
  it('does not interrupt an autonomous task when the observation surface disconnects', () => {
    const disconnectBlock = backgroundSource.slice(
      backgroundSource.indexOf('port.onDisconnect.addListener'),
      backgroundSource.indexOf("console.log('Side panel disconnected')") + 900,
    );

    expect(disconnectBlock).toContain('sidePanelPorts.release(port)');
    expect(disconnectBlock).not.toContain('taskManager.interruptActive()');
  });

  it('keeps debugger cancellation as an explicit interruption boundary', () => {
    const debuggerBlock = backgroundSource.slice(
      backgroundSource.indexOf('chrome.debugger.onDetach.addListener'),
      backgroundSource.indexOf('// Cleanup when tab is closed'),
    );

    expect(debuggerBlock).toContain('createDebuggerDetachHandler');
    expect(debuggerBlock).toContain('interruptActive: () => taskManager.interruptActive()');
    expect(debuggerBlock).not.toContain('cleanupBrowserContext: () => browserContext.cleanup()');
  });
});
