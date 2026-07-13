const ACTION_EVENT_DETAILS: Record<string, string> = {
  'act.start': 'action_started',
  'act.ok': 'action_completed',
  'act.fail': 'action_failed',
};
const STEP_EVENT_DETAILS: Record<string, string> = {
  'step.start': 'step_started',
  'step.ok': 'step_completed',
  'step.fail': 'step_failed',
  'step.cancel': 'step_cancelled',
};

export function redactRuntimeEventDetails(actor: string, state: string, details: string): string {
  if (actor === 'navigator') return ACTION_EVENT_DETAILS[state] ?? STEP_EVENT_DETAILS[state] ?? details;
  if (actor === 'planner') return STEP_EVENT_DETAILS[state] ?? details;
  return details;
}
