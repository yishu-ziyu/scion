/**
 * Context budget helpers + book ch2-style trajectory compression for
 * long-horizon browser tasks (windowed: full latest observation, compress older history).
 *
 * v1 is deterministic (no LLM). Privacy: never archive full form values / passwords.
 */

export function compactStateText(text: string, maxChars = 32_000): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n...[compacted ${text.length - maxChars} chars]...\n${text.slice(-tail)}`;
}

export interface TrajectoryStep {
  step: number;
  action?: string;
  result?: string;
  url?: string;
  note?: string;
}

export interface CompressTrajectoryOptions {
  /** Keep last N steps fully (not marked [COMPRESSED]). Default 3. */
  keepRecent?: number;
  /** Max chars per field on archived (older) steps. Default 80. */
  fieldMaxChars?: number;
  /** Soft max for the whole trajectory block. */
  maxChars?: number;
}

export interface PlanMemoryPhase {
  id: string;
  title: string;
  status: string;
}

/** Minimal plan shape for memory (id/title/status only; no notes/secrets). */
export interface PlanMemoryInput {
  id?: string;
  goal?: string;
  phases: PlanMemoryPhase[];
}

export interface LongHorizonContextInput {
  observation: string;
  trajectory: TrajectoryStep[];
  planMemory?: string;
  maxChars?: number;
  compressOptions?: CompressTrajectoryOptions;
}

const DEFAULT_KEEP_RECENT = 3;
const DEFAULT_FIELD_MAX = 80;
const DEFAULT_MAX_CONTEXT = 32_000;
const RECENT_FIELD_MAX = 2_000;

/**
 * Strip password / form-value-like content and cap length.
 * Used for trajectory archive fields so secrets never re-enter the prompt.
 */
export function sanitizeTrajectoryField(text: string, maxChars = DEFAULT_FIELD_MAX): string {
  let s = text
    .replace(/(password|passwd|pwd)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\b(password|passwd|pwd)\b[^\n]{0,60}/gi, 'password=[REDACTED]')
    // input_text / form value payloads: key=value or "text":"..."
    .replace(/\b(text|value|input|content)\s*[:=]\s*["'][^"']*["']/gi, '$1=[REDACTED]')
    .replace(/\b(text|value|input|content)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 1))}…`;
}

function formatStepLine(step: TrajectoryStep, compressed: boolean, fieldMax: number): string {
  const max = compressed ? fieldMax : RECENT_FIELD_MAX;
  const parts: string[] = [`step ${step.step}:`];
  if (step.action) parts.push(`action=${sanitizeTrajectoryField(step.action, max)}`);
  if (step.url) parts.push(`url=${sanitizeTrajectoryField(step.url, max)}`);
  if (step.result) parts.push(`result=${sanitizeTrajectoryField(step.result, max)}`);
  if (step.note) parts.push(`note=${sanitizeTrajectoryField(step.note, max)}`);
  const line = parts.join(' ');
  return compressed ? `[COMPRESSED] ${line}` : line;
}

/**
 * Windowed trajectory: last N steps full structured lines; older steps
 * truncated per field and marked [COMPRESSED].
 */
export function compressTrajectory(steps: TrajectoryStep[], options: CompressTrajectoryOptions = {}): string {
  if (!steps.length) return '';
  const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
  const fieldMax = options.fieldMaxChars ?? DEFAULT_FIELD_MAX;
  const maxChars = options.maxChars;

  const sorted = [...steps].sort((a, b) => a.step - b.step);
  const splitAt = Math.max(0, sorted.length - keepRecent);
  const older = sorted.slice(0, splitAt);
  const recent = sorted.slice(splitAt);

  const lines: string[] = [];
  if (older.length) {
    lines.push('## Trajectory archive');
    for (const s of older) {
      lines.push(formatStepLine(s, true, fieldMax));
    }
  }
  if (recent.length) {
    lines.push('## Recent steps');
    for (const s of recent) {
      lines.push(formatStepLine(s, false, fieldMax));
    }
  }

  let out = lines.join('\n');
  if (maxChars != null && maxChars >= 0 && out.length > maxChars) {
    if (maxChars === 0) return '';
    const mark = '\n...[trajectory truncated]...\n';
    const tailBudget = maxChars - mark.length;
    if (tailBudget > 32) {
      // Prefer recent steps at the end.
      out = `${mark}${out.slice(-tailBudget)}`;
    } else {
      out = out.slice(0, maxChars);
    }
  }
  return out;
}

/** Compact plan block: phase id / title / status only (no notes or secrets). */
export function buildPlanMemory(plan: PlanMemoryInput | null | undefined): string {
  if (!plan?.phases?.length) return '';
  const lines = ['## Plan memory'];
  if (plan.id) lines.push(`plan_id: ${plan.id}`);
  if (plan.goal) lines.push(`goal: ${sanitizeTrajectoryField(plan.goal, 120)}`);
  for (const p of plan.phases) {
    lines.push(`- ${p.id}: ${sanitizeTrajectoryField(p.title, 60)} [${p.status}]`);
  }
  return lines.join('\n');
}

/**
 * Assemble long-horizon context within a char budget.
 * Priority: observation (full latest, head-tail compact only as last resort)
 * → plan memory → compressed trajectory.
 */
export function buildLongHorizonContext(input: LongHorizonContextInput): string {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CONTEXT;
  // Leave headroom for plan + trajectory; observation still gets majority.
  const observationBudget = Math.max(1_024, Math.floor(maxChars * 0.7));
  const observation = compactStateText(input.observation, observationBudget);

  const parts: string[] = [`## Observation\n${observation}`];

  const planBlock = (input.planMemory ?? '').trim();
  if (planBlock) {
    const used = parts.join('\n\n').length;
    // Cap plan to a modest share so trajectory still fits.
    const planRoom = Math.min(planBlock.length + 64, Math.max(0, Math.floor((maxChars - used) * 0.2)), 2_000);
    if (planRoom > 32) {
      const planOut =
        planBlock.length <= planRoom ? planBlock : `${planBlock.slice(0, planRoom - 24)}\n...[plan truncated]...`;
      parts.push(planOut);
    }
  }

  const usedAfterPlan = parts.join('\n\n').length;
  const trajBudget = Math.max(0, maxChars - usedAfterPlan - 4);
  const traj = compressTrajectory(input.trajectory, {
    ...input.compressOptions,
    maxChars: trajBudget,
  });
  if (traj) {
    parts.push(traj);
  }

  let assembled = parts.join('\n\n');
  if (assembled.length > maxChars) {
    assembled = `${assembled.slice(0, Math.max(0, maxChars - 22))}\n...[context budget]...`;
  }
  return assembled;
}

/**
 * Build a short trajectory result line without form values.
 * input_text never carries the typed string into the archive.
 */
export function summarizeActionResultForTrajectory(
  actionName: string,
  summary: string | null | undefined,
  error: string | null | undefined,
): string | undefined {
  if (error) {
    return sanitizeTrajectoryField(`error: ${error}`, 120);
  }
  if (actionName === 'input_text') {
    return 'input_text applied';
  }
  if (!summary) return undefined;
  return sanitizeTrajectoryField(summary, 200);
}
