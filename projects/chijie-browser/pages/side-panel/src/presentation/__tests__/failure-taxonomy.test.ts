import { describe, expect, it, vi } from 'vitest';
import {
  PRODUCT_FAILURE_LABELS,
  isEngineerFailureNoise,
  productFailureLabel,
  toProductFailureCode,
} from '../failure-taxonomy';

// Product build of @extension/i18n calls chrome.i18n.getMessage; stub labels for unit env.
const PRODUCT_LABEL_BY_KEY: Record<string, string> = {
  chat_task_product_fail_login_wall: '需要登录或验证',
  chat_task_product_fail_selector_miss: '找不到要点的目标',
  chat_task_product_fail_approval_timeout: '等待确认超时',
  chat_task_product_fail_false_complete: '完成判定不可靠',
  chat_task_product_fail_model_loop: '任务陷入重复尝试',
  chat_task_product_fail_other: '任务未能完成',
};
vi.stubGlobal('chrome', {
  i18n: {
    getMessage: (key: string) => PRODUCT_LABEL_BY_KEY[key] ?? key,
  },
});

describe('Feature: user-visible failure categories (ticket 04)', () => {
  it('maps product report codes 1:1', () => {
    expect(toProductFailureCode('login_wall')).toBe('login_wall');
    expect(toProductFailureCode('selector_miss')).toBe('selector_miss');
    expect(toProductFailureCode('false_complete')).toBe('false_complete');
    expect(toProductFailureCode('model_loop')).toBe('model_loop');
  });

  it('maps executor categories to product vocabulary', () => {
    expect(toProductFailureCode('observe_failed')).toBe('selector_miss');
    expect(toProductFailureCode('json_parse_failed')).toBe('model_loop');
    expect(toProductFailureCode('max_steps')).toBe('model_loop');
    expect(toProductFailureCode('no_progress')).toBe('model_loop');
    expect(toProductFailureCode('llm_failed')).toBe('model_loop');
    expect(toProductFailureCode('login_required')).toBe('login_wall');
    expect(toProductFailureCode('target_missing')).toBe('selector_miss');
    expect(toProductFailureCode('executor_start_failed')).toBe('other');
  });

  // Contract 011 E1: complex-task stop categories surface as model_loop product labels.
  it('no_progress and max_steps map to model_loop with non-empty product labels', () => {
    for (const category of ['no_progress', 'max_steps'] as const) {
      expect(toProductFailureCode(category)).toBe('model_loop');
      const label = productFailureLabel(category);
      expect(label.length).toBeGreaterThan(0);
      expect(isEngineerFailureNoise(label)).toBe(false);
      expect(label).not.toMatch(/no_progress|max_steps|step_failed|Planner|Navigator/i);
    }
  });

  it('labels are localized product copy without engineer tokens', () => {
    for (const [code, label] of Object.entries(PRODUCT_FAILURE_LABELS)) {
      expect(label.length).toBeGreaterThan(2);
      expect(isEngineerFailureNoise(label)).toBe(false);
      expect(productFailureLabel(code)).toBe(label);
    }
  });

  it('flags machine tokens as engineer noise', () => {
    expect(isEngineerFailureNoise('step_failed')).toBe(true);
    expect(isEngineerFailureNoise('observe_failed')).toBe(true);
    expect(isEngineerFailureNoise('no_progress on tab')).toBe(true);
    expect(isEngineerFailureNoise('ExecutorDriver timeout')).toBe(true);
    expect(isEngineerFailureNoise(productFailureLabel('login_wall'))).toBe(false);
  });
});

