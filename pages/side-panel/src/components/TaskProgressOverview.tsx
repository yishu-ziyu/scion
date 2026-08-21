import type { ReactNode } from 'react';
import { FiExternalLink, FiFileText, FiPauseCircle } from 'react-icons/fi';
import type { ProgressHealthState, TaskProgressView } from '../presentation/task-progress-view';

interface TaskProgressOverviewProps {
  view: TaskProgressView;
  now?: number;
  controls?: ReactNode;
  interrupted?: boolean;
  /** Delivered or failed sentence. Only rendered when it exists. */
  result?: ReactNode;
  /** Growing work stream (search boards, pages). */
  nowBody?: ReactNode;
  /** Full original sentence. Not a 目标 label. */
  utterance?: string;
}

export function healthNeedsAttention(state: ProgressHealthState): boolean {
  return state === 'needs_user' || state === 'stalled' || state === 'paused';
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
  void state;
  return '';
}

export function healthAnnouncement(health: TaskProgressView['health']): string {
  return health.summary;
}

export function TaskProgressOverview({
  view,
  now = Date.now(),
  controls,
  interrupted = false,
  result,
  nowBody,
  utterance,
}: TaskProgressOverviewProps) {
  const lastProgress = relativeTime(view.health.lastMeaningfulProgressAt, now);
  const healthVisible = healthNeedsAttention(view.health.state) && !result;
  const hideDuplicateHealth =
    Boolean(result) ||
    view.status === 'completed' ||
    view.status === 'failed' ||
    view.health.state === 'failed' ||
    view.health.state === 'complete' ||
    view.health.state === 'recovering';
  const visibleArtifacts = view.artifacts.filter(artifact => artifact.kind !== 'receipt');
  const hasDeliveredResult = Boolean(result) || view.findings.length > 0 || visibleArtifacts.length > 0;
  const spoken = (utterance ?? view.mission.title).replace(/\s+/g, ' ').trim();
  const showNow = Boolean(nowBody || view.currentActivity);
  const nowSection = showNow ? (
    <section
      className="chijie-progress-now"
      data-testid="task-progress-current-activity"
      data-live-log={nowBody ? 'true' : undefined}>
      {!nowBody && view.currentActivity ? (
        <>
          <strong data-testid="task-now-summary">{view.currentActivity.summary}</strong>
          {view.currentActivity.site && (
            <span className="chijie-progress-now-site" data-testid="task-now-site">
              {view.currentActivity.site}
            </span>
          )}
          <span data-testid="task-now-purpose">{view.currentActivity.purpose}</span>
        </>
      ) : null}
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
        <h2 data-testid="task-goal-summary">{spoken}</h2>
      </section>

      {view.directionChange ? (
        <section className="chijie-system-note" data-testid="task-direction-change">
          <p>{view.directionChange.summary}</p>
        </section>
      ) : null}

      {nowSection}

      <section
        className="chijie-progress-health"
        data-testid="task-progress-health"
        data-health={view.health.state}
        data-quiet={healthVisible && !hideDuplicateHealth ? undefined : 'true'}
        hidden={hideDuplicateHealth || !healthVisible || undefined}>
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
        {healthVisible && !hideDuplicateHealth ? healthAnnouncement(view.health) : ''}
      </span>

      {interrupted ? (
        <section className="chijie-interrupted-status" data-testid="task-interrupted-status">
          <span className="chijie-interrupted-status-icon">
            <FiPauseCircle aria-hidden />
          </span>
          <span className="chijie-interrupted-status-copy">
            <strong>任务已中断，进度已经保存</strong>
            {lastProgress ? <span data-testid="task-interrupted-last-progress">最后进展 {lastProgress}</span> : null}
            <span data-testid="task-interrupted-next-step">继续后：{view.nextStep}</span>
          </span>
          {controls}
        </section>
      ) : (
        controls
      )}

      {view.milestones.some(milestone => milestone.status === 'blocked') ? (
        <div className="chijie-progress-blocked" role="alert">
          当前阶段遇到阻塞，请调整任务方向或稍后重试。
        </div>
      ) : null}

      {hasDeliveredResult ? (
        <section className="chijie-progress-result" data-testid="task-result-block">
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
          {visibleArtifacts.length > 0 && (
            <div className="chijie-progress-artifacts" data-testid="task-progress-artifacts">
              <ul>
                {visibleArtifacts.map(artifact => (
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
        </section>
      ) : null}
    </div>
  );
}
