import { type EvidenceSpace, type MissionPhaseStatus, type TaskSnapshot } from '@extension/storage';
import { shouldShowVerifiedDone } from './task-loop-ui';

export type ProgressViewStatus =
  | 'planning'
  | 'working'
  | 'verifying'
  | 'delivering'
  | 'paused'
  | 'needs_user'
  | 'completed'
  | 'failed';

export type ProgressGateStatus = 'pending' | 'active' | 'passed' | 'blocked';

export interface ProgressGate {
  id: string;
  label: string;
  status: ProgressGateStatus;
  current?: number;
  target?: number;
  unit?: string;
  detail?: string;
}

export interface ProgressMilestone {
  id: string;
  title: string;
  status: MissionPhaseStatus;
  summary?: string;
  gates: ProgressGate[];
}

export interface ProgressFinding {
  id: string;
  title: string;
  detail?: string;
  observedAt: number;
}

export interface ProgressArtifact {
  id: string;
  title: string;
  kind: 'table' | 'document' | 'file' | 'page' | 'receipt';
  status: 'draft' | 'created' | 'verified';
  url?: string;
}

/** design/008: answers "should I intervene?" — not a debug dashboard. */
export type ProgressHealthState =
  | 'advancing'
  | 'recovering'
  | 'slow'
  | 'stalled'
  | 'needs_user'
  | 'paused'
  | 'failed'
  | 'complete';

export interface ProgressHealth {
  state: ProgressHealthState;
  summary: string;
  lastMeaningfulProgressAt?: number;
}

/** design/008: one semantic Now line — action + purpose, not chain-of-thought. */
export interface ProgressCurrentActivity {
  summary: string;
  purpose: string;
  site?: string;
  startedAt: number;
}

export interface TaskProgressView {
  kind: 'research' | 'generic';
  /** result = 目标 + 结果。console = 008 长程控制台。 */
  surface?: 'result' | 'console';
  mission: {
    title: string;
    deliverable: string;
  };
  directionChange?: {
    summary: string;
    occurredAt: number;
  };
  status: ProgressViewStatus;
  health: ProgressHealth;
  /** Present only while the task is actively working (or recovering). */
  currentActivity?: ProgressCurrentActivity;
  milestones: ProgressMilestone[];
  findings: ProgressFinding[];
  artifacts: ProgressArtifact[];
  nextStep: string;
  updatedAt: number;
}

export interface DeriveTaskProgressViewInput {
  snapshot: TaskSnapshot;
  missionInstruction: string;
  evidenceSpace?: EvidenceSpace | null;
  now?: number;
}

function compact(value: string | undefined, max: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function genericMissionTitle(instruction: string): string {
  const text = compact(instruction, 160);
  if (!text) return '当前任务';
  const first = text.split(/[。！？!?；;]/, 1)[0]?.trim() || text;
  return compact(first, 72);
}

function genericMissionDeliverable(): string {
  return '完成委托并提供可检查的结果';
}

function isResultSurface(phases: { title: string }[]): boolean {
  return phases.length <= 1;
}

function viewStatus(snapshot: TaskSnapshot): ProgressViewStatus {
  if (snapshot.status === 'paused' || snapshot.status === 'interrupted') return 'paused';
  if (snapshot.status === 'waiting_user' || snapshot.status === 'inputs_required') return 'needs_user';
  if (snapshot.status === 'completed') {
    const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
    return shouldShowVerifiedDone(snapshot, round?.receipt) ? 'completed' : 'failed';
  }
  if (snapshot.status === 'failed' || snapshot.status === 'cancelled') return 'failed';
  return snapshot.rounds.some(round => round.evidence.length > 0) ? 'working' : 'planning';
}

function lastMeaningfulProgressAt(snapshot: TaskSnapshot, evidenceSpace?: EvidenceSpace | null): number | undefined {
  const recordAt = evidenceSpace?.records.reduce((max, record) => Math.max(max, record.capturedAt ?? 0), 0);
  const decisionAt = evidenceSpace?.researchDecision?.createdAt;
  const deliveryAt = Object.values(evidenceSpace?.researchDelivery ?? {}).reduce(
    (max, artifact) => Math.max(max, artifact?.verifiedAt ?? 0),
    0,
  );
  const roundProgress = snapshot.rounds.flatMap(round => [
    ...round.evidence.filter(evidence => evidence.passed).map(evidence => evidence.observedAt),
    ...round.attempts.filter(attempt => attempt.state === 'observed').map(attempt => attempt.observedAt),
  ]);
  const candidates = [recordAt, decisionAt, deliveryAt, ...roundProgress].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  );
  if (candidates.length === 0) return undefined;
  return Math.max(...candidates);
}

/** S1 health uses observable evidence/attempt state; generic snapshot writes are not progress. */
function activitySiteLabel(snapshot: TaskSnapshot): string | undefined {
  const page =
    [...snapshot.targetRefs].reverse().find(ref => ref.kind === 'page' && ref.tabId === snapshot.activeTabId) ??
    [...snapshot.targetRefs].reverse().find(ref => ref.kind === 'page');
  const raw = page?.label?.trim() || page?.urlOrigin?.trim();
  if (!raw) return undefined;
  try {
    if (raw.includes('://')) {
      return new URL(raw).hostname.replace(/^www\./, '') || compact(raw, 40);
    }
    return compact(raw.replace(/^www\./, ''), 40);
  } catch {
    return compact(raw, 40);
  }
}

function latestAttempt(snapshot: TaskSnapshot) {
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  const attempts = round?.attempts ?? [];
  return attempts.length > 0 ? attempts[attempts.length - 1] : undefined;
}

function activityPurpose(snapshot: TaskSnapshot, milestones: ProgressMilestone[]): string {
  const active = milestones.find(milestone => milestone.status === 'active');
  if (isResultSurface(milestones)) return '推进当前任务';
  if (active) return `服务于「${active.title}」`;
  if (snapshot.plan?.goal) return '推进当前验收';
  return '推进当前任务';
}

/**
 * Now line while the task is running. Prefer the live action; otherwise the
 * last observed action or the current page. Do not leave this empty.
 */
export function deriveCurrentActivity(
  snapshot: TaskSnapshot,
  milestones: ProgressMilestone[],
): ProgressCurrentActivity | undefined {
  if (snapshot.status !== 'running') return undefined;
  const attempt = latestAttempt(snapshot);
  const site = activitySiteLabel(snapshot);
  const purpose = activityPurpose(snapshot, milestones);
  if (attempt) {
    const summaryRaw =
      attempt.displaySummary?.replace(/\s+/g, ' ').trim() ||
      attempt.targetLabel?.replace(/\s+/g, ' ').trim() ||
      (attempt.actionName ? '正在操作页面' : '') ||
      '正在处理';
    return {
      summary: compact(summaryRaw, 80),
      purpose,
      site,
      startedAt: attempt.executingAt ?? attempt.observedAt ?? snapshot.updatedAt,
    };
  }
  return {
    summary: site ? `正在看 ${site}` : '正在处理',
    purpose,
    site,
    startedAt: snapshot.createdAt,
  };
}

export function deriveProgressHealth(
  snapshot: TaskSnapshot,
  evidenceSpace?: EvidenceSpace | null,
  now = Date.now(),
): ProgressHealth {
  const lastAt = lastMeaningfulProgressAt(snapshot, evidenceSpace);
  switch (snapshot.status) {
    case 'paused':
    case 'interrupted':
      return { state: 'paused', summary: '已暂停', lastMeaningfulProgressAt: lastAt };
    case 'waiting_user':
    case 'inputs_required': {
      const reason = snapshot.rounds.find(item => item.id === snapshot.currentRoundId)?.waitReason;
      if (reason === 'confirm_execute') {
        return {
          state: 'advancing',
          summary: '',
          lastMeaningfulProgressAt: lastAt,
        };
      }
      const summary =
        reason === 'login_required'
          ? '需要你处理登录、验证或确认后才能继续'
          : reason === 'proof_required'
            ? '写出的结果和页面对不上'
            : '还不能交卷';
      return {
        state: 'needs_user',
        summary,
        lastMeaningfulProgressAt: lastAt,
      };
    }
    case 'failed':
      return {
        state: 'failed',
        summary: '没做成',
        lastMeaningfulProgressAt: lastAt,
      };
    case 'cancelled':
      return {
        state: 'failed',
        summary: '已停止',
        lastMeaningfulProgressAt: lastAt,
      };
    case 'completed':
      return {
        state: 'complete',
        summary: shouldShowVerifiedDone(
          snapshot,
          snapshot.rounds.find(item => item.id === snapshot.currentRoundId)?.receipt,
        )
          ? '已验证完成'
          : '已完成',
        lastMeaningfulProgressAt: lastAt,
      };
    case 'running':
    default: {
      const attempt = latestAttempt(snapshot);
      if (attempt?.state === 'uncertain' || attempt?.state === 'blocked') {
        return {
          state: 'recovering',
          summary: '上一步未确认，正在恢复或换路',
          lastMeaningfulProgressAt: lastAt,
        };
      }
      const executingAge = attempt?.executingAt ? Math.max(0, now - attempt.executingAt) : Number.POSITIVE_INFINITY;
      if (attempt?.state === 'executing' && executingAge <= 30_000) {
        return {
          state: 'advancing',
          summary: '当前动作正在等待页面反馈',
          lastMeaningfulProgressAt: lastAt,
        };
      }
      if (lastAt) {
        const idleFor = Math.max(0, now - lastAt);
        if (idleFor <= 30_000) {
          return { state: 'advancing', summary: '刚有可确认进展', lastMeaningfulProgressAt: lastAt };
        }
        return idleFor <= 90_000
          ? {
              state: 'slow',
              summary: '暂无新的可确认进展',
              lastMeaningfulProgressAt: lastAt,
            }
          : {
              state: 'stalled',
              summary: '进展停滞，可暂停或调整方向',
              lastMeaningfulProgressAt: lastAt,
            };
      }
      const taskAge = Math.max(0, now - snapshot.createdAt);
      return {
        state: taskAge <= 15_000 ? 'advancing' : 'slow',
        summary: taskAge <= 15_000 ? '正在准备第一步' : '尚无可确认进展，可继续等待或调整方向',
      };
    }
  }
}

function latestDirectionChange(snapshot: TaskSnapshot): TaskProgressView['directionChange'] {
  const round = [...snapshot.rounds].reverse().find(item => item.changeType === 'direction_change');
  if (!round) return undefined;
  return {
    summary: '用户已调整任务方向，新要求已进入后续执行',
    occurredAt: round.createdAt ?? snapshot.updatedAt,
  };
}

function genericProgressView(input: DeriveTaskProgressViewInput): TaskProgressView {
  const { snapshot } = input;
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  const milestones: ProgressMilestone[] = (snapshot.plan?.phases ?? []).map(phase => {
    const passed = phase.criteriaIds.filter(id => phase.evidenceIds.includes(id)).length;
    return {
      id: phase.id,
      title: phase.title,
      status: phase.status,
      summary: phase.status === 'done' ? '已通过' : phase.status === 'active' ? '当前阶段' : undefined,
      gates:
        phase.criteriaIds.length > 0
          ? [
              {
                id: `${phase.id}-criteria`,
                label: '验收条件',
                status:
                  passed >= phase.criteriaIds.length ? 'passed' : phase.status === 'active' ? 'active' : 'pending',
                current: passed,
                target: phase.criteriaIds.length,
                unit: '项',
              },
            ]
          : [],
    };
  });
  const active = milestones.find(milestone => milestone.status === 'active');
  const verified = shouldShowVerifiedDone(snapshot, round?.receipt);
  const currentActivity = deriveCurrentActivity(snapshot, milestones);
  return {
    kind: 'generic',
    surface: isResultSurface(snapshot.plan?.phases ?? []) ? 'result' : 'console',
    mission: {
      title: genericMissionTitle(input.missionInstruction),
      deliverable: genericMissionDeliverable(),
    },
    directionChange: latestDirectionChange(snapshot),
    status: viewStatus(snapshot),
    health: deriveProgressHealth(snapshot, undefined, input.now),
    ...(currentActivity ? { currentActivity } : {}),
    milestones,
    findings: [],
    artifacts: [],
    nextStep:
      snapshot.status === 'failed' || snapshot.status === 'cancelled'
        ? '没有完成交付'
        : active
          ? `继续完成“${active.title}”`
          : snapshot.status === 'completed'
            ? verified
              ? '任务已完成'
              : '补齐验收证据后再交付'
            : '继续推进当前任务',
    updatedAt: snapshot.updatedAt,
  };
}

export function deriveTaskProgressView(input: DeriveTaskProgressViewInput): TaskProgressView {
  return genericProgressView(input);
}
