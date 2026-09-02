/**
 * Recovery store for the composed task instruction.
 *
 * The manager's in-memory `instructions` map dies with the service worker.
 * Chat rehydration cannot serve composed orchestrator instructions (they are
 * synthesized from the work brief and match no stored chat message, so their
 * instructionMessageId is ''), which made every SW-restart recovery of an
 * orchestrator task fail as `missing_instruction`. This record holds the
 * exact instruction per task so recovery re-drives the executor with the
 * same text.
 *
 * Privacy: same sensitivity tier as chat history (working state, not
 * telemetry); never written to traces or the redacted task snapshot. GC runs
 * at write time — records whose task no longer exists in task-runtime-v1 are
 * dropped, and the id being written is always kept (start persists the task
 * row after this write).
 */
const KEY = 'task-instructions-v1';

function storageAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function rememberTaskInstruction(taskId: string, instruction: string): Promise<void> {
  if (!storageAvailable() || !instruction.trim()) return;
  try {
    const stored = await chrome.storage.local.get([KEY, 'task-runtime-v1']);
    const record: Record<string, string> = { ...((stored[KEY] as Record<string, string> | undefined) ?? {}) };
    record[taskId] = instruction;
    const live = new Set(Object.keys((stored['task-runtime-v1'] as Record<string, unknown> | undefined) ?? {}));
    for (const id of Object.keys(record)) {
      if (id !== taskId && !live.has(id)) delete record[id];
    }
    await chrome.storage.local.set({ [KEY]: record });
  } catch {
    // Recovery aid only: a failed write must never break task start.
  }
}

export async function recallTaskInstruction(taskId: string): Promise<string | undefined> {
  if (!storageAvailable()) return undefined;
  try {
    const stored = await chrome.storage.local.get(KEY);
    return (stored[KEY] as Record<string, string> | undefined)?.[taskId];
  } catch {
    return undefined;
  }
}
