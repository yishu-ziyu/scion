import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FiAlertCircle, FiList, FiPauseCircle } from 'react-icons/fi';
import type { ProgressMilestone, ProgressViewStatus } from '../presentation/task-progress-view';

export type MissionPlanItemStatus =
  | 'planned'
  | 'active'
  | 'done'
  | 'blocked'
  | 'paused'
  | 'waiting_user'
  | 'failed';

interface MissionPlanListProps {
  milestones: ProgressMilestone[];
  status: ProgressViewStatus;
}

function iconClassName(on: boolean, strong = false): string {
  return `chijie-plan-item-icon${strong ? ' is-strong' : ''}${on ? ' is-on' : ''}`;
}

function CheckIcon({ on }: { on: boolean }) {
  return (
    <svg className={iconClassName(on)} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon({ on }: { on: boolean }) {
  return (
    <svg className={iconClassName(on, true)} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m12.75 15 3-3m0 0-3-3m3 3h-7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DashedIcon({ on }: { on: boolean }) {
  return (
    <svg className={iconClassName(on)} viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeDasharray="1.8 3.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FilledCheckIcon() {
  return (
    <svg className="chijie-plan-head-check" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

function RollingCharacter({ char }: { char: string }) {
  const previous = useRef(char);
  const [roll, setRoll] = useState<{ from: string; to: string } | null>(null);
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (char === previous.current) return;
    const from = previous.current;
    previous.current = char;
    setRoll({ from, to: char });
    setUp(false);
    let innerFrame = 0;
    const frame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => setUp(true));
    });
    const done = window.setTimeout(() => setRoll(null), 380);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(innerFrame);
      window.clearTimeout(done);
    };
  }, [char]);

  if (!roll) return <span className="chijie-plan-roll-digit">{char}</span>;
  return (
    <span className="chijie-plan-roll-digit">
      <span className={`chijie-plan-roll-inner${up ? ' is-up' : ''}`}>
        <span>{roll.from}</span>
        <span>{roll.to}</span>
      </span>
    </span>
  );
}

function RollingCount({ value }: { value: string }) {
  return (
    <span className="chijie-plan-roll-count" aria-label={value}>
      {value.split('').map((char, index) => (
        <RollingCharacter key={`${value.length}-${index}`} char={char} />
      ))}
    </span>
  );
}

export function missionPlanItemStatus(
  milestoneStatus: ProgressMilestone['status'],
  taskStatus: ProgressViewStatus,
): MissionPlanItemStatus {
  if (taskStatus === 'completed') return 'done';
  if (milestoneStatus !== 'active') return milestoneStatus;
  if (taskStatus === 'paused') return 'paused';
  if (taskStatus === 'needs_user') return 'waiting_user';
  if (taskStatus === 'failed') return 'failed';
  return 'active';
}

function statusLabel(status: MissionPlanItemStatus): string | null {
  if (status === 'paused') return '已暂停';
  if (status === 'waiting_user') return '等待你';
  if (status === 'failed') return '未完成';
  if (status === 'blocked') return '受阻';
  return null;
}

function HeadIcon({
  status,
  complete,
  progress,
}: {
  status: ProgressViewStatus;
  complete: boolean;
  progress: number;
}) {
  if (complete) return <FilledCheckIcon />;
  if (status === 'paused') return <FiPauseCircle className="chijie-plan-head-state" aria-hidden />;
  if (status === 'needs_user' || status === 'failed') {
    return <FiAlertCircle className="chijie-plan-head-state" aria-hidden />;
  }
  if (status !== 'planning') {
    return (
      <span
        className="chijie-plan-head-pie"
        style={{ '--chijie-plan-progress': `${progress}%` } as CSSProperties}
        aria-hidden>
        <svg className="chijie-plan-head-pie-ring" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            r="10.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeDasharray="2.2 4.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return <FiList className="chijie-plan-head-list" aria-hidden />;
}

function ItemIcon({ status }: { status: MissionPlanItemStatus }) {
  const attention = status === 'blocked' || status === 'waiting_user' || status === 'failed';
  return (
    <span className="chijie-plan-item-icon-wrap">
      <DashedIcon on={status === 'planned'} />
      <ArrowIcon on={status === 'active'} />
      <CheckIcon on={status === 'done'} />
      {status === 'paused' && <FiPauseCircle className="chijie-plan-item-state is-on" aria-hidden />}
      {attention && <FiAlertCircle className="chijie-plan-item-state is-on" aria-hidden />}
    </span>
  );
}

export function MissionPlanList({ milestones, status }: MissionPlanListProps) {
  const [collapsed, setCollapsed] = useState(false);
  const itemStatuses = milestones.map(milestone => missionPlanItemStatus(milestone.status, status));
  const doneCount = itemStatuses.filter(itemStatus => itemStatus === 'done').length;
  const complete = milestones.length > 0 && doneCount === milestones.length;
  const progress = milestones.length > 0 ? Math.round((doneCount / milestones.length) * 100) : 0;

  return (
    <section className="chijie-progress-plan chijie-plan-todo" data-testid="mission-plan">
      <button
        type="button"
        className="chijie-plan-head"
        aria-expanded={!collapsed}
        aria-label="展开或收起任务计划"
        onClick={() => setCollapsed(current => !current)}>
        <span className="chijie-plan-head-icon" data-state={status}>
          <HeadIcon status={status} complete={complete} progress={progress} />
          <svg className="chijie-plan-chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m19.5 8.25-7.5 7.5-7.5-7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="chijie-plan-title">任务计划</span>
        <span className="chijie-plan-count" data-testid="mission-plan-count">
          <RollingCount value={`${doneCount}/${milestones.length}`} />
          <span>阶段</span>
        </span>
      </button>

      <div className={`chijie-plan-collapsible${collapsed ? ' is-collapsed' : ''}`}>
        <div className="chijie-plan-inner">
          <ol className="chijie-plan-list">
            {milestones.map((milestone, index) => {
              const itemStatus = itemStatuses[index] ?? missionPlanItemStatus(milestone.status, status);
              const label = statusLabel(itemStatus);
              return (
                <li
                  key={milestone.id}
                  data-status={itemStatus}
                  data-testid="mission-plan-phase"
                  style={{ '--chijie-plan-index': index } as CSSProperties}>
                  <ItemIcon status={itemStatus} />
                  <span className="chijie-progress-milestone-body">
                    <span className="chijie-progress-milestone-title" data-label={milestone.title}>
                      {milestone.title}
                    </span>
                    {label && <span className="chijie-plan-item-state-label">{label}</span>}
                    {(itemStatus === 'active' ||
                      itemStatus === 'blocked' ||
                      itemStatus === 'paused' ||
                      itemStatus === 'waiting_user' ||
                      itemStatus === 'failed') &&
                      milestone.summary && (
                        <span className="chijie-progress-milestone-summary">{milestone.summary}</span>
                      )}
                    {milestone.gates.length > 0 &&
                      (itemStatus === 'active' ||
                        itemStatus === 'done' ||
                        itemStatus === 'blocked' ||
                        itemStatus === 'paused' ||
                        itemStatus === 'waiting_user' ||
                        itemStatus === 'failed') && (
                        <span className="chijie-progress-gates">
                          {milestone.gates.map(gate => (
                            <span
                              key={gate.id}
                              className="chijie-progress-gate"
                              data-status={gate.status}
                              data-testid={`progress-gate-${gate.id}`}>
                              <span className="chijie-progress-gate-line">
                                <span>{gate.label}</span>
                                {gate.current !== undefined && gate.target !== undefined && (
                                  <strong>
                                    {gate.current}/{gate.target}
                                    {gate.unit ? ` ${gate.unit}` : ''}
                                    {gate.status === 'passed' && (
                                      <span className="chijie-progress-gate-passed">已达标</span>
                                    )}
                                  </strong>
                                )}
                              </span>
                              {gate.current !== undefined && gate.target !== undefined && gate.target > 0 && (
                                <span className="chijie-progress-track" aria-hidden>
                                  <span
                                    style={{
                                      transform: `scaleX(${Math.max(0, Math.min(1, gate.current / gate.target))})`,
                                    }}
                                  />
                                </span>
                              )}
                              {gate.detail && <span className="chijie-progress-gate-detail">{gate.detail}</span>}
                            </span>
                          ))}
                        </span>
                      )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
