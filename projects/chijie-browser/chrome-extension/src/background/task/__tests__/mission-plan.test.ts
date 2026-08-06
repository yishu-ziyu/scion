import { describe, expect, it } from 'vitest';
import {
  advanceMissionPhase,
  applyPassedCriteriaToMissionPlan,
  attachCriteriaToActivePhase,
  buildMissionPlan,
  countMissionPhases,
  derivePhaseTitle,
  markActivePhase,
  markRemainingPhasesDone,
  maybeAdvancePhaseByAttemptHeuristic,
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
    expect(plan.goal).toBe('User task');

    const json = JSON.stringify(plan);
    expect(json).not.toContain('竞品');
    expect(json).not.toContain(instruction);
    expect(json).not.toContain('对比表');
    // Phase label may be 总结; raw segment "写一份结论" must not leak.
    expect(json).not.toContain('写一份结论');
    expect(json).not.toContain('结论');
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

  it('strips emails and long tokens from titles and never stores them on the plan', () => {
    const instruction =
      '调研 alice@example.com 的竞品；输出 sk-abc1234567890xyzSECRET 报告；验证结果';
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

  it('serializes a JSON-safe checkpoint and restores progress', () => {
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
      { title: '调研', status: 'done' },
      { title: '输出', status: 'active' },
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
    expect(text).toContain('Mission: User task');
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

  it('advances multi-phase missions by successful attempt count when no criteria bound', () => {
    let plan = refineMissionPlanFromInstruction('调研；输出；验证', 2500);
    plan = maybeAdvancePhaseByAttemptHeuristic(plan, 1, 2501);
    expect(plan.phases.map(p => p.status)).toEqual(['done', 'active', 'planned']);

    plan = maybeAdvancePhaseByAttemptHeuristic(plan, 2, 2502);
    expect(plan.phases.map(p => p.status)).toEqual(['done', 'done', 'active']);

    // Never auto-closes the last phase
    plan = maybeAdvancePhaseByAttemptHeuristic(plan, 99, 2503);
    expect(plan.phases.map(p => p.status)).toEqual(['done', 'done', 'active']);
  });

  it('does not use attempt heuristic when active phase has criteria', () => {
    let plan = refineMissionPlanFromInstruction('调研；输出；验证', 2600);
    plan = attachCriteriaToActivePhase(plan, ['c1'], 2601);
    plan = maybeAdvancePhaseByAttemptHeuristic(plan, 5, 2602);
    expect(plan.phases.map(p => p.status)).toEqual(['active', 'planned', 'planned']);
  });

  it('marks remaining phases done while preserving intermediate done state', () => {
    let plan = refineMissionPlanFromInstruction('调研；输出；验证', 2700);
    plan = advanceMissionPhase(plan, 'phase-1', 'done', 2701);
    plan = markActivePhase(plan, 1, 2702);
    plan.phases[0] = { ...plan.phases[0]!, criteriaIds: ['c1'], evidenceIds: ['c1'] };
    plan = markRemainingPhasesDone(plan, 2703);
    expect(plan.phases.map(p => p.status)).toEqual(['done', 'done', 'done']);
    expect(plan.phases[0]?.criteriaIds).toEqual(['c1']);
    expect(plan.phases[0]?.evidenceIds).toEqual(['c1']);
  });
});
