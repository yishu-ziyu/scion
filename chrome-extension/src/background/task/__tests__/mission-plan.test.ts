import { describe, expect, it } from 'vitest';
import {
  advanceMissionPhase,
  applyFinalDeliverableToMissionPlan,
  applyPassedCriteriaToMissionPlan,
  applySinglePhaseEvidence,
  attachCriteriaAcrossMissionPlan,
  attachCriteriaToActivePhase,
  buildMissionPlan,
  buildMissionPlanFromPhaseTitles,
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
  it('does not invent phases from verbs or semicolons', () => {
    const instruction = '调研 10 家竞品；输出对比表；写一份结论';
    expect(countMissionPhases(instruction)).toBe(1);

    const plan = refineMissionPlanFromInstruction(instruction, 1700);
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({ id: 'phase-1', title: '执行', status: 'active' });
    expect(plan.goal).toBe('执行任务');
    const json = JSON.stringify(plan);
    expect(json).not.toContain('竞品');
    expect(json).not.toContain(instruction);
    expect(json).not.toContain('对比表');
  });

  it('keeps a current-page read as one execute phase', () => {
    const plan = refineMissionPlanFromInstruction(
      '阅读当前飞书页面，用一句中文概括核心主题，并引用一个正文中可见的细节；不要修改页面。',
      1750,
    );
    expect(plan.goal).toBe('执行任务');
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]?.title).toBe('执行');
    expect(JSON.stringify(plan)).not.toContain('飞书');
    expect(JSON.stringify(plan)).not.toContain('核心主题');
  });

  it('keeps buildMissionPlan as generic 阶段 N skeleton', () => {
    const plan = buildMissionPlan('调研 10 家竞品；输出对比表；写一份结论', 1700);
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]?.title).toBe('阶段 1');
    expect(JSON.stringify(plan)).not.toContain('竞品');
  });

  it('uses numbered steps the user wrote, without verb labels', () => {
    const instruction =
      '这是一个多阶段任务：1) 进入英文维基；2) 搜索并打开 Artificial intelligence 条目；3) 在回复中写出当前页标题';
    const plan = refineMissionPlanFromInstruction(instruction, 1900);
    expect(plan.phases).toHaveLength(3);
    expect(plan.phases.map(phase => phase.title)).toEqual(['阶段 1', '阶段 2', '阶段 3']);
    expect(JSON.stringify(plan)).not.toContain('Artificial intelligence');
    expect(JSON.stringify(plan)).not.toContain('这是一个多阶段');
  });

  it('caps numbered phases and keeps a single-phase mission valid', () => {
    const many = Array.from({ length: 20 }, (_, index) => `${index + 1}) 任务`).join(' ');
    expect(countMissionPhases(many)).toBe(12);
    const single = refineMissionPlanFromInstruction('打开 YouTube', 1800);
    expect(single.phases).toHaveLength(1);
    expect(single.phases[0]?.status).toBe('active');
    expect(single.phases[0]?.title).toBe('执行');
    expect(single.createdAt).toBe(1800);
    expect(single.updatedAt).toBe(1800);
  });

  it('treats a trailing success clause as part of one execute phase', () => {
    const plan = refineMissionPlanFromInstruction('submit; success is Saved successfully.', 1850);
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({ title: '执行', status: 'active' });
    expect(JSON.stringify(plan)).not.toContain('Saved successfully');
  });

  it('strips emails and long tokens and never stores them on the plan', () => {
    const instruction = '调研 alice@example.com 的竞品；输出 sk-abc1234567890xyzSECRET 报告；验证结果';
    const plan = refineMissionPlanFromInstruction(instruction, 1900);
    const json = JSON.stringify(plan);
    expect(json).not.toContain('alice@example.com');
    expect(json).not.toContain('sk-abc1234567890xyzSECRET');
    expect(json).not.toContain('竞品');
    expect(plan.phases.map(p => p.title)).toEqual(['执行']);
    expect(sanitizePlanText('contact me@x.com now')).not.toContain('@');
  });

  it('advances a phase and demotes previous active when marking active', () => {
    let plan = buildMissionPlanFromPhaseTitles(['调研', '输出', '验证'], 2000);
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
    let plan = buildMissionPlanFromPhaseTitles(['调研', '输出', '验证'], 2100);
    plan = advanceMissionPhase(plan, 'phase-1', 'done', 2101);
    plan = markActivePhase(plan, 1, 2102);

    const checkpoint = serializeMissionCheckpoint(plan);
    expect(checkpoint.v).toBe(1);
    expect(JSON.stringify(checkpoint)).not.toContain('调研；输出');
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
    let plan = buildMissionPlanFromPhaseTitles(['调研', '输出', '验证'], 2200);
    plan = advanceMissionPhase(plan, 'phase-1', 'done', 2201);
    plan = markActivePhase(plan, 1, 2202);
    const text = renderMissionPlanForAgent(plan);
    expect(text).toContain('Mission: 执行任务');
    expect(text).toContain('Progress: 1/3 done; active=输出');
    expect(text).toContain('[x] 1. 调研');
    expect(text).toContain('[>] 2. 输出');
    expect(text).toContain('[ ] 3. 验证');
  });

  it('derivePhaseTitle is a generic index label', () => {
    expect(derivePhaseTitle('', 0)).toBe('阶段 1');
    expect(derivePhaseTitle('user@evil.com', 2)).toBe('阶段 3');
    expect(derivePhaseTitle('离开 example.com', 0)).toBe('阶段 1');
    expect(derivePhaseTitle('阅读当前产品列表页', 1)).toBe('阶段 2');
  });

  it('attaches criteria to the active phase only when empty', () => {
    let plan = buildMissionPlanFromPhaseTitles(['调研', '输出', '验证'], 2300);
    plan = attachCriteriaToActivePhase(plan, ['c1', 'c2'], 2301);
    expect(plan.phases[0]?.criteriaIds).toEqual(['c1', 'c2']);
    expect(plan.phases[1]?.criteriaIds).toEqual([]);
    plan = attachCriteriaToActivePhase(plan, ['c3'], 2302);
    expect(plan.phases[0]?.criteriaIds).toEqual(['c1', 'c2']);
    expect(plan.updatedAt).toBe(2301);
  });

  it('advances active phase when all its criteria have passed evidence', () => {
    let plan = buildMissionPlanFromPhaseTitles(['调研', '输出', '验证'], 2400);
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

  it('does not rewrite a plan into 验证/输出', () => {
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
    expect(proofOnly.phases.map(phase => phase.title)).toEqual(['执行']);
    expect(proofOnly.phases[0]?.criteriaIds).toEqual(['url', 'text']);

    const withDelivery = reconcileMissionPlanWithFrozenContract(
      narrative,
      [{ id: 'page', required: true }],
      true,
      2552,
    );
    expect(withDelivery.phases.map(phase => phase.title)).toEqual(['执行']);
    expect(withDelivery.phases).toHaveLength(1);
  });

  it('does not reconcile optional or already-progressed criteria ownership', () => {
    const narrative = buildMissionPlanFromPhaseTitles(['调研', '验证', '输出'], 2570);
    expect(reconcileMissionPlanWithFrozenContract(narrative, [], true, 2571)).toBe(narrative);
    expect(reconcileMissionPlanWithFrozenContract(narrative, [{ id: 'optional', required: false }], true, 2572)).toBe(
      narrative,
    );
    const progressed = attachCriteriaToActivePhase(narrative, ['existing'], 2574);
    expect(reconcileMissionPlanWithFrozenContract(progressed, [{ id: 'new', required: true }], true, 2575)).toBe(
      progressed,
    );
  });

  it('extends the active phase without inventing a 验证 frontier', () => {
    const narrative = buildMissionPlanFromPhaseTitles(['打开', '验证', '输出'], 2580);
    const reconciled = reconcileMissionPlanWithFrozenContract(narrative, [{ id: 'url', required: true }], true, 2581);
    const extended = extendReconciledMissionProof(reconciled, ['url', 'text'], 2582);
    expect(extended.phases.map(phase => phase.title)).toEqual(['打开', '验证', '输出']);
    expect(extended.phases[0]?.criteriaIds).toEqual(['url', 'text']);
  });

  it('closes a single execute phase with a written deliverable', () => {
    let plan = refineMissionPlanFromInstruction('读当前页，一句主题，引用一处正文', 2800);
    plan = applyFinalDeliverableToMissionPlan(plan, 'deliverable:abc', 2801);
    expect(plan.phases).toHaveLength(1);
    expect(plan.phases[0]).toMatchObject({
      title: '执行',
      status: 'done',
      criteriaIds: ['deliverable:abc'],
      evidenceIds: ['deliverable:abc'],
    });
  });

  it('never assigns unowned evidence or closes a non-delivery phase from a final digest', () => {
    let plan = buildMissionPlanFromPhaseTitles(['调研', '验证'], 2600);
    plan = attachCriteriaAcrossMissionPlan(plan, ['c1', 'c2'], 2601);
    plan = applyPassedCriteriaToMissionPlan(plan, ['unowned'], 2602);
    expect(plan.phases.map(p => p.evidenceIds)).toEqual([[], []]);
    expect(plan.phases.map(p => p.status)).toEqual(['active', 'planned']);

    plan = applyFinalDeliverableToMissionPlan(plan, 'deliverable:d1', 2603);
    expect(plan.phases.map(p => p.status)).toEqual(['active', 'planned']);
    expect(plan.phases.map(p => p.evidenceIds)).toEqual([[], []]);
  });

  it('does not let a final digest skip an earlier evidence-free phase', () => {
    let plan = buildMissionPlanFromPhaseTitles(['调研', '验证', '输出'], 2700);
    plan = markActivePhase(plan, 2, 2701);
    plan = applyFinalDeliverableToMissionPlan(plan, 'deliverable:d1', 2702);
    expect(plan.phases.map(p => p.status)).toEqual(['planned', 'planned', 'active']);
    expect(plan.phases[2]?.evidenceIds).toEqual([]);
  });

  it('preserves blocked phases when later evidence arrives', () => {
    let plan = buildMissionPlanFromPhaseTitles(['调研', '验证', '输出'], 2750);
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
