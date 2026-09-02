/**
 * BrowserAction discriminated union (B3).
 *
 * Design rules:
 * - Discriminated on `kind`; no bare-string + Record<string, unknown> API.
 * - `effect` is required on every action — external commits must be
 *   explicitly marked `external_commit`, never defaulted.
 * - `target` types are enforced per kind by validateActionTarget() before
 *   execution.
 * - No task-completion field exists anywhere in this protocol.
 */
import { z } from 'zod';
import { BrowserTargetSchema, type BrowserTarget, type BrowserTargetKind } from './targets';
import { BROWSER_PROTOCOL_VERSION_STRING } from './version';

export const ActionEffectSchema = z.enum(['read', 'reversible_write', 'external_commit']);
export type ActionEffect = z.infer<typeof ActionEffectSchema>;

export const WaitConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url_includes'), value: z.string().min(1) }),
  z.object({ kind: z.literal('url_starts_with'), value: z.string().min(1) }),
  z.object({ kind: z.literal('title_includes'), value: z.string().min(1) }),
  z.object({ kind: z.literal('text_includes'), value: z.string().min(1) }),
  z.object({ kind: z.literal('revision_changed'), fromRevision: z.string().min(1) }),
]);
export type WaitCondition = z.infer<typeof WaitConditionSchema>;

const actionBase = {
  protocolVersion: z.literal(BROWSER_PROTOCOL_VERSION_STRING),
  actionId: z.string().min(1),
  /** When the action was requested (epoch ms). */
  requestedAt: z.number().int().nonnegative(),
  effect: ActionEffectSchema,
};

export const NavigateActionSchema = z.object({
  ...actionBase,
  kind: z.literal('navigate'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ url: z.string().min(1) }),
});

export const ClickActionSchema = z.object({
  ...actionBase,
  kind: z.literal('click'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ doubleClick: z.boolean().optional() }).partial(),
});

export const InputTextActionSchema = z.object({
  ...actionBase,
  kind: z.literal('input_text'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ text: z.string(), append: z.boolean().optional() }),
});

export const SelectOptionActionSchema = z.object({
  ...actionBase,
  kind: z.literal('select_option'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ optionText: z.string().min(1) }),
});

export const SendKeysActionSchema = z.object({
  ...actionBase,
  kind: z.literal('send_keys'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ keys: z.string().min(1) }),
});

export const ScrollActionSchema = z.object({
  ...actionBase,
  kind: z.literal('scroll'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().optional(),
  }),
});

export const OpenTabActionSchema = z.object({
  ...actionBase,
  kind: z.literal('open_tab'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ url: z.string().min(1), foreground: z.boolean().optional() }),
});

export const SwitchTabActionSchema = z.object({
  ...actionBase,
  kind: z.literal('switch_tab'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ tabId: z.number().int().nonnegative() }),
});

export const CloseTabActionSchema = z.object({
  ...actionBase,
  kind: z.literal('close_tab'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ tabId: z.number().int().nonnegative() }),
});

export const GoBackActionSchema = z.object({
  ...actionBase,
  kind: z.literal('go_back'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({}).partial(),
});

export const MediaControlActionSchema = z.object({
  ...actionBase,
  kind: z.literal('media_control'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ command: z.enum(['play', 'pause', 'seek', 'set_rate']) }),
});

export const WaitActionSchema = z.object({
  ...actionBase,
  kind: z.literal('wait'),
  target: BrowserTargetSchema.nullable(),
  input: z.object({ condition: WaitConditionSchema, timeoutMs: z.number().int().positive() }),
});

export const BrowserActionSchema = z.discriminatedUnion('kind', [
  NavigateActionSchema,
  ClickActionSchema,
  InputTextActionSchema,
  SelectOptionActionSchema,
  SendKeysActionSchema,
  ScrollActionSchema,
  OpenTabActionSchema,
  SwitchTabActionSchema,
  CloseTabActionSchema,
  GoBackActionSchema,
  MediaControlActionSchema,
  WaitActionSchema,
]);
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type BrowserActionKind = BrowserAction['kind'];

export const BROWSER_ACTION_KINDS = [
  'navigate',
  'click',
  'input_text',
  'select_option',
  'send_keys',
  'scroll',
  'open_tab',
  'switch_tab',
  'close_tab',
  'go_back',
  'media_control',
  'wait',
] as const satisfies readonly BrowserActionKind[];

/* ------------------------------------------------------------------ *
 * Target-kind policy per action (validated before execution)
 * ------------------------------------------------------------------ */

const ALLOWED_TARGET_KINDS: Record<BrowserActionKind, ReadonlySet<BrowserTargetKind | 'null'>> = {
  navigate: new Set(['page', 'frame', 'null']),
  click: new Set(['element']),
  input_text: new Set(['element']),
  select_option: new Set(['element']),
  send_keys: new Set(['element', 'page', 'null']),
  scroll: new Set(['page', 'frame', 'element', 'null']),
  open_tab: new Set(['null']),
  switch_tab: new Set(['page']),
  close_tab: new Set(['page']),
  go_back: new Set(['page']),
  media_control: new Set(['media']),
  wait: new Set(['page', 'frame', 'null']),
};

export type TargetPolicyResult = { ok: true } | { ok: false; reason: string };

/**
 * Reject actions whose target kind is illegal for the action before the
 * action reaches an executor. Pure; returns a structured verdict.
 */
export function validateActionTarget(action: BrowserAction): TargetPolicyResult {
  const allowed = ALLOWED_TARGET_KINDS[action.kind];
  const actual: BrowserTargetKind | 'null' = action.target === null ? 'null' : action.target.kind;
  if (!allowed.has(actual)) {
    return {
      ok: false,
      reason: `action kind '${action.kind}' does not accept target kind '${actual}'`,
    };
  }
  return { ok: true };
}

/** Throwing variant of validateActionTarget for call sites that prefer exceptions. */
export function assertActionTarget(action: BrowserAction): void {
  const result = validateActionTarget(action);
  if (!result.ok) throw new Error(result.reason);
}

/** Target helper so callers don't re-narrow for policy checks. */
export function actionTargetKind(action: BrowserAction): BrowserTargetKind | 'null' {
  return action.target === null ? 'null' : (action.target as BrowserTarget).kind;
}

/* ------------------------------------------------------------------ *
 * Exhaustiveness helper
 * ------------------------------------------------------------------ */

function assertNever(value: never): never {
  throw new Error(`Unhandled browser action: ${JSON.stringify(value)}`);
}

/**
 * Compile-time + runtime exhaustiveness check over BrowserAction.
 * Adding a new action kind without extending this switch breaks type-check.
 */
export function describeActionKind(action: BrowserAction): string {
  switch (action.kind) {
    case 'navigate':
      return `navigate to ${action.input.url}`;
    case 'click':
      return 'click element';
    case 'input_text':
      return 'input text';
    case 'select_option':
      return `select option ${action.input.optionText}`;
    case 'send_keys':
      return `send keys ${action.input.keys}`;
    case 'scroll':
      return `scroll ${action.input.direction}`;
    case 'open_tab':
      return `open tab ${action.input.url}`;
    case 'switch_tab':
      return `switch to tab ${action.input.tabId}`;
    case 'close_tab':
      return `close tab ${action.input.tabId}`;
    case 'go_back':
      return 'go back';
    case 'media_control':
      return `media ${action.input.command}`;
    case 'wait':
      return `wait for ${action.input.condition.kind}`;
    default:
      return assertNever(action);
  }
}
