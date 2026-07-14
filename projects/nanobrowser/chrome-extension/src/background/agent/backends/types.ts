/**
 * Production Agent Core backends (design/002).
 * - nano: legacy Planner/Navigator (demotable)
 * - control: P1-parity control loop under TaskManager hooks
 */
export type AgentCoreBackend = 'nano' | 'control';

export const DEFAULT_AGENT_CORE_BACKEND: AgentCoreBackend = 'nano';

export function parseAgentCoreBackend(value: unknown): AgentCoreBackend {
  return value === 'control' ? 'control' : 'nano';
}
