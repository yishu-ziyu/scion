/**
 * Parse mid-model control-loop JSON (design/002).
 * Tolerant of MiniMax free text + <think> (stripped upstream via extractJsonFromModelOutput).
 */
import type { CompletionCriterionDraft } from '../../task/contracts';

export interface ControlPolicyDecision {
  observation: string;
  criteria: CompletionCriterionDraft[];
  done: boolean;
  /** null when done or waiting */
  action: { name: string; args: Record<string, unknown> } | null;
  waitingUser: 'login_required' | 'captcha_required' | null;
}

const ALLOWED_ACTIONS = new Set([
  'done',
  'input_text',
  'click_element',
  'control_media',
  'go_to_url',
  'go_back',
  'send_keys',
  'wait',
  'scroll_to_text',
  'scroll_to_percent',
  'scroll_to_top',
  'scroll_to_bottom',
  'open_tab',
  'switch_tab',
  'close_tab',
  'get_dropdown_options',
  'select_dropdown_option',
  'cache_content',
  'search_google',
  'previous_page',
  'next_page',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseCriteria(raw: unknown): CompletionCriterionDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: CompletionCriterionDraft[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row || typeof row.kind !== 'string') continue;
    const required = row.required !== false;
    switch (row.kind) {
      case 'url':
        if (row.operator === 'equals' || row.operator === 'starts_with') {
          if (typeof row.expected === 'string') {
            out.push({ kind: 'url', operator: row.operator, expected: row.expected, required });
          }
        }
        break;
      case 'page_text':
      case 'text':
        if (
          (row.operator === 'present' || row.operator === 'absent') &&
          typeof row.expected === 'string'
        ) {
          out.push({
            kind: 'page_text',
            operator: row.operator,
            expected: row.expected,
            required,
          });
        }
        break;
      case 'media_state':
        if (row.operator === 'equals' && (row.expected === 'playing' || row.expected === 'paused')) {
          out.push({ kind: 'media_state', operator: 'equals', expected: row.expected, required });
        }
        break;
      case 'user_confirmed':
        out.push({ kind: 'user_confirmed', operator: 'equals', expected: true, required });
        break;
      case 'element_state':
        if (
          row.operator === 'equals' &&
          typeof row.expected === 'string' &&
          ['visible', 'hidden', 'enabled', 'disabled'].includes(row.expected)
        ) {
          out.push({
            kind: 'element_state',
            operator: 'equals',
            expected: row.expected as 'visible' | 'hidden' | 'enabled' | 'disabled',
            required,
          });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

function parseAction(raw: Record<string, unknown>): { name: string; args: Record<string, unknown> } | null {
  // Shape A: { action_name, action_args }
  if (typeof raw.action_name === 'string') {
    const name = raw.action_name;
    if (!ALLOWED_ACTIONS.has(name)) return null;
    const args = asRecord(raw.action_args) ?? asRecord(raw.args) ?? {};
    return { name, args: { ...args } };
  }

  // Shape B: { action: { name, args } }
  const actionObj = asRecord(raw.action);
  if (actionObj && typeof actionObj.name === 'string') {
    const name = actionObj.name;
    if (!ALLOWED_ACTIONS.has(name)) return null;
    const args = asRecord(actionObj.args) ?? {};
    return { name, args: { ...args } };
  }

  // Shape C: navigator-style { action: [ { click_element: { index: 1 } } ] }
  if (Array.isArray(raw.action) && raw.action.length > 0) {
    const first = asRecord(raw.action[0]);
    if (first) {
      for (const [key, value] of Object.entries(first)) {
        if (ALLOWED_ACTIONS.has(key)) {
          const args = asRecord(value) ?? {};
          return { name: key, args: { ...args } };
        }
      }
    }
  }

  // Shape D: flat { name: "click_element", index: 1 }
  if (typeof raw.name === 'string' && ALLOWED_ACTIONS.has(raw.name)) {
    const { name, observation: _o, done: _d, completion_criteria: _c, ...rest } = raw;
    return { name: raw.name, args: rest as Record<string, unknown> };
  }

  return null;
}

export function parseControlPolicyDecision(raw: Record<string, unknown>): ControlPolicyDecision {
  const observation = typeof raw.observation === 'string' ? raw.observation : '';
  const done = raw.done === true || raw.done === 'true';
  const criteria = parseCriteria(raw.completion_criteria ?? raw.criteria);

  let waitingUser: ControlPolicyDecision['waitingUser'] = null;
  const reason = typeof raw.waiting_user === 'string' ? raw.waiting_user : '';
  if (reason === 'login_required' || reason === 'captcha_required') {
    waitingUser = reason;
  } else if (/login required|需要登录|请先登录/i.test(observation) && !done) {
    // Only soft-flag; TaskManager / product may ignore false positives.
    // Do not force waiting_user from observation alone (planner false-positive history).
  }

  if (waitingUser) {
    return { observation, criteria, done: false, action: null, waitingUser };
  }

  if (done) {
    return { observation, criteria, done: true, action: null, waitingUser: null };
  }

  const action = parseAction(raw);
  if (action?.name === 'done') {
    return {
      observation,
      criteria,
      done: true,
      action: null,
      waitingUser: null,
    };
  }

  return { observation, criteria, done: false, action, waitingUser: null };
}

export const CONTROL_SYSTEM_PROMPT = `You control a real Chrome tab for one user task.
Output ONE JSON object only. No markdown fences. No prose outside JSON.

Schema:
{
  "observation": "short page reading",
  "completion_criteria": [
    { "kind": "page_text", "operator": "present", "expected": "Saved successfully", "required": true }
  ],
  "done": false,
  "action_name": "input_text" | "click_element" | "control_media" | "go_to_url" | "wait" | "send_keys" | "done" | ...,
  "action_args": { ... }
}

Rules:
1. One action per turn. Prefer the smallest step that advances the task.
2. On the first useful turn include completion_criteria if the goal is verifiable (success text, media_state, url).
3. When the goal is already met on the page, set "done": true and omit action_name (or use done).
4. For HTML audio/video play/pause use action_name "control_media" with action_args { "command": "play"|"pause" }. Do not click native shadow media controls.
5. Form submit / send / buy / delete will be gated by product approval — still propose the click with clear intent in action_args.intent when needed.
6. Never invent element indexes that are not listed. Indexes come from the interactive elements list.
7. Do not claim login_required unless a clear login wall is visible.
8. Never put passwords or secrets into action_args.
`;
