import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ExecuteScriptDetails = {
  target?: unknown;
  func?: unknown;
  args?: unknown[];
  files?: string[];
};

const { executeScript } = vi.hoisted(() => {
  const executeScript = vi.fn();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { id: 'test-extension' },
      scripting: { executeScript },
    },
  });
  return { executeScript };
});

import { getMarkdownContent, injectBuildDomTreeScripts } from '../service';

function requests(): ExecuteScriptDetails[] {
  return executeScript.mock.calls.map(call => call[0] as ExecuteScriptDetails);
}

describe('DOM service host-script contracts', () => {
  beforeEach(() => {
    executeScript.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['eval()', '</script>'] as const)(
    'keeps hostile-looking selector text %s in executeScript.args instead of source',
    async selector => {
      executeScript.mockResolvedValue([{ result: 'markdown' }]);

      await expect(getMarkdownContent(7, selector)).resolves.toBe('markdown');

      const [request] = requests();
      expect(request.target).toEqual({ tabId: 7 });
      expect(request.args).toEqual([selector]);
      expect(request.func).toEqual(expect.any(Function));
      expect(String(request.func)).not.toContain(selector);
      expect(request.files).toBeUndefined();
    },
  );

  it.each([
    {
      label: 'when the frame probe returns no frames',
      probeResult: [],
      expectedTarget: { tabId: 7 },
    },
    {
      label: 'when a frame needs the script',
      probeResult: [{ frameId: 3, result: false }],
      expectedTarget: { tabId: 7, frameIds: [3] },
    },
  ])('$label uses only function probes and the fixed buildDomTree.js file', async ({ probeResult, expectedTarget }) => {
    executeScript.mockResolvedValueOnce(probeResult).mockResolvedValueOnce([]);

    await injectBuildDomTreeScripts(7);

    const calls = requests();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.func).toEqual(expect.any(Function));
    expect(calls[0]?.files).toBeUndefined();
    expect(calls[1]).toEqual({ target: expectedTarget, files: ['buildDomTree.js'] });

    for (const call of calls) {
      if (call.func !== undefined) expect(call.func).toEqual(expect.any(Function));
      if (call.files !== undefined) expect(call.files).toEqual(['buildDomTree.js']);
    }
  });
});
