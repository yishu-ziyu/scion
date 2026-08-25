import { describe, expect, it } from 'vitest';
import type { EvidenceRecord, EvidenceSpace, TaskSnapshot } from '@extension/storage';
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

const originalInstruction =
  '你现在接管 The Living Reader。至少 80 条用户讨论，至少 30 个产品，最终恰好 3 个能力并完成飞书研究表与决策文档回读。';

describe('deriveTaskProgressView', () => {
  it('keeps durable progress while paused and exposes mutual-exclusion health', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('paused'),
      missionInstruction: originalInstruction,
      evidenceSpace: space(91, 26),
      now: 12_000,
    });

    expect(view.status).toBe('paused');
    expect(view.milestones.some(item => item.status === 'active')).toBe(true);
    expect(view.health.state).toBe('paused');
    expect(view.health.summary).toBe('已暂停');
    expect(view).not.toHaveProperty('currentActivity');
  });

  it('projects a Now line only while running (action + purpose + site)', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('running'),
      missionInstruction: originalInstruction,
      evidenceSpace: space(76, 26),
      now: 12_000,
    });

    expect(view.health.state).toBe('advancing');
    expect(view.currentActivity).toMatchObject({
      summary: '打开 Zotero 官网',
      purpose: '推进当前任务',
      site: 'example.com',
      startedAt: 9_100,
    });
  });

  it('never exposes a raw action name when the attempt lacks public copy', () => {
    const task = snapshot('running');
    task.rounds[0]!.attempts[0] = {
      ...task.rounds[0]!.attempts[0]!,
      actionName: 'click_element',
      displaySummary: undefined,
      targetLabel: undefined,
    };

    const view = deriveTaskProgressView({ snapshot: task, missionInstruction: originalInstruction, now: 12_000 });

    expect(view.currentActivity?.summary).toBe('正在操作页面');
    expect(view.currentActivity?.summary).not.toMatch(/click|element|_/i);
  });

  it('does not repeat the operate-page question in progress health', () => {
    const task = snapshot('waiting_user');
    task.rounds[0]!.waitReason = 'confirm_execute';
    const view = deriveTaskProgressView({
      snapshot: task,
      missionInstruction: originalInstruction,
      now: 12_000,
    });
    expect(view.health.summary).not.toBe('要我现在操作这个网页吗？');
    expect(view.health.state).not.toBe('needs_user');
  });

  it('does not mention login when waiting only for page proof', () => {
    const task = snapshot('waiting_user');
    task.rounds[0]!.waitReason = 'proof_required';
    const view = deriveTaskProgressView({
      snapshot: task,
      missionInstruction: originalInstruction,
      now: 12_000,
    });
    expect(view.health.state).toBe('needs_user');
    expect(view.health.summary).toBe('写出的结果和页面对不上');
    expect(view.health.summary).not.toContain('登录');
  });

  it.each([
    ['waiting_user', 'needs_user', 'needs_user'],
    ['inputs_required', 'needs_user', 'needs_user'],
    ['failed', 'failed', 'failed'],
    ['cancelled', 'failed', 'failed'],
    ['completed', 'failed', 'complete'],
    // running without round.evidence stays planning; health still advances.
    ['running', 'planning', 'advancing'],
    ['interrupted', 'paused', 'paused'],
  ] as const)('maps %s to public status %s and health %s', (taskStatus, viewStatus, healthState) => {
    const view = deriveTaskProgressView({
      snapshot: snapshot(taskStatus),
      missionInstruction: originalInstruction,
      evidenceSpace: space(76, 26),
      now: 12_000,
    });

    expect(view.status).toBe(viewStatus);
    expect(view.health.state).toBe(healthState);
    expect(view.health.summary.length).toBeGreaterThan(0);
    if (taskStatus === 'running') {
      expect(view.currentActivity?.summary).toBe('打开 Zotero 官网');
    } else {
      expect(view).not.toHaveProperty('currentActivity');
    }
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

    expect(view.mission.title).toBe('你现在接管 The Living Reader');
    expect(view.directionChange).toEqual({
      summary: '用户已调整任务方向，新要求已进入后续执行',
      occurredAt: 9_500,
    });
  });

  it('does not label a generic completed signal as verified or render a receipt artifact', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('completed'),
      missionInstruction: '读取当前页面并给出摘要',
      evidenceSpace: null,
      now: 12_000,
    });
    expect(view.status).toBe('failed');
    expect(view.health).toMatchObject({ state: 'complete', summary: '已完成' });
    expect(view.artifacts).toEqual([]);
  });

  it('uses the original instruction as the stable generic mission', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('running'),
      missionInstruction: '调研十家浏览器产品并输出一张对比表。不要遗漏来源。',
      evidenceSpace: null,
      now: 12_000,
    });

    expect(view.kind).toBe('generic');
    expect(view.surface).toBe('result');
    expect(view.mission.title).toBe('调研十家浏览器产品并输出一张对比表');
    expect(view.mission.deliverable).toBe('完成委托并提供可检查的结果');
    expect(view.milestones.every(milestone => milestone.gates.length === 0)).toBe(true);
  });

  it('states a failed generic read as one failed result, not live progress', () => {
    const task = snapshot('failed');
    task.plan = {
      id: 'mission-read',
      goal: 'User task',
      phases: [
        {
          id: 'verify',
          title: '验证',
          status: 'done',
          criteriaIds: ['c1', 'c2'],
          evidenceIds: ['c1', 'c2'],
          notes: [],
        },
        {
          id: 'output',
          title: '输出',
          status: 'active',
          criteriaIds: ['c3'],
          evidenceIds: [],
          notes: [],
        },
      ],
      createdAt: 1_000,
      updatedAt: 2_000,
    };

    const view = deriveTaskProgressView({
      snapshot: task,
      missionInstruction: '阅读当前页面，用一句中文概括核心主题，并引用一个正文中可见的细节',
      evidenceSpace: null,
      now: 12_000,
    });

    expect(view.kind).toBe('generic');
    expect(view.surface).toBe('console');
    expect(view.status).toBe('failed');
    expect(view.health).toMatchObject({ state: 'failed', summary: '没做成' });
    expect(view.nextStep).toBe('没有完成交付');
    expect(view).not.toHaveProperty('currentActivity');
  });

  it('does not invent a deliverable slogan from theme-and-citation wording', () => {
    const view = deriveTaskProgressView({
      snapshot: snapshot('running'),
      missionInstruction: '阅读当前飞书页面，用一句中文概括核心主题，并引用一个正文中可见的细节；不要修改页面。',
      evidenceSpace: null,
      now: 12_000,
    });

    expect(view.kind).toBe('generic');
    expect(view.surface).toBe('result');
    expect(view.mission.title).toContain('阅读当前飞书页面');
    expect(view.mission.deliverable).toBe('完成委托并提供可检查的结果');
  });

  it('does not treat a generic snapshot update as meaningful progress', () => {
    const task = snapshot('running');
    task.createdAt = 1_000;
    task.updatedAt = 19_900;
    task.rounds[0]!.attempts = [];

    const view = deriveTaskProgressView({
      snapshot: task,
      missionInstruction: '读取当前页面并给出摘要',
      evidenceSpace: null,
      now: 20_000,
    });

    expect(view.health).toEqual({
      state: 'slow',
      summary: '尚无可确认进展，可继续等待或调整方向',
    });
    expect(view.currentActivity).toMatchObject({
      summary: '正在看 example.com',
      site: 'example.com',
    });
  });

  it.each([
    { idleFor: 30_000, state: 'advancing', summary: '刚有可确认进展' },
    { idleFor: 30_001, state: 'slow', summary: '暂无新的可确认进展' },
    { idleFor: 90_000, state: 'slow', summary: '暂无新的可确认进展' },
    { idleFor: 90_001, state: 'stalled', summary: '进展停滞，可暂停或调整方向' },
  ] as const)('maps $idleFor ms without meaningful progress to $state', ({ idleFor, state, summary }) => {
    const task = snapshot('running');
    task.rounds[0]!.attempts[0] = {
      ...task.rounds[0]!.attempts[0]!,
      state: 'observed',
      executingAt: 9_100,
      observedAt: 10_000,
    };

    const view = deriveTaskProgressView({
      snapshot: task,
      missionInstruction: '读取当前页面并给出摘要',
      evidenceSpace: null,
      now: 10_000 + idleFor,
    });

    expect(view.health).toEqual({
      state,
      summary,
      lastMeaningfulProgressAt: 10_000,
    });
  });

  it('keeps Now on the last observed action while running, so the live line is never empty', () => {
    const task = snapshot('running');
    task.rounds[0]!.attempts[0] = {
      ...task.rounds[0]!.attempts[0]!,
      state: 'observed',
      observedAt: 9_200,
    };
    task.updatedAt = 19_900;

    const view = deriveTaskProgressView({
      snapshot: task,
      missionInstruction: '读取当前页面并给出摘要',
      evidenceSpace: null,
      now: 20_000,
    });

    expect(view.currentActivity).toMatchObject({
      summary: '打开 Zotero 官网',
      site: 'example.com',
    });
    expect(view.health).toMatchObject({
      state: 'advancing',
      summary: '刚有可确认进展',
      lastMeaningfulProgressAt: 9_200,
    });
  });

  it('surfaces uncertain action state as recovery instead of normal progress', () => {
    const task = snapshot('running');
    task.rounds[0]!.attempts[0] = {
      ...task.rounds[0]!.attempts[0]!,
      state: 'uncertain',
      observedAt: undefined,
    };

    const view = deriveTaskProgressView({
      snapshot: task,
      missionInstruction: '读取当前页面并给出摘要',
      evidenceSpace: null,
      now: 20_000,
    });

    expect(view.health).toMatchObject({ state: 'recovering', summary: '上一步未确认，正在恢复或换路' });
    expect(view.currentActivity).toMatchObject({
      summary: '打开 Zotero 官网',
      site: 'example.com',
    });
  });
});
