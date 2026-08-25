export type DebuggerDetachSource = { tabId?: number };

type DetachDependencies = {
  interruptActive: () => Promise<unknown>;
  isCurrentTaskTab: (tabId: number) => boolean;
  onError: (message: string, error: unknown) => void;
};

/**
 * Chrome event listeners do not await returned promises. Keep cancellation
 * cleanup contained so a detached debugger cannot take down the MV3 worker.
 */
export function createDebuggerDetachHandler({
  interruptActive,
  isCurrentTaskTab,
  onError,
}: DetachDependencies): (source: DebuggerDetachSource, reason: string) => void {
  let cleanupInFlight = false;
  const report = (message: string, error: unknown): void => {
    try {
      onError(message, error);
    } catch {
      // Error reporting must not escape a browser event callback either.
    }
  };

  return (source, reason) => {
    if (
      reason !== 'canceled_by_user' ||
      source.tabId === undefined ||
      !isCurrentTaskTab(source.tabId) ||
      cleanupInFlight
    ) {
      return;
    }

    cleanupInFlight = true;
    void (async () => {
      try {
        await interruptActive();
      } catch (error) {
        report('Failed to interrupt task after debugger cancellation', error);
      } finally {
        cleanupInFlight = false;
      }
    })();
  };
}
