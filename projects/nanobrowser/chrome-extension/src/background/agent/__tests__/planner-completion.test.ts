import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { id: 'test-extension' } },
  });
});

vi.mock('@extension/storage', () => ({
  ProviderTypeEnum: {
    Llama: 'llama',
    CustomOpenAI: 'custom_openai',
    OpenAI: 'openai',
  },
}));

import { plannerOutputSchema } from '../agents/planner';
import { plannerSystemPromptTemplate } from '../prompts/templates/planner';
import { navigatorSystemPromptTemplate } from '../prompts/templates/navigator';

describe('Planner completion contract', () => {
  it('defaults to no criteria and no waiting-user request', () => {
    const parsed = plannerOutputSchema.parse({});
    expect(parsed.completion_criteria).toEqual([]);
    expect(parsed.waiting_user).toBeNull();
  });

  it('accepts bounded observable criteria and typed manual intervention', () => {
    const parsed = plannerOutputSchema.parse({
      done: false,
      completion_criteria: [{ kind: 'page_text', operator: 'present', expected: 'Saved successfully', required: true }],
      waiting_user: { reason: 'login_required', message: 'Please sign in manually.' },
    });
    expect(parsed).toMatchObject({
      done: false,
      completion_criteria: [{ kind: 'page_text', expected: 'Saved successfully' }],
      waiting_user: { reason: 'login_required' },
    });
  });

  it('keeps login and CAPTCHA prompts out of automated success paths', () => {
    expect(plannerSystemPromptTemplate).toContain('set done=false and waiting_user.reason="login_required"');
    expect(plannerSystemPromptTemplate).toContain('set done=false and waiting_user.reason="captcha_required"');
    expect(navigatorSystemPromptTemplate).not.toContain('try to solve it');
    expect(navigatorSystemPromptTemplate).toContain('never solve or bypass it');
  });
});
