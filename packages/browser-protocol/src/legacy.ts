/**
 * Legacy adapter (B2 + B5).
 *
 * Bridges the pre-protocol `ObservationFrame` shape (v1) into the v2
 * protocol. The legacy shape is described here with minimal structural
 * types so this package never imports chrome-extension.
 *
 * Version policy: v1 documents are REJECTED by parseObservation() and may
 * only enter through adaptLegacyObservation().
 */
import { z } from 'zod';
import { BrowserObservationSchema, type BrowserObservation, type PageSignal } from './observation';
import { sanitizeUrl, type ElementTarget } from './targets';
import { checkProtocolVersion, type ProtocolGateResult } from './version';

/* ------------------------------------------------------------------ *
 * Old (v1) shapes — structural minimum of ObservationFrame
 * ------------------------------------------------------------------ */

export const LegacyInteractiveElementSchema = z.object({
  index: z.number().int().nonnegative(),
  tagName: z.string().optional(),
  text: z.string().optional(),
  title: z.string().optional(),
  role: z.string().optional(),
  type: z.string().optional(),
  name: z.string().optional(),
  id: z.string().optional(),
  value: z.string().optional(),
  valueRedacted: z.boolean().optional(),
  autocomplete: z.string().optional(),
  placeholder: z.string().optional(),
  label: z.string().optional(),
  contentEditable: z.boolean().optional(),
  checked: z.string().optional(),
  tabId: z.number().int().optional(),
  cdpFrameId: z.string().optional(),
  backendNodeId: z.number().int().optional(),
  cdpTargetId: z.string().optional(),
});
export type LegacyInteractiveElement = z.infer<typeof LegacyInteractiveElementSchema>;

export const LegacyObservationFrameSchema = z.object({
  /** v1 frames carry no version field; "1" is accepted when present. */
  protocolVersion: z.union([z.literal('1'), z.literal(1)]).optional(),
  frameId: z.string(),
  observedAt: z.number(),
  tab: z.object({ id: z.number(), url: z.string(), title: z.string() }),
  pageRevision: z.string(),
  targetCount: z.number().optional(),
  /** Compact prompt text the old kernel fed to models; dropped by the adapter. */
  text: z.string().optional(),
  interactiveElements: z.array(LegacyInteractiveElementSchema).optional(),
  visibleText: z.string().optional(),
  viewport: z.object({ scrollY: z.number(), viewportHeight: z.number(), documentHeight: z.number() }).optional(),
  media: z
    .object({
      kind: z.enum(['none', 'bound', 'ambiguous']),
      state: z.string().optional(),
      candidateCount: z.number().optional(),
    })
    .optional(),
  signals: z
    .array(
      z.union([
        z.object({ kind: z.literal('no_progress') }),
        z.object({ kind: z.literal('material_change') }),
        z.object({ kind: z.literal('navigation') }),
        z.object({ kind: z.literal('enrichment'), label: z.string(), detail: z.string() }),
      ]),
    )
    .optional(),
  inaccessibleIframes: z
    .array(z.object({ targetId: z.string(), url: z.string().optional(), error: z.string() }))
    .optional(),
});
export type LegacyObservationFrame = z.infer<typeof LegacyObservationFrameSchema>;

/* ------------------------------------------------------------------ *
 * Adapter
 * ------------------------------------------------------------------ */

/**
 * ponytail: legacy digests without backendNodeId fall back to `#id`, then to
 * a synthetic `[data-chijie-legacy-index="N"]` selector. That bridge selector
 * is only unique within one pageRevision; the executor path that replaces
 * this adapter should resolve real CDP identities instead.
 */
function legacyElementToTarget(
  element: LegacyInteractiveElement,
  pageRevision: string,
  rootFrameId: string,
): ElementTarget {
  const identity: ElementTarget['identity'] = {};
  if (element.backendNodeId !== undefined) identity.backendNodeId = element.backendNodeId;
  else if (element.id) identity.cssPath = `#${element.id}`;
  else identity.cssPath = `[data-chijie-legacy-index="${element.index}"]`;
  if (element.cdpFrameId && element.cdpFrameId !== rootFrameId) identity.frameId = element.cdpFrameId;

  const target: ElementTarget = { kind: 'element', identity, pageRevision };
  target.index = element.index;
  if (element.tagName) target.tagName = element.tagName;
  if (element.role) target.role = element.role;
  if (element.type) target.type = element.type;
  if (element.text) target.text = element.text;
  if (element.label) target.label = element.label;
  if (element.placeholder) target.placeholder = element.placeholder;
  if (element.valueRedacted) {
    target.valueRedacted = true;
  } else if (element.value !== undefined) {
    target.value = element.value;
  }
  if (element.checked !== undefined) target.checked = element.checked === 'true';
  return target;
}

/** Convert one legacy ObservationFrame into a v2 BrowserObservation. Pure. */
export function adaptLegacyObservation(legacy: LegacyObservationFrame): BrowserObservation {
  const frame = LegacyObservationFrameSchema.parse(legacy);
  const observation: BrowserObservation = {
    protocolVersion: '2',
    observationId: frame.frameId,
    observedAt: Math.trunc(frame.observedAt),
    page: {
      kind: 'page',
      tabId: frame.tab.id,
      url: sanitizeUrl(frame.tab.url),
      title: frame.tab.title,
      pageRevision: frame.pageRevision,
    },
    pageRevision: frame.pageRevision,
    interactiveElements: (frame.interactiveElements ?? []).map(element =>
      legacyElementToTarget(element, frame.pageRevision, frame.frameId),
    ),
    signals: (frame.signals ?? []) as PageSignal[],
  };
  if (frame.visibleText !== undefined) observation.visibleText = frame.visibleText;
  if (frame.viewport) observation.viewport = frame.viewport;
  if (frame.media) {
    observation.media = { kind: frame.media.kind };
    if (frame.media.state !== undefined) observation.media.state = frame.media.state;
    if (frame.media.candidateCount !== undefined)
      observation.media.candidateCount = Math.trunc(frame.media.candidateCount);
  }
  if (frame.inaccessibleIframes?.length) {
    observation.inaccessibleFrames = frame.inaccessibleIframes.map(entry => ({
      frameId: entry.targetId,
      ...(entry.url ? { url: sanitizeUrl(entry.url) } : {}),
      reason: entry.error,
    }));
  }
  return BrowserObservationSchema.parse(observation);
}

/* ------------------------------------------------------------------ *
 * Version-aware entry point
 * ------------------------------------------------------------------ */

export type ParseObservationResult =
  | { ok: true; observation: BrowserObservation }
  | { ok: false; code: string; found: string };

/**
 * Parse a raw observation message.
 * - v2: schema parse (unknown fields stripped, never crash).
 * - v1: rejected with LEGACY_PROTOCOL_REQUIRES_ADAPTER — callers must go
 *   through adaptLegacyObservation() explicitly.
 * - anything else: UNSUPPORTED_PROTOCOL_VERSION.
 */
export function parseObservation(raw: unknown): ParseObservationResult {
  const version: unknown =
    raw !== null && typeof raw === 'object' ? (raw as { protocolVersion?: unknown }).protocolVersion : undefined;
  const gate: ProtocolGateResult = checkProtocolVersion(version);
  if (gate.ok) {
    const parsed = BrowserObservationSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        code: 'INVALID_OBSERVATION',
        found: parsed.error.issues.map(i => i.path.join('.')).join(','),
      };
    }
    return { ok: true, observation: parsed.data };
  }
  return { ok: false, code: gate.code, found: gate.found };
}
