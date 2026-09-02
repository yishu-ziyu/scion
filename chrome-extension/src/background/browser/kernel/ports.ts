/**
 * Browser Kernel ports (product/022 batch C3).
 * The kernel talks to Agent/Task only through these minimal structural
 * interfaces; it must never import agent/types (AgentContext) or
 * task/contracts (ExecutorHooks/DispatchResult) directly.
 */

/** Minimal identity of a registered action; the Agent `Action` class satisfies this. */
export interface KernelAction {
  name(): string;
}

/** Result fields the kernel reads after a dispatch; mirrors ActionResult without importing it. */
export interface KernelDispatchActionResult {
  error?: string | null;
  isDone?: boolean;
  extractedContent?: string | null;
}

/** Kernel-owned subset of task/contracts DispatchResult (only the fields the kernel reads). */
export interface KernelDispatchResult {
  actionResult: KernelDispatchActionResult;
  pageRevision?: string;
}

/** Dispatch one action for a round; production adapter wraps ExecutorHooks.dispatchAction. */
export interface ActionDispatcherPort {
  dispatch(roundId: string, action: KernelAction, rawArgs: unknown): Promise<KernelDispatchResult>;
}

/** Receives completed action results; production adapter wraps AgentContext.actionResults.push. */
export interface ActionResultSink {
  record(result: KernelDispatchActionResult): void;
}

/** Observation defaults; production adapter snapshots AgentContext.options. */
export interface KernelDefaults {
  useVision?: boolean;
  includeAttributes?: string[] | null;
}
