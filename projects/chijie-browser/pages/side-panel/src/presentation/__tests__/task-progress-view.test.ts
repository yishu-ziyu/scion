import { describe, expect, it } from 'vitest';
import type {
  EvidenceRecord,
  EvidenceSpace,
  ResearchCapabilityDecisionDraft,
  TaskSnapshot,
} from '@extension/storage';
import {
  putResearchDecisionInSpace,
  putResearchDeliveryInSpace,
  researchDeliveryReady,
} from '@extension/storage/lib/task';
import { deriveTaskProgressView } from '../task-progress-view';

function snapshot(status: TaskSnapshot['status'] = 'paused'): TaskSnapshot {
  return {
    id: 'task-living-reader',
    goalSummary: 'User task',
    chatSessionId: 'chat-1',
    instructionMessageId: 'message-original',
    status,
    revision: 9,
    activeTabId: 7,
    currentRoundId: 'round-1',
    targetRefs: [
      {
        id: 'page-1',
        kind: 'page',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://example.com',
        digest: 'digest',
      },
    ],
    rounds: [
      {
        id: 'round-1',
        instructionSummary: 'Latest correction',
        status,
        commandAcks: {},
        criteria: [],
        attempts: [
          {
            id: 'attempt-1',
            roundId: 'round-1',
            actionName: 'go_to_url',
            effect: 'read',
            argsDigest: 'args',
            displaySummary: '打开 Zotero 官网',
            targetLabel: 'zotero.org',
            state: status === 'running' ? 'executing' : 'observed',
            proposedAt: 9_000,
            executingAt: 9_100,
            observedAt: status === 'running' ? undefined : 9_200,
          },
        ],
        evidence: [],
      },
    ],
    plan: {
      id: 'mission-1',
      goal: 'User task',
      phases: [
        {
          id: 'phase-1',
          title: '你现在接',
          status: 'active',
          criteriaIds: [],
          evidenceIds: [],
          notes: [],
        },
      ],
      createdAt: 1_000,
      updatedAt: 2_000,
    },
    createdAt: 1_000,
    updatedAt: 10_000,
  };
}

function evidenceRecord(input: {
  id: string;
  recordType: EvidenceRecord['recordType'];
  source: string;
  capturedAt: number;
  relatedProduct?: string;
}): EvidenceRecord {
  return {
    id: input.id,
    taskId: 'task-living-reader',
    recordType: input.recordType,
    source: input.source,
    canonicalSource: input.source,
    sourceTitle: `Source ${input.id}`,
    rawBasis: 'This is a sufficiently long verbatim basis copied from the observed page.',
    observation: `Observation ${input.id}`,
    inference: `Inference ${input.id}`,
    confidence: 'high',
    relatedProduct: input.relatedProduct,
    priority: 'medium',
    stance: 'neutral',
    dedupeKey: input.id,
    capturedAt: input.capturedAt,
  };
}

function space(userCount: number, productCount: number): EvidenceSpace {
  const records: EvidenceRecord[] = [
    evidenceRecord({
      id: 'repo',
      recordType: 'repository',
      source: 'https://github.com/yishu-ziyu/living-reader',
      capturedAt: 2_000,
    }),
  ];
  for (let index = 0; index < userCount; index += 1) {
    records.push(
      evidenceRecord({
        id: `user-${index}`,
        recordType: 'user_discussion',
        source: `https://reddit.com/r/reading/comments/${index}`,
        capturedAt: 3_000 + index,
      }),
    );
  }
  for (let index = 0; index < productCount; index += 1) {
    records.push(
      evidenceRecord({
        id: `product-${index}`,
        recordType: 'product',
        source: `https://product-${index}.example.com`,
        relatedProduct: `Product ${index}`,
        capturedAt: 4_000 + index,
      }),
    );
  }
  return {
    taskId: 'task-living-reader',
    records,
    workCycles: 20,
    createdAt: 1_000,
    updatedAt: 8_000,
  };
}

function capability(title: string): ResearchCapabilityDecisionDraft {
  return {
    title,
    userMoment: '用户在阅读复杂内容并准备复述时卡住',
    behaviorChange: '用户可以留在原文内完成理解与验证',
    whyNow: '现有用户和产品证据集中且当前架构可支持',
    whyOthersLater: '其他候选方向的证据覆盖和紧迫性更弱',
    implementationDistance: '需要一轮可控的浏览器侧增量实现',
    mvp: '提供一个可以真实验证结果的最小交互闭环',
    successMetric: '目标阅读任务的验证完成率得到显著提升',
    userEvidenceIds: ['user-1', 'user-2'],
    productEvidenceIds: ['product-1'],
    repositoryEvidenceIds: ['repo'],
  };
}

const originalInstruction =
  '你现在接管 The Living Reader。至少 80 条用户讨论，至少 30 个产品，最终恰好 3 个能力并完成飞书研究表与决策文档回读。';

describe('deriveTaskProgressView', () => {
  it('projects durable research counts instead of heuristic action progress', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('paused'),
      missionInstruction: originalInstruction,
      evidenceSpace: space(91, 26),
      now: 12_000,
    });

    expect(view.kind).toBe('research');
    expect(view.mission.title).toBe('Living Reader 下一阶段能力决策');
    expect(view.milestones).toHaveLength(5);
    expect(view.milestones.map(item => item.status)).toEqual(['done', 'done', 'active', 'planned', 'planned']);
    expect(view.milestones[1]?.gates[0]).toMatchObject({ current: 91, target: 80, status: 'passed' });
    expect(view.milestones[2]?.gates[0]).toMatchObject({ current: 26, target: 30, status: 'active' });
    expect(view.nextStep).toContain('4 个');
  });

  it('explains why raw research records can exceed qualified gate progress', () => {
    const evidenceSpace = space(76, 26);
    for (let index = 0; index < 15; index += 1) {
      evidenceSpace.records.push(
        evidenceRecord({
          id: `excluded-user-${index}`,
          recordType: 'user_discussion',
          source: `https://www.google.com/search?q=reading-case-${index}`,
          capturedAt: 5_000 + index,
        }),
      );
    }

    const view = deriveTaskProgressView({
      snapshot: snapshot('interrupted'),
      missionInstruction: originalInstruction,
      evidenceSpace,
      now: 12_000,
    });

    expect(view.milestones[1]?.gates[0]).toMatchObject({
      label: '合格用户讨论',
      current: 76,
      target: 80,
      status: 'active',
      detail: '原始记录 91 条，15 条因来源过滤或去重未计入',
    });
    expect(view.health).toMatchObject({
      state: 'paused',
      summary: '运行已中断，检查点已经保存',
    });
    expect(view.currentActivity).toBeUndefined();
    expect(view.nextStep).toContain('4 条合格用户讨论证据');
  });

  it('never presents stale live activity while paused', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('paused'),
      missionInstruction: originalInstruction,
      evidenceSpace: space(91, 26),
      now: 12_000,
    });

    expect(view.status).toBe('paused');
    expect(view.health.state).toBe('paused');
    expect(view.currentActivity).toBeUndefined();
  });

  it('explains the current action through the active milestone while running', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('running'),
      missionInstruction: originalInstruction,
      evidenceSpace: space(91, 26),
      now: 12_000,
    });

    expect(view.currentActivity).toMatchObject({
      summary: '打开 Zotero 官网',
      purpose: '推进“产品研究”',
      site: 'zotero.org',
    });
    expect(view.health.state).toBe('advancing');
  });

  it('reports slow when a running task has no meaningful progress for the health window', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('running'),
      missionInstruction: originalInstruction,
      evidenceSpace: space(91, 26),
      now: 600_000,
    });

    expect(view.health).toMatchObject({
      state: 'slow',
      summary: '一段时间没有新成果，正在重新规划',
    });
  });

  it.each([
    ['waiting_user', 'needs_user', 'needs_user'],
    ['inputs_required', 'needs_user', 'needs_user'],
    ['failed', 'failed', 'failed'],
    ['cancelled', 'failed', 'failed'],
    ['completed', 'completed', 'complete'],
  ] as const)('maps %s to one non-running public state', (taskStatus, viewStatus, healthState) => {
    const view = deriveTaskProgressView({
      snapshot: snapshot(taskStatus),
      missionInstruction: originalInstruction,
      evidenceSpace: space(76, 26),
      now: 12_000,
    });

    expect(view.status).toBe(viewStatus);
    expect(view.health.state).toBe(healthState);
    expect(view.currentActivity).toBeUndefined();
  });

  it('reports recovery from a blocked live attempt instead of pretending normal progress', () => {
    const task = snapshot('running');
    task.rounds[0]!.attempts[0]!.state = 'blocked';
    const view = deriveTaskProgressView({
      snapshot: task,
      missionInstruction: originalInstruction,
      evidenceSpace: space(91, 26),
      now: 12_000,
    });

    expect(view.health).toMatchObject({
      state: 'recovering',
      summary: '这一步未确认成功，正在换一种方式',
    });
  });

  it('projects a durable direction-change round separately from the stable mission', () => {
    const task = snapshot('running');
    task.rounds[0] = {
      ...task.rounds[0]!,
      changeType: 'direction_change',
      createdAt: 9_500,
    };
    const view = deriveTaskProgressView({
      snapshot: task,
      missionInstruction: originalInstruction,
      evidenceSpace: space(91, 26),
      now: 12_000,
    });

    expect(view.mission.title).toBe('Living Reader 下一阶段能力决策');
    expect(view.directionChange).toEqual({
      summary: '用户已调整任务方向，新要求已进入后续执行',
      occurredAt: 9_500,
    });
  });

  it('does not pass the decision milestone from three capabilities with an incomplete evidence matrix', () => {
    const evidenceSpace = space(80, 30);
    const incomplete = capability('能力一');
    incomplete.userEvidenceIds = ['user-1'];
    evidenceSpace.researchDecision = {
      capabilities: [incomplete, { ...incomplete, title: '能力二' }, { ...incomplete, title: '能力三' }],
      deferred: ['暂缓另一个证据不足的候选方向'],
      contradictions: [],
      createdAt: 9_000,
    };

    const view = deriveTaskProgressView({
      snapshot: snapshot('running'),
      missionInstruction: originalInstruction,
      evidenceSpace,
      now: 12_000,
    });

    expect(view.milestones[3]).toMatchObject({ status: 'active' });
    expect(view.milestones[3]?.gates[0]).toMatchObject({ current: 3, target: 3, status: 'active' });
    expect(view.nextStep).toContain('交叉验证证据');
  });

  it('advances decision and delivery milestones only from accepted durable state', () => {
    const evidenceSpace = space(80, 30);
    evidenceSpace.researchDecision = {
      capabilities: [capability('能力一'), capability('能力二'), capability('能力三')],
      deferred: ['暂缓证据不足的社交推荐能力'],
      contradictions: [],
      createdAt: 9_000,
    };
    evidenceSpace.researchDelivery = {
      research_table: {
        kind: 'research_table',
        url: 'https://feishu.cn/base/table',
        title: '研究表',
        observedText: '研究表回读',
        rowCount: 112,
        verifiedAt: 10_000,
      },
    };

    const view = deriveTaskProgressView({
      snapshot: snapshot('running'),
      missionInstruction: originalInstruction,
      evidenceSpace,
      now: 12_000,
    });

    expect(view.milestones.map(item => item.status)).toEqual(['done', 'done', 'done', 'done', 'active']);
    expect(view.milestones[4]?.gates[0]).toMatchObject({ current: 1, target: 2, status: 'active' });
    expect(view.artifacts).toHaveLength(1);
    expect(view.nextStep).toContain('飞书研究表与决策文档');
  });

  it('projects a fully verified 80/30 decision and dual-readback state through the public task surface', () => {
    const evidenceSpace = space(80, 30);
    const decision = putResearchDecisionInSpace({
      space: evidenceSpace,
      draft: {
        capabilities: [capability('能力一'), capability('能力二'), capability('能力三')],
        deferred: ['暂缓证据不足的社交推荐能力'],
        contradictions: ['部分用户仍偏好在独立笔记工具中整理材料'],
      },
      now: 9_000,
    });
    expect(decision.accepted).toBe(true);

    const table = putResearchDeliveryInSpace({
      space: decision.space,
      kind: 'research_table',
      url: 'https://example.feishu.cn/base/living-reader-research',
      title: 'Living Reader 研究表',
      observedText:
        '证据 来源 用户问题 观察 推断 置信度 相关产品 对应 Living Reader 能力 优先级，共 111 行',
      rowCount: 111,
      now: 10_000,
    });
    expect(table.accepted).toBe(true);

    const document = putResearchDeliveryInSpace({
      space: table.space,
      kind: 'decision_document',
      url: 'https://example.feishu.cn/docx/living-reader-decision',
      title: 'Living Reader 最终决策',
      observedText: '下一步做什么：能力一、能力二、能力三。为什么：证据矩阵已通过。暂时不做：社交推荐。',
      now: 11_000,
    });
    expect(document.accepted).toBe(true);
    expect(researchDeliveryReady(document.space)).toBe(true);

    const view = deriveTaskProgressView({
      snapshot: snapshot('completed'),
      missionInstruction: originalInstruction,
      evidenceSpace: document.space,
      now: 12_000,
    });

    expect(view.status).toBe('completed');
    expect(view.health).toMatchObject({ state: 'complete', summary: '全部要求已经过页面证据验证' });
    expect(view.currentActivity).toBeUndefined();
    expect(view.milestones.map(item => item.status)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(view.milestones.flatMap(item => item.gates).every(gate => gate.status === 'passed')).toBe(true);
    expect(view.milestones[1]?.gates[0]).toMatchObject({ current: 80, target: 80 });
    expect(view.milestones[2]?.gates[0]).toMatchObject({ current: 30, target: 30 });
    expect(view.milestones[3]?.gates[0]).toMatchObject({ current: 3, target: 3 });
    expect(view.milestones[4]?.gates[0]).toMatchObject({ current: 2, target: 2 });
    expect(view.artifacts).toEqual([
      expect.objectContaining({ id: 'research-table', status: 'verified', url: table.space.researchDelivery?.research_table?.url }),
      expect.objectContaining({
        id: 'decision-document',
        status: 'verified',
        url: document.space.researchDelivery?.decision_document?.url,
      }),
    ]);
    expect(view.nextStep).toBe('核对全部验收门并生成最终回执');
  });

  it('uses the original instruction as the stable generic mission', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('running'),
      missionInstruction: '调研十家浏览器产品并输出一张对比表。不要遗漏来源。',
      evidenceSpace: null,
      now: 12_000,
    });

    expect(view.kind).toBe('generic');
    expect(view.mission.title).toBe('调研十家浏览器产品并输出一张对比表');
    expect(view.milestones.every(milestone => milestone.gates.length === 0)).toBe(true);
  });
});
