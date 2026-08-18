import type { ReactNode } from 'react';
import { FiActivity, FiExternalLink, FiFileText, FiPauseCircle } from 'react-icons/fi';
import type { ProgressHealthState, TaskProgressView } from '../presentation/task-progress-view';
import { MissionPlanList } from './MissionPlanList';

interface TaskProgressOverviewProps {
  view: TaskProgressView;
  now?: number;
  controls?: ReactNode;
  interrupted?: boolean;
  /** Verified or failed result body. Shown in the 结果 block. */
  result?: ReactNode;
  /** Live tool log. Replaces the one-line Now callout while the task is running. */
  nowBody?: ReactNode;
}

export function healthNeedsAttention(state: ProgressHealthState): boolean {
  return (
    state === 'needs_user' ||
    state === 'failed' ||
    state === 'stalled' ||
    state === 'paused' ||
    state === 'recovering'
  );
}

function relativeTime(timestamp: number | undefined, now: number): string | null {
  if (!timestamp) return null;
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (seconds < 10) return '刚刚';
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(timestamp).toLocaleDateString();
}

export function healthLabel(state: TaskProgressView['health']['state']): string {
  if (state === 'failed' || state === 'complete') return '结果';
  if (state === 'paused' || state === 'needs_user') return '状态';
  return '运行';
}

export function healthAnnouncement(health: TaskProgressView['health']): string {
  const prefix = healthLabel(health.state);
  return prefix === '运行' ? `运行状态：${health.summary}` : `${prefix}：${health.summary}`;
}

export function TaskProgressOverview({
  view,
  now = Date.now(),
  controls,
  interrupted = false,
  result,
  nowBody,
}: TaskProgressOverviewProps) {
  const blocked = view.milestones.find(milestone => milestone.status === 'blocked');
  const lastProgress = relativeTime(view.health.lastMeaningfulProgressAt, now);
  const isResultSurface = view.surface === 'result';
  const healthVisible = healthNeedsAttention(view.health.state);
  const hideDuplicateHealth =
    Boolean(result) && (view.health.state === 'failed' || view.health.state === 'complete');
  const hasDeliveredResult =
    Boolean(result) || view.findings.length > 0 || (!isResultSurface && view.artifacts.length > 0);
  const showPendingResult =
    !hasDeliveredResult &&
    !nowBody &&
    view.status !== 'failed' &&
    view.status !== 'completed' &&
    view.health.state !== 'failed' &&
    view.health.state !== 'complete';
  const failedAudit = view.status === 'failed';
  const nowKicker = failedAudit ? '做过' : '现在';
  const showNow = Boolean(nowBody || view.currentActivity);
  const nowSection = showNow ? (
    <section
      className="chijie-progress-now"
      data-testid="task-progress-current-activity"
      data-live-log={nowBody ? 'true' : undefined}
      data-audit={failedAudit ? 'true' : undefined}>
      {!(failedAudit && nowBody) && <span className="chijie-progress-kicker">{nowKicker}</span>}
      {view.currentActivity && (
        <>
          <strong
            data-testid="task-now-summary"
            className={nowBody ? 'chijie-visually-hidden' : undefined}>
            {view.currentActivity.summary}
          </strong>
          {view.currentActivity.site && (
            <span
              className={nowBody ? 'chijie-visually-hidden' : 'chijie-progress-now-site'}
              data-testid="task-now-site">
              {view.currentActivity.site}
            </span>
          )}
          <span
            data-testid="task-now-purpose"
            className={nowBody ? 'chijie-visually-hidden' : undefined}>
            {view.currentActivity.purpose}
          </span>
        </>
      )}
      {nowBody}
    </section>
  ) : null;

  return (
    <div
      className="chijie-progress-overview"
      data-kind={view.kind}
      data-surface={view.surface ?? 'console'}
      data-testid="task-progress-overview">
      <section className="chijie-progress-mission chijie-user-bubble" data-testid="task-goal-block">
        <p className="chijie-progress-kicker">目标</p>
        <h2 data-testid="task-goal-summary">{view.mission.title}</h2>
        {!isResultSurface && view.kind === 'research' && <p>{view.mission.deliverable}</p>}
      </section>

      {view.directionChange && (
        <section className="chijie-progress-direction-change" data-testid="task-direction-change">
          <FiActivity aria-hidden />
          <span>
            <strong>方向已调整</strong>
            <span>{view.directionChange.summary}</span>
          </span>
          <time>{relativeTime(view.directionChange.occurredAt, now)}</time>
        </section>
      )}

      {!isResultSurface && !failedAudit && view.milestones.length > 0 && (
        <MissionPlanList
          milestones={view.milestones}
          status={view.status}
          durableProgress={view.milestones.some(milestone =>
            milestone.gates.some(gate => gate.target !== undefined && gate.target > 0),
          )}
        />
      )}

      {!failedAudit && nowSection}

      <section
        className="chijie-progress-health"
        data-testid="task-progress-health"
        data-health={view.health.state}
        data-quiet={healthVisible && !hideDuplicateHealth ? undefined : 'true'}
        hidden={hideDuplicateHealth || undefined}>
        <span className="chijie-progress-health-label">{healthLabel(view.health.state)}</span>
        <strong className="chijie-progress-health-summary">{view.health.summary}</strong>
        {view.health.lastMeaningfulProgressAt ? (
          <time className="chijie-progress-health-time">
            最近进展 {relativeTime(view.health.lastMeaningfulProgressAt, now) ?? ''}
          </time>
        ) : null}
      </section>
      <span
        key={`${view.health.state}:${view.health.summary}`}
        className="chijie-visually-hidden"
        data-testid="task-health-announcer"
        role="status"
        aria-atomic="true">
        {healthAnnouncement(view.health)}
      </span>

      {interrupted ? (
        <section className="chijie-interrupted-status" data-testid="task-interrupted-status">
          <span className="chijie-interrupted-status-icon">
            <FiPauseCircle aria-hidden />
          </span>
          <span className="chijie-interrupted-status-copy">
            <strong>任务已中断，进度已经保存</strong>
            {lastProgress ? (
              <span data-testid="task-interrupted-last-progress">最后进展 {lastProgress}</span>
            ) : null}
            <span data-testid="task-interrupted-next-step">继续后：{view.nextStep}</span>
          </span>
          {controls}
        </section>
      ) : (
        controls
      )}

      {(result || hasDeliveredResult || showPendingResult) && (
        <section className="chijie-progress-result" data-testid="task-result-block">
          <p className="chijie-progress-kicker">结果</p>
          {result}
          {view.findings.length > 0 && (
            <div className="chijie-progress-findings" data-testid="task-progress-findings">
              <ul>
                {view.findings.map(finding => (
                  <li key={finding.id}>
                    <strong>{finding.title}</strong>
                    {finding.detail && <span>{finding.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!isResultSurface && view.artifacts.length > 0 && (
            <div className="chijie-progress-artifacts" data-testid="task-progress-artifacts">
              <ul>
                {view.artifacts.map(artifact => (
                  <li key={artifact.id}>
                    <FiFileText aria-hidden />
                    {artifact.url ? (
                      <a href={artifact.url} target="_blank" rel="noreferrer">
                        <span>{artifact.title}</span>
                        <FiExternalLink aria-hidden />
                      </a>
                    ) : (
                      <span>{artifact.title}</span>
                    )}
                    <small>{artifact.status === 'verified' ? '已回读验证' : '已创建'}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {showPendingResult && (
            <p className="chijie-progress-result-pending" data-testid="task-result-pending">
              做完会出现在这里
            </p>
          )}
        </section>
      )}

      {failedAudit && nowSection}

      {blocked && (
        <div className="chijie-progress-blocked" role="alert">
          当前阶段遇到阻塞，请调整任务方向或稍后重试。
        </div>
      )}
    </div>
  );
}
