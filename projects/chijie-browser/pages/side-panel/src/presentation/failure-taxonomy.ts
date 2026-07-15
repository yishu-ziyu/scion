/**
 * User-visible failure categories (ticket 04).
 * Aligns product reports (login_wall / selector_miss / …) with executor categories.
 * Primary UI shows Chinese labels only — never raw step_failed / Planner.
 */

/** Product report codes (golden journeys / Tabbit alignment). */
export type ProductFailureCode =
  | 'login_wall'
  | 'selector_miss'
  | 'approval_timeout'
  | 'false_complete'
  | 'model_loop'
  | 'other';

export const PRODUCT_FAILURE_LABELS: Record<ProductFailureCode, string> = {
  login_wall: '需要登录或验证码',
  selector_miss: '找不到目标元素或页面',
  approval_timeout: '等待批准超时',
  false_complete: '页面未达成却报完成',
  model_loop: '模型反复失败或步数耗尽',
  other: '任务失败，可重试或改写指令',
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
  return PRODUCT_FAILURE_LABELS[toProductFailureCode(category)];
}

/** True if text looks like engineer-primary noise. */
export function isEngineerFailureNoise(text: string): boolean {
  return /\b(step_failed|Planner|Navigator|observe_failed|json_parse_failed)\b/i.test(text);
}
