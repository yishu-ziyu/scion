import { describe, expect, it } from 'vitest';
import { buildControlUserPrompt, memoryAfterAction } from '../control-llm';

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

  it('puts a failed click_element error in last_action_result for the next decide', () => {
    const lastActionMemory = memoryAfterAction('click_element', {
      error: 'Needs index or query. Did not click.',
    });
    expect(lastActionMemory).toBe('click_element failed: Needs index or query. Did not click.');
    const prompt = buildControlUserPrompt({
      instruction: 'click submit',
      step: 0,
      maxSteps: 20,
      criteriaLocked: true,
      contextBlock: 'Current page: https://example.test',
      lastActionMemory,
      statusBar: '',
      verifiedPages: [],
    });
    expect(prompt).toContain(
      '<last_action_result>\nclick_element failed: Needs index or query. Did not click.\n</last_action_result>',
    );
  });

  it('omits last_action_result after a successful click that is not kept', () => {
    const afterFail = memoryAfterAction('click_element', {
      error: 'Needs index or query. Did not click.',
    });
    const afterSuccess = memoryAfterAction('click_element', { summary: 'Clicked Submit' });
    expect(afterFail).toContain('Needs index or query. Did not click.');
    expect(afterSuccess).toBeNull();
    const prompt = buildControlUserPrompt({
      instruction: 'click submit',
      step: 1,
      maxSteps: 20,
      criteriaLocked: true,
      contextBlock: 'Current page: https://example.test',
      lastActionMemory: afterSuccess,
      statusBar: '',
      verifiedPages: [],
    });
    expect(prompt).not.toContain('<last_action_result>');
    expect(prompt).not.toContain('Needs index or query. Did not click.');
  });
});
