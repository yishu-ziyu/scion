import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProgressMilestone, TaskProgressView } from '../../presentation/task-progress-view';
import { MissionPlanList, missionPlanItemStatus } from '../MissionPlanList';
import { TaskProgressOverview } from '../TaskProgressOverview';

function milestone(
  id: string,
  status: ProgressMilestone['status'],
  options: Partial<ProgressMilestone> = {},
): ProgressMilestone {
  return {
    id,
    title: options.title ?? `阶段 ${id}`,
    status,
    summary: options.summary,
    gates: options.gates ?? [],
  };
}

function renderPlan(milestones: ProgressMilestone[], status: TaskProgressView['status']): string {
  return renderToStaticMarkup(createElement(MissionPlanList, { milestones, status }));
}

describe('missionPlanItemStatus', () => {
  it('preserves durable completed, planned, and blocked phase states', () => {
    expect(missionPlanItemStatus('done', 'paused')).toBe('done');
    expect(missionPlanItemStatus('planned', 'failed')).toBe('planned');
    expect(missionPlanItemStatus('blocked', 'working')).toBe('blocked');
  });

  it('projects an active phase as running only while the task is active', () => {
    expect(missionPlanItemStatus('active', 'planning')).toBe('active');
    expect(missionPlanItemStatus('active', 'working')).toBe('active');
    expect(missionPlanItemStatus('active', 'verifying')).toBe('active');
    expect(missionPlanItemStatus('active', 'delivering')).toBe('active');
  });

  it('never presents stale active motion while paused, waiting for the user, or failed', () => {
    expect(missionPlanItemStatus('active', 'paused')).toBe('paused');
    expect(missionPlanItemStatus('active', 'needs_user')).toBe('waiting_user');
    expect(missionPlanItemStatus('active', 'failed')).toBe('failed');
  });

  it('renders every stage as done after verified task completion', () => {
    expect(missionPlanItemStatus('active', 'completed')).toBe('done');
    expect(missionPlanItemStatus('planned', 'completed')).toBe('done');
    expect(missionPlanItemStatus('blocked', 'completed')).toBe('done');
  });
});

describe('MissionPlanList rendered contract', () => {
  it('renders truthful done, active, and planned stages with an accessible collapse control', () => {
    const html = renderPlan(
      [
        milestone('done', 'done'),
        milestone('active', 'active', { summary: '正在读取当前页面' }),
        milestone('planned', 'planned'),
      ],
      'working',
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="展开或收起任务计划"');
    expect(html).toContain('aria-label="1/3"');
    expect(html).toContain('data-status="done"');
    expect(html).toContain('data-status="active"');
    expect(html).toContain('data-status="planned"');
    expect(html).toContain('正在读取当前页面');
  });

  it.each([
    ['paused', 'paused', '已暂停'],
    ['needs_user', 'waiting_user', '等待你'],
    ['failed', 'failed', '未完成'],
  ] as const)('projects active work into the %s task state without stale running motion', (taskStatus, itemStatus, label) => {
    const html = renderPlan([milestone('current', 'active', { summary: '当前阶段' })], taskStatus);

    expect(html).toContain(`data-status="${itemStatus}"`);
    expect(html).toContain(label);
    expect(html).not.toContain('data-status="active"');
  });

  it('renders blocked stages and clamps gate progress at both boundaries', () => {
    const html = renderPlan(
      [
        milestone('blocked', 'blocked', {
          summary: '需要更换路径',
          gates: [
            { id: 'over', label: '超过目标', status: 'passed', current: 5, target: 2 },
            { id: 'under', label: '低于起点', status: 'blocked', current: -1, target: 2 },
          ],
        }),
      ],
      'working',
    );

    expect(html).toContain('data-status="blocked"');
    expect(html).toContain('受阻');
    expect(html).toContain('需要更换路径');
    expect(html).toContain('transform:scaleX(1)');
    expect(html).toContain('transform:scaleX(0)');
  });

  it('marks every stage done only after verified task completion', () => {
    const html = renderPlan([milestone('current', 'active'), milestone('next', 'planned')], 'completed');

    expect(html).toContain('aria-label="2/2"');
    expect(html.match(/data-status="done"/g)).toHaveLength(2);
    expect(html).not.toContain('data-status="active"');
    expect(html).not.toContain('data-status="planned"');
  });
});

describe('TaskProgressOverview mission-plan integration', () => {
  it('surfaces a blocked milestone as an alert instead of silently hiding the recovery path', () => {
    const view: TaskProgressView = {
      kind: 'generic',
      mission: { title: '描述当前页面', deliverable: '给出页面摘要' },
      status: 'working',
      milestones: [milestone('blocked', 'blocked', { summary: '页面暂不可读' })],
      health: { state: 'recovering', summary: '正在换一种方式' },
      findings: [],
      artifacts: [],
      nextStep: '重新读取页面',
      updatedAt: 1,
    };

    const html = renderToStaticMarkup(createElement(TaskProgressOverview, { view, now: 1 }));

    expect(html).toContain('data-testid="mission-plan"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('当前阶段遇到阻塞');
  });

  it('replaces the duplicated health and next-step cards with one compact interrupted surface', () => {
    const view: TaskProgressView = {
      kind: 'generic',
      mission: { title: '描述当前页面', deliverable: '给出页面摘要' },
      status: 'paused',
      milestones: [milestone('current', 'active')],
      health: { state: 'paused', summary: '运行已中断，检查点已经保存' },
      findings: [],
      artifacts: [],
      nextStep: '继续完成“描述当前页面”',
      updatedAt: 1,
    };

    const controls = createElement('div', { 'data-testid': 'interrupted-controls' }, '继续任务');
    const html = renderToStaticMarkup(createElement(TaskProgressOverview, { view, now: 1, interrupted: true, controls }));

    expect(html).toContain('data-testid="task-interrupted-status"');
    expect(html).toContain('任务已中断，进度已经保存');
    expect(html).toContain('可以从「阶段 current」继续');
    expect(html).toContain('data-testid="interrupted-controls"');
    expect(html).not.toContain('data-testid="task-progress-health"');
  });
});
