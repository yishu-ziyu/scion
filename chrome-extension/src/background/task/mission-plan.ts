/**
 * Mission/Plan v0.3 (decision 005).
 *
 * Default: one phase. Numbered steps the user wrote (1) 2) 3) become a
 * skeleton. The framework does not invent 验证/输出 from verbs or keywords.
 * Raw instruction, emails, and secrets never persist on the plan.
 */
import type { MissionPlan, MissionPhase, MissionPhaseStatus } from '@extension/storage/lib/task';

/** Numbered step markers the user wrote: 1) 2） 3. 1、 */
const NUMBERED_STEP = /(?:^|[\s；;：:])\d{1,2}\s*[)）.、]\s*/g;
const MAX_PHASES = 12;
const MAX_TITLE_LEN = 12;
const GENERIC_GOAL = '执行任务';
const DEFAULT_PHASE_TITLE = '执行';

/** Checkpoint shape for interrupt resume (JSON-safe, no secrets). */
export interface MissionCheckpoint {
  v: 1;
  id: string;
  goal: string;
  phases: MissionPhase[];
  createdAt: number;
  updatedAt: number;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/** Long hex / base64-ish tokens often used as secrets or ids. */
const LONG_TOKEN_RE = /\b[a-zA-Z0-9_-]{20,}\b/g;
const API_KEYISH_RE = /\b(?:sk|pk|api[_-]?key|token|secret|bearer)[-_:=.\s]*[a-zA-Z0-9._-]{8,}\b/gi;

function numberedStepCount(instruction: string): number {
  const text = instruction.trim();
  if (!text) return 0;
  const hits = [...text.matchAll(NUMBERED_STEP)];
  if (hits.length < 2) return 0;
  let count = 0;
  for (let i = 0; i < hits.length; i += 1) {
    const start = (hits[i].index ?? 0) + hits[i][0].length;
    const end = i + 1 < hits.length ? (hits[i + 1].index ?? text.length) : text.length;
    if (text.slice(start, end).replace(/[；;。]\s*$/, '').trim()) count += 1;
  }
  return count >= 2 ? Math.min(count, MAX_PHASES) : 0;
}

export function countMissionPhases(instruction: string): number {
  return Math.max(numberedStepCount(instruction), 1);
}

/** Strip emails, long tokens, and key-like strings from a fragment. */
export function sanitizePlanText(text: string): string {
  return text.replace(EMAIL_RE, '').replace(API_KEYISH_RE, '').replace(LONG_TOKEN_RE, '').replace(/\s+/g, ' ').trim();
}

export function derivePhaseTitle(_segment: string, phaseIndex: number): string {
  return `阶段 ${phaseIndex + 1}`;
}

export function deriveMissionGoal(_instruction?: string, _phaseTitles?: string[]): string {
  return GENERIC_GOAL;
}

function phasesFromTitles(titles: string[], now: number): MissionPlan {
  const phases: MissionPhase[] = titles.map((title, index) => ({
    id: `phase-${index + 1}`,
    title,
    status: index === 0 ? 'active' : 'planned',
    criteriaIds: [],
    evidenceIds: [],
    notes: [],
  }));
  return {
    id: `mission-${now}`,
    goal: GENERIC_GOAL,
    phases,
    createdAt: now,
    updatedAt: now,
  };
}

/** Test / restore helper. Titles are caller-owned; they are not parsed from user text. */
export function buildMissionPlanFromPhaseTitles(titles: string[], now: number): MissionPlan {
  const safe = titles
    .map(title => sanitizePlanText(title).slice(0, MAX_TITLE_LEN))
    .filter(Boolean)
    .slice(0, MAX_PHASES);
  return phasesFromTitles(safe.length > 0 ? safe : [DEFAULT_PHASE_TITLE], now);
}

/**
 * One phase unless the user wrote numbered steps. Goal never copies the instruction.
 */
export function refineMissionPlanFromInstruction(instruction: string, now: number): MissionPlan {
  const count = countMissionPhases(instruction);
  const titles =
    count > 1 ? Array.from({ length: count }, (_, index) => `阶段 ${index + 1}`) : [DEFAULT_PHASE_TITLE];
  return phasesFromTitles(titles, now);
}

/** v0.1 skeleton with generic 阶段 N titles (kept for callers that want blank labels). */
export function buildMissionPlan(instruction: string, now: number): MissionPlan {
  const phaseCount = countMissionPhases(instruction);
  const phases: MissionPhase[] = Array.from({ length: phaseCount }, (_, index) => ({
    id: `phase-${index + 1}`,
    title: `阶段 ${index + 1}`,
    status: index === 0 ? 'active' : 'planned',
    criteriaIds: [],
    evidenceIds: [],
    notes: [],
  }));

  return {
    id: `mission-${now}`,
    goal: GENERIC_GOAL,
    phases,
    createdAt: now,
    updatedAt: now,
  };
}

export function advanceMissionPhase(
  plan: MissionPlan,
  phaseId: string,
  status: MissionPhaseStatus,
  now: number,
): MissionPlan {
  const phases = plan.phases.map(phase => {
    if (phase.id !== phaseId) {
      // Only one active phase: demote other actives when promoting a new active.
      if (status === 'active' && phase.status === 'active') {
        return { ...phase, status: 'planned' as const };
      }
      return { ...phase };
    }
    return { ...phase, status };
  });

  return {
    ...plan,
    phases,
    updatedAt: now,
  };
}

export function markActivePhase(plan: MissionPlan, phaseIndex: number, now: number): MissionPlan {
  if (phaseIndex < 0 || phaseIndex >= plan.phases.length) {
    return { ...plan, updatedAt: now };
  }
  const phases = plan.phases.map((phase, index) => {
    if (index === phaseIndex) return { ...phase, status: 'active' as const };
    if (phase.status === 'active') return { ...phase, status: 'planned' as const };
    return { ...phase };
  });
  return {
    ...plan,
    phases,
    updatedAt: now,
  };
}

/**
 * First freeze: attach criterion ids to the active phase when it still has none.
 * Does not overwrite later freezes or phases that already list criteria.
 */
export function attachCriteriaToActivePhase(plan: MissionPlan, criterionIds: string[], now: number): MissionPlan {
  if (criterionIds.length === 0) return plan;
  const activeIndex = plan.phases.findIndex(phase => phase.status === 'active');
  if (activeIndex < 0) return plan;
  if (plan.phases[activeIndex].criteriaIds.length > 0) return plan;
  const unique = [...new Set(criterionIds.filter(Boolean))];
  if (unique.length === 0) return plan;
  const phases = plan.phases.map((phase, index) => (index === activeIndex ? { ...phase, criteriaIds: unique } : phase));
  return { ...plan, phases, updatedAt: now };
}

/**
 * Bind frozen criteria to phases in order, excluding a final deliverable phase.
 * No phase may borrow another phase's evidence at receipt time.
 */
export function attachCriteriaAcrossMissionPlan(plan: MissionPlan, criterionIds: string[], now: number): MissionPlan {
  const unique = [...new Set(criterionIds.filter(Boolean))];
  if (unique.length === 0) return plan;
  const unresolved = plan.phases
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase }) => phase.status !== 'done' && phase.status !== 'blocked');
  const finalIndex = plan.phases.length - 1;
  const proofPhases = unresolved.filter(
    ({ phase, index }) => index !== finalIndex || !isDeliveryPhaseTitle(phase.title),
  );
  if (proofPhases.length === 0) return plan;

  const assignments = new Map<number, string[]>();
  unique.forEach((id, index) => {
    const owner = proofPhases[Math.min(index, proofPhases.length - 1)];
    if (!owner) return;
    assignments.set(owner.index, [...(assignments.get(owner.index) ?? []), id]);
  });
  const phases = plan.phases.map((phase, index) => {
    const ids = assignments.get(index);
    if (!ids || phase.criteriaIds.length > 0) return phase;
    return { ...phase, criteriaIds: ids };
  });
  return { ...plan, phases, updatedAt: now };
}

/**
 * Decision 005: bind required criteria to the current phase. Do not invent 验证/输出.
 */
export function reconcileMissionPlanWithFrozenContract(
  plan: MissionPlan,
  criteria: ReadonlyArray<{ id: string; required: boolean }>,
  _needsDeliverable: boolean,
  now: number,
): MissionPlan {
  const unique = [
    ...new Set(
      criteria
        .filter(criterion => criterion.required)
        .map(criterion => criterion.id)
        .filter(Boolean),
    ),
  ];
  if (unique.length === 0) return plan;
  return attachCriteriaToActivePhase(plan, unique, now);
}

/** Add later required criteria to the active phase. Do not invent a 验证 frontier. */
export function extendReconciledMissionProof(
  plan: MissionPlan,
  requiredCriterionIds: string[],
  now: number,
): MissionPlan {
  const activeIndex = plan.phases.findIndex(phase => phase.status === 'active');
  if (activeIndex < 0) return plan;
  const active = plan.phases[activeIndex];
  if (active.evidenceIds.length > 0) return plan;
  const unique = [...new Set([...active.criteriaIds, ...requiredCriterionIds.filter(Boolean)])];
  if (unique.length === active.criteriaIds.length) return plan;
  return {
    ...plan,
    phases: plan.phases.map((phase, index) => (index === activeIndex ? { ...phase, criteriaIds: unique } : phase)),
    updatedAt: now,
  };
}

/**
 * Record passed criterion ids onto their owning phases only,
 * then mark the active phase done and promote the next while its criteria are met.
 * Returns the same plan reference when nothing changes.
 */
export function applyPassedCriteriaToMissionPlan(
  plan: MissionPlan,
  passedCriterionIds: string[],
  now: number,
): MissionPlan {
  if (passedCriterionIds.length === 0) return plan;
  const passed = new Set(passedCriterionIds.filter(Boolean));
  if (passed.size === 0) return plan;

  const activeIndex = plan.phases.findIndex(phase => phase.status === 'active');
  if (activeIndex < 0) return plan;
  const active = plan.phases[activeIndex];
  const ownedPassed = active.criteriaIds.filter(id => passed.has(id));
  if (ownedPassed.length === 0) return advanceWhileActivePhaseCriteriaMet(plan, now);
  const evidenceIds = [...new Set([...active.evidenceIds, ...ownedPassed])];
  const changed = evidenceIds.length !== active.evidenceIds.length;
  const phases = changed
    ? plan.phases.map((phase, index) => (index === activeIndex ? { ...phase, evidenceIds } : phase))
    : plan.phases;

  if (!changed) {
    // Still try advance in case evidence was already present but status not advanced.
    const advanced = advanceWhileActivePhaseCriteriaMet(plan, now);
    return advanced === plan ? plan : advanced;
  }
  return advanceWhileActivePhaseCriteriaMet({ ...plan, phases, updatedAt: now }, now);
}

/** Single-phase missions have no cross-phase ambiguity: required browser evidence owns that phase. */
export function applySinglePhaseEvidence(plan: MissionPlan, criterionIds: string[], now: number): MissionPlan {
  if (plan.phases.length !== 1 || criterionIds.length === 0) return plan;
  const phase = plan.phases[0];
  const ownedPassed = phase.criteriaIds.filter(id => criterionIds.includes(id));
  if (ownedPassed.length === 0) return plan;
  const evidenceIds = [...new Set([...phase.evidenceIds, ...ownedPassed])];
  if (evidenceIds.length === phase.evidenceIds.length) return plan;
  const complete = phase.criteriaIds.every(id => evidenceIds.includes(id));
  return {
    ...plan,
    phases: [{ ...phase, evidenceIds, status: complete ? 'done' : phase.status }],
    updatedAt: now,
  };
}

/** Advance active → done → next while the active phase has criteria and all are evidenced. */
function advanceWhileActivePhaseCriteriaMet(plan: MissionPlan, now: number): MissionPlan {
  let current = plan;
  for (let guard = 0; guard < current.phases.length; guard += 1) {
    const activeIndex = current.phases.findIndex(phase => phase.status === 'active');
    if (activeIndex < 0) break;
    const active = current.phases[activeIndex];
    if (active.criteriaIds.length === 0) break;
    const allMet = active.criteriaIds.every(id => active.evidenceIds.includes(id));
    if (!allMet) break;
    current = advanceMissionPhase(current, active.id, 'done', now);
    if (current.phases[activeIndex + 1]?.status === 'planned') {
      current = markActivePhase(current, activeIndex + 1, now);
    } else {
      break;
    }
  }
  return current;
}

/**
 * Multi-phase missions with no criteria on the active phase: each successful
 * attempt can complete one phase, leaving the last phase active until verified complete.
 */
function isDeliveryPhaseTitle(title: string): boolean {
  return /^(?:输出|总结|提取|output|extract)$/i.test(title.trim());
}

/** A written result may close the last active phase once earlier phases are done. */
export function applyFinalDeliverableToMissionPlan(plan: MissionPlan, deliverableId: string, now: number): MissionPlan {
  if (!deliverableId) return plan;
  const activeIndex = plan.phases.findIndex(phase => phase.status === 'active');
  if (activeIndex < 0) return plan;
  if (activeIndex !== plan.phases.length - 1) return plan;
  const active = plan.phases[activeIndex];
  if (plan.phases.slice(0, activeIndex).some(phase => phase.status !== 'done')) return plan;
  const criteriaIds = [...new Set([...active.criteriaIds, deliverableId])];
  const evidenceIds = [...new Set([...active.evidenceIds, deliverableId])];
  if (!criteriaIds.every(id => evidenceIds.includes(id))) return plan;
  const phases = plan.phases.map((phase, index) =>
    index === activeIndex ? { ...phase, criteriaIds, evidenceIds, status: 'done' as const } : phase,
  );
  return { ...plan, phases, updatedAt: now };
}

export function serializeMissionCheckpoint(plan: MissionPlan): MissionCheckpoint {
  return {
    v: 1,
    id: plan.id,
    goal: plan.goal || GENERIC_GOAL,
    phases: plan.phases.map(phase => ({
      id: phase.id,
      title: sanitizePlanText(phase.title).slice(0, MAX_TITLE_LEN) || phase.id,
      status: phase.status,
      // Criteria / evidence ids are opaque refs; notes must not carry secrets.
      criteriaIds: [...phase.criteriaIds],
      evidenceIds: [...phase.evidenceIds],
      notes: phase.notes
        .map(n => sanitizePlanText(n))
        .filter(Boolean)
        .slice(0, 8),
    })),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function restoreMissionPlan(checkpoint: MissionCheckpoint | MissionPlan | null | undefined): MissionPlan | null {
  if (!checkpoint || typeof checkpoint !== 'object') return null;
  const id = typeof checkpoint.id === 'string' ? checkpoint.id : null;
  const phases = Array.isArray(checkpoint.phases) ? checkpoint.phases : null;
  if (!id || !phases || phases.length === 0) return null;

  const ownedCriterionIds = new Set<string>();
  const restoredPhases: MissionPhase[] = phases.slice(0, MAX_PHASES).map((raw, index) => {
    const phase = raw as Partial<MissionPhase>;
    const status: MissionPhaseStatus =
      phase.status === 'planned' || phase.status === 'active' || phase.status === 'done' || phase.status === 'blocked'
        ? phase.status
        : index === 0
          ? 'active'
          : 'planned';
    const criteriaIds = Array.isArray(phase.criteriaIds)
      ? [...new Set(phase.criteriaIds.filter((x): x is string => typeof x === 'string' && Boolean(x)))].filter(id => {
          if (ownedCriterionIds.has(id)) return false;
          ownedCriterionIds.add(id);
          return true;
        })
      : [];
    const evidenceIds = Array.isArray(phase.evidenceIds)
      ? [...new Set(phase.evidenceIds.filter((x): x is string => typeof x === 'string'))].filter(id =>
          criteriaIds.includes(id),
        )
      : [];
    const restoredStatus =
      status === 'done' && (criteriaIds.length === 0 || !criteriaIds.every(id => evidenceIds.includes(id)))
        ? 'planned'
        : status;
    return {
      id: typeof phase.id === 'string' && phase.id ? phase.id : `phase-${index + 1}`,
      title:
        typeof phase.title === 'string' && phase.title.trim()
          ? sanitizePlanText(phase.title).slice(0, MAX_TITLE_LEN) || `阶段 ${index + 1}`
          : `阶段 ${index + 1}`,
      status: restoredStatus,
      criteriaIds,
      evidenceIds: restoredStatus === 'planned' ? [] : evidenceIds,
      notes: Array.isArray(phase.notes)
        ? phase.notes
            .filter((x): x is string => typeof x === 'string')
            .map(n => sanitizePlanText(n))
            .filter(Boolean)
            .slice(0, 8)
        : [],
    };
  });

  // Restore a single sequential frontier. Evidence beyond that frontier is a
  // future-phase prefill and must not survive a checkpoint round-trip.
  const frontier = restoredPhases.findIndex(phase => phase.status !== 'done');
  if (frontier >= 0) {
    restoredPhases.forEach((phase, index) => {
      if (index < frontier) return;
      if (index === frontier) {
        if (phase.status !== 'blocked') phase.status = 'active';
        return;
      }
      phase.status = 'planned';
      phase.evidenceIds = [];
    });
  }

  return {
    id,
    goal:
      typeof checkpoint.goal === 'string' && checkpoint.goal.trim() && checkpoint.goal !== 'User task'
        ? sanitizePlanText(checkpoint.goal) ||
          deriveMissionGoal(
            '',
            restoredPhases.map(phase => phase.title),
          )
        : deriveMissionGoal(
            '',
            restoredPhases.map(phase => phase.title),
          ),
    phases: restoredPhases,
    createdAt: typeof checkpoint.createdAt === 'number' ? checkpoint.createdAt : 0,
    updatedAt: typeof checkpoint.updatedAt === 'number' ? checkpoint.updatedAt : 0,
  };
}

/** Compact multi-line status for LLM context / control status. */
export function renderMissionPlanForAgent(plan: MissionPlan): string {
  const active = plan.phases.find(p => p.status === 'active');
  const done = plan.phases.filter(p => p.status === 'done').length;
  const lines = [
    `Mission: ${plan.goal || GENERIC_GOAL}`,
    `Progress: ${done}/${plan.phases.length} done` + (active ? `; active=${active.title}` : ''),
    ...plan.phases.map((p, i) => {
      const mark = p.status === 'done' ? '[x]' : p.status === 'active' ? '[>]' : p.status === 'blocked' ? '[!]' : '[ ]';
      return `${mark} ${i + 1}. ${p.title}`;
    }),
  ];
  return lines.join('\n');
}
