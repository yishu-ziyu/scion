/**
 * Action effect classification (C5).
 *
 * Given the observations before and after an action, decide what the action
 * actually did: applied / no_effect / blocked / unknown. These are exactly
 * the ActionReceipt statuses — the classifier and the receipt never drift.
 *
 * Hard rules (EPIC C5):
 * - A debugger detach makes the after-snapshot untrustworthy → `unknown`,
 *   never a claimed `applied`.
 * - An `external_commit` whose effect cannot be confirmed is `unknown`, and
 *   `unknown` must NEVER be auto-retried for an external_commit (a second
 *   click of "buy" is a second purchase). See `mayRetryAction`.
 * - Fixed idempotence rule: input_text re-entering the value the field
 *   already holds produces no observable change → `no_effect` (the classifier
 *   never invents an `applied` for it; see the matching test).
 *
 * The protocol observation carries page revision/URL/title, element
 * attributes, media and signals. It has no download/tab-list/debugger
 * fields yet, so this file declares the minimal runtime-side extras shape
 * (see `EffectObservationExtras`); producers may attach those fields and
 * the classifier reads them when present.
 */
import {
  makeBrowserError,
  type ActionReceipt,
  type ActionReceiptStatus,
  type BrowserAction,
  type BrowserError,
  type BrowserObservation,
  type ElementTarget,
} from '@chijie/browser-protocol';
import { identityMatches, type TargetResolution } from './target-resolver';

/* ------------------------------------------------------------------ *
 * Runtime-side minimal extras (protocol has no fields for these yet)
 * ------------------------------------------------------------------ */

export interface EffectObservationExtras {
  /** protocol 无 download 观测字段：最小形状，缺省视为无下载。 */
  downloads?: { activeCount?: number; completedCount?: number };
  /** protocol 只有当前 page.tabId：tab 全局状态用最小形状补充。 */
  tabs?: { count?: number; activeTabId?: number };
  /** debugger 已 detach：after 快照不可信，效果只能是 unknown。 */
  debuggerDetached?: boolean;
  /** 执行前被 policy/user 拒绝（页面必然不变）：分类为 blocked。 */
  blocked?: boolean;
}

export type EffectObservation = BrowserObservation & EffectObservationExtras;

export type ActionEffectVerdict = ActionReceiptStatus;

/* ------------------------------------------------------------------ *
 * Change detection
 * ------------------------------------------------------------------ */

/** Stable attributes only — `index` is presentation, never state. */
function elementStateSignature(element: ElementTarget): string {
  return JSON.stringify([
    element.tagName ?? '',
    element.role ?? '',
    element.type ?? '',
    element.text ?? '',
    element.label ?? '',
    element.placeholder ?? '',
    element.value ?? '',
    element.valueRedacted === true,
    element.checked ?? false,
    element.disabled ?? false,
  ]);
}

/** Coarse digest of every form value on the page (values are already
 *  protocol-redacted for sensitive fields; valueRedacted never carries one). */
function formValuesSummary(observation: BrowserObservation): string {
  return observation.interactiveElements
    .map(
      element =>
        `${element.identity.backendNodeId ?? element.identity.cssPath ?? ''}=${element.value ?? ''}:${element.checked === true}`,
    )
    .join('|');
}

function findElementByTarget(observation: BrowserObservation, target: ElementTarget): ElementTarget | undefined {
  return observation.interactiveElements.find(element => identityMatches(target, element));
}

/** Page-level signals: revision, URL, title, active tab, media state. */
function pageSignalsChanged(before: EffectObservation, after: EffectObservation): boolean {
  if (before.pageRevision !== after.pageRevision) return true;
  if (before.page.url !== after.page.url) return true;
  if (before.page.title !== after.page.title) return true;
  if (before.page.tabId !== after.page.tabId) return true;
  return JSON.stringify(before.media ?? null) !== JSON.stringify(after.media ?? null);
}

/** Runtime-side extras: downloads and the global tab list. */
function extrasChanged(before: EffectObservation, after: EffectObservation): boolean {
  if (JSON.stringify(before.downloads ?? null) !== JSON.stringify(after.downloads ?? null)) return true;
  return JSON.stringify(before.tabs ?? null) !== JSON.stringify(after.tabs ?? null);
}

/** Target attribute change even when the page revision did not move. */
function targetAttributesChanged(before: EffectObservation, after: EffectObservation, action: BrowserAction): boolean {
  if (action.target === null || action.target.kind !== 'element') return false;
  const b = findElementByTarget(before, action.target);
  const a = findElementByTarget(after, action.target);
  return Boolean(b && a && elementStateSignature(b) !== elementStateSignature(a));
}

function hasObservableChange(before: EffectObservation, after: EffectObservation, action: BrowserAction): boolean {
  if (pageSignalsChanged(before, after)) return true;
  if (formValuesSummary(before) !== formValuesSummary(after)) return true;
  if (extrasChanged(before, after)) return true;
  return targetAttributesChanged(before, after, action);
}

/* ------------------------------------------------------------------ *
 * Classifier
 * ------------------------------------------------------------------ */

/**
 * Classify the effect of `action` from the before/after observations.
 * Order: untrustworthy snapshot → policy refusal → observable change →
 * unconfirmable external commit → no effect.
 */
export function classifyActionEffect(
  before: EffectObservation,
  after: EffectObservation,
  action: BrowserAction,
): ActionEffectVerdict {
  // debugger detach: the after-snapshot proves nothing. Never claim applied.
  if (after.debuggerDetached || before.debuggerDetached) return 'unknown';
  // refused before execution: page necessarily unchanged.
  if (after.blocked) return 'blocked';
  if (hasObservableChange(before, after, action)) return 'applied';
  // An external commit with no observable change cannot be confirmed.
  if (action.effect === 'external_commit') return 'unknown';
  // Nothing observable changed — including the fixed idempotence case:
  // input_text re-entering the value the field already holds lands here.
  return 'no_effect';
}

/**
 * Retry policy for the classifier verdict. `unknown` is retryable for
 * ordinary actions (e.g. debugger detached, re-observe and try again) but
 * NEVER for an external_commit — retrying could double the external effect.
 */
export function mayRetryAction(action: BrowserAction, verdict: ActionEffectVerdict): boolean {
  return verdict === 'unknown' && action.effect !== 'external_commit';
}

/* ------------------------------------------------------------------ *
 * Receipt composition
 * ------------------------------------------------------------------ */

export interface ActionReceiptInput {
  action: BrowserAction;
  before: EffectObservation;
  /** Absent when the action never produced a trustworthy after-snapshot
   *  (debugger detached, resolution failure before execution). */
  after?: EffectObservation;
  /** Target resolution outcome, when the action carried a target. */
  resolution?: TargetResolution;
  verdict: ActionEffectVerdict;
  error?: BrowserError;
}

/** Default errors so blocked/unknown receipts always satisfy validateReceipt. */
function fallbackError(verdict: ActionEffectVerdict, action: BrowserAction): BrowserError {
  if (verdict === 'blocked') {
    return makeBrowserError('USER_IN_CONTROL', `action ${action.kind} was refused before execution`);
  }
  return makeBrowserError(
    'VALIDATION_UNAVAILABLE',
    `effect of action ${action.kind} could not be confirmed from the after-snapshot`,
  );
}

/**
 * Compose a TargetResolution + effect verdict into a protocol ActionReceipt.
 * `afterRevision` is present only when a real after-snapshot was read;
 * blocked/unknown receipts always carry an error explaining themselves.
 * There is no isDone — completion is a policy verdict above this layer.
 */
export function buildActionReceipt(input: ActionReceiptInput): ActionReceipt {
  const { action, before, after, verdict } = input;
  const error =
    input.error ?? (verdict === 'blocked' || verdict === 'unknown' ? fallbackError(verdict, action) : undefined);
  return {
    actionId: action.actionId,
    status: verdict,
    beforeRevision: before.pageRevision,
    afterRevision: after?.pageRevision,
    evidence: after ? [{ kind: 'dom_diff', ref: after.observationId, capturedAt: after.observedAt }] : [],
    ...(error ? { error } : {}),
  };
}
