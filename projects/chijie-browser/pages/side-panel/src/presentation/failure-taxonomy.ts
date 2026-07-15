/**
 * User-visible failure categories (ticket 04).
 * Aligns product reports (login_wall / selector_miss / …) with executor categories.
 * Primary UI shows localized product labels only — never raw step_failed / Planner.
 */

import { t } from '@extension/i18n';

/** Product report codes (golden journeys / Tabbit alignment). */
export type ProductFailureCode =
  | 'login_wall'
  | 'selector_miss'
  | 'approval_timeout'
  | 'false_complete'
  | 'model_loop'
  | 'other';

const PRODUCT_FAILURE_MESSAGE_KEYS = {
  login_wall: 'chat_task_product_fail_login_wall',
  selector_miss: 'chat_task_product_fail_selector_miss',
  approval_timeout: 'chat_task_product_fail_approval_timeout',
  false_complete: 'chat_task_product_fail_false_complete',
  model_loop: 'chat_task_product_fail_model_loop',
  other: 'chat_task_product_fail_other',
} as const satisfies Record<ProductFailureCode, Parameters<typeof t>[0]>;

/** Localized labels for each product failure code (resolved at access time). */
export const PRODUCT_FAILURE_LABELS: Record<ProductFailureCode, string> = {
  get login_wall() {
    return t(PRODUCT_FAILURE_MESSAGE_KEYS.login_wall);
  },
  get selector_miss() {
    return t(PRODUCT_FAILURE_MESSAGE_KEYS.selector_miss);
  },
  get approval_timeout() {
    return t(PRODUCT_FAILURE_MESSAGE_KEYS.approval_timeout);
  },
  get false_complete() {
    return t(PRODUCT_FAILURE_MESSAGE_KEYS.false_complete);
  },
  get model_loop() {
    return t(PRODUCT_FAILURE_MESSAGE_KEYS.model_loop);
  },
  get other() {
    return t(PRODUCT_FAILURE_MESSAGE_KEYS.other);
  },
};

/** Map executor / waitReason / free-form category → product code. */
export function toProductFailureCode(category: string | undefined | null): ProductFailureCode {
  if (!category) return 'other';
  const c = category.toLowerCase();

  if (
    c === 'login_wall' ||
    c === 'login_required' ||
    c === 'captcha_required' ||
    c.includes('login') ||
    c.includes('captcha')
  ) {
    return 'login_wall';
  }

  if (
    c === 'selector_miss' ||
    c === 'target_missing' ||
    c === 'target_ambiguous' ||
    c === 'observe_failed' ||
    c === 'action_failed' ||
    c === 'unknown_action' ||
    c === 'no_action'
  ) {
    return 'selector_miss';
  }

  if (c === 'approval_timeout' || c === 'approval_rejected') {
    return 'approval_timeout';
  }

  if (c === 'false_complete') {
    return 'false_complete';
  }

  if (
    c === 'model_loop' ||
    c === 'max_steps' ||
    c === 'json_parse_failed' ||
    c === 'llm_failed' ||
    c === 'control_script_exhausted'
  ) {
    return 'model_loop';
  }

  return 'other';
}

export function productFailureLabel(category: string | undefined | null): string {
  return t(PRODUCT_FAILURE_MESSAGE_KEYS[toProductFailureCode(category)]);
}

/** True if text looks like engineer-primary noise. */
export function isEngineerFailureNoise(text: string): boolean {
  return /\b(step_failed|Planner|Navigator|observe_failed|json_parse_failed)\b/i.test(text);
}
