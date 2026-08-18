import { ExecutionState } from './types/event';

export function shouldPersistExecutionEvent(state: ExecutionState): boolean {
  return ![ExecutionState.ACT_START, ExecutionState.ACT_OK, ExecutionState.ACT_FAIL].includes(state);
}
