/**
 * Parse mid-model control-loop JSON (design/002).
 * Tolerant of MiniMax free text + <think> (stripped upstream via extractJsonFromModelOutput).
 */
import type { CompletionCriterionDraft } from '../../task/contracts';
import type { ObservationFrame } from '../../browser/kernel';

export interface ControlPolicyDecision {
  observation: string;
  criteria: CompletionCriterionDraft[];
  done: boolean;
  /** null when done or waiting */
  action: { name: string; args: Record<string, unknown> } | null;
  waitingUser: 'login_required' | 'captcha_required' | null;
}

export const CONTROL_PROMPT_VERSION = 'chijie-control-v0.3.6';

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

export function renderControlSystemPrompt(options: ControlSystemPromptOptions = {}): string {
  const statusBlock = options.statusBar ? `\n\n<agent_status>\n${options.statusBar}\n</agent_status>` : '';
  return `${CONTROL_SYSTEM_PROMPT_BODY}\n\nPrompt version: ${CONTROL_PROMPT_VERSION}.${statusBlock}`;
}

const ALLOWED_ACTIONS = new Set([
  'done',
  'input_text',
  'click_element',
  'control_media',
  'save_screenshot',
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
  'focus_tab',
  'close_tab',
  'get_dropdown_options',
  'select_dropdown_option',
  'cache_content',
  'record_evidence',
  'inspect_evidence_space',
  'record_research_decision',
  'record_research_delivery',
  'read_page_text',
  'inspect_open_tabs',
  'search_google',
  'previous_page',
  'next_page',
]);

/** Alias model-facing names onto registered action handlers. */
function normalizeActionName(name: string): string {
  if (name === 'focus_tab') return 'switch_tab';
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

function parseAction(raw: Record<string, unknown>): { name: string; args: Record<string, unknown> } | null {
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

  // Shape C: navigator-style { action: [ { click_element: { index: 1 } } ] }
  if (Array.isArray(raw.action) && raw.action.length > 0) {
    const first = asRecord(raw.action[0]);
    if (first) {
      for (const [key, value] of Object.entries(first)) {
        if (ALLOWED_ACTIONS.has(key)) {
          const args = asRecord(value) ?? {};
          return { name: normalizeActionName(key), args: normalizeActionArgs({ ...args }) };
        }
      }
    }
  }

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

  // Task-scoped autonomy (decisions/004): drop model-proposed user_confirmed criteria.
  // Human confirmation is for proof UI only when code cannot verify, not a default planner tool.
  const autonomousCriteria = criteria.filter(item => item.kind !== 'user_confirmed');

  if (waitingUser) {
    return { observation, criteria: autonomousCriteria, done: false, action: null, waitingUser };
  }

  if (done) {
    return { observation, criteria: autonomousCriteria, done: true, action: null, waitingUser: null };
  }

  const action = parseAction(raw);
  if (action?.name === 'done') {
    return {
      observation,
      criteria: autonomousCriteria,
      done: true,
      action: null,
      waitingUser: null,
    };
  }

  return { observation, criteria: autonomousCriteria, done: false, action, waitingUser: null };
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
  "action_name": "input_text" | "click_element" | "control_media" | "save_screenshot" | "go_to_url" | "wait" | "send_keys" | "done" | ...,
  "action_args": { ... }
}

Rules:
1. After Visible page text is present, first judge whether the user's original sentence is already done from that wording. If yes, set "done": true and write the user-facing result in observation. Indexes are only for clicking. Do not take an action first just to start reading. One action per turn only when the goal is not yet done; prefer the smallest step that advances the task.
2. On the first useful turn include completion_criteria if the goal is verifiable (success text, media_state, tab_state, download_state, url). For "open YouTube and click the first video", prefer url starts_with https://www.youtube.com/watch (not just the homepage).
2b. Never treat 404 / "This page isn't available" / empty playlist error shells as success. URL criteria alone are invalid if the page is an error page; keep working or recover (search library / Library / Liked videos) instead of done.
3. When the goal is already met on the page, set "done": true and omit action_name (or use done). Do not re-open the homepage or re-click the same video. Model "done" alone never completes without matching page/tab/download evidence.
4. For HTML audio/video play/pause use action_name "control_media" with action_args { "command": "play"|"pause", optional "target_digest" }. Do not click native shadow media controls. Continuous control reuses the last media digest when target_digest is omitted.
5. Close/focus tabs with close_tab / switch_tab (or focus_tab). Omit tab_id to use the task-bound current tab. For close goals set completion_criteria tab_state expected closed.
6. Form fields lists labeled controls with current values. Use input_text on those indexes (input, textarea, select, contenteditable). After a fill, read Form fields again to confirm the value stuck. Do not invent indexes.
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
14. For long research tasks, use record_evidence only after opening and reading the actual source page. Never count search snippets or unopened links. Every useful source MUST be recorded before leaving its URL; never plan to reconstruct records later from memory. Repository files/pages use record_type "repository", user discussions use "user_discussion", and product pages use "product". Use inspect_evidence_space after recovery and before claiming a source quota is met.
15. Each observation includes visible page wording plus clickable indexes. Write the user-facing result from the wording. Indexes are for clicking, not for quoting. Call read_page_text only if the visible window is empty or too short, or after you scrolled to new content. Do not click around to start reading. When the user asks to include already-open browser context, use inspect_open_tabs and switch only to clearly relevant tabs.
16. For record_evidence, action_args MUST be {"records":[{"record_type":"user_discussion"|"product"|"repository"|"browser_context"|"product_principle","source":"the exact current page URL","source_title":"...","user_problem":"optional","raw_basis":"at least 20 characters copied from the page","observation":"at least 8 characters","inference":"...","confidence":"high"|"medium"|"low","related_product":"optional","living_reader_capability":"optional","priority":"high"|"medium"|"low","stance":"support"|"oppose"|"mixed"|"neutral","dedupe_key":"stable source-local key"}]}. Use these English field names and enum values exactly. Product records MUST set related_product to the actual product shown on the current source, never to Living Reader as a placeholder. For evidence-recording tasks, do not propose a URL criterion that was already true at baseline; verify progress with inspect_evidence_space instead.
17. On an unavailable/404/error page during research, do not record evidence, wait, or finish. Use go_back to return to the last valid source, then choose a real alternative link.
18. When research quotas are met, inspect filtered evidence pages, then use record_research_decision to persist exactly three capabilities. Each requires seven substantive decision answers plus IDs for 2 independent user sources, 1 product, and 1 repository source. Candidate completion is invalid until this action is accepted.
19. After writing the Feishu research table and decision document, reopen each final page and call record_research_delivery. The table readback must show every required field and cover all evidence rows; the document readback must show 下一步做什么, 为什么, 暂时不做, and all three accepted capability titles.
20. Never inspect or record unrelated private items from signed-in dashboards. For product research, use only generic product UI, public examples, official documentation, or demos; leave a private dashboard when those cannot be isolated.
`;

export const CONTROL_SYSTEM_PROMPT = renderControlSystemPrompt();
