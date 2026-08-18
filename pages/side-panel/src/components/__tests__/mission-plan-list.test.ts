import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProgressMilestone, TaskProgressView } from '../../presentation/task-progress-view';
import { MissionPlanList, missionPlanItemStatus } from '../MissionPlanList';
import { healthAnnouncement, healthLabel, TaskProgressOverview } from '../TaskProgressOverview';
import { ThinkingReasoning } from '../ThinkingReasoning';

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

  it('does not promote unfinished stages from a generic completed status', () => {
    expect(missionPlanItemStatus('done', 'completed')).toBe('done');
    expect(missionPlanItemStatus('active', 'completed')).toBe('planned');
    expect(missionPlanItemStatus('planned', 'completed')).toBe('planned');
    expect(missionPlanItemStatus('blocked', 'completed')).toBe('blocked');
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
    expect(html).toContain('aria-controls=');
    expect(html).toContain('aria-hidden="false"');
    expect(html).toContain('aria-label="任务计划，3 个里程碑，当前已展开，按下收起"');
    // No durable gates → count is milestone total, not a fake done/total phase ratio pie.
    expect(html).toContain('data-durable-progress="false"');
    expect(html).toContain('aria-label="3"');
    expect(html).toContain('里程碑');
    expect(html).not.toContain('aria-label="1/3"');
    expect(html).toContain('data-status="done"');
    expect(html).toContain('data-status="active"');
    expect(html).toContain('data-status="planned"');
    expect(html).toContain('状态：已完成');
    expect(html).toContain('状态：进行中');
    expect(html).toContain('状态：待开始');
    expect(html).toContain('正在读取当前页面');
  });

  it('shows durable gate ratio and pie only when milestones have real targets', () => {
    const html = renderToStaticMarkup(
      createElement(MissionPlanList, {
        milestones: [
          milestone('done', 'done', {
            gates: [{ id: 'g1', label: '合格讨论', status: 'passed', current: 80, target: 80 }],
          }),
          milestone('active', 'active', {
            gates: [{ id: 'g2', label: '竞品', status: 'active', current: 10, target: 20 }],
          }),
        ],
        status: 'working',
        durableProgress: true,
      }),
    );

    expect(html).toContain('data-durable-progress="true"');
    expect(html).toContain('aria-label="1/2"');
    expect(html).toContain('阶段');
    expect(html).toContain('chijie-plan-head-pie');
  });

  it.each([
    ['paused', 'paused', '已暂停'],
    ['needs_user', 'waiting_user', '等待你'],
    ['failed', 'failed', '未完成'],
  ] as const)(
    'projects active work into the %s task state without stale running motion',
    (taskStatus, itemStatus, label) => {
      const html = renderPlan([milestone('current', 'active', { summary: '当前阶段' })], taskStatus);

      expect(html).toContain(`data-status="${itemStatus}"`);
      expect(html).toContain(label);
      expect(html).not.toContain('data-status="active"');
    },
  );

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

  it('announces a passed gate even when it has no numeric target', () => {
    const html = renderPlan(
      [milestone('verified', 'done', { gates: [{ id: 'proof', label: '页面证据', status: 'passed' }] })],
      'working',
    );

    expect(html).toContain('页面证据');
    expect(html).toContain('已达标');
  });

  it('keeps evidence-backed phase states after a generic completion signal', () => {
    const html = renderPlan(
      [milestone('done', 'done'), milestone('current', 'active'), milestone('next', 'planned')],
      'completed',
    );

    expect(html).toContain('aria-label="3"');
    expect(html).toContain('data-durable-progress="false"');
    expect(html.match(/data-status="done"/g)).toHaveLength(1);
    expect(html).not.toContain('data-status="active"');
    expect(html.match(/data-status="planned"/g)).toHaveLength(2);
  });

  it.each(['failed', 'needs_user'] as const)(
    'does not present an all-done phase list as task completion while the task is %s',
    taskStatus => {
      const html = renderToStaticMarkup(
        createElement(MissionPlanList, {
          milestones: [
            milestone('done', 'done', {
              gates: [{ id: 'proof', label: '页面证据', status: 'passed', current: 1, target: 1 }],
            }),
          ],
          status: taskStatus,
          durableProgress: true,
        }),
      );

      expect(html).toContain('aria-label="1/1"');
      expect(html).toContain('data-testid="mission-plan-task-state"');
      expect(html).toContain('任务未交付');
      expect(html).toContain(
        taskStatus === 'failed'
          ? 'aria-label="任务计划，1/1 阶段，任务未交付，当前已收起，按下展开"'
          : 'aria-label="任务计划，1/1 阶段，任务未交付，当前已展开，按下收起"',
      );
      expect(html).not.toContain('chijie-plan-head-check');
      expect(html).toContain('chijie-plan-head-state');
      if (taskStatus === 'failed') {
        expect(html).not.toContain('已达标');
        expect(html).toContain('aria-expanded="false"');
      }
    },
  );

  it.each(['planning', 'working', 'verifying', 'delivering', 'paused', 'needs_user', 'completed', 'failed'] as const)(
    'never turns a partial Gate vector into a green completed plan while task status is %s',
    taskStatus => {
      const html = renderToStaticMarkup(
        createElement(MissionPlanList, {
          milestones: [
            milestone('done', 'done', {
              gates: [{ id: 'source', label: '来源已访问', status: 'passed', current: 1, target: 1 }],
            }),
            milestone('current', 'active', {
              gates: [
                { id: 'quote', label: '引文已核对', status: 'passed', current: 1, target: 1 },
                { id: 'delivery', label: '交付已验证', status: 'active', current: 0, target: 1 },
              ],
            }),
          ],
          status: taskStatus,
          durableProgress: true,
        }),
      );

      expect(html).toContain('aria-label="1/2"');
      expect(html).not.toContain('chijie-plan-head-check');
      if (taskStatus !== 'completed') expect(html).toContain('交付已验证');
      expect(html).not.toContain('aria-label="任务计划，2/2 阶段');
    },
  );

  it.each(['planning', 'working', 'verifying', 'delivering', 'paused', 'needs_user', 'failed'] as const)(
    'keeps an all-passed Gate vector explicitly undelivered while task status is %s',
    taskStatus => {
      const html = renderToStaticMarkup(
        createElement(MissionPlanList, {
          milestones: [
            milestone('done', 'done', {
              gates: [{ id: 'proof', label: '页面证据', status: 'passed', current: 1, target: 1 }],
            }),
          ],
          status: taskStatus,
          durableProgress: true,
        }),
      );

      expect(html).toContain('任务未交付');
      expect(html).not.toContain('chijie-plan-head-check');
    },
  );
});

describe('TaskProgressOverview mission-plan integration', () => {
  it('surfaces a blocked milestone as an alert instead of silently hiding the recovery path', () => {
    const view: TaskProgressView = {
      kind: 'generic',
      mission: { title: '描述当前页面', deliverable: '给出页面摘要' },
      status: 'working',
      health: { state: 'advancing', summary: '正常推进' },
      milestones: [milestone('blocked', 'blocked', { summary: '页面暂不可读' })],
      findings: [],
      artifacts: [],
      nextStep: '重新读取页面',
      updatedAt: 1,
    };

    const html = renderToStaticMarkup(createElement(TaskProgressOverview, { view, now: 1 }));

    expect(html).toContain('data-testid="mission-plan"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('当前阶段遇到阻塞');
    expect(html).toContain('data-testid="task-progress-health"');
  });

  it('keeps interrupted recovery controls and a mutual-exclusion health line', () => {
    const view: TaskProgressView = {
      kind: 'generic',
      mission: { title: '描述当前页面', deliverable: '给出页面摘要' },
      status: 'paused',
      health: { state: 'paused', summary: '已暂停', lastMeaningfulProgressAt: 1 },
      milestones: [milestone('current', 'active')],
      findings: [],
      artifacts: [],
      nextStep: '继续完成“描述当前页面”',
      updatedAt: 1,
    };

    const controls = createElement('div', { 'data-testid': 'interrupted-controls' }, '继续任务');
    const html = renderToStaticMarkup(
      createElement(TaskProgressOverview, { view, now: 1, interrupted: true, controls }),
    );

    expect(html).toContain('data-testid="task-interrupted-status"');
    expect(html).toContain('任务已中断，进度已经保存');
    expect(html).toContain('data-testid="task-interrupted-last-progress"');
    expect(html).toContain('最后进展 刚刚');
    expect(html).toContain('data-testid="task-interrupted-next-step"');
    expect(html).toContain('继续后：继续完成“描述当前页面”');
    expect(html).not.toContain('可以从「阶段 current」继续');
    expect(html).toContain('data-testid="interrupted-controls"');
    expect(html).toContain('data-testid="task-progress-health"');
    expect(html).toContain('data-health="paused"');
    expect(html).toContain('已暂停');
    // Now line is running-only; paused recovery must not fake live activity.
    expect(html).not.toContain('data-testid="task-progress-current-activity"');
    expect(html).not.toContain('思考中');
  });

  it('renders the Now line when currentActivity is present', () => {
    const view: TaskProgressView = {
      kind: 'generic',
      mission: { title: '描述当前页面', deliverable: '给出页面摘要' },
      status: 'working',
      health: { state: 'advancing', summary: '正常推进' },
      currentActivity: {
        summary: '打开 Zotero 官网',
        purpose: '服务于「用户研究」',
        site: 'zotero.org',
        startedAt: 1,
      },
      milestones: [milestone('research', 'active')],
      findings: [],
      artifacts: [],
      nextStep: '继续收集证据',
      updatedAt: 1,
    };

    const html = renderToStaticMarkup(createElement(TaskProgressOverview, { view, now: 1 }));

    expect(html).toContain('data-testid="task-progress-current-activity"');
    expect(html).toContain('data-testid="task-now-summary"');
    expect(html).toContain('打开 Zotero 官网');
    expect(html).toContain('服务于「用户研究」');
    expect(html).toContain('zotero.org');
    expect(html).toContain('data-testid="task-progress-health"');
  });

  it('announces semantic health without coupling to the relative-time tick', () => {
    const health = { state: 'advancing' as const, summary: '正常推进', lastMeaningfulProgressAt: 1 };

    expect(healthAnnouncement(health)).toBe('运行状态：正常推进');
    expect(healthAnnouncement({ state: 'failed', summary: '失败了，没有可交付结果' })).toBe(
      '结果：失败了，没有可交付结果',
    );
    expect(healthLabel('failed')).toBe('结果');
    expect(healthLabel('advancing')).toBe('运行');
  });

  it('renders a failed health line as a result, not live running copy', () => {
    const view: TaskProgressView = {
      kind: 'generic',
      mission: { title: '阅读当前页面', deliverable: '一句主题概括，并引用一处可核对的正文细节' },
      status: 'failed',
      health: { state: 'failed', summary: '失败了，没有可交付结果' },
      milestones: [
        milestone('verify', 'done', {
          title: '验证',
          gates: [{ id: 'proof', label: '验收条件', status: 'passed', current: 2, target: 2 }],
        }),
        milestone('output', 'active', { title: '输出', summary: '当前阶段' }),
      ],
      findings: [],
      artifacts: [],
      nextStep: '没有完成交付',
      updatedAt: 1,
    };

    const html = renderToStaticMarkup(createElement(TaskProgressOverview, { view, now: 1 }));

    expect(html).toContain('data-health="failed"');
    expect(html).toContain('失败了，没有可交付结果');
    expect(html).toContain('>结果<');
    expect(html).not.toContain('>运行<');
    expect(html).not.toContain('已达标');
    expect(html).not.toContain('请查看缺口后继续或调整方向');
  });

  it('hides the plan list on a short-task result surface', () => {
    const view: TaskProgressView = {
      kind: 'generic',
      surface: 'result',
      mission: { title: '读当前页，一句主题', deliverable: '完成委托并提供可检查的结果' },
      status: 'working',
      health: { state: 'advancing', summary: '当前动作正在等待页面反馈' },
      currentActivity: {
        summary: '正在读当前页',
        purpose: '推进当前任务',
        site: 'evermind.ai',
        startedAt: 1,
      },
      milestones: [milestone('execute', 'active', { title: '执行' })],
      findings: [],
      artifacts: [],
      nextStep: '继续推进当前任务',
      updatedAt: 1,
    };

    const html = renderToStaticMarkup(createElement(TaskProgressOverview, { view, now: 1 }));

    expect(html).toContain('data-surface="result"');
    expect(html).toContain('读当前页，一句主题');
    expect(html).toContain('正在读当前页');
    expect(html).toContain('推进当前任务');
    expect(html).not.toContain('data-testid="mission-plan"');
    expect(html).not.toContain('完成委托并提供可检查的结果');
    expect(html).not.toContain('已验证任务回执');
  });
});

describe('ThinkingReasoning rendered contract', () => {
  const items = [
    { id: 'attempt-1', text: '打开 Zotero 官网' },
    { id: 'attempt-2', text: '读取当前页面' },
  ];

  it('keeps the audit stream collapsible while running (no forced live chrome)', () => {
    const html = renderToStaticMarkup(createElement(ThinkingReasoning, { items, running: true, elapsed: '12s' }));

    expect(html).toContain('data-testid="task-thinking-reasoning"');
    expect(html).toContain('data-running="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('处理过程');
    expect(html).toContain('工作时长 12s');
    expect(html).not.toContain('思考中');
    expect(html).not.toContain('is-shimmer');
    expect(html).toContain('打开 Zotero 官网');
    expect(html).toContain('读取当前页面');
    expect(html).toContain('is-collapsed');
    expect(html).toContain('aria-hidden="true"');
  });

  it('folds completed work into an elapsed summary by default', () => {
    const html = renderToStaticMarkup(createElement(ThinkingReasoning, { items, running: false, elapsed: '1m 08s' }));

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('工作了');
    expect(html).toContain('1m 08s');
    expect(html).toContain('is-collapsed');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('思考中…');
  });

  it('renders nothing for an idle task without public action summaries', () => {
    const html = renderToStaticMarkup(createElement(ThinkingReasoning, { items: [], running: false, elapsed: '0s' }));

    expect(html).toBe('');
  });
});
