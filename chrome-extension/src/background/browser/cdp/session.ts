import type { DebuggerTarget, DebuggerTargetInfo } from './types';

/** Stable CDP version accepted by chrome.debugger.attach. */
const PROTOCOL_VERSION = '1.3';

const DEBUGGER_UNAVAILABLE = 'chrome.debugger is not available';

type Debuggee = { tabId?: number; targetId?: string };

type DebuggerApi = {
  attach: (target: Debuggee, protocolVersion: string) => Promise<void>;
  detach: (target: Debuggee) => Promise<void>;
  sendCommand: (
    target: Debuggee,
    method: string,
    commandParams?: { [key: string]: unknown },
  ) => Promise<object | undefined>;
  getTargets?: () => Promise<DebuggerTargetInfo[]>;
};

export type { DebuggerTarget, DebuggerTargetInfo };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

function debuggerApi(): DebuggerApi {
  const api = (globalThis as { chrome?: { debugger?: Partial<DebuggerApi> } }).chrome?.debugger;
  if (
    !api ||
    typeof api.attach !== 'function' ||
    typeof api.detach !== 'function' ||
    typeof api.sendCommand !== 'function'
  ) {
    throw new Error(DEBUGGER_UNAVAILABLE);
  }
  return api as DebuggerApi;
}

function isAlreadyAttached(error: unknown): boolean {
  return /already attached/i.test(errorMessage(error));
}

function isNotAttached(error: unknown): boolean {
  return /not attached/i.test(errorMessage(error));
}

export function normalizeTarget(target: number | DebuggerTarget): Debuggee {
  if (typeof target === 'number') return { tabId: target };
  if ('targetId' in target && target.targetId) return { targetId: target.targetId };
  if ('tabId' in target && typeof target.tabId === 'number') return { tabId: target.tabId };
  throw new Error('Debugger target needs tabId or targetId');
}

/** Attach chrome.debugger. A second attach on the same target is a no-throw. */
export async function attach(target: number | DebuggerTarget): Promise<void> {
  const api = debuggerApi();
  try {
    await api.attach(normalizeTarget(target), PROTOCOL_VERSION);
  } catch (error) {
    if (isAlreadyAttached(error)) return;
    throw toError(error);
  }
}

/** Send one Chrome DevTools Protocol method. Callers own method names; this is not a model tool. */
export async function sendCommand(
  target: number | DebuggerTarget,
  method: string,
  params?: { [key: string]: unknown },
): Promise<object | undefined> {
  const api = debuggerApi();
  const debuggee = normalizeTarget(target);
  try {
    return params === undefined
      ? await api.sendCommand(debuggee, method)
      : await api.sendCommand(debuggee, method, params);
  } catch (error) {
    throw toError(error);
  }
}

/** Detach chrome.debugger. Detach when nothing is attached is a no-throw. */
export async function detach(target: number | DebuggerTarget): Promise<void> {
  const api = debuggerApi();
  try {
    await api.detach(normalizeTarget(target));
  } catch (error) {
    if (isNotAttached(error)) return;
    throw toError(error);
  }
}

/** List debugger targets, including iframe targets for a tab. */
export async function getTargets(): Promise<DebuggerTargetInfo[]> {
  const api = debuggerApi();
  if (typeof api.getTargets !== 'function') {
    throw new Error('chrome.debugger.getTargets is not available');
  }
  return api.getTargets();
}
