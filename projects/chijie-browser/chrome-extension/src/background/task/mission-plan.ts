/**
 * Mission/Plan v0.2.
 *
 * Durable phase skeleton for long-horizon tasks. Derives short phase labels
 * from the user instruction without persisting raw instruction text, emails,
 * secrets, or entity-heavy content. Supports phase progress, interrupt
 * checkpoint serialize/restore, and a compact agent-facing status line.
 */
import type { MissionPlan, MissionPhase, MissionPhaseStatus } from '@extension/storage/lib/task';

const PHASE_SEPARATOR = /[；;\n]+/;
/** Numbered step markers: 1) 2） 3. 1、 */
const NUMBERED_STEP = /(?:^|[\s；;：:])\d{1,2}\s*[)）.、]\s*/g;
const MAX_PHASES = 12;
const MAX_TITLE_LEN = 12;
const GENERIC_GOAL = 'User task';

/** Checkpoint shape for interrupt resume (JSON-safe, no secrets). */
export interface MissionCheckpoint {
  v: 1;
  id: string;
  goal: string;
  phases: MissionPhase[];
  createdAt: number;
  updatedAt: number;
}

// Leading action verbs → short generic labels (CN + EN). Prefer verb over entity nouns.
const VERB_LABELS: Array<{ re: RegExp; label: string }> = [
  { re: /^(调研|研究|搜索|查找|检索|收集|调查)/, label: '调研' },
  { re: /^(对比|比较|对照)/, label: '对比' },
  { re: /^(输出|导出|生成|整理|汇总)/, label: '输出' },
  // Prefer 总结 when the segment is about a conclusion, even if it starts with 写/撰写.
  { re: /^(写|撰写|编写|起草).{0,12}(结论|总结|摘要)/, label: '总结' },
  { re: /^(写|撰写|编写|起草)/, label: '输出' },
  { re: /^(总结|归纳|结论)/, label: '总结' },
  { re: /(结论|总结|摘要)\s*$/, label: '总结' },
  { re: /^(验证|检查|确认|核对|校验)/, label: '验证' },
  { re: /^(打开|访问|浏览|进入|导航)/, label: '打开' },
  { re: /^(离开|退出|关闭当前)/, label: '离开' },
  { re: /^(填写|输入|填入)/, label: '填写' },
  { re: /^(提交|发送|发布)/, label: '提交' },
  { re: /^(下载|保存|拉取)/, label: '下载' },
  { re: /^(上传|导入)/, label: '上传' },
  { re: /^(阅读|查看|浏览当前)/, label: '阅读' },
  { re: /^(提取|抽取|抓取)/, label: '提取' },
  { re: /^(播放|暂停|恢复|点击|选择|操作)/, label: '操作' },
  { re: /^(确认|核对).{0,8}(页面|正文|URL|url)/, label: '验证' },
  { re: /^(research|survey|search|find|collect)\b/i, label: 'research' },
  { re: /^(compare|contrast)\b/i, label: 'compare' },
  { re: /^(output|export|generate|write|draft|summarize)\b/i, label: 'output' },
  { re: /^(verify|check|confirm|validate)\b/i, label: 'verify' },
  { re: /^(open|visit|navigate|browse|go\s+to|leave)\b/i, label: 'open' },
  { re: /^(fill|type|enter|submit|send)\b/i, label: 'submit' },
  { re: /^(download|upload|save)\b/i, label: 'transfer' },
  { re: /^(read|extract|scrape)\b/i, label: 'extract' },
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/** Long hex / base64-ish tokens often used as secrets or ids. */
const LONG_TOKEN_RE = /\b[a-zA-Z0-9_-]{20,}\b/g;
const API_KEYISH_RE = /\b(?:sk|pk|api[_-]?key|token|secret|bearer)[-_:=.\s]*[a-zA-Z0-9._-]{8,}\b/gi;

function splitInstructionSegments(instruction: string): string[] {
  const text = instruction.trim();
  if (!text) return [''];

  // Prefer numbered multi-phase steps when present (product/021 long-horizon goals).
  const numberedHits = [...text.matchAll(NUMBERED_STEP)];
  if (numberedHits.length >= 2) {
    const slices: string[] = [];
    for (let i = 0; i < numberedHits.length; i += 1) {
      const start = (numberedHits[i].index ?? 0) + numberedHits[i][0].length;
      const end = i + 1 < numberedHits.length ? (numberedHits[i + 1].index ?? text.length) : text.length;
      const slice = text.slice(start, end).replace(/[；;。]\s*$/, '').trim();
      if (slice) slices.push(slice);
    }
    if (slices.length >= 2) return slices.slice(0, MAX_PHASES);
  }

  const parts = text
    .split(PHASE_SEPARATOR)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return [''];
  return parts.slice(0, MAX_PHASES);
}

export function countMissionPhases(instruction: string): number {
  return Math.min(Math.max(splitInstructionSegments(instruction).length, 1), MAX_PHASES);
}

/** Strip emails, long tokens, and key-like strings from a fragment. */
export function sanitizePlanText(text: string): string {
  return text
    .replace(EMAIL_RE, '')
    .replace(API_KEYISH_RE, '')
    .replace(LONG_TOKEN_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Host / URL fragments must never become soft phase titles. */
const HOSTISH_RE =
  /(?:https?:\/\/)|(?:www\.)|(?:\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/\S*)?\b)/i;

/**
 * Soft fallback titles are only safe when they look like a short generic phrase.
 * Reject verb+entity cuts ("离开 e"), domain/host leakage, and mixed-script scraps.
 */
function isUnsafeSoftTitle(soft: string, compact: string): boolean {
  if (!soft || soft.length < 2) return true;
  // "离开 e" / "前往 e" — 4-grapheme cut of verb + space + entity head.
  if (/\s/.test(soft)) return true;
  if (/[./:]/.test(soft)) return true;
  if (HOSTISH_RE.test(compact) || HOSTISH_RE.test(soft)) return true;
  // Mixed CJK + Latin without space usually means verb residual + host/entity scrap.
  const hasCjk = /[\u4e00-\u9fff]/.test(soft);
  const hasLatin = /[a-zA-Z]/.test(soft);
  if (hasCjk && hasLatin) return true;
  return false;
}

/**
 * Derive a short phase title from one instruction segment.
 * Prefer verb/action labels; never keep entity-heavy raw text.
 */
export function derivePhaseTitle(segment: string, phaseIndex: number): string {
  const fallback = `阶段 ${phaseIndex + 1}`;
  const cleaned = sanitizePlanText(segment);
  if (!cleaned) return fallback;

  for (const { re, label } of VERB_LABELS) {
    if (re.test(cleaned)) return label;
  }

  // Fallback: short sanitized prefix only if it stays generic-looking.
  // Drop digits-heavy / remaining @ fragments; cap length.
  const compact = cleaned
    .replace(/\d+/g, '')
    .replace(/[@#￥$%^&*{}[\]|\\<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact || compact.length < 2) return fallback;

  // Domain / host / URL remaining after verb strip fails → no entity leakage.
  if (HOSTISH_RE.test(compact)) return fallback;

  // If prefix still looks like free-form entity content (longer Chinese/English
  // noun phrase without a verb match), keep only first 4 graphemes as a soft label.
  const chars = [...compact];
  const soft = chars.slice(0, Math.min(4, MAX_TITLE_LEN)).join('').trim();
  if (isUnsafeSoftTitle(soft, compact)) return fallback;
  return soft.length > MAX_TITLE_LEN ? soft.slice(0, MAX_TITLE_LEN) : soft;
}

/**
 * Build a mission plan with meaningful short phase titles.
 * plan.goal stays generic; raw instruction is never stored on the plan.
 */
export function refineMissionPlanFromInstruction(instruction: string, now: number): MissionPlan {
  const segments = splitInstructionSegments(instruction);
  const phases: MissionPhase[] = segments.map((segment, index) => ({
    id: `phase-${index + 1}`,
    title: derivePhaseTitle(segment, index),
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
export function attachCriteriaToActivePhase(
  plan: MissionPlan,
  criterionIds: string[],
  now: number,
): MissionPlan {
  if (criterionIds.length === 0) return plan;
  const activeIndex = plan.phases.findIndex(phase => phase.status === 'active');
  if (activeIndex < 0) return plan;
  if (plan.phases[activeIndex].criteriaIds.length > 0) return plan;
  const unique = [...new Set(criterionIds.filter(Boolean))];
  if (unique.length === 0) return plan;
  const phases = plan.phases.map((phase, index) =>
    index === activeIndex ? { ...phase, criteriaIds: unique } : phase,
  );
  return { ...plan, phases, updatedAt: now };
}

/**
 * Record passed criterion ids onto owning phases (or active if unowned),
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

  let changed = false;
  let phases = plan.phases.map(phase => {
    const ownedPassed = phase.criteriaIds.filter(id => passed.has(id));
    if (ownedPassed.length === 0) return phase;
    const evidenceIds = [...phase.evidenceIds];
    for (const id of ownedPassed) {
      if (!evidenceIds.includes(id)) evidenceIds.push(id);
    }
    if (evidenceIds.length === phase.evidenceIds.length) return phase;
    changed = true;
    return { ...phase, evidenceIds };
  });

  const ownedIds = new Set(phases.flatMap(phase => phase.criteriaIds));
  const unownedPassed = [...passed].filter(id => !ownedIds.has(id));
  if (unownedPassed.length > 0) {
    const activeIndex = phases.findIndex(phase => phase.status === 'active');
    if (activeIndex >= 0) {
      phases = phases.map((phase, index) => {
        if (index !== activeIndex) return phase;
        const evidenceIds = [...phase.evidenceIds];
        for (const id of unownedPassed) {
          if (!evidenceIds.includes(id)) evidenceIds.push(id);
        }
        if (evidenceIds.length === phase.evidenceIds.length) return phase;
        changed = true;
        return { ...phase, evidenceIds };
      });
    }
  }

  if (!changed) {
    // Still try advance in case evidence was already present but status not advanced.
    const advanced = advanceWhileActivePhaseCriteriaMet(plan, now);
    return advanced === plan ? plan : advanced;
  }
  return advanceWhileActivePhaseCriteriaMet({ ...plan, phases, updatedAt: now }, now);
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
    if (activeIndex + 1 < current.phases.length) {
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
export function maybeAdvancePhaseByAttemptHeuristic(
  plan: MissionPlan,
  successfulAttemptCount: number,
  now: number,
): MissionPlan {
  if (plan.phases.length <= 1 || successfulAttemptCount <= 0) return plan;
  const activeIndex = plan.phases.findIndex(phase => phase.status === 'active');
  if (activeIndex < 0) return plan;
  if (plan.phases[activeIndex].criteriaIds.length > 0) return plan;

  // Complete earlier phases only; keep the last phase open for final verification.
  const targetDone = Math.min(plan.phases.length - 1, successfulAttemptCount);
  const alreadyDone = plan.phases.filter(phase => phase.status === 'done').length;
  if (alreadyDone >= targetDone && plan.phases[targetDone]?.status === 'active') {
    return plan;
  }

  let current = plan;
  for (let index = 0; index < targetDone; index += 1) {
    const phase = current.phases[index];
    if (phase && phase.status !== 'done') {
      current = advanceMissionPhase(current, phase.id, 'done', now);
    }
  }
  if (targetDone < current.phases.length) {
    const next = current.phases[targetDone];
    if (next && next.status !== 'active') {
      current = markActivePhase(current, targetDone, now);
    }
  }
  return current;
}

/**
 * On verified task complete: mark remaining phases done.
 * Already-done phases keep status/criteriaIds/evidenceIds as-is.
 */
export function markRemainingPhasesDone(plan: MissionPlan, now: number): MissionPlan {
  let changed = false;
  const phases = plan.phases.map(phase => {
    if (phase.status === 'done') return phase;
    changed = true;
    return { ...phase, status: 'done' as const };
  });
  if (!changed) return { ...plan, updatedAt: now };
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
      notes: phase.notes.map(n => sanitizePlanText(n)).filter(Boolean).slice(0, 8),
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

  const restoredPhases: MissionPhase[] = phases.slice(0, MAX_PHASES).map((raw, index) => {
    const phase = raw as Partial<MissionPhase>;
    const status: MissionPhaseStatus =
      phase.status === 'planned' ||
      phase.status === 'active' ||
      phase.status === 'done' ||
      phase.status === 'blocked'
        ? phase.status
        : index === 0
          ? 'active'
          : 'planned';
    return {
      id: typeof phase.id === 'string' && phase.id ? phase.id : `phase-${index + 1}`,
      title:
        typeof phase.title === 'string' && phase.title.trim()
          ? sanitizePlanText(phase.title).slice(0, MAX_TITLE_LEN) || `阶段 ${index + 1}`
          : `阶段 ${index + 1}`,
      status,
      criteriaIds: Array.isArray(phase.criteriaIds) ? phase.criteriaIds.filter((x): x is string => typeof x === 'string') : [],
      evidenceIds: Array.isArray(phase.evidenceIds) ? phase.evidenceIds.filter((x): x is string => typeof x === 'string') : [],
      notes: Array.isArray(phase.notes)
        ? phase.notes
            .filter((x): x is string => typeof x === 'string')
            .map(n => sanitizePlanText(n))
            .filter(Boolean)
            .slice(0, 8)
        : [],
    };
  });

  // Ensure at most one active phase after restore.
  let sawActive = false;
  for (const phase of restoredPhases) {
    if (phase.status === 'active') {
      if (sawActive) phase.status = 'planned';
      else sawActive = true;
    }
  }
  if (!sawActive && restoredPhases[0] && restoredPhases[0].status === 'planned') {
    restoredPhases[0].status = 'active';
  }

  return {
    id,
    goal: typeof checkpoint.goal === 'string' && checkpoint.goal.trim() ? sanitizePlanText(checkpoint.goal) || GENERIC_GOAL : GENERIC_GOAL,
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
      const mark =
        p.status === 'done' ? '[x]' : p.status === 'active' ? '[>]' : p.status === 'blocked' ? '[!]' : '[ ]';
      return `${mark} ${i + 1}. ${p.title}`;
    }),
  ];
  return lines.join('\n');
}
