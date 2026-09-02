/**
 * Observation targets (B2).
 *
 * Identity rules:
 * - ElementTarget is NOT identified by its digest index. `index` is an
 *   optional display affordance; stable identity is (backendNodeId or
 *   cssPath) + frameId + pageRevision.
 * - Elements inside iframes carry an explicit frame identity.
 * - Sensitive inputs expose `valueRedacted: true` and never a real value.
 * - URLs default to query/fragment-free via sanitizeUrl before persistence.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * URL sanitization
 * ------------------------------------------------------------------ */

export interface SanitizeUrlOptions {
  /** Keep the query string (default false — tokens ride in query params). */
  keepQuery?: boolean;
  /** Keep the fragment (default false — fragments leak anchors/selections). */
  keepFragment?: boolean;
}

/**
 * Normalize a URL for protocol storage: strip query and fragment unless
 * explicitly kept, and remove embedded credentials. Non-absolute or
 * malformed input is returned without its query/fragment when possible,
 * otherwise unchanged after trimming. Pure.
 */
export function sanitizeUrl(raw: string, options: SanitizeUrlOptions = {}): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not absolute (relative path, about:..., data:... parse fine above;
    // anything else we strip manually).
    let out = trimmed;
    if (!options.keepFragment) out = out.split('#')[0];
    if (!options.keepQuery) out = out.split('?')[0];
    return out;
  }
  if (parsed.username || parsed.password) {
    parsed.username = '';
    parsed.password = '';
  }
  if (!options.keepQuery) parsed.search = '';
  if (!options.keepFragment) parsed.hash = '';
  return parsed.toString();
}

/* ------------------------------------------------------------------ *
 * Targets
 * ------------------------------------------------------------------ */

export const PageTargetSchema = z.object({
  kind: z.literal('page'),
  tabId: z.number().int().nonnegative(),
  /** Sanitized URL (no query/fragment by default). */
  url: z.string(),
  title: z.string(),
  /** Revision of the page document this target was observed at. */
  pageRevision: z.string().min(1),
});
export type PageTarget = z.infer<typeof PageTargetSchema>;

/** An iframe (or the root frame) inside a page. */
export const FrameTargetSchema = z.object({
  kind: z.literal('frame'),
  /** CDP frameId — stable identity of the frame document. */
  frameId: z.string().min(1),
  cdpTargetId: z.string().min(1).optional(),
  /** Frame URL, sanitized by default. Absent for opaque/child frames. */
  url: z.string().optional(),
  /** The page this frame lives in. */
  tabId: z.number().int().nonnegative(),
  pageRevision: z.string().min(1),
});
export type FrameTarget = z.infer<typeof FrameTargetSchema>;

/**
 * Stable identity for a DOM element. At least one of backendNodeId /
 * cssPath must be present (enforced below); index alone is never identity.
 */
export const ElementIdentitySchema = z
  .object({
    backendNodeId: z.number().int().nonnegative().optional(),
    /** Fallback selector when no CDP backendNodeId is available. */
    cssPath: z.string().min(1).optional(),
    /** Frame the element lives in; omitted only for the root frame. */
    frameId: z.string().min(1).optional(),
  })
  .refine(v => v.backendNodeId !== undefined || v.cssPath !== undefined, {
    message: 'ElementTarget requires backendNodeId or cssPath as stable identity',
  });
export type ElementIdentity = z.infer<typeof ElementIdentitySchema>;

export const ElementTargetSchema = z.object({
  kind: z.literal('element'),
  identity: ElementIdentitySchema,
  /** Revision of the page the identity was resolved against. */
  pageRevision: z.string().min(1),
  /** Optional digest position — presentation only, never identity. */
  index: z.number().int().nonnegative().optional(),
  tagName: z.string().optional(),
  role: z.string().optional(),
  type: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  /**
   * Sensitive-field semantics: when true, no `value` may be present.
   * Non-sensitive fields may carry `value`; the two are mutually exclusive.
   */
  value: z.string().optional(),
  valueRedacted: z.boolean().optional(),
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
export type ElementTarget = z.infer<typeof ElementTargetSchema>;

export const MediaTargetSchema = z.object({
  kind: z.literal('media'),
  /** Stable media identity within the page revision. */
  mediaId: z.string().min(1),
  mediaKind: z.enum(['video', 'audio', 'other']),
  frameId: z.string().min(1).optional(),
  tabId: z.number().int().nonnegative(),
  pageRevision: z.string().min(1),
  state: z.enum(['playing', 'paused', 'ended', 'unknown']).optional(),
});
export type MediaTarget = z.infer<typeof MediaTargetSchema>;

export const BrowserTargetSchema = z.discriminatedUnion('kind', [
  PageTargetSchema,
  FrameTargetSchema,
  ElementTargetSchema,
  MediaTargetSchema,
]);
export type BrowserTarget = z.infer<typeof BrowserTargetSchema>;

export type BrowserTargetKind = BrowserTarget['kind'];

/** ElementTarget extra guard: valueRedacted forbids a real value. */
export function validateElementTarget(raw: unknown): ElementTarget {
  const parsed = ElementTargetSchema.parse(raw);
  if (parsed.valueRedacted && parsed.value !== undefined) {
    throw new Error('ElementTarget with valueRedacted must not carry a value');
  }
  return parsed;
}

/** Every target kind exposes the page revision it belongs to. */
export function targetPageRevision(target: BrowserTarget): string {
  return target.pageRevision;
}
