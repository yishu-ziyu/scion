/**
 * Browser Kernel types (product/022).
 * Stable interface between Agent Policy and Chrome control.
 */

export interface InteractiveElementDigest {
  index: number;
  tagName?: string;
  text?: string;
  role?: string;
  type?: string;
  name?: string;
  id?: string;
  value?: string;
  placeholder?: string;
  label?: string;
  contentEditable?: boolean;
  checked?: string;
}

export interface ViewportState {
  scrollY: number;
  viewportHeight: number;
  documentHeight: number;
}

export interface MediaObservation {
  kind: 'none' | 'bound' | 'ambiguous';
  state?: string;
  targetDigest?: string;
  candidateCount?: number;
}

export type PageSignal =
  | { kind: 'no_progress' }
  | { kind: 'material_change' }
  | { kind: 'navigation' }
  | { kind: 'enrichment'; label: string; detail: string };

export interface ObservationFrame {
  frameId: string;
  observedAt: number;
  tab: {
    id: number;
    url: string;
    title: string;
  };
  pageRevision: string;
  targetCount: number;
  interactiveElements: InteractiveElementDigest[];
  /** Visible document wording (innerText), bounded. Empty when the page has no body. */
  visibleText?: string;
  /** Compact text for model prompts (existing control path). */
  text: string;
  viewport?: ViewportState;
  media?: MediaObservation;
  screenshotRef?: string;
  signals: PageSignal[];
  /** Optional site enrichment text (skills may attach; core must not hardcode sites). */
  enrichment?: string;
}

export interface ElementDigest {
  index: number;
  tagName?: string;
  text?: string;
}

export interface ElementChange {
  index: number;
  before?: ElementDigest;
  after?: ElementDigest;
}

export interface MediaChange {
  before?: MediaObservation;
  after?: MediaObservation;
}

export interface ObservationDiff {
  fromRevision: string;
  toRevision: string;
  urlChanged: boolean;
  titleChanged: boolean;
  addedElements: ElementDigest[];
  removedElements: ElementDigest[];
  changedElements: ElementChange[];
  scrollDelta?: number;
  mediaChange?: MediaChange;
  materialChange: boolean;
  /** Compact prompt text for diff-mode context. */
  text: string;
}

export interface ObserveOptions {
  useVision?: boolean;
  includeAttributes?: string[] | null;
  /** Optional enrichment text already computed by Skill Runtime. */
  enrichment?: string;
}

export interface KernelActionResult {
  error?: string | null;
  isDone?: boolean;
  summary?: string | null;
  pageRevision?: string;
}

export interface ExtractionRequest<T = unknown> {
  schema?: unknown;
  /** Optional raw HTML override (tests). */
  html?: string;
  parser?: (html: string) => T;
}

export interface ExtractionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type WaitCondition =
  | { kind: 'url_includes'; value: string }
  | { kind: 'url_starts_with'; value: string }
  | { kind: 'title_includes'; value: string }
  | { kind: 'text_includes'; value: string }
  | { kind: 'revision_changed'; fromRevision: string };

export interface BrowserKernel {
  observe(options?: ObserveOptions): Promise<ObservationFrame>;
  act(
    roundId: string,
    actionName: string,
    args: unknown,
    frameRevision?: string,
  ): Promise<KernelActionResult>;
  extract<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>>;
  waitFor(condition: WaitCondition, timeoutMs: number): Promise<ObservationFrame>;
  /** Last frame from observe/act cycle (may be null before first observe). */
  lastFrame(): ObservationFrame | null;
  /** Diff between two frames (pure). */
  diff(from: ObservationFrame, to: ObservationFrame): ObservationDiff;
}
