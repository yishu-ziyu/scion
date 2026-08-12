import { describe, expect, it } from 'vitest';
import {
  advanceMissionPhase,
  applyFinalDeliverableToMissionPlan,
  applyPassedCriteriaToMissionPlan,
  applySinglePhaseEvidence,
  attachCriteriaAcrossMissionPlan,
  attachCriteriaToActivePhase,
  buildMissionPlan,
  countMissionPhases,
  derivePhaseTitle,
  extendReconciledMissionProof,
  markActivePhase,
  reconcileMissionPlanWithFrozenContract,
  refineMissionPlanFromInstruction,
  renderMissionPlanForAgent,
  restoreMissionPlan,
  sanitizePlanText,
  serializeMissionCheckpoint,
} from '../mission-plan';

describe('mission plan', () => {
  it('splits an instruction into phases without persisting raw entity text', () => {
    const instruction = '调研 10 家竞品；输出对比表；写一份结论';
    expect(countMissionPhases(instruction)).toBe(3);

    const plan = refineMissionPlanFromInstruction(instruction, 1700);
    expect(plan.phases).toHaveLength(3);
    expect(plan.phases[0]).toMatchObject({ id: 'phase-1', title: '调研', status: 'active' });
    expect(plan.phases[1]).toMatchObject({ id: 'phase-2', title: '输出', status: 'planned' });
    expect(plan.phases[2]).toMatchObject({ id: 'phase-3', title: '总结', status: 'planned' });
    expect(plan.goal).toBe('调研并总结');

    const json = JSON.stringify(plan);
    expect(json).not.toContain('竞品');
    expect(json).not.toContain(instruction);
    expect(json).not.toContain('对比表');
    // Phase label may be 总结; raw segment "写一份结论" must not leak.
    expect(json).not.toContain('写一份结论');
    expect(json).not.toContain('结论');
  });

  it('derives a useful single-phase goal from canonical action words only', () => {
    const plan = refineMissionPlanFromInstruction(
      '阅读当前飞书页面，用一句中文概括核心主题，并引用一个正文中可见的细节；不要修改页面。',
      1750,
    );
    expect(plan.goal).toBe('阅读并总结');
    expect(plan.phases).toHaveLength(1);
    expect(JSON.stringify(plan)).not.toContain('飞书');
    expect(JSON.stringify(plan)).not.toContain('核心主题');
  });

  it('keeps buildMissionPlan as generic 阶段 N skeleton', () => {
    const plan = buildMissionPlan('调研 10 家竞品；输出对比表；写一份结论', 1700);
    expect(plan.phases[0]?.title).toBe('阶段 1');
    expect(JSON.stringify(plan)).not.toContain('竞品');
  });

  it('splits numbered multi-phase goals into action-oriented titles', () => {
    const instruction =
      '这是一个多阶段任务：1) 进入英文维基；2) 搜索并打开 Artificial intelligence 条目；3) 在回复中写出当前页标题';
    const plan = refineMissionPlanFromInstruction(instruction, 1900);
    expect(plan.phases.length).toBeGreaterThanOrEqual(3);
    expect(plan.phases[0]?.title).toMatch(/打开|进入|调研|阶段/);
    // Must not keep the whole preamble as one phase title.
    expect(plan.phases[0]?.title).not.toContain('这是一个多阶段');
    expect(JSON.stringify(plan)).not.toContain('Artificial intelligence');
  });

  it('caps phase count and keeps a single-phase mission valid', () => {
    const many = Array.from({ length: 20 }, (_, index) => `任务 ${index + 1}`).join('；');
    expect(countMissionPhases(many)).toBe(12);
    const single = refineMissionPlanFromInstruction('打开 YouTube', 1800);
    expect(single.phases).toHaveLength(1);
    expect(single.phases[0]?.status).toBe('active');
    expect(single.phases[0]?.title).toBe('打开');
    expect(single.createdAt).toBe(1800);
    expect(single.updatedAt).toBe(1800);
  });

  it('treats a trailing success clause as proof, not an evidence-free phase', () => {
    const plan = refineMissionPlanFromInstruction('submit; success is Saved successfully.', 1850);
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({ title: 'submit', status: 'active' });
    expect(JSON.stringify(plan)).not.toContain('Saved successfully');
  });

  it('strips emails and long tokens from titles and never stores them on the plan', () => {
    const instruction = '调研 alice@example.com 的竞品；输出 sk-abc1234567890xyzSECRET 报告；验证结果';
    const plan = refineMissionPlanFromInstruction(instruction, 1900);
    const json = JSON.stringify(plan);
    expect(json).not.toContain('alice@example.com');
    expect(json).not.toContain('sk-abc1234567890xyzSECRET');
    expect(json).not.toContain('竞品');
    expect(plan.phases.map(p => p.title)).toEqual(['调研', '输出', '验证']);
    expect(sanitizePlanText('contact me@x.com now')).not.toContain('@');
  });

  it('advances a phase and demotes previous active when marking active', () => {
    let plan = refineMissionPlanFromInstruction('调研；输出；验证', 2000);
    plan = advanceMissionPhase(plan, 'phase-1', 'done', 2001);
    expect(plan.phases[0]?.status).toBe('done');
    expect(plan.updatedAt).toBe(2001);

    plan = markActivePhase(plan, 1, 2002);
    expect(plan.phases[0]?.status).toBe('done');
    expect(plan.phases[1]?.status).toBe('active');
    expect(plan.phases[2]?.status).toBe('planned');

    plan = advanceMissionPhase(plan, 'phase-3', 'active', 2003);
    expect(plan.phases[1]?.status).toBe('planned');
    expect(plan.phases[2]?.status).toBe('active');
  });

  it('serializes a JSON-safe checkpoint and rejects evidence-free done progress on restore', () => {
    let plan = refineMissionPlanFromInstruction('调研；输出；验证', 2100);
    plan = advanceMissionPhase(plan, 'phase-1', 'done', 2101);
    plan = markActivePhase(plan, 1, 2102);

    const checkpoint = serializeMissionCheckpoint(plan);
    expect(checkpoint.v).toBe(1);
    const json = JSON.stringify(checkpoint);
    expect(json).not.toContain('调研；输出');
    // titles are verb labels only
    expect(checkpoint.phases.map(p => p.status)).toEqual(['done', 'active', 'planned']);

    const restored = restoreMissionPlan(checkpoint);
    expect(restored).not.toBeNull();
    expect(restored?.id).toBe(plan.id);
    expect(restored?.phases.map(p => ({ title: p.title, status: p.status }))).toEqual([
      { title: '调研', status: 'active' },
      { title: '输出', status: 'planned' },
      { title: '验证', status: 'planned' },
    ]);
    expect(restoreMissionPlan(null)).toBeNull();
    expect(restoreMissionPlan({} as never)).toBeNull();
  });

  it('renders a compact agent-facing plan status', () => {
    let plan = refineMissionPlanFromInstruction('调研；输出；验证', 2200);
    plan = advanceMissionPhase(plan, 'phase-1', 'done', 2201);
    plan = markActivePhase(plan, 1, 2202);
    const text = renderMissionPlanForAgent(plan);
    expect(text).toContain('Mission: 调研并验证');
    expect(text).toContain('Progress: 1/3 done; active=输出');
    expect(text).toContain('[x] 1. 调研');
    expect(text).toContain('[>] 2. 输出');
    expect(text).toContain('[ ] 3. 验证');
  });

  it('derivePhaseTitle falls back to 阶段 N when segment is empty after sanitize', () => {
    expect(derivePhaseTitle('', 0)).toBe('阶段 1');
    expect(derivePhaseTitle('user@evil.com', 2)).toBe('阶段 3');
  });

  it('maps extended action verbs to short labels (离开/阅读/提取/验证)', () => {
    expect(derivePhaseTitle('离开 example.com', 0)).toBe('离开');
    expect(derivePhaseTitle('离开 example.com', 0)).not.toBe('离开 e');
    expect(derivePhaseTitle('阅读当前产品列表页', 1)).toBe('阅读');
    expect(derivePhaseTitle('提取至少 5 行', 2)).toBe('提取');
    expect(derivePhaseTitle('确认页面正文', 3)).toBe('验证');

    const plan = refineMissionPlanFromInstruction(
      '离开 example.com；阅读当前产品列表页；提取至少 5 行；确认页面正文',
      2800,
    );
    expect(plan.phases.map(p => p.title)).toEqual(['离开', '阅读', '提取', '验证']);
    expect(JSON.stringify(plan)).not.toContain('example.com');
    expect(JSON.stringify(plan)).not.toContain('离开 e');
    expect(JSON.stringify(plan)).not.toContain('产品列表');
  });

  it('soft fallback never leaks verb+entity scrap or host fragments', () => {
    // Unknown leading verb + host → soft would be "前往 e"; prefer 阶段 N.
    expect(derivePhaseTitle('前往 example.com', 0)).toBe('阶段 1');
    expect(derivePhaseTitle('前往 example.com', 0)).not.toMatch(/e$/);
    // Bare host / domain fragments.
    expect(derivePhaseTitle('example.com 产品页', 1)).toBe('阶段 2');
    expect(derivePhaseTitle('foo.bar 站点', 2)).toBe('阶段 3');
    expect(derivePhaseTitle('https://wiki.example/page', 3)).toBe('阶段 4');
    // Safe pure-phrase soft label still allowed when generic-looking.
    const soft = derivePhaseTitle('产品列表页内容', 0);
    expect(soft === '产品列表' || soft === '阶段 1').toBe(true);
    if (soft !== '阶段 1') {
      expect(soft).not.toMatch(/\s/);
      expect(soft).not.toMatch(/[a-zA-Z]/);
    }
  });

  it('attaches criteria to the active phase only when empty', () => {
    let plan = refineMissionPlanFromInstruction('调研；输出；验证', 2300);
    plan = attachCriteriaToActivePhase(plan, ['c1', 'c2'], 2301);
    expect(plan.phases[0]?.criteriaIds).toEqual(['c1', 'c2']);
    expect(plan.phases[1]?.criteriaIds).toEqual([]);
    // Second attach is a no-op
    plan = attachCriteriaToActivePhase(plan, ['c3'], 2302);
    expect(plan.phases[0]?.criteriaIds).toEqual(['c1', 'c2']);
    expect(plan.updatedAt).toBe(2301);
  });

  it('advances active phase when all its criteria have passed evidence', () => {
    let plan = refineMissionPlanFromInstruction('调研；输出；验证', 2400);
    plan = attachCriteriaToActivePhase(plan, ['c1', 'c2'], 2401);
    plan = applyPassedCriteriaToMissionPlan(plan, ['c1'], 2402);
    expect(plan.phases[0]?.status).toBe('active');
    expect(plan.phases[0]?.evidenceIds).toEqual(['c1']);

    plan = applyPassedCriteriaToMissionPlan(plan, ['c1', 'c2'], 2403);
    expect(plan.phases[0]?.status).toBe('done');
    expect(plan.phases[0]?.evidenceIds).toEqual(['c1', 'c2']);
    expect(plan.phases[1]?.status).toBe('active');
    expect(plan.phases[2]?.status).toBe('planned');
  });

  it('closes a single phase only with its own complete criterion evidence', () => {
    let plan = refineMissionPlanFromInstruction('阅读当前页面', 2450);
    plan = attachCriteriaAcrossMissionPlan(plan, ['c1', 'c2'], 2451);

    expect(applySinglePhaseEvidence(plan, ['unowned'], 2452)).toBe(plan);
    expect(applySinglePhaseEvidence(plan, ['c1'], 2453).phases[0]).toMatchObject({
      status: 'active',
      evidenceIds: ['c1'],
    });

    const completed = applySinglePhaseEvidence(plan, ['c1', 'c2'], 2454);
    expect(completed.phases[0]).toMatchObject({
      status: 'done',
      criteriaIds: ['c1', 'c2'],
      evidenceIds: ['c1', 'c2'],
    });
  });

  it('distributes frozen criteria across proof phases and keeps final output separate', () => {
    let plan = refineMissionPlanFromInstruction('调研；验证；输出', 2500);
    plan = attachCriteriaAcrossMissionPlan(plan, ['c1', 'c2'], 2501);
    expect(plan.phases.map(p => p.criteriaIds)).toEqual([['c1'], ['c2'], []]);

    plan = applyPassedCriteriaToMissionPlan(plan, ['c1', 'c2'], 2502);
    expect(plan.phases.map(p => p.status)).toEqual(['done', 'active', 'planned']);
    expect(plan.phases.map(p => p.evidenceIds)).toEqual([['c1'], [], []]);

    // c2 was observed while phase 1 owned the frontier, so the same batch may
    // not prefill phase 2. A fresh later verification advances it.
    plan = applyPassedCriteriaToMissionPlan(plan, ['c2'], 2503);
    expect(plan.phases.map(p => p.status)).toEqual(['done', 'done', 'active']);
    expect(plan.phases.map(p => p.evidenceIds)).toEqual([['c1'], ['c2'], []]);

    plan = applyFinalDeliverableToMissionPlan(plan, 'deliverable:d1', 2504);
    expect(plan.phases.map(p => p.status)).toEqual(['done', 'done', 'done']);
    expect(plan.phases[2]?.evidenceIds).toEqual(['deliverable:d1']);
  });

  it('reconciles a virgin narrative plan into one proof phase and an optional delivery phase', () => {
    const narrative = refineMissionPlanFromInstruction('离开当前页面；打开目标条目；确认正文', 2550);
    const proofOnly = reconcileMissionPlanWithFrozenContract(
      narrative,
      [
        { id: 'url', required: true },
        { id: 'text', required: true },
      ],
      false,
      2551,
    );
    expect(proofOnly.phases).toEqual([
      expect.objectContaining({
        id: 'phase-1',
        title: '验证',
        status: 'active',
        criteriaIds: ['url', 'text'],
        evidenceIds: [],
      }),
    ]);

    const withDelivery = reconcileMissionPlanWithFrozenContract(
      narrative,
      [{ id: 'page', required: true }],
      true,
      2552,
    );
    expect(withDelivery.phases).toEqual([
      expect.objectContaining({ title: '验证', status: 'active', criteriaIds: ['page'] }),
      expect.objectContaining({ title: '输出', status: 'planned', criteriaIds: [], evidenceIds: [] }),
    ]);
  });

  it('does not reconcile zero, optional, or already-progressed criteria ownership', () => {
    const narrative = refineMissionPlanFromInstruction('调研；验证；输出', 2570);
    expect(reconcileMissionPlanWithFrozenContract(narrative, [], true, 2571)).toBe(narrative);
    expect(reconcileMissionPlanWithFrozenContract(narrative, [{ id: 'optional', required: false }], true, 2572)).toBe(
      narrative,
    );
    const mixed = reconcileMissionPlanWithFrozenContract(
      narrative,
      [
        { id: 'required', required: true },
        { id: 'optional', required: false },
      ],
      false,
      2573,
    );
    expect(mixed.phases).toEqual([expect.objectContaining({ title: '验证', criteriaIds: ['required'] })]);

    const progressed = attachCriteriaToActivePhase(narrative, ['existing'], 2574);
    expect(reconcileMissionPlanWithFrozenContract(progressed, [{ id: 'new', required: true }], true, 2575)).toBe(
      progressed,
    );
  });

  it('extends only an untouched reconciled proof frontier with later required criteria', () => {
    const narrative = refineMissionPlanFromInstruction('打开；验证；输出', 2580);
    const reconciled = reconcileMissionPlanWithFrozenContract(narrative, [{ id: 'url', required: true }], true, 2581);
    const extended = extendReconciledMissionProof(reconciled, ['url', 'text'], 2582);
    expect(extended.phases[0]?.criteriaIds).toEqual(['url', 'text']);

    const progressed = applyPassedCriteriaToMissionPlan(reconciled, ['url'], 2583);
    expect(extendReconciledMissionProof(progressed, ['late'], 2584)).toBe(progressed);
  });

  it('never assigns unowned evidence or closes a non-delivery phase from a final digest', () => {
    let plan = refineMissionPlanFromInstruction('调研；验证', 2600);
    plan = attachCriteriaAcrossMissionPlan(plan, ['c1', 'c2'], 2601);
    plan = applyPassedCriteriaToMissionPlan(plan, ['unowned'], 2602);
    expect(plan.phases.map(p => p.evidenceIds)).toEqual([[], []]);
    expect(plan.phases.map(p => p.status)).toEqual(['active', 'planned']);

    plan = applyFinalDeliverableToMissionPlan(plan, 'deliverable:d1', 2603);
    expect(plan.phases.map(p => p.status)).toEqual(['active', 'planned']);
    expect(plan.phases.map(p => p.evidenceIds)).toEqual([[], []]);
  });

  it('does not let a final digest skip an earlier evidence-free phase', () => {
    let plan = refineMissionPlanFromInstruction('调研；验证；输出', 2700);
    plan = markActivePhase(plan, 2, 2701);
    plan = applyFinalDeliverableToMissionPlan(plan, 'deliverable:d1', 2702);
    expect(plan.phases.map(p => p.status)).toEqual(['planned', 'planned', 'active']);
    expect(plan.phases[2]?.evidenceIds).toEqual([]);
  });

  it('preserves blocked phases when later evidence arrives', () => {
    let plan = refineMissionPlanFromInstruction('调研；验证；输出', 2750);
    plan = attachCriteriaAcrossMissionPlan(plan, ['c1', 'c2'], 2751);
    plan.phases[1] = { ...plan.phases[1]!, status: 'blocked' };
    plan = applyPassedCriteriaToMissionPlan(plan, ['c1', 'c2'], 2752);
    expect(plan.phases.map(p => p.status)).toEqual(['done', 'blocked', 'planned']);
    expect(plan.phases[1]?.evidenceIds).toEqual([]);
  });

  it('restores one criterion owner and drops future-phase prefills', () => {
    const restored = restoreMissionPlan({
      id: 'mission-corrupt',
      goal: '调研并输出',
      createdAt: 1,
      updatedAt: 2,
      phases: [
        {
          id: 'phase-1',
          title: '调研',
          status: 'active',
          criteriaIds: ['c1'],
          evidenceIds: [],
          notes: [],
        },
        {
          id: 'phase-2',
          title: '输出',
          status: 'done',
          criteriaIds: ['c1', 'c2'],
          evidenceIds: ['c1', 'c2'],
          notes: [],
        },
      ],
    });
    expect(restored?.phases.map(phase => phase.criteriaIds)).toEqual([['c1'], ['c2']]);
    expect(restored?.phases.map(phase => phase.status)).toEqual(['active', 'planned']);
    expect(restored?.phases.map(phase => phase.evidenceIds)).toEqual([[], []]);
  });
});
