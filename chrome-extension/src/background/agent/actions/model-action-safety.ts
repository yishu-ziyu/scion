export type ModelActionRejection = 'dynamic_code_not_allowed' | 'unknown_action';

/** Names backed by deterministic ActionBuilder handlers. Aliases normalize before dispatch. */
export const MODEL_ACTION_NAMES = [
  'done',
  'search_google',
  'go_to_url',
  'go_back',
  'observe',
  'click_element',
  'input_text',
  'switch_tab',
  'open_tab',
  'close_tab',
  'extract_content',
  'cache_content',
  'record_evidence',
  'inspect_evidence_space',
  'record_research_decision',
  'record_research_delivery',
  'read_page_text',
  'inspect_open_tabs',
  'find_tab',
  'scroll_to_percent',
  'scroll_to_top',
  'scroll_to_bottom',
  'previous_page',
  'next_page',
  'scroll_to_text',
  'send_keys',
  'control_media',
  'get_dropdown_options',
  'select_dropdown_option',
  'save_screenshot',
  'wait',
] as const;

const MODEL_ACTION_NAME_SET = new Set<string>(MODEL_ACTION_NAMES);

/** Model action payloads may contain data, never source code to execute. */
export function containsModelSuppliedCode(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.trim().toLowerCase() === 'code') return true;
    if (containsModelSuppliedCode(child, seen)) return true;
  }
  return false;
}

/** Shared fail-closed check for Action.call, learned plans, kernel, and dispatcher. */
export function modelActionRejection(actionName: string, args: unknown): ModelActionRejection | null {
  if (actionName === 'evaluate' || containsModelSuppliedCode(args)) return 'dynamic_code_not_allowed';
  if (!MODEL_ACTION_NAME_SET.has(actionName)) return 'unknown_action';
  return null;
}
