/**
 * Minimal instantiable runtime skeleton (C1).
 *
 * The point of C1 is the port boundary, not full logic: this skeleton wires
 * the ports together, stamps protocol fields (ids, timestamps) through the
 * injectable clock and id generator, and runs observe + execute while
 * emitting trace events. Real execution behavior arrives with later EPIC C
 * steps behind the same ports.
 */
import {
  BROWSER_PROTOCOL_VERSION_STRING,
  validateActionTarget,
  type ActionReceipt,
  type BrowserAction,
  type BrowserObservation,
} from '@chijie/browser-protocol';
import type {
  ActionExecutorPort,
  ClockPort,
  IdGeneratorPort,
  LoggerPort,
  ObserveOptions,
  PageSnapshotPort,
  RuntimeTracePort,
} from './ports';

export interface BrowserRuntimeDeps {
  executor: ActionExecutorPort;
  snapshot: PageSnapshotPort;
  trace: RuntimeTracePort;
  clock: ClockPort;
  ids: IdGeneratorPort;
  logger: LoggerPort;
}

export type ExecuteOutcome = { ok: true; receipt: ActionReceipt } | { ok: false; reason: string };

export class BrowserRuntime {
  constructor(private readonly deps: BrowserRuntimeDeps) {}

  /** Current protocol timestamp from the injected clock. */
  now(): number {
    return this.deps.clock.now();
  }

  /** Next id from the injected generator (for callers building actions). */
  nextId(): string {
    return this.deps.ids.next();
  }

  /** Protocol version stamp for building actions outside this class. */
  protocolVersion(): typeof BROWSER_PROTOCOL_VERSION_STRING {
    return BROWSER_PROTOCOL_VERSION_STRING;
  }

  async observe(options?: ObserveOptions): Promise<BrowserObservation> {
    const observation = await this.deps.snapshot.observe(options);
    await this.deps.trace.emit({
      kind: 'observation.captured',
      observationId: observation.observationId,
      at: this.deps.clock.now(),
    });
    this.deps.logger.debug(`observed page revision ${observation.pageRevision}`);
    return observation;
  }

  /**
   * Execute one action through the executor port. Target-policy violations
   * never reach the executor; they return a structured refusal so callers
   * (and the legacy adapter) can translate them into receipts upstream.
   */
  async execute(action: BrowserAction): Promise<ExecuteOutcome> {
    const verdict = validateActionTarget(action);
    if (!verdict.ok) {
      this.deps.logger.warn(`action ${action.actionId} rejected: ${verdict.reason}`);
      return { ok: false, reason: verdict.reason };
    }
    await this.deps.trace.emit({
      kind: 'action.requested',
      actionId: action.actionId,
      at: this.deps.clock.now(),
    });
    const receipt = await this.deps.executor.execute(action);
    await this.deps.trace.emit({
      kind: 'action.receipt',
      actionId: receipt.actionId,
      status: receipt.status,
      at: this.deps.clock.now(),
    });
    return { ok: true, receipt };
  }
}
