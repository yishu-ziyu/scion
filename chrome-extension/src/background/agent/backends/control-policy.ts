/**
 * Parse mid-model control-loop JSON (design/002).
 * Tolerant of MiniMax free text + <think> (stripped upstream via extractJsonFromModelOutput).
 */
import { renderActionSchemaPrompt } from '../actions/action-prompt';
import { ALL_ACTION_SCHEMAS } from '../actions/schemas';
import { containsModelSuppliedCode, MODEL_ACTION_NAMES } from '../actions/model-action-safety';
import type { CompletionCriterionDraft } from '../../task/contracts';
import type { ObservationFrame } from '../../browser/kernel';
import { MAX_ACTIONS_PER_DECISION } from './observe-act-loop';

export type ControlActionSpec = { name: string; args: Record<string, unknown> };

export interface ControlPolicyDecision {
  observation: string;
  criteria: CompletionCriterionDraft[];
  done: boolean;
  /** First queued action; null when done, waiting, or the list is empty. */
  action: ControlActionSpec | null;
  /**
   * Acts parsed from this JSON (capped at CONTROL_MAX_ACTIONS_PER_TURN).
   * `action` is `actions[0]`. Empty when done or waiting.
   * Each `args.index` refers to the ObservationFrame that will be shown for this decide.
   */
  actions: ControlActionSpec[];
  waitingUser: 'login_required' | 'captcha_required' | 'target_missing' | null;
}

/** Control prompt/parser alias for the loop's hard limit. */
export const CONTROL_MAX_ACTIONS_PER_TURN = MAX_ACTIONS_PER_DECISION;

export const CONTROL_PROMPT_VERSION = 'chijie-control-v0.4.6';

/** Everyday schemas whose Action.prompt() text is appended to the default control system prompt. */
export const EVERYDAY_CONTROL_ACTION_NAMES = [
  'done',
  'input_text',
  'click_element',
  'control_media',
  'save_screenshot',
  'go_to_url',
  'go_back',
  'observe',
  'extract_content',
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
  'read_page_text',
  'inspect_open_tabs',
  'find_tab',
  'search_google',
  'previous_page',
  'next_page',
] as const;

const RESEARCH_ONLY_CONTROL_ACTION_NAMES = new Set([
  'record_evidence',
  'inspect_evidence_space',
  'cache_content',
  'record_research_decision',
  'record_research_delivery',
]);

function renderEverydayActionCatalog(): string {
  const byName = new Map(ALL_ACTION_SCHEMAS.map(schema => [schema.name, schema]));
  const prompts: string[] = [];
  for (const name of EVERYDAY_CONTROL_ACTION_NAMES) {
    if (RESEARCH_ONLY_CONTROL_ACTION_NAMES.has(name)) continue;
    const schema = byName.get(name);
    if (!schema) continue;
    prompts.push(renderActionSchemaPrompt(schema));
  }
  return `<available_actions>\n${prompts.join('\n\n')}\n</available_actions>`;
}

export interface AgentStatusBarInput {
  url?: string;
  title?: string;
  pageRevision?: string;
  step?: number;
  maxSteps?: number;
  attemptCount?: number;
  noProgressStreak?: number;
  criteriaCount?: number;
  lastEvidence?: string;
  /** Optional active mission phase id (long-horizon plan). */
  activePhaseId?: string;
}

/** Deterministic, code-maintained status bar (book ch2). */
export function buildAgentStatusBar(input: AgentStatusBarInput): string {
  const rows: string[] = [
    `url: ${input.url ?? 'unknown'}`,
    `title: ${input.title ?? 'unknown'}`,
    `frame: ${input.pageRevision ?? 'none'}`,
    `step: ${(input.step ?? 0) + 1}/${input.maxSteps ?? 0}`,
    `attempts: ${input.attemptCount ?? 0}`,
    `no_progress: ${input.noProgressStreak ?? 0}`,
    `criteria: ${input.criteriaCount ?? 0}`,
  ];
  if (input.activePhaseId) rows.push(`active_phase: ${input.activePhaseId}`);
  if (input.lastEvidence) rows.push(`last_evidence: ${input.lastEvidence}`);
  return rows.join('\n');
}

export interface ControlSystemPromptOptions {
  statusBar?: string;
  /** Append the evidence-recording / Feishu research script. Default off. */
  research?: boolean;
}

/** Quotas, evidence ledgers, and Feishu write-back — not every browser task. */
export function instructionLooksLikeResearch(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/record_evidence|inspect_evidence_space|record_research_decision|record_research_delivery/i.test(text)) {
    return true;
  }
  if (/证据空间|建立能力地图/.test(text)) return true;
  if (/飞书/.test(text) && /回写|写入|写进/.test(text)) return true;
  if (/至少.{0,12}\d+\s*(?:个|条)?(?:真实用户|用户讨论)/.test(text)) return true;
  if (/at\s+least\s+\d+\s+user discussions?/i.test(text)) return true;
  return false;
}

/**
 * Manual intervention is a runtime fact, not a model judgment. Only accept a
 * wait when the current page frame contains a high-confidence blocker signal.
 */
export function observationSupportsWaitingUser(
  frame: ObservationFrame | null,
  reason: NonNullable<ControlPolicyDecision['waitingUser']>,
): boolean {
  if (!frame) return false;

  const elementText = frame.interactiveElements
    .map(element => [element.text, element.role, element.type, element.name, element.id].filter(Boolean).join(' '))
    .join('\n');
  const pageText = [frame.tab.title, frame.tab.url, frame.text, elementText].join('\n');

  if (reason === 'target_missing') {
    return Boolean(frame.inaccessibleIframes && frame.inaccessibleIframes.length > 0);
  }

  if (reason === 'captcha_required') {
    return /\b(?:captcha|recaptcha|hcaptcha|cf-turnstile)\b|verify (?:that )?you are human|人机验证|验证码/i.test(
      pageText,
    );
  }

  if (frame.interactiveElements.some(element => element.type?.toLowerCase() === 'password')) return true;

  const hasBlockingCopy =
    /(?:please|must|need to) (?:sign|log) in to (?:continue|proceed|access)|authentication required|请先登录|登录后(?:继续|查看|访问)|需要登录/i.test(
      pageText,
    );
  if (hasBlockingCopy) return true;

  let pathSignalsLogin = false;
  try {
    pathSignalsLogin = /\/(?:login|log-in|signin|sign-in|auth|sso)(?:\/|$)/i.test(new URL(frame.tab.url).pathname);
  } catch {
    pathSignalsLogin = false;
  }
  const hasLoginControl = /\b(?:sign|log)\s*in\b|登录|登入/i.test(elementText);
  return pathSignalsLogin && hasLoginControl;
}

export function observationHasInaccessibleIframes(frame: ObservationFrame | null | undefined): boolean {
  return Boolean(frame?.inaccessibleIframes && frame.inaccessibleIframes.length > 0);
}

const ACTING_ON_PAGE = new Set(['input_text', 'click_element', 'select_dropdown_option', 'send_keys']);

/** Login wall: stop. Never type credentials the user did not provide. */
export function applyLoginWallGate(
  decision: ControlPolicyDecision,
  frame: ObservationFrame | null,
): ControlPolicyDecision {
  if (!observationSupportsWaitingUser(frame, 'login_required')) return decision;
  return {
    ...decision,
    done: false,
    action: null,
    actions: [],
    waitingUser: 'login_required',
  };
}

/** A needed iframe did not attach: do not fill or claim done. */
export function applyInaccessibleIframeGate(
  decision: ControlPolicyDecision,
  frame: ObservationFrame | null,
): ControlPolicyDecision {
  if (!observationHasInaccessibleIframes(frame)) return decision;
  if (decision.done) {
    return { ...decision, done: false, action: null, actions: [], waitingUser: 'target_missing' };
  }
  const queued = decision.actions.length > 0 ? decision.actions : decision.action ? [decision.action] : [];
  if (queued.some(item => ACTING_ON_PAGE.has(item.name))) {
    return { ...decision, done: false, action: null, actions: [], waitingUser: 'target_missing' };
  }
  return decision;
}

export function renderControlSystemPrompt(options: ControlSystemPromptOptions = {}): string {
  const statusBlock = options.statusBar ? `\n\n<agent_status>\n${options.statusBar}\n</agent_status>` : '';
  const researchBlock = options.research ? `\n\n${CONTROL_RESEARCH_PROMPT_BODY}` : '';
  return `${CONTROL_SYSTEM_PROMPT_BODY}\n\n${renderEverydayActionCatalog()}${researchBlock}\n\nPrompt version: ${CONTROL_PROMPT_VERSION}.${statusBlock}`;
}

const ALLOWED_ACTIONS = new Set([...MODEL_ACTION_NAMES, 'focus_tab', 'snapshot']);

/** Alias model-facing names onto registered action handlers. */
function normalizeActionName(name: string): string {
  if (name === 'focus_tab') return 'switch_tab';
  if (name === 'snapshot') return 'observe';
  return name;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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
        if ((row.operator === 'present' || row.operator === 'absent') && typeof row.expected === 'string') {
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
      case 'tab_state':
        if (row.operator === 'equals' && (row.expected === 'closed' || row.expected === 'active')) {
          out.push({ kind: 'tab_state', operator: 'equals', expected: row.expected, required });
        }
        break;
      case 'download_state':
        if (row.operator === 'equals' && (row.expected === 'started' || row.expected === 'finished')) {
          out.push({ kind: 'download_state', operator: 'equals', expected: row.expected, required });
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

/** Coerce model-emitted index ("12", 12.0) to a finite number; drop NaN. */
function normalizeActionArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  if ('index' in out) {
    const raw = out.index;
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN;
    if (Number.isFinite(n)) out.index = n;
    else delete out.index;
  }
  return out;
}

function parseKeyedAction(raw: Record<string, unknown>): ControlActionSpec | null {
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_ACTIONS.has(key)) continue;
    const args = asRecord(value);
    if (!args) continue;
    return { name: normalizeActionName(key), args: normalizeActionArgs({ ...args }) };
  }
  return null;
}

function parseAction(raw: Record<string, unknown>): ControlActionSpec | null {
  // Shape A: { action_name, action_args }
  if (typeof raw.action_name === 'string') {
    const name = raw.action_name;
    if (!ALLOWED_ACTIONS.has(name)) return null;
    const args = asRecord(raw.action_args) ?? asRecord(raw.args) ?? {};
    return { name: normalizeActionName(name), args: normalizeActionArgs({ ...args }) };
  }

  // Shape B: { action: { name, args } }
  const actionObj = asRecord(raw.action);
  if (actionObj && typeof actionObj.name === 'string') {
    const name = actionObj.name;
    if (!ALLOWED_ACTIONS.has(name)) return null;
    const args = asRecord(actionObj.args) ?? {};
    return { name: normalizeActionName(name), args: normalizeActionArgs({ ...args }) };
  }

  // Shape C item / single keyed object: { click_element: { index: 1 } }
  const keyed = parseKeyedAction(raw);
  if (keyed) return keyed;

  // Shape D: flat { name: "click_element", index: 1 }
  if (typeof raw.name === 'string' && ALLOWED_ACTIONS.has(raw.name)) {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'name' || key === 'observation' || key === 'done' || key === 'completion_criteria') {
        continue;
      }
      rest[key] = value;
    }
    return { name: normalizeActionName(raw.name), args: normalizeActionArgs(rest) };
  }

  return null;
}

function parseActionItem(item: unknown): ControlActionSpec | null {
  const rec = asRecord(item);
  if (!rec) return null;
  const usesNamedShape =
    typeof rec.action_name === 'string' ||
    typeof asRecord(rec.action)?.name === 'string' ||
    typeof rec.name === 'string';
  if (usesNamedShape) return parseAction(rec);
  if (Object.keys(rec).length !== 1) return null;
  return parseAction(rec);
}

function parseActionItems(items: unknown[]): ControlActionSpec[] | null {
  const parsed: ControlActionSpec[] = [];
  for (const item of items) {
    const action = parseActionItem(item);
    if (!action) return null;
    parsed.push(action);
  }
  return parsed;
}

function takeActionQueue(items: unknown[]): ControlActionSpec[] {
  const parsed = parseActionItems(items);
  if (!parsed) return [];
  const out: ControlActionSpec[] = [];
  for (const action of parsed) {
    if (action.name === 'done') break;
    out.push(action);
    if (out.length >= CONTROL_MAX_ACTIONS_PER_TURN) break;
  }
  return out;
}

/** Same-observation action list from model JSON. Empty when none parsed. */
export function parseControlActionQueue(raw: Record<string, unknown>): ControlActionSpec[] {
  if (containsModelSuppliedCode(raw)) return [];
  if (Array.isArray(raw.action) && raw.action.length > 0) {
    return takeActionQueue(raw.action);
  }
  if (Array.isArray(raw.actions) && raw.actions.length > 0) {
    return takeActionQueue(raw.actions);
  }
  const single = parseAction(raw);
  if (!single || single.name === 'done') return [];
  return [single];
}

function firstParsedArrayAction(raw: Record<string, unknown>): ControlActionSpec | null {
  const items = Array.isArray(raw.action) ? raw.action : Array.isArray(raw.actions) ? raw.actions : null;
  if (!items) return null;
  return parseActionItems(items)?.[0] ?? null;
}

const CONTROL_RESPONSE_KEYS = new Set([
  'observation',
  'done',
  'waiting_user',
  'completion_criteria',
  'criteria',
  'action_name',
  'action_args',
  'args',
  'action',
  'actions',
  'name',
  'current_state',
]);

function hasRejectedNamedAction(raw: Record<string, unknown>): boolean {
  return (['action_name', 'name'] as const).some(key => {
    const value = raw[key];
    return value !== undefined && (typeof value !== 'string' || !ALLOWED_ACTIONS.has(value));
  });
}

function hasRejectedActionContainer(raw: Record<string, unknown>, key: 'action' | 'actions'): boolean {
  const value = raw[key];
  if (value === undefined) return false;
  if (Array.isArray(value)) return !parseActionItems(value);
  return key !== 'action' || !asRecord(value) || !parseAction({ action: value });
}

function hasUnknownObjectAction(raw: Record<string, unknown>): boolean {
  if (['action_name', 'name', 'action', 'actions'].some(key => raw[key] !== undefined)) return false;
  return Object.entries(raw).some(
    ([key, value]) =>
      !CONTROL_RESPONSE_KEYS.has(key) && !ALLOWED_ACTIONS.has(key) && Boolean(value && typeof value === 'object'),
  );
}

const FORBIDDEN_ACTION_KEYS = ['evaluate', 'run_javascript'] as const;

function hasRejectedModelAction(raw: Record<string, unknown>): boolean {
  return (
    containsModelSuppliedCode(raw) ||
    hasRejectedNamedAction(raw) ||
    hasRejectedActionContainer(raw, 'action') ||
    hasRejectedActionContainer(raw, 'actions') ||
    FORBIDDEN_ACTION_KEYS.some(key => Object.prototype.hasOwnProperty.call(raw, key)) ||
    hasUnknownObjectAction(raw)
  );
}

const WAITING_USER_REASONS = new Set(['login_required', 'captcha_required', 'target_missing']);

function explicitWaitingUserReason(value: unknown): ControlPolicyDecision['waitingUser'] {
  return typeof value === 'string' && WAITING_USER_REASONS.has(value)
    ? (value as NonNullable<ControlPolicyDecision['waitingUser']>)
    : null;
}

export function parseControlPolicyDecision(raw: Record<string, unknown>): ControlPolicyDecision {
  const observation = typeof raw.observation === 'string' ? raw.observation : '';
  const done = raw.done === true || raw.done === 'true';
  const criteria = parseCriteria(raw.completion_criteria ?? raw.criteria);

  const waitingUser = explicitWaitingUserReason(raw.waiting_user);

  // Task-scoped autonomy (decisions/004): drop model-proposed user_confirmed criteria.
  // Human confirmation is for proof UI only when code cannot verify, not a default planner tool.
  const autonomousCriteria = criteria.filter(item => item.kind !== 'user_confirmed');

  if (hasRejectedModelAction(raw)) {
    return { observation, criteria: autonomousCriteria, done: false, action: null, actions: [], waitingUser: null };
  }

  if (waitingUser) {
    return { observation, criteria: autonomousCriteria, done: false, action: null, actions: [], waitingUser };
  }

  if (done) {
    return { observation, criteria: autonomousCriteria, done: true, action: null, actions: [], waitingUser: null };
  }

  const actions = parseControlActionQueue(raw);
  if (actions.length === 0) {
    if (firstParsedArrayAction(raw)?.name === 'done') {
      return {
        observation,
        criteria: autonomousCriteria,
        done: true,
        action: null,
        actions: [],
        waitingUser: null,
      };
    }
    const lone = parseAction(raw);
    if (lone?.name === 'done' || raw.action_name === 'done') {
      return {
        observation,
        criteria: autonomousCriteria,
        done: true,
        action: null,
        actions: [],
        waitingUser: null,
      };
    }
    return { observation, criteria: autonomousCriteria, done: false, action: null, actions: [], waitingUser: null };
  }

  return {
    observation,
    criteria: autonomousCriteria,
    done: false,
    action: actions[0] ?? null,
    actions,
    waitingUser: null,
  };
}

const CONTROL_SYSTEM_PROMPT_BODY = `You control a real Chrome tab for one user task.
Output ONE JSON object only. No markdown fences. No prose outside JSON.

Schema:
{
  "observation": "user-facing result when done; otherwise a short page reading",
  "completion_criteria": [
    { "kind": "page_text", "operator": "present", "expected": "Saved successfully", "required": true }
  ],
  "done": false,
  "action_name": "observe" | "extract_content" | "input_text" | "click_element" | "control_media" | "save_screenshot" | "go_to_url" | "wait" | "send_keys" | "done" | ...,
  "action_args": { ... }
}

Several acts on this snapshot (optional instead of action_name):
"action": [
  { "input_text": { "index": 1, "text": "Ada" } },
  { "input_text": { "index": 2, "text": "ada@example.test" } },
  { "click_element": { "index": 3 } }
]

Rules:
0. Loop: decide, then observe/act only if you need the page. If the snapshot is [no_page_snapshot], do not invent page facts. Greeting or a question you can answer without the page: set done and write the answer. If you need the page, do not set done — emit the real page action (observe, go_to_url, open_tab, find_tab, search_google). The loop will attach and run it. If the user asked what this page or these videos are about, read then write the analysis in observation and set done. The analysis sentence does not need to appear on the page.
1. After Visible page text is present, first judge whether the user's original sentence is already done from that wording. If yes, set "done": true and write the user-facing result in observation. Indexes are only for clicking. Do not take an action first just to start reading. When the goal is not yet done, emit the next action, or a short action array (up to 5) for steps that still use this snapshot — e.g. fill several Form fields then click submit. After click_element, switch_tab, go_to_url, open_tab, close_tab, go_back, previous_page, next_page, search_google, or send_keys, do not queue more actions that use index; those indexes die with this snapshot. When the user says 这个页面 / current tab, call find_tab { "active": true } once if you are not already bound. That stays on the page they sent the task from; do not follow them if they switch away.
2. On the first useful turn include completion_criteria if the goal is verifiable (success text, media_state, tab_state, download_state, url). For "open YouTube and click the first video", prefer url starts_with https://www.youtube.com/watch (not just the homepage).
2c. If the user asks what this page or these videos are about, do not invent completion_criteria. Write the result in observation and set done.
2b. Never treat 404 / "This page isn't available" / empty playlist error shells as success. URL criteria alone are invalid if the page is an error page; keep working or recover (search library / Library / Liked videos) instead of done.
3. When the goal is already met, set "done": true and omit action_name (or use done). Do not re-open the homepage or re-click the same video. Open/click/fill still need the page to have changed. A written analysis is itself the result.
4. For HTML audio/video play/pause use action_name "control_media" with action_args { "command": "play"|"pause", optional "target_digest" }. Do not click native shadow media controls. Continuous control reuses the last media digest when target_digest is omitted.
5. Bind/close tabs with close_tab / switch_tab (or focus_tab). switch_tab and open_tab do not bring that tab to the front; the user may keep working in another tab. Omit tab_id to use the task-bound current tab. For close goals set completion_criteria tab_state expected closed. Do not require tab_state active.
6. Form fields lists labeled controls with current values. Use input_text on those indexes (input, textarea, select, contenteditable). When the user explicitly asks to fill several listed fields and submit, and every field plus the submit control is present in this snapshot, put every input_text and the final click_element in the SAME action array. Do not stop after the fills for another model decision. Confirm values on the next observation. Do not invent indexes. Checkbox, radio, file, and submit are not Form fields — click them with click_element (file cannot be filled with input_text).
6b. Click submit / send / buy / delete only when the user's original sentence asked to submit, send, buy, or delete. If they only asked to fill, fill the matching fields, set done true, and say what was filled. Do not click submit to be helpful. Plain link clicks are not form submits.
7. Never invent element indexes that are not listed. Indexes are short-lived refs bound automatically to the shown Snapshot frame. If an action reports a stale frame/target, use the next observation instead of retrying the old index.
8. Do not claim login_required unless a clear login wall is visible.
9. Never put passwords or secrets into action_args.
10. Screenshot / save page image / 截图 / 保存到下载文件夹: use action_name "save_screenshot" (optional action_args.filename). After the tool reports success, set "done": true. Never click browser chrome, OS share sheets, or page "download" buttons to fake a screenshot save.
11. Download goals need download_state finished (or started) evidence; never claim download complete without it.
12. Long-horizon / multi-phase:
    - Read <agent_status> and any plan memory / trajectory summary in the message; stay on the active phase.
    - Finish current-phase evidence before advancing to the next phase.
    - Never invent done without observable page/tab/download evidence that matches the criteria.
13. When done is true, "observation" is the user-facing result. The user will check it against the page. Acknowledgements, promises, and "I will…" / "好的我来…" are not results. Never return an acknowledgement or future promise.
14. Each observation includes visible page wording plus clickable indexes. Write the user-facing result from the wording. Indexes are for clicking, not for quoting. Call read_page_text only if the visible window is empty or too short, or after you scrolled to new content. Do not click around to start reading. When the user asks to include already-open browser context, use inspect_open_tabs and switch only to clearly relevant tabs.
15. Before click_element, if the Interactive elements list is long or you need a named control, call observe with a query (for example "提交" or "Search") so only matching controls remain. Indexes stay the original highlight numbers. You may also pass the same query on click_element or input_text instead of an index. If the query does not resolve to one control, you get candidates and no click. An empty observe query returns the full page list.
16. When the user wants numbers, a table, a named list, or what the videos/items on the current page are about, call extract_content with a goal and optional schema field names. That writes JSON records into an artifact. extract_content does not finish the task; do not set done true just because rows came back. Then write the result in observation and set done.
17. Choose action_name from <available_actions>. Follow that action's When to use and Do NOT use.
18. If the user asked to 搜 / 搜索 / search and did not give a URL, use search_google with a short query. Do not invent wikipedia, github, docs, or other destination URLs.
`;

const CONTROL_RESEARCH_PROMPT_BODY = `Research-only:
R1. Use record_evidence only after opening and reading the actual source page. Never count search snippets or unopened links. Every useful source MUST be recorded before leaving its URL; never plan to reconstruct records later from memory. Repository files/pages use record_type "repository", user discussions use "user_discussion", and product pages use "product". Use inspect_evidence_space after recovery and before claiming a source quota is met.
R2. For record_evidence, action_args MUST be {"records":[{"record_type":"user_discussion"|"product"|"repository"|"browser_context"|"product_principle","source":"the exact current page URL","source_title":"...","user_problem":"optional","raw_basis":"at least 20 characters copied from the page","observation":"at least 8 characters","inference":"...","confidence":"high"|"medium"|"low","related_product":"optional","living_reader_capability":"optional","priority":"high"|"medium"|"low","stance":"support"|"oppose"|"mixed"|"neutral","dedupe_key":"stable source-local key"}]}. Use these English field names and enum values exactly. Product records MUST set related_product to the actual product shown on the current source, never to Living Reader as a placeholder. For evidence-recording tasks, do not propose a URL criterion that was already true at baseline; verify progress with inspect_evidence_space instead.
R3. On an unavailable/404/error page during research, do not record evidence, wait, or finish. Use go_back to return to the last valid source, then choose a real alternative link.
R4. When research quotas are met, inspect filtered evidence pages, then use record_research_decision to persist exactly three capabilities. Each requires seven substantive decision answers plus IDs for 2 independent user sources, 1 product, and 1 repository source. Candidate completion is invalid until this action is accepted.
R5. After writing the Feishu research table and decision document, reopen each final page and call record_research_delivery. The table readback must show every required field and cover all evidence rows; the document readback must show 下一步做什么, 为什么, 暂时不做, and all three accepted capability titles.
R6. Never inspect or record unrelated private items from signed-in dashboards. For product research, use only generic product UI, public examples, official documentation, or demos; leave a private dashboard when those cannot be isolated.`;

export const CONTROL_SYSTEM_PROMPT = renderControlSystemPrompt();
