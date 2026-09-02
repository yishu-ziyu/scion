/**
 * BrowserObservation (B2).
 *
 * A model-agnostic snapshot of what the browser looked like at a moment in
 * time. Carries the protocol version, a stable observationId, the page target,
 * the interactive elements (each with stable identity), and page signals.
 *
 * Deliberately absent: any "is the task done" field. Completion is a policy
 * decision made above this protocol, never inside an observation.
 */
import { z } from 'zod';
import { ElementTargetSchema, PageTargetSchema, sanitizeUrl } from './targets';
import { BROWSER_PROTOCOL_VERSION_STRING } from './version';

export const ViewportStateSchema = z.object({
  scrollY: z.number(),
  viewportHeight: z.number(),
  documentHeight: z.number(),
});
export type ViewportState = z.infer<typeof ViewportStateSchema>;

export const MediaObservationSchema = z.object({
  kind: z.enum(['none', 'bound', 'ambiguous']),
  state: z.string().optional(),
  candidateCount: z.number().int().nonnegative().optional(),
});
export type MediaObservation = z.infer<typeof MediaObservationSchema>;

export const PageSignalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('no_progress') }),
  z.object({ kind: z.literal('material_change') }),
  z.object({ kind: z.literal('navigation') }),
  z.object({ kind: z.literal('enrichment'), label: z.string(), detail: z.string() }),
]);
export type PageSignal = z.infer<typeof PageSignalSchema>;

export const InaccessibleFrameSchema = z.object({
  frameId: z.string().min(1),
  url: z.string().optional(),
  /** Sanitized error text, never raw page content. */
  reason: z.string().min(1),
});
export type InaccessibleFrame = z.infer<typeof InaccessibleFrameSchema>;

export const BrowserObservationSchema = z.object({
  protocolVersion: z.literal(BROWSER_PROTOCOL_VERSION_STRING),
  observationId: z.string().min(1),
  observedAt: z.number().int().nonnegative(),
  page: PageTargetSchema,
  pageRevision: z.string().min(1),
  interactiveElements: z.array(ElementTargetSchema),
  visibleText: z.string().optional(),
  viewport: ViewportStateSchema.optional(),
  media: MediaObservationSchema.optional(),
  inaccessibleFrames: z.array(InaccessibleFrameSchema).optional(),
  signals: z.array(PageSignalSchema),
});
export type BrowserObservation = z.infer<typeof BrowserObservationSchema>;

/**
 * Sanitize every URL in an observation before persistence: strip query and
 * fragment from the page URL and any frame URLs. Returns a new object; pure.
 */
export function sanitizeObservationUrls(observation: BrowserObservation): BrowserObservation {
  return {
    ...observation,
    page: { ...observation.page, url: sanitizeUrl(observation.page.url) },
    inaccessibleFrames: observation.inaccessibleFrames?.map(frame =>
      frame.url ? { ...frame, url: sanitizeUrl(frame.url) } : frame,
    ),
  };
}
