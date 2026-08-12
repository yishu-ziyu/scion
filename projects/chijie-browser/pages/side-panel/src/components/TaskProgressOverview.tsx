import type { ReactNode } from 'react';
import {
  FiActivity,
  FiAlertCircle,
  FiCheck,
  FiClock,
  FiExternalLink,
  FiFileText,
  FiPauseCircle,
} from 'react-icons/fi';
import type { TaskProgressView } from '../presentation/task-progress-view';
import { MissionPlanList } from './MissionPlanList';

interface TaskProgressOverviewProps {
  view: TaskProgressView;
  now?: number;
  controls?: ReactNode;
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

function HealthIcon({ state }: { state: TaskProgressView['health']['state'] }) {
  if (state === 'paused') return <FiPauseCircle aria-hidden />;
  if (state === 'needs_user' || state === 'failed') return <FiAlertCircle aria-hidden />;
  if (state === 'complete') return <FiCheck aria-hidden />;
  if (state === 'slow') return <FiClock aria-hidden />;
  return <FiActivity aria-hidden />;
}

export function TaskProgressOverview({ view, now = Date.now(), controls }: TaskProgressOverviewProps) {
  const active = view.milestones.find(milestone => milestone.status === 'active');
  const lastProgress = relativeTime(view.health.lastMeaningfulProgressAt, now);

  return (
    <div className="chijie-progress-overview" data-kind={view.kind} data-testid="task-progress-overview">
      <section className="chijie-progress-mission" data-testid="task-goal-block">
        <p className="chijie-progress-kicker">任务目标</p>
        <h2 data-testid="task-goal-summary">{view.mission.title}</h2>
        <p>{view.mission.deliverable}</p>
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

      {view.milestones.length > 0 && <MissionPlanList milestones={view.milestones} status={view.status} />}

      {view.currentActivity && (
        <section className="chijie-progress-now" data-testid="task-progress-current-activity">
          <span className="chijie-progress-kicker">现在</span>
          <strong>{view.currentActivity.summary}</strong>
          <span>
            {view.currentActivity.purpose}
            {view.currentActivity.site ? ` · ${view.currentActivity.site}` : ''}
          </span>
        </section>
      )}

      <section className="chijie-progress-health" data-state={view.health.state} data-testid="task-progress-health">
        <span className="chijie-progress-health-icon">
          <HealthIcon state={view.health.state} />
        </span>
        <span className="chijie-progress-health-copy">
          <strong>{view.health.summary}</strong>
          {lastProgress && <span>最近有效进展：{lastProgress}</span>}
          <span>
            {view.status === 'paused' ? '继续后' : '下一步'}：{view.nextStep}
          </span>
        </span>
      </section>

      {controls}

      {view.findings.length > 0 && (
        <section className="chijie-progress-findings" data-testid="task-progress-findings">
          <div className="chijie-progress-section-head">
            <span>最新成果</span>
            <span>{view.findings.length}</span>
          </div>
          <ul>
            {view.findings.map(finding => (
              <li key={finding.id}>
                <strong>{finding.title}</strong>
                {finding.detail && <span>{finding.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.artifacts.length > 0 && (
        <section className="chijie-progress-artifacts" data-testid="task-progress-artifacts">
          <div className="chijie-progress-section-head">
            <span>交付物</span>
            <span>{view.artifacts.length}</span>
          </div>
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
        </section>
      )}

      {active?.status === 'blocked' && (
        <div className="chijie-progress-blocked" role="alert">
          当前阶段遇到阻塞，请查看上方健康状态或调整任务方向。
        </div>
      )}
    </div>
  );
}
