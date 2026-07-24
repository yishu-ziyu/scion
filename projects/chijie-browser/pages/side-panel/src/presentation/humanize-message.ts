/**
 * Presentation layer: map machine actors/events to human-facing chat copy.
 * Backend may still use Planner/Navigator; the UI must not.
 */
import { Actors, type Message } from '@extension/storage';
import type { AgentEvent } from '../types/event';
import { ExecutionState } from '../types/event';

/** Legacy + current progress sentinel shown as a bar, not as text. */
export const PROGRESS_MESSAGE_CONTENT = '正在执行...';

export type DisplayKind = 'user' | 'assistant' | 'progress' | 'failure' | 'system_note';

export interface DisplayMessage {
  kind: DisplayKind;
  /** Always human role label: 你 / 助手 (or localized via copy bag) */
  title: string;
  body: string;
  detail?: string;
  actions?: Array<'retry' | 'rephrase'>;
  timestamp: number;
  /** Original actor retained for keys only; never show as title */
  rawActor: string;
}

export interface HumanCopy {
  you: string;
  assistant: string;
  progress: string;
  failParse: string;
  failAborted: string;
  failGeneric: string;
  failStep: string;
}

export const DEFAULT_ZH_COPY: HumanCopy = {
  you: '你',
  assistant: '助手',
  progress: '正在处理…',
  failParse: '这一步没做成：模型返回的内容读不出来。',
  failAborted: '这次操作被中断了。',
  failGeneric: '这一步没做成。可以再试一次，或换个说法。',
  failStep: '这一步没做成。',
};

const MACHINE_ROLE_NAMES = /^(planner|navigator|validator|manager|evaluator|system|user)$/i;
const BANNED_PRIMARY = /\b(step_failed|step\.fail|step_ok|step\.ok|act_fail|act\.fail)\b/i;

export function isProgressContent(content: string): boolean {
  return content === PROGRESS_MESSAGE_CONTENT || content === DEFAULT_ZH_COPY.progress;
}

export function looksLikeMachineToken(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (BANNED_PRIMARY.test(t)) return true;
  if (MACHINE_ROLE_NAMES.test(t)) return true;
  // bare snake/enum-ish single tokens
  if (/^[a-z][a-z0-9_.]{0,40}$/i.test(t) && !/[\u4e00-\u9fff]/.test(t) && t.includes('_')) {
    return true;
  }
  return false;
}

/**
 * Browser chrome / step telemetry that belongs in the task card steps, not chat.
 * design/005 A1: no Browser: process log as primary conversation.
 */
export function isProcessNoiseContent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/^Browser opened\.?$/i.test(t)) return true;
  if (/^Switched to https?:\/\//i.test(t)) return true;
  if (/^Opened (tab|page|url)\b/i.test(t)) return true;
  if (/^Playing video( for \d+ seconds?)?\.?$/i.test(t)) return true;
  if (/^Paused video\.?$/i.test(t)) return true;
  if (/^Navigat(ed|ing) to\b/i.test(t)) return true;
  if (/^Click(ed|ing)\b/i.test(t) && t.length < 80) return true;
  if (/^Scroll(ed|ing)\b/i.test(t) && t.length < 80) return true;
  if (/^(任务完成|已完成|Done|Task complete)\.?$/i.test(t)) return true;
  if (/^User instruction$/i.test(t)) return true;
  if (/^Run Skill:/i.test(t)) return true;
  // English tool-log lines that leak into chat as the "assistant" body
  if (/^(Browser|Navigator|Planner|Validator)\s*:/i.test(t)) return true;
  return false;
}

export function classifyFailure(details: string | undefined, copy: HumanCopy = DEFAULT_ZH_COPY): {
  body: string;
  detail?: string;
} {
  const raw = (details ?? '').trim();
  const lower = raw.toLowerCase();
  let body = copy.failGeneric;
  if (
    /extract json|manuallyparse|validatemodeloutput|not valid json|could not manually extract|could not validate model output|manually extract json/i.test(
      lower,
    )
  ) {
    body = copy.failParse;
  } else if (/requestcancelled|aborted|cancel/i.test(lower)) {
    body = copy.failAborted;
  } else if (raw && !looksLikeMachineToken(raw) && /[\u4e00-\u9fff]/.test(raw)) {
    // Already human Chinese from somewhere - keep short
    body = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
  } else if (raw && looksLikeMachineToken(raw)) {
    body = copy.failStep;
  }

  const detail =
    raw && raw !== body && !BANNED_PRIMARY.test(raw)
      ? raw.slice(0, 200)
      : raw && BANNED_PRIMARY.test(raw)
        ? undefined
        : raw && raw !== body
          ? raw.slice(0, 200)
          : undefined;

  // Never use pure enum as detail title content alone for expand if it's only step_failed
  const safeDetail = detail && !looksLikeMachineToken(detail) ? detail : detail && detail.length > 20 ? detail : undefined;

  return { body, detail: safeDetail };
}

/** Split optional embedded detail from failure messages written as `body\n\n«detail»`. */
export function splitEmbeddedDetail(content: string): { body: string; detail?: string } {
  const m = content.match(/^(.*)\n\n«([\s\S]*)»\s*$/);
  if (!m) return { body: content };
  return { body: m[1].trim(), detail: m[2].trim() || undefined };
}

export function humanizeStoredMessage(msg: Message, copy: HumanCopy = DEFAULT_ZH_COPY): DisplayMessage {
  const actor = msg.actor;
  const content = msg.content ?? '';

  if (actor === Actors.USER) {
    return {
      kind: 'user',
      title: copy.you,
      body: content,
      timestamp: msg.timestamp,
      rawActor: actor,
    };
  }

  if (isProgressContent(content)) {
    return {
      kind: 'progress',
      title: copy.assistant,
      body: copy.progress,
      timestamp: msg.timestamp,
      rawActor: actor,
    };
  }

  const embedded = splitEmbeddedDetail(content);
  // Already humanized failure body stored for new pipeline
  if (
    embedded.body === copy.failParse ||
    embedded.body === copy.failAborted ||
    embedded.body === copy.failGeneric ||
    embedded.body === copy.failStep ||
    embedded.body.includes('这一步没做成') ||
    embedded.body.includes('这次操作被中断')
  ) {
    return {
      kind: 'failure',
      title: copy.assistant,
      body: embedded.body,
      detail: embedded.detail,
      actions: ['retry', 'rephrase'],
      timestamp: msg.timestamp,
      rawActor: actor,
    };
  }

  // Historical or live failures stored with machine content
  if (
    BANNED_PRIMARY.test(content) ||
    /could not manually extract|could not validate model output|Planning failed|Navigation failed|Failed to execute/i.test(
      content,
    )
  ) {
    const { body, detail } = classifyFailure(embedded.body || content, copy);
    return {
      kind: 'failure',
      title: copy.assistant,
      body,
      detail: embedded.detail ?? detail,
      actions: ['retry', 'rephrase'],
      timestamp: msg.timestamp,
      rawActor: actor,
    };
  }

  // Historical process telemetry: hide from chat (task card is SSOT for steps).
  if (isProcessNoiseContent(content) || isProcessNoiseContent(embedded.body)) {
    return {
      kind: 'system_note',
      title: copy.assistant,
      body: '',
      timestamp: msg.timestamp,
      rawActor: actor,
    };
  }

  // Any non-user actor → 助手
  const kind: DisplayKind =
    actor === Actors.SYSTEM && looksLikeMachineToken(content) ? 'system_note' : 'assistant';

  let body = content;
  if (looksLikeMachineToken(body)) {
    body = copy.failGeneric;
    return {
      kind: 'failure',
      title: copy.assistant,
      body,
      actions: ['retry', 'rephrase'],
      timestamp: msg.timestamp,
      rawActor: actor,
    };
  }

  return {
    kind,
    title: copy.assistant,
    body,
    timestamp: msg.timestamp,
    rawActor: actor,
  };
}

export type AgentEventUi =
  | { action: 'suppress' }
  | { action: 'progress' }
  | { action: 'append_assistant'; content: string }
  | { action: 'append_failure'; content: string; detail?: string }
  | { action: 'append_system'; content: string };

/**
 * Decide what the chat UI should do for a live agent event.
 * Does not mutate React state.
 */
export function classifyAgentEvent(
  event: Pick<AgentEvent, 'actor' | 'state'> & { details?: string },
  copy: HumanCopy = DEFAULT_ZH_COPY,
): AgentEventUi {
  const { actor, state } = event;
  const details = event.details ?? '';

  if (actor === Actors.USER) {
    return { action: 'suppress' };
  }

  if (actor === Actors.SYSTEM) {
    if (state === ExecutionState.TASK_FAIL || state === ExecutionState.TASK_CANCEL) {
      if (!details || looksLikeMachineToken(details)) {
        const { body, detail } = classifyFailure(details, copy);
        return { action: 'append_failure', content: body, detail };
      }
      return { action: 'append_system', content: details };
    }
    // TASK_OK etc. - card owns status; skip chat spam
    return { action: 'suppress' };
  }

  if (actor === Actors.PLANNER || actor === Actors.NAVIGATOR || actor === Actors.VALIDATOR) {
    if (state === ExecutionState.STEP_START) {
      return { action: 'progress' };
    }
    if (state === ExecutionState.STEP_FAIL) {
      const { body, detail } = classifyFailure(details, copy);
      return { action: 'append_failure', content: body, detail };
    }
    if (state === ExecutionState.STEP_OK) {
      if (!details || looksLikeMachineToken(details) || isProcessNoiseContent(details)) {
        // Task card owns steps/progress; chat only gets real deliverables or failures.
        return { action: 'suppress' };
      }
      // Only surface short human prose that looks like an answer, not telemetry.
      const text = details.length > 200 ? `${details.slice(0, 200)}…` : details;
      return { action: 'append_assistant', content: text };
    }
    // ACT_* and cancel: suppress from chat
    return { action: 'suppress' };
  }

  return { action: 'suppress' };
}

/** True if the last message should be replaced by a new failure (merge spam). */
export function shouldMergeFailure(last: Message | undefined, now = Date.now(), windowMs = 4000): boolean {
  if (!last) return false;
  if (last.actor === Actors.USER) return false;
  if (now - last.timestamp > windowMs) return false;
  const hum = humanizeStoredMessage(last);
  return hum.kind === 'failure';
}

export function displayTitleIsHuman(title: string, copy: HumanCopy = DEFAULT_ZH_COPY): boolean {
  return title === copy.you || title === copy.assistant;
}

export function assertNoMachineRoleInTitle(title: string): boolean {
  return !/planner|navigator|validator/i.test(title);
}
