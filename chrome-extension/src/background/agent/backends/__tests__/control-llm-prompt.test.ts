import { describe, expect, it } from 'vitest';
import { buildControlUserPrompt } from '../control-llm';

describe('control user prompt verified pages', () => {
  it('inserts verified IANA url and title after Task and before the current page', () => {
    const instruction = '1) 打开 IANA 首页 2) 打开英文维基 Web_browser 3) 写出两个页面的标题';
    const prompt = buildControlUserPrompt({
      instruction,
      step: 1,
      maxSteps: 20,
      criteriaLocked: true,
      contextBlock: 'Current page: https://www.iana.org',
      lastActionMemory: null,
      statusBar: '',
      verifiedPages: [{ normalizedUrl: 'https://www.iana.org', title: 'Internet Assigned Numbers Authority' }],
    });
    expect(prompt).toContain(`Task:\n${instruction}`);
    expect(prompt).toContain(
      'Verified pages:\n1. url=https://www.iana.org title=Internet Assigned Numbers Authority',
    );
    expect(prompt).toContain('Current page: https://www.iana.org');
    expect(prompt.indexOf('Task:')).toBeLessThan(prompt.indexOf('Verified pages:'));
    expect(prompt.indexOf('Verified pages:')).toBeLessThan(prompt.indexOf('Current page:'));
  });
});
