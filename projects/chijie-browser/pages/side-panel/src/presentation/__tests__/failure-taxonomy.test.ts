import { describe, expect, it } from 'vitest';
import {
  PRODUCT_FAILURE_LABELS,
  isEngineerFailureNoise,
  productFailureLabel,
  toProductFailureCode,
} from '../failure-taxonomy';

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
    expect(toProductFailureCode('llm_failed')).toBe('model_loop');
    expect(toProductFailureCode('login_required')).toBe('login_wall');
    expect(toProductFailureCode('target_missing')).toBe('selector_miss');
    expect(toProductFailureCode('executor_start_failed')).toBe('other');
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
    expect(isEngineerFailureNoise(productFailureLabel('login_wall'))).toBe(false);
  });
});
