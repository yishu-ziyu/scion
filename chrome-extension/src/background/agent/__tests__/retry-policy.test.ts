import { describe, expect, it } from 'vitest';
import { classifyRetry } from '../retry-policy';

describe('classifyRetry', () => {
  it('retries infrastructure noise', () => {
    expect(classifyRetry('request timed out')).toBe('retry');
    expect(classifyRetry('network error')).toBe('retry');
    expect(classifyRetry('llm_failed')).toBe('retry');
  });

  it('retries stale click/input locate misses from page.ts', () => {
    expect(classifyRetry('Element: [object Object] not found')).toBe('retry');
    expect(classifyRetry('Element: foo not found')).toBe('retry');
    expect(classifyRetry('Failed to click element: … not found')).toBe('retry');
    expect(classifyRetry('Failed to click element: [object Object]. Error: Element: [object Object] not found')).toBe(
      'retry',
    );
    expect(
      classifyRetry('Failed to input text into element: [object Object]. Error: Element: [object Object] not found'),
    ).toBe('retry');
    expect(classifyRetry(new Error('Element: [object Object] not found'))).toBe('retry');
    expect(classifyRetry('Element not found or puppeteer is not connected')).toBe('retry');
    expect(classifyRetry('Dropdown element with index 3 not found')).toBe('retry');
  });

  it('retries kernel/dispatcher stale-index and stale-frame errors', () => {
    expect(classifyRetry('stale_task_round')).toBe('retry');
    expect(classifyRetry('Action pageRevision does not match current observation')).toBe('retry');
    expect(classifyRetry('Target ref is not valid for current observation')).toBe('retry');
    expect(classifyRetry('索引为 5 的元素不存在，请重试或改用其他操作')).toBe('retry');
    expect(classifyRetry('No control matched query="提交". Candidates: (none). Did not act.')).toBe('retry');
  });

  it('does not retry deterministic invalid calls, including inside page.ts wraps', () => {
    expect(classifyRetry('Invalid input: index is NaN')).toBe('no_retry');
    expect(classifyRetry('unknown action')).toBe('no_retry');
    expect(classifyRetry('unknown action click_element')).toBe('no_retry');
    expect(classifyRetry('permission denied')).toBe('no_retry');
    expect(classifyRetry('forbidden')).toBe('no_retry');
    expect(classifyRetry('unauthorized')).toBe('no_retry');
    expect(classifyRetry('model_not_found')).toBe('no_retry');
    expect(classifyRetry('Session not found')).toBe('no_retry');
    expect(classifyRetry('Failed to click element: [object Object]. Error: permission denied')).toBe('no_retry');
    expect(classifyRetry('Failed to click element: [object Object]. Error: Invalid input: index is NaN')).toBe(
      'no_retry',
    );
  });

  it('escalates budget exhaustion', () => {
    expect(classifyRetry('max failures reached')).toBe('escalate');
    expect(classifyRetry('max steps')).toBe('escalate');
  });
});
