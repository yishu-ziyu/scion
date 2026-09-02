/**
 * Shadow Mode recorder (C6 third batch) — the production wiring of
 * createShadowHook. For each settled legacy action it builds
 *
 *   legacy side: {name, args, element, error} from the just-executed attempt
 *   v2 side:     an equivalent BrowserAction (plan only, NEVER executed) whose
 *                target is resolved against the observation the legacy action
 *                was decided on, with a synthetic error-free receipt
 *
 * and persists one `shadow` trace span via shadowOnce + TraceStore. The whole
 * path is try/catch guarded: a shadow failure is logged and never touches the
 * legacy result, the task state, or control flow. The factory returns null
 * unless runtimeMode is exactly 'v2-shadow', so the default (legacy) path
 * constructs no comparator, no hook, and no closures.
 */
import {
  BROWSER_PROTOCOL_VERSION_STRING,
  sanitizeUrl,
  type BrowserAction,
  type BrowserActionKind,
  type BrowserObservation,
  type BrowserTarget,
  type ElementTarget,
} from '@chijie/browser-protocol';
import {
  LEGACY_NAME_TO_ACTION_KIND,
  parseRuntimeMode,
  resolveTarget,
  shadowOnce,
  ShadowComparator,
  type LegacyElementLike,
  type LegacyPlanLike,
  type TargetResolution,
} from '@chijie/browser-runtime';
import type { InteractiveElementDigest, ObservationFrame } from '../../browser/kernel';
import { createShadowHook, type ShadowV2Plan } from '../../browser/runtime/shadow-hook';
import { createLogger } from '../../log';
import { traceStore } from '../../task/trace';

const logger = createLogger('ShadowRecorder');

/** What the v2 side can plan for one legacy action. */
type V2TargetPlan =
  | { kind: 'element'; ref: ElementTarget }
  /** Text query resolved against the observation (legacy `query` arg). */
  | { kind: 'query'; query: string }
  /** Targetless action: the v2 equivalent carries target: null. */
  | { kind: 'none' }
  /** Element action whose target no stable identity can be built for. */
  | { kind: 'unresolvable' };

/** Stable-identity view of a legacy digest element; null when it has none. */
function elementTargetOfDigest(digest: InteractiveElementDigest, pageRevision: string): ElementTarget | null {
  const identity: ElementTarget['identity'] = {
    ...(digest.backendNodeId !== undefined ? { backendNodeId: digest.backendNodeId } : {}),
    // cssPath fallback mirrors protocol/legacy.ts: `#id`, else none.
    ...(digest.id ? { cssPath: `#${digest.id}` } : {}),
  };
  if (identity.backendNodeId === undefined && identity.cssPath === undefined) return null;
  return {
    kind: 'element',
    identity,
    pageRevision,
    index: digest.index,
    ...(digest.text !== undefined ? { text: digest.text } : {}),
    ...(digest.label !== undefined ? { label: digest.label } : {}),
    ...(digest.placeholder !== undefined ? { placeholder: digest.placeholder } : {}),
  };
  // Deliberately not copied from the digest: value/valueRedacted (form input
  // must never ride into a shadow artifact), checked (type mismatch).
}

/** Minimal protocol observation the TargetResolver can read a frame into. */
function observationFromFrame(frame: ObservationFrame): BrowserObservation {
  return {
    protocolVersion: BROWSER_PROTOCOL_VERSION_STRING,
    observationId: `shadow-${frame.frameId}-${frame.observedAt}`,
    observedAt: frame.observedAt,
    page: {
      kind: 'page',
      tabId: frame.tab.id,
      url: sanitizeUrl(frame.tab.url),
      title: frame.tab.title,
      pageRevision: frame.pageRevision,
    },
    pageRevision: frame.pageRevision,
    interactiveElements: frame.interactiveElements.flatMap(digest => {
      const element = elementTargetOfDigest(digest, frame.pageRevision);
      return element ? [element] : [];
    }),
    ...(frame.media
      ? { media: { kind: frame.media.kind, state: frame.media.state, candidateCount: frame.media.candidateCount } }
      : {}),
    inaccessibleFrames: (frame.inaccessibleIframes ?? []).map(item => ({
      frameId: item.targetId,
      reason: item.error,
      ...(item.url !== undefined ? { url: item.url } : {}),
    })),
    signals: [],
  };
}

/**
 * Plan the v2 target for a legacy action. Returns null when the legacy name
 * has no protocol mapping (no faithful v2 plan exists → no shadow report).
 */
function v2TargetPlanOf(
  name: string,
  args: Record<string, unknown>,
  frame: ObservationFrame | null,
): V2TargetPlan | null {
  const actionKind = LEGACY_NAME_TO_ACTION_KIND[name];
  if (!actionKind) return null;
  if (actionKind === 'click' || actionKind === 'input_text' || actionKind === 'select_option') {
    if (typeof args.index === 'number' && frame) {
      const digest = frame.interactiveElements.find(element => element.index === args.index);
      const ref = digest ? elementTargetOfDigest(digest, frame.pageRevision) : null;
      return ref ? { kind: 'element', ref } : { kind: 'unresolvable' };
    }
    if (typeof args.query === 'string' && args.query) return { kind: 'query', query: args.query };
    return { kind: 'unresolvable' };
  }
  // navigate / send_keys / open_tab / switch_tab / close_tab / go_back /
  // media_control address no digest element (control_media's mediaId is not
  // reconstructible from the legacy digest — both sides compare as 'none').
  return { kind: 'none' };
}

/** Per-kind v2 action builders; null = legacy args carry no faithful input. */
type V2ActionContext = { target: BrowserTarget | null; actionId: string; requestedAt: number };
type V2ActionBuilder = (args: Record<string, unknown>, ctx: V2ActionContext) => BrowserAction | null;

const v2Action = (ctx: V2ActionContext, kind: BrowserActionKind, input: Record<string, unknown>): BrowserAction =>
  ({
    protocolVersion: BROWSER_PROTOCOL_VERSION_STRING,
    ...ctx,
    effect: 'external_commit',
    kind,
    input,
  }) as BrowserAction;

const V2_ACTION_BUILDERS: Partial<Record<BrowserActionKind, V2ActionBuilder>> = {
  navigate: (args, ctx) =>
    typeof args.url === 'string' && args.url ? v2Action(ctx, 'navigate', { url: args.url }) : null,
  click: (_args, ctx) => v2Action(ctx, 'click', {}),
  input_text: (args, ctx) => (typeof args.text === 'string' ? v2Action(ctx, 'input_text', { text: args.text }) : null),
  select_option: (args, ctx) =>
    typeof args.text === 'string' ? v2Action(ctx, 'select_option', { optionText: args.text }) : null,
  send_keys: (args, ctx) => (typeof args.keys === 'string' ? v2Action(ctx, 'send_keys', { keys: args.keys }) : null),
  open_tab: (args, ctx) =>
    typeof args.url === 'string' && args.url ? v2Action(ctx, 'open_tab', { url: args.url }) : null,
  switch_tab: (args, ctx) => intAction(ctx, 'switch_tab', args.tab_id),
  close_tab: (args, ctx) => intAction(ctx, 'close_tab', args.tab_id),
  go_back: (_args, ctx) => v2Action(ctx, 'go_back', {}),
  media_control: (args, ctx) =>
    typeof args.command === 'string' && MEDIA_COMMANDS.has(args.command)
      ? v2Action(ctx, 'media_control', { command: args.command })
      : null,
};

const MEDIA_COMMANDS = new Set(['play', 'pause', 'seek', 'set_rate']);

function intAction(ctx: V2ActionContext, kind: BrowserActionKind, raw: unknown): BrowserAction | null {
  const tabId = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(tabId) && tabId >= 0 ? v2Action(ctx, kind, { tabId }) : null;
}

/**
 * The v2 equivalent of a legacy action, plan-only. `effect` is always
 * external_commit and the target policy is not enforced: this action is never
 * validated or executed, it exists only to be compared.
 */
function browserActionFromLegacy(
  name: string,
  args: Record<string, unknown>,
  target: BrowserTarget | null,
): BrowserAction | null {
  const actionKind = LEGACY_NAME_TO_ACTION_KIND[name];
  if (!actionKind) return null;
  const build = V2_ACTION_BUILDERS[actionKind];
  // Missing/invalid legacy input (e.g. no url on go_to_url) → no faithful plan.
  if (!build) return null;
  return build(args, { target, actionId: `shadow-${crypto.randomUUID()}`, requestedAt: Date.now() });
}

/** The element the legacy action addressed, from the decision-time digest. */
function legacyElementOf(args: Record<string, unknown>, frame: ObservationFrame | null): LegacyElementLike | null {
  if (!frame || typeof args.index !== 'number') return null;
  const digest = frame.interactiveElements.find(element => element.index === args.index);
  if (!digest) return null;
  return {
    ...(digest.index !== undefined ? { index: digest.index } : {}),
    ...(digest.backendNodeId !== undefined ? { backendNodeId: digest.backendNodeId } : {}),
    ...(digest.cdpFrameId !== undefined ? { cdpFrameId: digest.cdpFrameId } : {}),
    ...(digest.id !== undefined ? { id: digest.id } : {}),
  };
}

/** Build the v2 plan (resolve target, never execute) for one legacy action. */
async function buildV2Plan(
  name: string,
  args: Record<string, unknown>,
  frame: ObservationFrame | null,
): Promise<ShadowV2Plan | null> {
  const plan = v2TargetPlanOf(name, args, frame);
  if (!plan) return null;
  const target: BrowserTarget | null = plan.kind === 'element' ? plan.ref : null;
  const action = browserActionFromLegacy(name, args, target);
  // Missing/invalid legacy input (e.g. no url on go_to_url) → no faithful plan.
  if (!action) return null;

  let resolution: TargetResolution | undefined;
  if (plan.kind === 'element' || plan.kind === 'query') {
    if (!frame) {
      resolution = { kind: 'missing' };
    } else {
      const ref = plan.kind === 'query' ? { kind: 'query' as const, query: plan.query } : plan.ref;
      resolution = await resolveTarget(observationFromFrame(frame), ref);
    }
  } else if (plan.kind === 'unresolvable') {
    resolution = { kind: 'missing' };
  }
  // Synthetic receipt per C6: v2 only plans, so it reports no error — the
  // error axis therefore surfaces legacy failures against a clean v2 plan.
  const receipt = {
    actionId: action.actionId,
    status: 'applied' as const,
    beforeRevision: frame?.pageRevision ?? 'rev-unknown',
    evidence: [],
  };
  return { action, resolution, receipt };
}

export interface ShadowRecorder {
  /** Compare one settled legacy action against a v2 plan and persist the
   *  report. Never throws; never changes the legacy outcome. */
  record(input: {
    name: string;
    args: Record<string, unknown>;
    error?: string | null;
    /** Decision-time frame the legacy indexes/queries refer to. */
    frame?: ObservationFrame | null;
  }): Promise<void>;
}

export interface ShadowRecorderDeps {
  /** Raw generalSettings.runtimeMode; anything but 'v2-shadow' disables. */
  runtimeMode: unknown;
  taskId: string;
  /** Current round id, resolved per record (the loop advances rounds). */
  roundId: () => string;
}

/**
 * Default-off: returns a recorder only while the mode is exactly 'v2-shadow'.
 * Every other value (including 'v2-active' and garbage) resolves to legacy —
 * null, no comparator, no hook, no per-action work.
 */
export function createShadowRecorder(deps: ShadowRecorderDeps): ShadowRecorder | null {
  if (parseRuntimeMode(deps.runtimeMode) !== 'v2-shadow') return null;
  const comparator = new ShadowComparator();
  const hook = createShadowHook({
    runtimeMode: deps.runtimeMode,
    compare: (legacy, v2) => comparator.compare({ legacy, v2 }),
    buildReport: (legacy, v2) =>
      shadowOnce(legacy, v2, { taskId: deps.taskId, roundId: deps.roundId(), at: Date.now() }),
  });
  if (!hook) return null;
  return {
    async record(input) {
      try {
        const frame = input.frame ?? null;
        const legacyPlan: LegacyPlanLike = {
          name: input.name,
          args: input.args,
          element: legacyElementOf(input.args, frame),
          error: input.error ?? null,
        };
        const v2Plan = await buildV2Plan(input.name, input.args, frame);
        // No faithful v2 plan (unmapped/invalid legacy action): no report.
        if (!v2Plan) return;
        const report = hook.onRound(legacyPlan, v2Plan);
        await traceStore.appendSpan({
          id: crypto.randomUUID(),
          taskId: report.taskId,
          roundId: report.roundId,
          kind: 'shadow',
          name: `shadow.${report.outcome}`,
          startedAt: report.at,
          status: 'ok',
          detail: JSON.stringify(report.axes),
          data: { version: report.version, divergence_axes: report.axes.length },
        });
      } catch (error) {
        // Iron rule: shadow failures are log-only. The legacy action result,
        // task state, and control flow are already settled above.
        logger.error('shadow record failed; legacy path unaffected', error);
      }
    },
  };
}
