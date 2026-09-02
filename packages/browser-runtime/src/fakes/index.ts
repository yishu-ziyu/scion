/**
 * Fake port implementations (C1).
 *
 * Everything the runtime needs to run in a plain Node test environment:
 * no Chrome, no UI, no TaskManager. The fake executor scripts the three
 * scenarios the runtime must handle — stale target, no effect, navigation —
 * and the fake snapshot produces protocol-valid observations.
 */
import {
  makeBrowserError,
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
  RuntimeEvent,
  RuntimeTracePort,
} from '../ports';

/** Deterministic clock; advance manually. */
export class FakeClock implements ClockPort {
  constructor(private time = 1_700_000_000_000) {}
  now(): number {
    return this.time;
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

/** Deterministic id source: prefix-1, prefix-2, … */
export class FakeIdGenerator implements IdGeneratorPort {
  private counter = 0;
  constructor(private readonly prefix = 'id') {}
  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}

/** In-memory logger; every call is inspectable via `entries`. */
export class FakeLogger implements LoggerPort {
  readonly entries: Array<{ level: keyof LoggerPort; message: string; args: unknown[] }> = [];
  debug(message: string, ...args: unknown[]): void {
    this.entries.push({ level: 'debug', message, args });
  }
  info(message: string, ...args: unknown[]): void {
    this.entries.push({ level: 'info', message, args });
  }
  warn(message: string, ...args: unknown[]): void {
    this.entries.push({ level: 'warn', message, args });
  }
  error(message: string, ...args: unknown[]): void {
    this.entries.push({ level: 'error', message, args });
  }
}

/** Collects trace events in memory. */
export class FakeTrace implements RuntimeTracePort {
  readonly events: RuntimeEvent[] = [];
  async emit(event: RuntimeEvent): Promise<void> {
    this.events.push(event);
  }
}

export type FakeScenario = 'applied' | 'stale_target' | 'no_effect' | 'navigation';

export function buildFakeObservation(overrides: Partial<BrowserObservation> = {}): BrowserObservation {
  return {
    protocolVersion: '2',
    observationId: 'obs-1',
    observedAt: 1_700_000_000_000,
    page: {
      kind: 'page',
      tabId: 1,
      url: 'https://example.test/',
      title: 'Example',
      pageRevision: 'rev-1',
    },
    pageRevision: 'rev-1',
    interactiveElements: [],
    signals: [],
    ...overrides,
  };
}

/**
 * Snapshot fake. `observe()` returns the queued observation (protocol-valid);
 * a `navigation` scenario advances the page revision and adds a navigation
 * signal so receipts and observations stay consistent.
 */
export class FakePageSnapshot implements PageSnapshotPort {
  private observation: BrowserObservation;
  private revision = 1;
  lastOptions: ObserveOptions | undefined;

  constructor(
    private readonly clock: ClockPort = new FakeClock(),
    observation?: BrowserObservation,
  ) {
    this.observation = observation ?? buildFakeObservation();
  }

  async observe(options?: ObserveOptions): Promise<BrowserObservation> {
    this.lastOptions = options;
    return this.observation;
  }

  /** Move the fake page forward as a navigation would. */
  navigate(url: string): void {
    this.revision += 1;
    const pageRevision = `rev-${this.revision}`;
    this.observation = {
      ...this.observation,
      observedAt: this.clock.now(),
      page: { ...this.observation.page, url, pageRevision },
      pageRevision,
      signals: [...this.observation.signals, { kind: 'navigation' }],
    };
  }
}

/**
 * Executor fake. One scripted scenario per instance covers the three
 * behaviors the runtime must survive: stale target, no effect, navigation.
 */
export class FakeActionExecutor implements ActionExecutorPort {
  readonly executed: BrowserAction[] = [];

  constructor(
    private readonly scenario: FakeScenario = 'applied',
    private readonly deps: { clock?: ClockPort; snapshot?: FakePageSnapshot } = {},
  ) {}

  async execute(action: BrowserAction): Promise<ActionReceipt> {
    this.executed.push(action);
    const clock = this.deps.clock ?? new FakeClock();
    const at = clock.now();
    const beforeRevision = action.target?.pageRevision ?? 'rev-1';

    if (this.scenario === 'stale_target') {
      return {
        actionId: action.actionId,
        status: 'blocked',
        beforeRevision,
        evidence: [],
        error: makeBrowserError('TARGET_STALE', `target revision '${beforeRevision}' is gone`),
      };
    }
    if (this.scenario === 'no_effect') {
      return {
        actionId: action.actionId,
        status: 'no_effect',
        beforeRevision,
        afterRevision: beforeRevision,
        evidence: [],
      };
    }
    if (this.scenario === 'navigation') {
      const url = 'url' in action.input ? String(action.input.url) : 'https://example.test/navigated';
      this.deps.snapshot?.navigate(url);
      const afterRevision = this.deps.snapshot
        ? (await this.deps.snapshot.observe()).pageRevision
        : `${beforeRevision}-nav`;
      return {
        actionId: action.actionId,
        status: 'applied',
        beforeRevision,
        afterRevision,
        evidence: [{ kind: 'url', ref: url, capturedAt: at }],
      };
    }
    return {
      actionId: action.actionId,
      status: 'applied',
      beforeRevision,
      afterRevision: beforeRevision,
      evidence: [{ kind: 'text', ref: `fake://${action.actionId}`, capturedAt: at }],
    };
  }
}

/** All fakes wired together for a one-line runtime instantiation in tests. */
export function createFakePorts(scenario: FakeScenario = 'applied') {
  const clock = new FakeClock();
  const snapshot = new FakePageSnapshot(clock);
  return {
    clock,
    ids: new FakeIdGenerator('act'),
    logger: new FakeLogger(),
    trace: new FakeTrace(),
    snapshot,
    executor: new FakeActionExecutor(scenario, { clock, snapshot }),
  };
}
