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
const GENERIC_GOAL = '执行任务';

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
      const slice = text
        .slice(start, end)
        .replace(/[；;。]\s*$/, '')
        .trim();
      if (slice) slices.push(slice);
    }
    if (slices.length >= 2) return slices.slice(0, MAX_PHASES);
  }

  // Natural-language sequence: 先…，再…，读取…，最终输出…
  const sequenceHits = [...text.matchAll(/(?:^|[，,。]\s*)(先|首先|再|然后|随后|接着|最终|最后)\s*/g)];
  if (sequenceHits.length >= 2) {
    const slices: string[] = [];
    for (let index = 0; index < sequenceHits.length; index += 1) {
      const start = (sequenceHits[index].index ?? 0) + sequenceHits[index][0].length;
      const end = index + 1 < sequenceHits.length ? (sequenceHits[index + 1].index ?? text.length) : text.length;
      const slice = text
        .slice(start, end)
        .replace(/^[，,。]\s*|[；;。]\s*$/g, '')
        .trim();
      if (!slice) continue;
      slices.push(
        ...slice
          .split(/[，,]\s*(?=(?:阅读|读取|提取|验证|确认|打开|访问|输出|总结|汇总))/)
          .map(part => part.trim())
          .filter(Boolean),
      );
    }
    if (slices.length >= 2) return slices.slice(0, MAX_PHASES);
  }

  const parts = text
    .split(PHASE_SEPARATOR)
    .map(part => part.trim())
    .filter(Boolean)
    // A trailing safety constraint is not an execution phase. Keeping it as a
    // planned phase makes an otherwise single-step read task look unfinished.
    .filter(
      part =>
        !/^(?:不要|请勿|无需|不需|仅限).{0,24}(?:修改|编辑|点击|提交|写入|操作)(?:页面|内容|文档)?[.!。！]?$/i.test(
          part,
        ),
    )
    // Observable success clauses define proof for the preceding action; they
    // are not independent phases that can demand a second copy of the proof.
    .filter(
      part =>
        !/^(?:success\s+is|until\s+(?:you\s+)?(?:see|seeing)|成功(?:标志|信号|文案|是|为)|看到.{0,80}后完成)/i.test(
          part,
        ),
    );
  if (parts.length === 0) return [''];
  return parts.slice(0, MAX_PHASES);
}

export function countMissionPhases(instruction: string): number {
  return Math.min(Math.max(splitInstructionSegments(instruction).length, 1), MAX_PHASES);
}

/** Strip emails, long tokens, and key-like strings from a fragment. */
export function sanitizePlanText(text: string): string {
  return text.replace(EMAIL_RE, '').replace(API_KEYISH_RE, '').replace(LONG_TOKEN_RE, '').replace(/\s+/g, ' ').trim();
}

/** Host / URL fragments must never become soft phase titles. */
const HOSTISH_RE = /(?:https?:\/\/)|(?:www\.)|(?:\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/\S*)?\b)/i;

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
 * Produce a recognisable, entity-free mission label from canonical action
 * words only. It never copies arbitrary nouns, hosts, ids, or values from the
 * instruction into durable task state.
 */
export function deriveMissionGoal(instruction: string, phaseTitles?: string[]): string {
  const text = sanitizePlanText(instruction);
  const actions: string[] = [];
  const add = (label: string) => {
    if (!actions.includes(label)) actions.push(label);
  };

  const safePhaseActions = (phaseTitles ?? [])
    .map(title => sanitizePlanText(title))
    .filter(title => title && !/^阶段\s*\d+$/.test(title));
  if (safePhaseActions.length > 1) {
    const first = safePhaseActions[0];
    const last = safePhaseActions.at(-1);
    return first === last ? first + '任务' : first + '并' + last;
  }

  if (/(?:阅读|读取|读一下|查看|\bread\b)/i.test(text)) add('阅读');
  if (/(?:调研|研究|搜索|查找|检索|\bresearch\b|\bsearch\b)/i.test(text)) add('调研');
  if (/(?:对比|比较|对照|\bcompare\b)/i.test(text)) add('对比');
  if (/(?:打开|访问|进入|导航|\bopen\b|\bvisit\b|\bnavigate\b)/i.test(text)) add('打开');
  if (/(?:填写|输入|提交|发送|\bfill\b|\bsubmit\b)/i.test(text)) add('提交');
  if (/(?:验证|检查|确认|核对|\bverify\b|\bconfirm\b)/i.test(text)) add('验证');
  if (/(?:总结|概括|摘要|归纳|结论|观察|\bsummari[sz]e\b|\bsummary\b)/i.test(text)) add('总结');
  if (/(?:输出|导出|生成|整理|汇总|\boutput\b|\bexport\b|\bgenerate\b)/i.test(text)) add('输出');
  if (/(?:识别|是不是|是否|哪个网站|什么网站)/.test(text)) add('识别');

  if (actions.length === 0 && safePhaseActions[0]) actions.push(safePhaseActions[0]);
  if (actions.length === 0) return GENERIC_GOAL;
  if (actions.length === 1) return actions[0] === '识别' ? '识别页面' : `${actions[0]}任务`;
  return `${actions[0]}并${actions.at(-1)}`;
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
    goal: deriveMissionGoal(
      instruction,
      phases.map(phase => phase.title),
    ),
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
    goal: deriveMissionGoal(instruction),
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

/** A final answer may prove only the active, explicit deliverable phase. */
export function applyFinalDeliverableToMissionPlan(plan: MissionPlan, deliverableId: string, now: number): MissionPlan {
  if (!deliverableId) return plan;
  const activeIndex = plan.phases.findIndex(phase => phase.status === 'active');
  if (activeIndex < 0) return plan;
  if (activeIndex !== plan.phases.length - 1) return plan;
  const active = plan.phases[activeIndex];
  if (!isDeliveryPhaseTitle(active.title)) return plan;
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
