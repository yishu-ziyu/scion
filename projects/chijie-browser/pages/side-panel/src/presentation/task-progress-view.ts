import {
  evidenceSpaceProgress,
  researchDecisionReady,
  researchDeliveryReady,
  type EvidenceSpace,
  type MissionPhaseStatus,
  type TaskSnapshot,
} from '@extension/storage';
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

const LIVING_READER_RE = /\bLiving\s+Reader\b|鲜活阅读器/i;
const MAX_RESEARCH_QUOTA = 1_000;

export function isLivingReaderMission(instruction: string): boolean {
  return LIVING_READER_RE.test(instruction);
}

function isLivingReaderEvidenceSpace(evidenceSpace?: EvidenceSpace | null): boolean {
  if (!evidenceSpace) return false;
  const recordMatches = evidenceSpace.records.some(record =>
    [record.sourceTitle, record.relatedProduct, record.livingReaderCapability].some(value =>
      LIVING_READER_RE.test(value ?? ''),
    ),
  );
  const deliveryMatches = Object.values(evidenceSpace.researchDelivery ?? {}).some(artifact =>
    LIVING_READER_RE.test(`${artifact?.title ?? ''}\n${artifact?.observedText ?? ''}`),
  );
  return recordMatches || deliveryMatches;
}

function boundedResearchQuota(value: string | undefined): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 && count <= MAX_RESEARCH_QUOTA ? count : 0;
}

/** Keep synchronized with background/task/research-checkpoint.ts. */
export function extractVisibleResearchTargets(
  instruction: string,
): { userDiscussions: number; products: number } | null {
  const text = instruction.replace(/\s+/g, ' ').trim();
  const userMatch = text.match(
    /(?:至少|at\s+least)\D{0,24}(\d{1,4})\D{0,24}(?:用户讨论|讨论或案例|讨论|user discussions?|cases?)/i,
  );
  const productMatch = text.match(/(?:至少|at\s+least)\D{0,24}(\d{1,4})\D{0,20}(?:竞品|产品|products?|competitors?)/i);
  const userDiscussions = boundedResearchQuota(userMatch?.[1]);
  const products = boundedResearchQuota(productMatch?.[1]);
  if (!userDiscussions && !products) return null;
  return { userDiscussions, products };
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

function viewStatus(snapshot: TaskSnapshot, evidenceSpace?: EvidenceSpace | null): ProgressViewStatus {
  if (snapshot.status === 'paused' || snapshot.status === 'interrupted') return 'paused';
  if (snapshot.status === 'waiting_user' || snapshot.status === 'inputs_required') return 'needs_user';
  if (snapshot.status === 'completed') {
    const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
    return shouldShowVerifiedDone(snapshot, round?.receipt) ? 'completed' : 'failed';
  }
  if (snapshot.status === 'failed' || snapshot.status === 'cancelled') return 'failed';
  if (evidenceSpace?.researchDecision && !researchDeliveryComplete(evidenceSpace)) return 'delivering';
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

/**
 * S2 Now line: only while running. Summary from last attempt; purpose from active milestone.
 */
export function deriveCurrentActivity(
  snapshot: TaskSnapshot,
  milestones: ProgressMilestone[],
): ProgressCurrentActivity | undefined {
  if (snapshot.status !== 'running') return undefined;
  const attempt = latestAttempt(snapshot);
  if (attempt?.state !== 'executing' || !attempt.executingAt) return undefined;
  const active = milestones.find(milestone => milestone.status === 'active');
  const summaryRaw =
    attempt?.displaySummary?.replace(/\s+/g, ' ').trim() ||
    attempt?.targetLabel?.replace(/\s+/g, ' ').trim() ||
    (attempt?.actionName ? '正在操作页面' : '') ||
    '正在推进任务';
  const summary = compact(summaryRaw, 80);
  const purpose = active ? `服务于「${active.title}」` : snapshot.plan?.goal ? '推进当前验收' : '推进当前任务';
  return {
    summary,
    purpose,
    site: activitySiteLabel(snapshot),
    startedAt: attempt.executingAt,
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
    case 'inputs_required':
      return {
        state: 'needs_user',
        summary: '需要你处理登录、验证或确认后才能继续',
        lastMeaningfulProgressAt: lastAt,
      };
    case 'failed':
      return {
        state: 'failed',
        summary: '未完成，请查看缺口后继续或调整方向',
        lastMeaningfulProgressAt: lastAt,
      };
    case 'cancelled':
      return {
        state: 'failed',
        summary: '已停止',
        lastMeaningfulProgressAt: lastAt,
      };
    case 'completed':
      return shouldShowVerifiedDone(
        snapshot,
        snapshot.rounds.find(item => item.id === snapshot.currentRoundId)?.receipt,
      )
        ? {
            state: 'complete',
            summary: '已验证完成',
            lastMeaningfulProgressAt: lastAt,
          }
        : {
            state: 'recovering',
            summary: '完成信号未通过验证，结果暂不可交付',
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

function researchDeliveryComplete(space?: EvidenceSpace | null): boolean {
  return researchDeliveryReady(space);
}

function latestDirectionChange(snapshot: TaskSnapshot): TaskProgressView['directionChange'] {
  const round = [...snapshot.rounds].reverse().find(item => item.changeType === 'direction_change');
  if (!round) return undefined;
  return {
    summary: '用户已调整任务方向，新要求已进入后续执行',
    occurredAt: round.createdAt ?? snapshot.updatedAt,
  };
}

function qualificationDetail(raw: number, qualified: number, unit: string): string {
  const excluded = Math.max(0, raw - qualified);
  if (excluded > 0) {
    return `原始记录 ${raw} ${unit}，${excluded} ${unit}因来源过滤或去重未计入`;
  }
  return raw > 0 ? `原始记录 ${raw} ${unit}，均已计入合格进度` : '仅计入通过来源与去重规则的证据';
}

function gateStatus(current: number, target: number, active: boolean): ProgressGateStatus {
  if (current >= target) return 'passed';
  return active ? 'active' : 'pending';
}

function milestoneStatuses(done: boolean[]): MissionPhaseStatus[] {
  const activeIndex = done.findIndex(value => !value);
  return done.map((isDone, index) => (isDone ? 'done' : index === activeIndex ? 'active' : 'planned'));
}

function researchProgressView(input: DeriveTaskProgressViewInput): TaskProgressView {
  const { snapshot, evidenceSpace } = input;
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  const verified = shouldShowVerifiedDone(snapshot, round?.receipt);
  const quotas = extractVisibleResearchTargets(input.missionInstruction) ?? { userDiscussions: 80, products: 30 };
  const progress = evidenceSpaceProgress(evidenceSpace);
  const rawUserDiscussionCount =
    evidenceSpace?.records.filter(record => record.recordType === 'user_discussion').length ?? 0;
  const rawProductCount = evidenceSpace?.records.filter(record => record.recordType === 'product').length ?? 0;
  const repositoryDone = progress.repository > 0;
  const userDone = !quotas.userDiscussions || progress.userDiscussions >= quotas.userDiscussions;
  const productDone = !quotas.products || progress.products >= quotas.products;
  const decisionDone = researchDecisionReady(evidenceSpace);
  const deliveryDone = researchDeliveryComplete(evidenceSpace);
  const statuses = milestoneStatuses([repositoryDone, userDone, productDone, decisionDone, deliveryDone]);
  const milestones: ProgressMilestone[] = [
    {
      id: 'understand-project',
      title: '理解项目',
      status: statuses[0],
      summary: repositoryDone ? '仓库依据已进入证据空间' : '读取仓库、能力地图和当前浏览器材料',
      gates: [
        {
          id: 'repository-evidence',
          label: '仓库依据',
          status: gateStatus(progress.repository, 1, statuses[0] === 'active'),
          current: Math.min(progress.repository, 1),
          target: 1,
          unit: '项',
        },
      ],
    },
    {
      id: 'user-research',
      title: '用户研究',
      status: statuses[1],
      summary: userDone
        ? '合格用户讨论配额已达标'
        : `还差 ${Math.max(0, quotas.userDiscussions - progress.userDiscussions)} 条合格证据`,
      gates: quotas.userDiscussions
        ? [
            {
              id: 'user-discussions',
              label: '合格用户讨论',
              status: gateStatus(progress.userDiscussions, quotas.userDiscussions, statuses[1] === 'active'),
              current: progress.userDiscussions,
              target: quotas.userDiscussions,
              unit: '条',
              detail: qualificationDetail(rawUserDiscussionCount, progress.userDiscussions, '条'),
            },
          ]
        : [],
    },
    {
      id: 'product-research',
      title: '产品研究',
      status: statuses[2],
      summary: productDone
        ? '合格产品配额已达标'
        : `还差 ${Math.max(0, quotas.products - progress.products)} 个合格产品`,
      gates: quotas.products
        ? [
            {
              id: 'products',
              label: '合格产品',
              status: gateStatus(progress.products, quotas.products, statuses[2] === 'active'),
              current: progress.products,
              target: quotas.products,
              unit: '个',
              detail: qualificationDetail(rawProductCount, progress.products, '个'),
            },
          ]
        : [],
    },
    {
      id: 'research-decision',
      title: '交叉验证与决策',
      status: statuses[3],
      summary: decisionDone ? '三个能力及证据矩阵已通过' : '收敛到恰好三个有完整证据的能力',
      gates: [
        {
          id: 'capability-decision',
          label: '最终能力',
          status: decisionDone ? 'passed' : statuses[3] === 'active' ? 'active' : 'pending',
          current: evidenceSpace?.researchDecision?.capabilities.length ?? 0,
          target: 3,
          unit: '个',
        },
      ],
    },
    {
      id: 'research-delivery',
      title: '飞书交付与回读',
      status: statuses[4],
      summary: deliveryDone ? '研究表和决策文档均已回读验证' : '创建并重新读取研究表与决策文档',
      gates: [
        {
          id: 'delivery-readback',
          label: '已验证交付物',
          status: deliveryDone ? 'passed' : statuses[4] === 'active' ? 'active' : 'pending',
          current:
            Number(Boolean(evidenceSpace?.researchDelivery?.research_table)) +
            Number(Boolean(evidenceSpace?.researchDelivery?.decision_document)),
          target: 2,
          unit: '项',
        },
      ],
    },
  ];
  const recentRecords = [...(evidenceSpace?.records ?? [])].sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 2);
  const findings: ProgressFinding[] = recentRecords.map(record => ({
    id: record.id,
    title: compact(record.sourceTitle, 72) || '新增研究证据',
    detail: compact(record.observation, 120),
    observedAt: record.capturedAt,
  }));
  const artifacts: ProgressArtifact[] = [];
  const table = evidenceSpace?.researchDelivery?.research_table;
  const document = evidenceSpace?.researchDelivery?.decision_document;
  if (table) {
    artifacts.push({
      id: 'research-table',
      title: table.title || '飞书研究表',
      kind: 'table',
      status: 'verified',
      url: table.url,
    });
  }
  if (document) {
    artifacts.push({
      id: 'decision-document',
      title: document.title || '飞书决策文档',
      kind: 'document',
      status: 'verified',
      url: document.url,
    });
  }

  let nextStep = '核对全部验收门并生成最终回执';
  if (!repositoryDone) nextStep = '完成仓库与当前材料理解';
  else if (!userDone)
    nextStep = `补足 ${Math.max(0, quotas.userDiscussions - progress.userDiscussions)} 条合格用户讨论证据`;
  else if (!productDone) nextStep = `补足 ${Math.max(0, quotas.products - progress.products)} 个未记录合格产品`;
  else if (!decisionDone) nextStep = '交叉验证证据并收敛到恰好三个能力';
  else if (!deliveryDone) nextStep = '创建并回读飞书研究表与决策文档';
  else if (snapshot.status === 'completed') nextStep = verified ? '任务已完成' : '补齐验收证据后再交付';

  const currentActivity = deriveCurrentActivity(snapshot, milestones);
  return {
    kind: 'research',
    mission: {
      title: 'Living Reader 下一阶段能力决策',
      deliverable: '恰好三个能力、完整证据矩阵、飞书研究表与决策文档回读',
    },
    directionChange: latestDirectionChange(snapshot),
    status: viewStatus(snapshot, evidenceSpace),
    health: deriveProgressHealth(snapshot, evidenceSpace, input.now),
    ...(currentActivity ? { currentActivity } : {}),
    milestones,
    findings,
    artifacts,
    nextStep,
    updatedAt: Math.max(snapshot.updatedAt, evidenceSpace?.updatedAt ?? 0),
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
  const artifacts: ProgressArtifact[] =
    verified && round?.receipt
      ? [
          {
            id: round.receipt.id,
            title: '已验证任务回执',
            kind: 'receipt',
            status: 'verified',
          },
        ]
      : [];
  const currentActivity = deriveCurrentActivity(snapshot, milestones);
  return {
    kind: 'generic',
    mission: {
      title: genericMissionTitle(input.missionInstruction),
      deliverable: '完成委托并提供可检查的结果',
    },
    directionChange: latestDirectionChange(snapshot),
    status: viewStatus(snapshot),
    health: deriveProgressHealth(snapshot, undefined, input.now),
    ...(currentActivity ? { currentActivity } : {}),
    milestones,
    findings: [],
    artifacts,
    nextStep: active
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
  return isLivingReaderMission(input.missionInstruction) || isLivingReaderEvidenceSpace(input.evidenceSpace)
    ? researchProgressView(input)
    : genericProgressView(input);
}
