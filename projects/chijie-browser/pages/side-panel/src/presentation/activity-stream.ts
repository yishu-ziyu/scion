/**
 * Activity stream presentation (design/005 + Codex/Claw-style responsibility UI).
 * Icons + human verbs only — never tool schema, digests, or agent role names.
 */

export type ActivityIconKey =
  | 'search'
  | 'eye'
  | 'globe'
  | 'click'
  | 'type'
  | 'play'
  | 'scroll'
  | 'wait'
  | 'tab'
  | 'close'
  | 'camera'
  | 'check'
  | 'back'
  | 'list'
  | 'generic';

export type ActivityPhase = 'thinking' | 'viewing' | 'acting' | 'done' | 'waiting';

/** Map executor action names to a calm icon language (not role/tool names). */
export function activityIconForAction(actionName: string): ActivityIconKey {
  switch (actionName) {
    case 'go_to_url':
    case 'open_tab':
    case 'search_google':
      return 'globe';
    case 'switch_tab':
    case 'focus_tab':
      return 'tab';
    case 'close_tab':
      return 'close';
    case 'click_element':
      return 'click';
    case 'input_text':
    case 'send_keys':
    case 'select_dropdown_option':
      return 'type';
    case 'get_dropdown_options':
      return 'list';
    case 'control_media':
      return 'play';
    case 'scroll_to_text':
    case 'scroll_to_percent':
      return 'scroll';
    case 'wait':
      return 'wait';
    case 'save_screenshot':
      return 'camera';
    case 'go_back':
      return 'back';
    case 'done':
      return 'check';
    default:
      return 'generic';
  }
}

export function activityElapsedSeconds(input: {
  createdAt: number;
  endAt?: number;
  now?: number;
}): number {
  const end = input.endAt ?? input.now ?? Date.now();
  if (!Number.isFinite(input.createdAt) || input.createdAt <= 0) return 0;
  return Math.max(0, Math.floor((end - input.createdAt) / 1000));
}

/** Compact duration for Activity header: 45s · 2m · 2m 05s */
export function formatActivityDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (rem === 0) return `${m}m`;
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

export function activityPhaseForAttempt(state: string | undefined): ActivityPhase {
  switch (state) {
    case 'executing':
    case 'approved':
      return 'acting';
    case 'proposed':
      return 'thinking';
    case 'observed':
      return 'done';
    case 'uncertain':
    case 'blocked':
      return 'waiting';
    default:
      return 'thinking';
  }
}

/**
 * One-line live responsibility copy.
 * Prefer host over generic "reading page" so the user knows what is being looked at.
 */
export function activityLiveHeadline(input: {
  status: string;
  actionName?: string;
  siteHost?: string;
  siteLabel?: string;
}): { phase: ActivityPhase; icon: ActivityIconKey; mode: 'thinking' | 'viewing' | 'acting' | 'waiting' } {
  const host = (input.siteHost || '').replace(/^www\./, '').trim();
  const label = (input.siteLabel || '').trim();

  if (input.status === 'waiting_approval') {
    return { phase: 'waiting', icon: 'wait', mode: 'waiting' };
  }
  if (input.status === 'waiting_user' || input.status === 'inputs_required') {
    return { phase: 'waiting', icon: 'wait', mode: 'waiting' };
  }
  if (input.status !== 'running') {
    return { phase: 'done', icon: 'check', mode: 'thinking' };
  }

  if (input.actionName) {
    return {
      phase: 'acting',
      icon: activityIconForAction(input.actionName),
      mode: 'acting',
    };
  }

  if (host || label) {
    return { phase: 'viewing', icon: 'eye', mode: 'viewing' };
  }
  return { phase: 'thinking', icon: 'search', mode: 'thinking' };
}

/** Secondary detail under the live headline — never digests. */
export function activityLiveDetail(input: {
  mode: 'thinking' | 'viewing' | 'acting' | 'waiting';
  siteHost?: string;
  observedCount: number;
}): 'preparing' | 'verified' | 'site' | 'wait_user' | 'none' {
  if (input.mode === 'waiting') return 'wait_user';
  if (input.mode === 'viewing' && (input.siteHost || '').trim()) return 'site';
  if (input.observedCount > 0) return 'verified';
  if (input.mode === 'thinking') return 'preparing';
  return 'none';
}

/** True when copy is a raw executor actionName (snake_case English), not human UI. */
export function looksLikeActionName(text: string): boolean {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return false;
  // input_text / go_to_url / control_media — never show these as live verbs.
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(s);
}

/**
 * Live acting line (design/006 §5 #3):
 * prefer displaySummary; fallback 「正在{人话动作} · host」;
 * never surface English actionName.
 */
export function activityLiveActingLine(input: {
  displaySummary?: string | null;
  humanActionLabel: string;
  siteHost?: string;
}): string {
  const summary = input.displaySummary?.replace(/\s+/g, ' ').trim() ?? '';
  if (summary.length >= 2 && !looksLikeActionName(summary)) {
    return summary;
  }
  const verb = input.humanActionLabel.replace(/\s+/g, ' ').trim() || '处理';
  // humanActionLabel is already a product phrase (e.g. 填写表单); avoid double 正在.
  const base = /^正在/.test(verb) ? verb : `正在${verb}`;
  const host = (input.siteHost || '').replace(/^www\./, '').trim();
  return host ? `${base} · ${host}` : base;
}
