import type { ActionAttempt, EvidenceSpace, TaskCommand, TaskSnapshot, WaitReason } from '@extension/storage';
import { t } from '@extension/i18n';
import { useEffect, useState } from 'react';
import {
  FiArrowDown,
  FiCamera,
  FiCheck,
  FiChevronDown,
  FiChevronUp,
  FiClock,
  FiCornerUpLeft,
  FiEdit3,
  FiEye,
  FiGlobe,
  FiLayers,
  FiList,
  FiMousePointer,
  FiMoreHorizontal,
  FiPlay,
  FiSearch,
  FiX,
  FiZap,
} from 'react-icons/fi';
import type { IconType } from 'react-icons';
import {
  actionStackClassName,
  completionVisibleText,
  dangerButtonClassName,
  monoLabelClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
  statusLabelKey,
  taskCardClassName,
} from '../design/contracts';
import {
  type TaskOutcomeRating,
  defaultStepsExpanded,
  observedAttemptCount,
  ratingStorageKey,
  shouldShowExecutionSteps,
  shouldShowOutcomeRating,
  shouldShowVerifiedDone,
  taskPrimaryOrganism,
  visibleAttemptWindow,
} from '../presentation/task-loop-ui';
import {
  type ActivityIconKey,
  activityElapsedSeconds,
  activityIconForAction,
  activityLiveActingLine,
  activityLiveDetail,
  activityLiveHeadline,
  activityPhaseForAttempt,
  formatActivityDuration,
  looksLikeActionName,
} from '../presentation/activity-stream';
import { requiredCompletionResult } from '../presentation/completion-outcome';
import { assessGoalCoverage, resolveDeliverableAnswer } from '../presentation/goal-coverage';
import { productFailureLabel, toProductFailureCode } from '../presentation/failure-taxonomy';
import { waitUserActionTestId } from '../presentation/wait-affordance';
import { deriveTaskProgressView } from '../presentation/task-progress-view';
import { TaskProgressOverview } from './TaskProgressOverview';

const ACTIVITY_ICONS: Record<ActivityIconKey, IconType> = {
  search: FiSearch,
  eye: FiEye,
  globe: FiGlobe,
  click: FiMousePointer,
  type: FiEdit3,
  play: FiPlay,
  scroll: FiArrowDown,
  wait: FiClock,
  tab: FiLayers,
  close: FiX,
  camera: FiCamera,
  check: FiCheck,
  back: FiCornerUpLeft,
  list: FiList,
  generic: FiZap,
};

function ActivityGlyph({ name, className }: { name: ActivityIconKey; className?: string }) {
  const Icon = ACTIVITY_ICONS[name] ?? FiZap;
  return <Icon className={className} aria-hidden size={14} strokeWidth={2} />;
}

export interface TaskStatusCardProps {
  snapshot: TaskSnapshot;
  send(command: TaskCommand): void;
  /** Last user goal text - used to prefill skill template. */
  defaultInstruction?: string;
  /** Original task instruction. Follow-ups must not replace the stable mission. */
  missionInstruction?: string;
  evidenceSpace?: EvidenceSpace | null;
  /** Focus the continuous-control composer without changing the stable mission. */
  onAdjustDirection?: () => void;
  isDarkMode?: boolean;
}

export function canRetryResearchFailure(snapshot: TaskSnapshot, evidenceSpace?: EvidenceSpace | null): boolean {
  if (snapshot.status !== 'failed') return false;
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  if (round?.failureCategory?.startsWith('research_')) return true;
  return evidenceSpace?.taskId === snapshot.id && evidenceSpace.records.length > 0;
}

function waitReasonHint(reason: WaitReason | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case 'login_required':
      return t('chat_task_hint_login');
    case 'captcha_required':
      return t('chat_task_hint_captcha');
    case 'proof_required':
      return t('chat_task_hint_proof');
    case 'commit_outcome_uncertain':
      return t('chat_task_hint_uncertain');
    case 'target_missing':
      return t('chat_task_hint_target_missing');
    case 'target_ambiguous':
      return t('chat_task_hint_target_ambiguous');
    case 'skill_inputs_required':
      return t('chat_task_hint_skill_inputs');
  }
}

/** Map executor failureCategory → user-visible Chinese/en i18n (no machine noise). */
export function failureCategoryHint(category: string | undefined): string | null {
  if (!category) return null;
  switch (category) {
    case 'llm_failed':
      return t('chat_task_fail_llm');
    case 'observe_failed':
      return t('chat_task_fail_observe');
    case 'json_parse_failed':
      return t('chat_task_fail_json');
    case 'no_action':
      return t('chat_task_fail_no_action');
    case 'unknown_action':
      return t('chat_task_fail_unknown_action');
    case 'action_failed':
      return t('chat_task_fail_action');
    case 'max_steps':
      return t('chat_task_fail_max_steps');
    case 'setup_failed':
      return t('chat_task_fail_setup');
    case 'executor_start_failed':
      return t('chat_task_fail_start');
    case 'on_plan_failed':
      return t('chat_task_fail_plan');
    case 'dispatch_failed':
      return t('chat_task_fail_dispatch');
    case 'no_completion_criteria':
      return t('chat_task_fail_no_criteria');
    case 'missing_instruction':
      return t('chat_task_fail_missing_instruction');
    default:
      return t('chat_task_fail_unknown', [category]);
  }
}

function failureNextStep(snapshot: TaskSnapshot): string {
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  // proof_required copy mentions the confirm button; only show it when one exists.
  const hasConfirmable =
    round?.criteria.some(
      criterion =>
        criterion.kind === 'user_confirmed' &&
        !round.evidence.some(
          evidence => evidence.criterionId === criterion.id && evidence.source === 'user' && evidence.passed,
        ),
    ) ?? false;
  const waitReason = round?.waitReason === 'proof_required' && !hasConfirmable ? undefined : round?.waitReason;
  const hint = waitReasonHint(waitReason);
  if (hint) return hint;
  if (snapshot.status === 'waiting_user') return t('chat_task_fail_no_action');
  if (snapshot.status === 'failed') {
    const category = round?.failureCategory;
    if (category) {
      // Known product codes keep the coarse label; "other" surfaces executor-specific i18n.
      if (toProductFailureCode(category) === 'other') {
        return failureCategoryHint(category) ?? productFailureLabel(category);
      }
      return productFailureLabel(category);
    }
    return t('chat_task_hint_failed_generic');
  }
  if (snapshot.status === 'cancelled') return t('chat_task_hint_cancelled');
  if (snapshot.status === 'interrupted') return t('chat_task_hint_interrupted');
  return t('chat_task_hint_generic');
}

/** Turn a concrete instruction into a reusable template when possible. */
export function instructionToSkillTemplate(instruction: string): string {
  let text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const fieldTokens = [...text.matchAll(/\bFIELD_[A-Z0-9_]+\b/g)].map(match => match[0]);
  const unique = [...new Set(fieldTokens)];
  if (unique.length === 1) {
    return text.split(unique[0]).join('{{name}}');
  }
  if (unique.length > 1) {
    unique.forEach((token, index) => {
      text = text.split(token).join(`{{field${index + 1}}}`);
    });
    return text;
  }

  const withMatch = text.match(/\bwith\s+([A-Za-z0-9._@+-]{2,80})(?=\s+(?:and|then)\b|[,;.]|$)/i);
  if (withMatch?.[1] && !/^(the|a|an|this|that|my|your)$/i.test(withMatch[1])) {
    return text.replace(withMatch[1], '{{name}}');
  }

  return text;
}

/** Human labels for action names (design/003 round timeline). */
export function humanActionLabel(actionName: string): string {
  const map: Record<string, Parameters<typeof t>[0]> = {
    go_to_url: 'chat_task_action_open',
    open_tab: 'chat_task_action_open_tab',
    switch_tab: 'chat_task_action_switch_tab',
    focus_tab: 'chat_task_action_switch_tab',
    close_tab: 'chat_task_action_close_tab',
    click_element: 'chat_task_action_click',
    input_text: 'chat_task_action_input',
    send_keys: 'chat_task_action_keys',
    control_media: 'chat_task_action_media',
    save_screenshot: 'chat_task_action_screenshot',
    scroll_to_text: 'chat_task_action_scroll',
    scroll_to_percent: 'chat_task_action_scroll',
    wait: 'chat_task_action_wait',
    done: 'chat_task_action_done',
    search_google: 'chat_task_action_search',
    go_back: 'chat_task_action_back',
    get_dropdown_options: 'chat_task_action_read_options',
    select_dropdown_option: 'chat_task_action_select',
  };
  return t(map[actionName] ?? 'chat_task_action_generic');
}

/** Prefer backend displaySummary (verb + object); fall back to coarse action label. */
export function attemptDisplayTitle(
  attempt: Pick<ActionAttempt, 'actionName' | 'displaySummary'>,
): string {
  const summary = attempt.displaySummary?.replace(/\s+/g, ' ').trim();
  // Never surface raw English actionName as a "summary" (design/005 P2).
  if (summary && summary.length >= 2 && !looksLikeActionName(summary)) return summary;
  return humanActionLabel(attempt.actionName);
}

function evidenceLabel(kind: string): string {
  const labels: Record<string, Parameters<typeof t>[0]> = {
    url: 'chat_task_evidence_url',
    page_text: 'chat_task_evidence_text',
    element_state: 'chat_task_evidence_element',
    media_state: 'chat_task_evidence_media',
    // Reuse media/generic until dedicated tab/download copy is localized.
    tab_state: 'chat_task_evidence_generic',
    download_state: 'chat_task_evidence_generic',
    user_confirmed: 'chat_task_evidence_user',
  };
  return t(labels[kind] ?? 'chat_task_evidence_generic');
}

function attemptLineState(attempt: ActionAttempt): string {
  switch (attempt.state) {
    case 'observed':
      return t('chat_task_attempt_observed');
    case 'executing':
      return t('chat_task_attempt_executing');
    case 'authorized':
      return t('chat_task_attempt_authorized');
    case 'proposed':
      return t('chat_task_attempt_proposed');
    case 'uncertain':
      return t('chat_task_attempt_uncertain');
    case 'blocked':
      return t('chat_task_attempt_blocked');
    default:
      return attempt.state;
  }
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function boundPageRef(snapshot: TaskSnapshot) {
  return [...snapshot.targetRefs].reverse().find(ref => ref.kind === 'page' && ref.tabId === snapshot.activeTabId)
    ?? [...snapshot.targetRefs].reverse().find(ref => ref.kind === 'page');
}

function siteLabel(snapshot: TaskSnapshot): string {
  const page = boundPageRef(snapshot);
  if (page?.label?.trim()) return page.label.trim();
  if (page?.urlOrigin && page.urlOrigin !== 'null') return page.urlOrigin;
  return t('chat_task_working_on_page');
}

/** Prefer hostname · title for the card chrome; full URL only when needed. */
function siteHostLabel(snapshot: TaskSnapshot): string {
  const page = boundPageRef(snapshot);
  let host = '';
  if (page?.urlOrigin && page.urlOrigin !== 'null') {
    try {
      host = new URL(page.urlOrigin).hostname.replace(/^www\./, '');
    } catch {
      host = page.urlOrigin;
    }
  }
  const title = page?.label?.trim();
  if (host && title && title !== host) {
    const short = title.length > 28 ? `${title.slice(0, 26)}…` : title;
    return `${host} · ${short}`;
  }
  if (host) return host;
  if (title) return title;
  return t('chat_task_working_on_page');
}

/**
 * What the user asked for.
 * Prefer chat message text: task snapshots intentionally keep generic
 * goalSummary ("User task") so secrets never land in storage.
 */
export function displayGoalText(
  snapshot: TaskSnapshot,
  roundInstruction: string | undefined,
  defaultInstruction = '',
): string {
  const isPlaceholder = (s: string) => !s || /^user\s+(task|instruction)$/i.test(s);
  const fromChat = defaultInstruction.replace(/\s+/g, ' ').trim();
  if (fromChat && !isPlaceholder(fromChat)) return fromChat;
  for (const c of [snapshot.goalSummary, roundInstruction]) {
    const text = (c ?? '').replace(/\s+/g, ' ').trim();
    if (!isPlaceholder(text)) return text;
  }
  return fromChat || '—';
}

export function TaskStatusCard({
  snapshot,
  send,
  defaultInstruction = '',
  missionInstruction = '',
  evidenceSpace = null,
  onAdjustDirection,
}: TaskStatusCardProps) {
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [skillTitle, setSkillTitle] = useState('');
  const [skillTemplate, setSkillTemplate] = useState('');
  const [stepsExpanded, setStepsExpanded] = useState(() => defaultStepsExpanded(snapshot.status));
  const [outcomeRating, setOutcomeRating] = useState<TaskOutcomeRating | null>(null);
  const [skillSavePendingId, setSkillSavePendingId] = useState<string | null>(null);
  const [deliverableCopied, setDeliverableCopied] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const round = snapshot.rounds.find(item => item.id === snapshot.currentRoundId);
  const attempts = round?.attempts ?? [];
  const skillSaveAck = skillSavePendingId ? round?.commandAcks[skillSavePendingId] : undefined;
  const confirmations =
    round?.criteria.filter(
      criterion =>
        criterion.kind === 'user_confirmed' &&
        !round.evidence.some(
          evidence => evidence.criterionId === criterion.id && evidence.source === 'user' && evidence.passed,
        ),
    ) ?? [];
  const waitAction =
    snapshot.status === 'waiting_user' ? waitUserActionTestId(round?.waitReason) : null;

  const isTerminal = ['completed', 'failed', 'cancelled'].includes(snapshot.status);
  const needsAttention =
    snapshot.status === 'waiting_user' ||
    snapshot.status === 'inputs_required' ||
    snapshot.status === 'failed' ||
    snapshot.status === 'interrupted';

  const doneSteps = observedAttemptCount(attempts);
  const stableInstruction = missionInstruction || defaultInstruction;
  const goalText = displayGoalText(snapshot, round?.instructionSummary, stableInstruction);
  const progressView = deriveTaskProgressView({
    snapshot,
    missionInstruction: stableInstruction,
    evidenceSpace,
    now: nowTick,
  });

  useEffect(() => {
    setStepsExpanded(defaultStepsExpanded(snapshot.status));
  }, [snapshot.id, snapshot.status, round?.id]);

  useEffect(() => {
    if (snapshot.status !== 'running') return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [snapshot.status, snapshot.id]);

  useEffect(() => {
    const receiptId = round?.receipt?.id;
    if (!receiptId || typeof localStorage === 'undefined') {
      setOutcomeRating(null);
      return;
    }
    const stored = localStorage.getItem(ratingStorageKey(receiptId));
    if (stored === 'success' || stored === 'partial' || stored === 'fail') {
      setOutcomeRating(stored);
    } else {
      setOutcomeRating(null);
    }
  }, [round?.receipt?.id]);

  useEffect(() => {
    if (!skillSaveAck) return;
    setSkillSavePendingId(null);
    if (skillSaveAck.accepted) {
      setShowSkillForm(false);
      setSkillTitle('');
      setSkillTemplate('');
    }
  }, [skillSaveAck]);

  useEffect(() => {
    if (!skillSavePendingId) return;
    const timeout = window.setTimeout(() => setSkillSavePendingId(null), 2_000);
    return () => window.clearTimeout(timeout);
  }, [skillSavePendingId]);

  const openSkillForm = () => {
    setShowSkillForm(true);
    setSkillTitle(previous => previous || snapshot.goalSummary.slice(0, 48) || t('chat_skills_defaultTitle'));
    setSkillTemplate(previous => {
      if (previous.trim()) return previous;
      return instructionToSkillTemplate(defaultInstruction) || defaultInstruction;
    });
  };

  // Contract helper: title without receipt id leakage (ui-acceptance).
  const completionChrome = completionVisibleText({
    doneTitle: t('chat_task_done_title'),
    doneBody: t('chat_task_done_body'),
    receiptId: round?.receipt?.id ?? '',
  });
  const doneTitleLine = completionChrome.split('\n')[0] || t('chat_task_done_title');

  const showSteps = shouldShowExecutionSteps(attempts);
  const visibleAttempts = visibleAttemptWindow(attempts, snapshot.status);
  const currentAttempt = [...attempts]
    .reverse()
    .find(attempt => attempt.state === 'executing' || attempt.state === 'proposed' || attempt.state === 'authorized');
  const passedEvidence =
    round?.evidence
      .filter(evidence => evidence.passed)
      .map(evidence => ({
        ...evidence,
        criterion: round.criteria.find(criterion => criterion.id === evidence.criterionId),
      })) ?? [];
  const showVerifiedDone = shouldShowVerifiedDone(snapshot, round?.receipt);
  const showRating = shouldShowOutcomeRating(snapshot, round?.receipt);
  const evidenceForUi = passedEvidence.map(item => ({
    kind: item.criterion?.kind,
    passed: item.passed,
    value: item.value,
  }));
  // Always a human result sentence when verified (design/006 §5 #2) — never empty completion.
  const completionOutcome = requiredCompletionResult({
    instructionSummary: round?.instructionSummary,
    evidence: evidenceForUi,
    fallback: t('chat_task_done_body'),
  });
  const deliverableAnswer = resolveDeliverableAnswer({
    instructionSummary: round?.instructionSummary,
    goalText: goalText || snapshot.goalSummary || '',
    completionOutcome,
  });
  const goalCoverage = assessGoalCoverage({
    goalText: goalText || snapshot.goalSummary || '',
    evidence: evidenceForUi,
    answerText: deliverableAnswer,
  });
  const showPartialComplete = showVerifiedDone && goalCoverage.coverage === 'partial';
  const siteHost = siteHostLabel(snapshot);
  const siteFull = siteLabel(snapshot);
  // Prefer hostname alone for live line (not "host · title") so 「正在… · host」 stays scannable.
  const liveSiteHost = (() => {
    const page = boundPageRef(snapshot);
    if (page?.urlOrigin && page.urlOrigin !== 'null') {
      try {
        return new URL(page.urlOrigin).hostname.replace(/^www\./, '');
      } catch {
        return page.urlOrigin;
      }
    }
    return '';
  })();
  const liveMeta = activityLiveHeadline({
    status: snapshot.status,
    actionName: currentAttempt?.actionName,
    siteHost: liveSiteHost || siteHost,
    siteLabel: siteFull,
  });
  const liveDetailKind = activityLiveDetail({
    mode: liveMeta.mode,
    siteHost: liveSiteHost || siteHost,
    observedCount: doneSteps,
  });
  // Prefer displaySummary; fallback 「正在{人话动作} · host」; never actionName English.
  const liveActingText =
    liveMeta.mode === 'acting' && currentAttempt
      ? activityLiveActingLine({
          displaySummary: currentAttempt.displaySummary,
          humanActionLabel: humanActionLabel(currentAttempt.actionName),
          siteHost: liveSiteHost || siteHost,
        })
      : null;
  const activityEndAt =
    round?.receipt?.verifiedAt ??
    (isTerminal ? snapshot.updatedAt : undefined);
  const activitySeconds = activityElapsedSeconds({
    createdAt: snapshot.createdAt,
    endAt: activityEndAt,
    now: nowTick,
  });
  // Feature-first primary organism (design/004+005): activity | completion | recovery.
  const primaryOrganism = taskPrimaryOrganism({
    status: snapshot.status,
    showVerifiedDone,
  });

  const showLiveActivity =
    snapshot.status === 'running' ||
    (snapshot.status === 'waiting_user' && !showPartialComplete) ||
    snapshot.status === 'inputs_required';

  // Activity panel: live work signal and/or collapsible step history.
  const showActivityPanel = showLiveActivity || showSteps;

  const copyDeliverable = async () => {
    if (!deliverableAnswer) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(deliverableAnswer);
      }
      setDeliverableCopied(true);
      window.setTimeout(() => setDeliverableCopied(false), 1_500);
    } catch {
      // Clipboard may be blocked; still select-friendly via the text node.
    }
  };

  const selectRating = (rating: TaskOutcomeRating) => {
    setOutcomeRating(rating);
    const receiptId = round?.receipt?.id;
    if (receiptId && typeof localStorage !== 'undefined') {
      localStorage.setItem(ratingStorageKey(receiptId), rating);
    }
  };

  const activityHeader = (
    <div className="chijie-activity-header" data-testid="task-activity-header">
      <span className="chijie-activity-header-label">{t('chat_task_activity_heading')}</span>
      <span className="chijie-activity-header-sep" aria-hidden>
        ·
      </span>
      <span className="chijie-activity-header-elapsed" data-testid="task-activity-elapsed">
        {formatActivityDuration(activitySeconds)}
      </span>
    </div>
  );

  const liveActivityRow = showLiveActivity ? (
    <div
      className="chijie-activity-live"
      data-testid="task-activity-live"
      data-mode={liveMeta.mode}
      role="status"
      aria-live="polite"
      aria-atomic="true">
      <span className="chijie-activity-icon is-live" data-phase={liveMeta.phase}>
        <ActivityGlyph name={liveMeta.icon} />
      </span>
      <span className="chijie-activity-live-copy">
        <strong>
          {liveMeta.mode === 'waiting'
            ? t('chat_task_activity_waiting')
            : liveMeta.mode === 'viewing'
              ? t('chat_task_activity_viewing', [liveSiteHost || siteHost || siteFull || '…'])
              : liveMeta.mode === 'acting' && liveActingText
                ? liveActingText
                : t('chat_task_activity_thinking')}
        </strong>
        {/* Acting line already embeds host; skip duplicate site detail under displaySummary. */}
        {liveDetailKind === 'site' && liveMeta.mode !== 'viewing' && liveMeta.mode !== 'acting' && (
          <span>{t('chat_task_activity_viewing', [liveSiteHost || siteHost])}</span>
        )}
        {liveDetailKind === 'verified' && liveMeta.mode !== 'acting' && (
          <span>{t('chat_task_activity_verified', [String(doneSteps)])}</span>
        )}
        {liveDetailKind === 'preparing' && <span>{t('chat_task_activity_preparing')}</span>}
        {liveDetailKind === 'wait_user' && <span>{t('chat_task_activity_wait_hint')}</span>}
      </span>
      {snapshot.status === 'running' && <span className="chijie-activity-dot" aria-hidden />}
    </div>
  ) : null;

  const stepsHistory =
    showSteps ? (
      <div data-testid="task-round-timeline" className="chijie-activity-history">
        <button
          type="button"
          data-testid="task-steps-toggle"
          className="chijie-task-steps-toggle"
          aria-expanded={stepsExpanded}
          onClick={() => setStepsExpanded(open => !open)}>
          <span>
            {t('chat_task_steps_heading')}
            <span className="chijie-task-steps-count">{attempts.length}</span>
          </span>
          <span className="chijie-task-steps-caret" aria-hidden>
            {stepsExpanded ? <FiChevronUp /> : <FiChevronDown />}
          </span>
        </button>
        {stepsExpanded && (
          <ol data-testid="task-execution-steps" className="chijie-activity-stream">
            {visibleAttempts.map(attempt => {
              const isActive = attempt.state === 'executing' || attempt.state === 'proposed';
              const iconKey = activityIconForAction(attempt.actionName);
              const phase = activityPhaseForAttempt(attempt.state);
              return (
                <li
                  key={attempt.id}
                  data-testid="task-round-step"
                  data-state={attempt.state}
                  data-phase={phase}
                  data-pending="false"
                  className={isActive ? 'is-active' : undefined}>
                  <span className="chijie-activity-icon" data-phase={phase} aria-hidden>
                    <ActivityGlyph name={iconKey} />
                  </span>
                  <span className="chijie-round-body">
                    <span className="chijie-round-title">{attemptDisplayTitle(attempt)}</span>
                    <span className="chijie-round-meta">
                      {attempt.targetLabel && (
                        <span className="chijie-round-target">{attempt.targetLabel}</span>
                      )}
                      <span className="chijie-round-state">
                        {attemptLineState(attempt)}
                      </span>
                      <span className="chijie-round-time">{formatTime(attempt.proposedAt)}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    ) : null;

  const completionBlock =
    showVerifiedDone && round?.receipt ? (
      <div
        data-testid="completion-receipt"
        data-coverage={goalCoverage.coverage}
        className={showPartialComplete ? 'chijie-done-block is-partial' : 'chijie-done-block'}>
        {showPartialComplete ? (
          <>
            <div className="font-medium" data-testid="completion-partial-title">
              {t('chat_task_partial_title')}
            </div>
            <div className="mt-0.5 text-xs opacity-90">{t('chat_task_partial_body')}</div>
            {goalCoverage.done.length > 0 && (
              <div className="chijie-coverage-block" data-testid="completion-coverage-done">
                <div className="chijie-coverage-label">{t('chat_task_partial_done_label')}</div>
                <ul>
                  {goalCoverage.done.map(line => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {goalCoverage.missing.length > 0 && (
              <div className="chijie-coverage-block is-missing" data-testid="completion-coverage-missing">
                <div className="chijie-coverage-label">{t('chat_task_partial_missing_label')}</div>
                <ul>
                  {goalCoverage.missing.map(line => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="font-medium" data-testid="completion-title">
              {doneTitleLine}
            </div>
            {/* Force human result sentence (design/006 §5 #2) — never title-only empty complete. */}
            <div className="mt-0.5 text-sm font-medium" data-testid="completion-result">
              {completionOutcome}
            </div>
            {/* Deliverable slot: only when substantive content exists; clickable/copyable. */}
            {deliverableAnswer && (
              <div
                className="chijie-completion-deliverable"
                data-testid="completion-deliverable">
                <button
                  type="button"
                  className="chijie-completion-deliverable-text"
                  data-testid="completion-deliverable-copy"
                  title={deliverableCopied ? '已复制' : '复制成果'}
                  onClick={() => void copyDeliverable()}>
                  {deliverableAnswer}
                </button>
                <span className="chijie-completion-deliverable-hint" aria-live="polite">
                  {deliverableCopied ? '已复制' : '点击复制'}
                </span>
              </div>
            )}
          </>
        )}
        {/* Partial coverage already lists done/missing; skip duplicate evidence ticks. */}
        {passedEvidence.length > 0 && !showPartialComplete && (
          <ul className="chijie-evidence-list" data-testid="completion-evidence-list">
            {passedEvidence.map(evidence => (
              <li key={`${evidence.criterionId}-${evidence.observedAt}`}>
                <span className="chijie-evidence-mark" aria-hidden>
                  <FiCheck />
                </span>
                <span>{evidenceLabel(evidence.criterion?.kind ?? '')}</span>
              </li>
            ))}
          </ul>
        )}
        <details className="chijie-receipt-details" data-testid="completion-receipt-details">
          <summary>{t('chat_task_receipt_technical')}</summary>
          <dl className="chijie-receipt-meta" data-testid="completion-receipt-meta">
            <div>
              <dt>{t('chat_task_receipt_time')}</dt>
              <dd>{new Date(round.receipt.verifiedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>{t('chat_task_current_site')}</dt>
              <dd>{siteHostLabel(snapshot)}</dd>
            </div>
          </dl>
        </details>
      </div>
    ) : null;

  const taskControls = !isTerminal ? (
    <div className={`${actionStackClassName} chijie-task-controls`} data-testid="task-continuous-controls">
      {snapshot.status === 'running' && (
        <button
          type="button"
          className={secondaryButtonClassName}
          onClick={() =>
            send({
              type: 'pause',
              commandId: crypto.randomUUID(),
              taskId: snapshot.id,
              expectedRevision: snapshot.revision,
            })
          }>
          {t('chat_task_pause')}
        </button>
      )}
      {snapshot.status === 'paused' && (
        <button
          type="button"
          className={primaryButtonClassName}
          onClick={() =>
            send({
              type: 'resume',
              commandId: crypto.randomUUID(),
              taskId: snapshot.id,
              expectedRevision: snapshot.revision,
            })
          }>
          {t('chat_task_resume')}
        </button>
      )}
      {onAdjustDirection && (
        <button type="button" className={secondaryButtonClassName} onClick={onAdjustDirection}>
          {t('chat_task_adjust_direction')}
        </button>
      )}
      <button
        type="button"
        className={dangerButtonClassName}
        onClick={() =>
          send({
            type: 'cancel',
            commandId: crypto.randomUUID(),
            taskId: snapshot.id,
            expectedRevision: snapshot.revision,
          })
        }>
        {t('chat_task_stop')}
      </button>
    </div>
  ) : null;

  const interruptedControls =
    snapshot.status === 'interrupted' ? (
      <div className="chijie-interrupted-actions" data-testid="task-continuous-controls">
        <button
          type="button"
          data-testid="task-resume"
          className="chijie-interrupted-resume"
          onClick={() =>
            send({
              type: 'resume',
              commandId: crypto.randomUUID(),
              taskId: snapshot.id,
              expectedRevision: snapshot.revision,
            })
          }>
          继续任务
        </button>
        {onAdjustDirection && (
          <button type="button" className="chijie-interrupted-adjust" onClick={onAdjustDirection}>
            {t('chat_task_adjust_direction')}
          </button>
        )}
        <details className="chijie-interrupted-more">
          <summary aria-label="更多任务操作">
            <FiMoreHorizontal aria-hidden />
          </summary>
          <div className="chijie-interrupted-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              data-testid="task-stop-menu"
              onClick={() =>
                send({
                  type: 'cancel',
                  commandId: crypto.randomUUID(),
                  taskId: snapshot.id,
                  expectedRevision: snapshot.revision,
                })
              }>
              {t('chat_task_stop')}
            </button>
          </div>
        </details>
      </div>
    ) : null;

  return (
    <section
      data-testid="task-status"
      data-status={showPartialComplete ? 'waiting_user' : snapshot.status}
      data-coverage={showVerifiedDone ? goalCoverage.coverage : undefined}
      data-attention={needsAttention || showPartialComplete ? 'true' : 'false'}
      data-primary-organism={primaryOrganism}
      className={taskCardClassName}>
      {/* 1. Status strip: what phase + where (one glance) */}
      <header className="chijie-task-head" data-interrupted={snapshot.status === 'interrupted' ? 'true' : undefined}>
        {snapshot.status !== 'interrupted' && (
          <span
            className="chijie-task-status-pill"
            data-testid="task-status-label"
            data-status={showPartialComplete ? 'waiting_user' : snapshot.status}
            data-partial={showPartialComplete ? 'true' : 'false'}>
            {showPartialComplete ? t('chat_task_partial_title') : t(statusLabelKey(snapshot.status))}
          </span>
        )}
        <span className="chijie-task-site-chip" data-testid="task-site" title={siteLabel(snapshot)}>
          {siteHostLabel(snapshot)}
        </span>
      </header>

      {/* 2. Stable mission + durable gates + health. Follow-ups never replace Mission. */}
      <TaskProgressOverview
        view={progressView}
        now={nowTick}
        controls={snapshot.status === 'interrupted' ? interruptedControls : taskControls}
        interrupted={snapshot.status === 'interrupted'}
      />

      {/* 3b. Running activity is already represented semantically in TaskProgressOverview.
          Keep raw browser operations as a collapsed audit trail. */}
      {primaryOrganism === 'activity' && showActivityPanel && (
        <div
          data-testid="task-activity-panel"
          className="chijie-activity-panel"
          data-secondary="true">
          {stepsHistory}
        </div>
      )}

      {/* 3c. Verified / partial completion before step history (honest result first). */}
      {primaryOrganism === 'completion' && completionBlock}

      {/* 3d. Approval / recovery / completion: steps stay secondary and usually collapsed. */}
      {primaryOrganism !== 'activity' && showActivityPanel && (
        <div
          data-testid="task-activity-panel"
          className="chijie-activity-panel"
          data-secondary={primaryOrganism === 'completion' ? 'true' : undefined}>
          {/* Runtime activity is mutually exclusive with paused/interrupted/recovery states. */}
          {snapshot.status === 'running' && activityHeader}
          {snapshot.status === 'running' && liveActivityRow}
          {stepsHistory}
        </div>
      )}

      {/* Optional outcome rating after verified done (Tabbit-class) */}
      {showRating && round?.receipt && (
        <div data-testid="task-outcome-rating" className="chijie-task-section">
          <div className={monoLabelClassName}>{t('chat_task_rating_prompt')}</div>
          <div className="chijie-rating-control" role="radiogroup" aria-label={t('chat_task_rating_prompt')}>
            {(['success', 'partial', 'fail'] as const).map(rating => (
              <label
                key={rating}
                className="chijie-rating-option"
                data-active={outcomeRating === rating ? 'true' : 'false'}>
                <input
                  type="radio"
                  name={`task-outcome-${round.receipt?.id}`}
                  data-testid={`task-rate-${rating}`}
                  checked={outcomeRating === rating}
                  onChange={() => selectRating(rating)}
                />
                <span>{t(`chat_task_rate_${rating}`)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Recovery surface: human hint + exactly one primary CTA per waitReason (design/006 §5 #4).
          Stop remains only in chijie-task-controls below. */}
      {(snapshot.status === 'failed' ||
        snapshot.status === 'cancelled' ||
        snapshot.status === 'waiting_user' ||
        snapshot.status === 'inputs_required') && (
        <div data-testid="task-next-step" className="chijie-next-step" data-primary-organism="recovery">
          <div className="font-medium">{t('chat_task_next_step_title')}</div>
          <div className="mt-1" data-testid="task-failure-reason">
            {failureNextStep(snapshot)}
          </div>
          {/* Product taxonomy only — never raw failureCategory as primary copy. */}
          {snapshot.status === 'failed' && round?.failureCategory && (
            <div
              className="mt-1 text-[11px] opacity-70"
              data-testid="task-failure-category"
              data-product-code={toProductFailureCode(round.failureCategory)}>
              {productFailureLabel(round.failureCategory)}
            </div>
          )}

          {/* One primary CTA: confirm (proof) | continue | retry. Stop stays in controls. */}
          {snapshot.status === 'waiting_user' &&
            round?.waitReason === 'proof_required' &&
            confirmations.map(confirmation => (
              <button
                key={confirmation.id}
                type="button"
                data-testid="criterion-confirm"
                className={`${primaryButtonClassName} mt-2`}
                onClick={() =>
                  send({
                    type: 'confirm_completion',
                    commandId: crypto.randomUUID(),
                    taskId: snapshot.id,
                    expectedRevision: snapshot.revision,
                    roundId: round.id,
                    criterionId: confirmation.id,
                  })
                }>
                {t('chat_task_confirm_done')}
              </button>
            ))}

          {waitAction === 'wait-continue' && (
            <button
              type="button"
              data-testid="wait-continue"
              className={`${primaryButtonClassName} mt-2`}
              onClick={() =>
                send({
                  type: 'resume',
                  commandId: crypto.randomUUID(),
                  taskId: snapshot.id,
                  expectedRevision: snapshot.revision,
                })
              }>
              {t('chat_task_wait_continue')}
            </button>
          )}
          {waitAction === 'wait-retry' && (
            <button
              type="button"
              data-testid="wait-retry"
              className={`${primaryButtonClassName} mt-2`}
              onClick={() =>
                send({
                  type: 'resume',
                  commandId: crypto.randomUUID(),
                  taskId: snapshot.id,
                  expectedRevision: snapshot.revision,
                })
              }>
              {t('chat_task_wait_retry')}
            </button>
          )}
          {canRetryResearchFailure(snapshot, evidenceSpace) && (
            <button
              type="button"
              data-testid="research-retry"
              className={`${primaryButtonClassName} mt-2`}
              onClick={() =>
                send({
                  type: 'retry_research',
                  commandId: crypto.randomUUID(),
                  taskId: snapshot.id,
                  expectedRevision: snapshot.revision,
                })
              }>
              {t('chat_task_retry_research')}
            </button>
          )}
        </div>
      )}

      {showVerifiedDone && !showSkillForm && (
        <div className="chijie-skill-save-row">
          <button type="button" data-testid="skill-save" className={secondaryButtonClassName} onClick={openSkillForm}>
            {t('chat_skills_save')}
          </button>
          <p className="text-xs opacity-80">{t('chat_task_skill_save_hint')}</p>
        </div>
      )}

      {round?.receipt && showSkillForm && (
        <div className={actionStackClassName}>
          <label className="flex flex-col gap-1 text-xs">
            {t('chat_skills_titlePlaceholder')}
            <input
              data-testid="skill-title"
              value={skillTitle}
              onChange={event => setSkillTitle(event.target.value)}
              placeholder={t('chat_skills_titlePlaceholder')}
              className="chijie-field"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('chat_skills_templatePlaceholder')}
            <textarea
              data-testid="skill-template"
              value={skillTemplate}
              onChange={event => setSkillTemplate(event.target.value)}
              rows={3}
              placeholder={t('chat_skills_templatePlaceholder')}
              className="chijie-field"
            />
          </label>
          <p className="text-xs opacity-70">{t('chat_task_skill_template_help')}</p>
          <button
            type="button"
            data-testid="skill-save-confirm"
            className={primaryButtonClassName}
            disabled={!skillTemplate.trim() || Boolean(skillSavePendingId)}
            aria-busy={Boolean(skillSavePendingId)}
            onClick={() => {
              if (skillSavePendingId) return;
              const commandId = crypto.randomUUID();
              setSkillSavePendingId(commandId);
              send({
                type: 'save_skill',
                commandId,
                taskId: snapshot.id,
                expectedRevision: snapshot.revision,
                roundId: round.id,
                title: skillTitle.trim() || t('chat_skills_defaultTitle'),
                instructionTemplate: skillTemplate,
              });
            }}>
            {skillSavePendingId ? t('chat_task_skill_saving') : t('chat_skills_saveConfirm')}
          </button>
          <button
            type="button"
            className={secondaryButtonClassName}
            disabled={Boolean(skillSavePendingId)}
            onClick={() => setShowSkillForm(false)}>
            {t('chat_task_cancel_edit')}
          </button>
        </div>
      )}

    </section>
  );
}
