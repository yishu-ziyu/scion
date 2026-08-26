import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProgressMilestone, TaskProgressView } from '../../presentation/task-progress-view';
import { healthAnnouncement, healthLabel, TaskProgressOverview } from '../TaskProgressOverview';

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

    expect(html).not.toContain('data-testid="mission-plan"');
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

  it('only paints process when the card passes a fold as nowBody', () => {
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

    const withoutFold = renderToStaticMarkup(createElement(TaskProgressOverview, { view, now: 1 }));
    expect(withoutFold).not.toContain('data-testid="task-progress-current-activity"');
    expect(withoutFold).not.toContain('打开 Zotero 官网');
    expect(withoutFold).not.toContain('服务于「用户研究」');

    const html = renderToStaticMarkup(
      createElement(TaskProgressOverview, {
        view,
        now: 1,
        nowBody: createElement(
          'details',
          { 'data-testid': 'task-process-disclosure', 'data-live': 'true' },
          createElement(
            'summary',
            { 'data-testid': 'task-now-line' },
            createElement('span', { 'data-testid': 'task-now-summary' }, '打开 Zotero 官网'),
            createElement('span', { 'data-testid': 'task-now-site' }, ' · zotero.org'),
          ),
        ),
      }),
    );

    expect(html).toContain('data-testid="task-progress-current-activity"');
    expect(html).toContain('data-testid="task-now-summary"');
    expect(html).toContain('打开 Zotero 官网');
    expect(html).toContain('zotero.org');
    expect(html).not.toContain('服务于「用户研究」');
    expect(html).toContain('data-testid="task-progress-health"');
    expect(html).toContain('data-quiet="true"');
    expect(html).toContain('描述当前页面');
    expect(html).not.toContain('>目标<');
    expect(html).not.toContain('做完会出现在这里');
  });

  it('renders a direction change as a system note, not a user bubble', () => {
    const view: TaskProgressView = {
      kind: 'generic',
      mission: { title: '读当前页', deliverable: '一句摘要' },
      directionChange: { summary: '用户已调整任务方向，新要求已进入后续执行', occurredAt: 1 },
      status: 'working',
      health: { state: 'advancing', summary: '正常推进' },
      milestones: [],
      findings: [],
      artifacts: [],
      nextStep: '继续推进当前任务',
      updatedAt: 1,
    };
    const html = renderToStaticMarkup(createElement(TaskProgressOverview, { view, now: 1 }));
    expect(html).toContain('data-testid="task-direction-change"');
    expect(html).toContain('chijie-system-note');
    expect(html).not.toMatch(/task-direction-change[^>]*chijie-user-bubble/);
  });

  it('announces semantic health without coupling to the relative-time tick', () => {
    const health = { state: 'advancing' as const, summary: '正常推进', lastMeaningfulProgressAt: 1 };

    expect(healthAnnouncement(health)).toBe('正常推进');
    expect(healthAnnouncement({ state: 'failed', summary: '没做成' })).toBe('没做成');
    expect(healthLabel('failed')).toBe('');
    expect(healthLabel('advancing')).toBe('');
  });

  it('renders a failed health line as a result, not live running copy', () => {
    const view: TaskProgressView = {
      kind: 'generic',
      mission: { title: '阅读当前页面', deliverable: '一句主题概括，并引用一处可核对的正文细节' },
      status: 'failed',
      health: { state: 'failed', summary: '没做成' },
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
    expect(html).toContain('没做成');
    expect(html).not.toContain('>结果<');

    const withResult = renderToStaticMarkup(
      createElement(TaskProgressOverview, {
        view,
        now: 1,
        result: createElement('p', { 'data-testid': 'completion-result' }, '试了几轮，还是没做成。'),
        nowBody: createElement('div', { 'data-testid': 'task-now-trace' }, '打开的页'),
      }),
    );
    expect(withResult).toContain('data-testid="completion-result"');
    expect(withResult.indexOf('data-testid="completion-result"')).toBeLessThan(
      withResult.indexOf('data-testid="task-progress-current-activity"'),
    );
    expect(withResult).toContain('hidden');
    expect(withResult).not.toContain('>现在<');
    expect(withResult).not.toContain('>结果<');
    expect(withResult).not.toContain('做过');
    expect(withResult).not.toContain('本次任务完成得怎么样');
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
    expect(html).not.toContain('正在读当前页');
    expect(html).not.toContain('推进当前任务');
    expect(html).not.toContain('data-testid="mission-plan"');
    expect(html).not.toContain('完成委托并提供可检查的结果');
    expect(html).not.toContain('已验证任务回执');
    expect(html).not.toContain('>目标<');
    expect(html).not.toContain('>现在<');
    expect(html).not.toContain('做完会出现在这里');
    expect(html).not.toContain('data-testid="task-result-block"');
  });
});
