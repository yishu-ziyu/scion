import { describe, expect, it } from 'vitest';
import { buildControlUserPrompt, memoryAfterAction } from '../control-llm';
import { formatUserMemoryForPrompt } from '../../user-memory';

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
    expect(prompt).toContain('Verified pages:\n1. url=https://www.iana.org title=Internet Assigned Numbers Authority');
    expect(prompt).toContain('Current page: https://www.iana.org');
    expect(prompt.indexOf('Task:')).toBeLessThan(prompt.indexOf('Verified pages:'));
    expect(prompt.indexOf('Verified pages:')).toBeLessThan(prompt.indexOf('Current page:'));
  });

  it('inserts user-established facts after Task and does not include the raw note', () => {
    const userMemory = formatUserMemoryForPrompt([
      {
        id: '1',
        kind: '常用邮箱',
        value: 'mail.google.com',
        sourceText: '我常用谷歌邮箱',
        updatedAt: 1,
      },
    ]);
    const prompt = buildControlUserPrompt({
      instruction: '打开邮箱',
      step: 0,
      maxSteps: 20,
      criteriaLocked: true,
      contextBlock: 'Current page: https://example.test',
      lastActionMemory: null,
      statusBar: '',
      verifiedPages: [],
      userMemory,
    });
    expect(prompt).toContain('Task:\n打开邮箱');
    expect(prompt).toContain('- 常用邮箱: mail.google.com');
    expect(prompt).not.toContain('我常用谷歌邮箱');
    expect(prompt.indexOf('Task:')).toBeLessThan(prompt.indexOf('User-established facts'));
    expect(prompt.indexOf('User-established facts')).toBeLessThan(prompt.indexOf('Current page:'));
  });

  it('puts a failed click_element error in last_action_result for the next decide', () => {
    const lastActionMemory = memoryAfterAction('click_element', {
      error: 'Needs index or query. Did not act.',
    });
    expect(lastActionMemory).toBe('click_element failed: Needs index or query. Did not act.');
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
      '<last_action_result>\nclick_element failed: Needs index or query. Did not act.\n</last_action_result>',
    );
  });

  it('omits last_action_result after a successful click that is not kept', () => {
    const afterFail = memoryAfterAction('click_element', {
      error: 'Needs index or query. Did not act.',
    });
    const afterSuccess = memoryAfterAction('click_element', { summary: 'Clicked Submit' });
    expect(afterFail).toContain('Needs index or query. Did not act.');
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
    expect(prompt).not.toContain('Needs index or query. Did not act.');
  });
});
