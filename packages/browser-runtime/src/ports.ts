/**
 * Runtime ports (C1).
 *
 * The headless browser runtime talks to the world only through these
 * interfaces. Every port has a fake implementation (./fakes/) so the runtime
 * instantiates and runs in a plain Node test environment with no Chrome, no
 * UI, and no TaskManager. This package must never import chrome-extension,
 * pages, the `chrome` global, or any LLM SDK — enforced by dependency-cruiser.
 */
import type { ActionReceipt, BrowserAction, BrowserObservation } from '@chijie/browser-protocol';

/**
 * Options for a page snapshot. The protocol package defines no observe
 * options yet, so this is the minimal runtime-side shape; when the protocol
 * grows one, this alias should point at it instead.
 */
export interface ObserveOptions {
  /** Keep only interactive elements matching this text (same semantics as legacy `observe { query }`). */
  query?: string;
}

/** Executes one protocol action and returns its receipt. Never decides task completion. */
export interface ActionExecutorPort {
  execute(action: BrowserAction): Promise<ActionReceipt>;
}

/** Produces a protocol observation of the current page state. */
export interface PageSnapshotPort {
  observe(options?: ObserveOptions): Promise<BrowserObservation>;
}

/**
 * Minimal discriminated runtime event. Trace sinks (storage, console, tests)
 * subscribe through this port; the runtime itself stays sink-agnostic.
 */
export type RuntimeEvent =
  | { kind: 'action.requested'; actionId: string; at: number }
  | { kind: 'action.receipt'; actionId: string; status: ActionReceipt['status']; at: number }
  | { kind: 'observation.captured'; observationId: string; at: number }
  /** Emitted by the TargetResolver when an old target was safely re-bound
   *  to the same identity in a newer observation (C4). */
  | {
      kind: 'target.rebound';
      fromRevision: string;
      toRevision: string;
      backendNodeId?: number;
      cssPath?: string;
      at: number;
    };

/** Append-only trace sink for runtime events. */
export interface RuntimeTracePort {
  emit(event: RuntimeEvent): Promise<void>;
}

/** Injectable clock so tests control time. */
export interface ClockPort {
  now(): number;
}

/** Injectable id source so tests get deterministic ids. */
export interface IdGeneratorPort {
  next(): string;
}

/** Minimal logger surface; no implementation is assumed. */
export interface LoggerPort {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
