/**
 * Production Agent Core backends (design/002).
 * - nano: legacy Planner/Navigator (demotable)
 * - control: P1-parity control loop under TaskManager hooks
 */
export type AgentCoreBackend = 'nano' | 'control';

/** Production default after M2 LLM control ships (design/002). Fallback: set generalSettings.agentCoreBackend = 'nano'. */
export const DEFAULT_AGENT_CORE_BACKEND: AgentCoreBackend = 'control';

export function parseAgentCoreBackend(value: unknown): AgentCoreBackend {
  return value === 'control' ? 'control' : 'nano';
}
