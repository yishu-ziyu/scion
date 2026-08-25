/**
 * Turn observe/decide/reobserve loop phases into live ActionAttempt rows
 * before the first dispatchAction.
 */
import type { ActionAttempt, AttemptFinding } from '@extension/storage/lib/task';

// Local copy of packages/storage/lib/task/page-reading.ts: importing @extension/storage here loads chrome.storage into page tests.
const PAGE_READING_NOISE =
  /^(思考中|获取页面快照|查看页面|推进当前任务|已按步骤做完|正在处理|正在操作页面|在想下一步|正在看\s|page_state)$/;

function isHumanPageReading(value: string | undefined): boolean {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (text.length < 2) return false;
  if (PAGE_READING_NOISE.test(text)) return false;
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(text) && !/[\u4e00-\u9fff]/.test(text)) return false;
  return true;
}

function compactPageReading(value: string, max = 160): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

export type LoopPhaseName = 'observe' | 'decide' | 'act' | 'reobserve';

export const OBSERVE_PHASE_SUMMARY = '获取页面快照';

export function createObservePhaseAttempt(roundId: string, now: number, step = 0): ActionAttempt {
  return {
    id: crypto.randomUUID(),
    roundId,
    actionName: 'observe',
    effect: 'read',
    argsDigest: `loop-phase:observe:${step}`,
    displaySummary: OBSERVE_PHASE_SUMMARY,
    state: 'executing',
    proposedAt: now,
    executingAt: now,
  };
}

export function isLiveObserveAttempt(attempt: ActionAttempt | undefined): boolean {
  if (!attempt || attempt.actionName !== 'observe') return false;
  return attempt.state === 'executing' || attempt.state === 'proposed' || attempt.state === 'authorized';
}

export function completeObservePhaseAttempt(attempt: ActionAttempt, now: number): ActionAttempt {
  return { ...attempt, state: 'observed', observedAt: now };
}

function persistableHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return (url.origin + url.pathname).replace(/\/+$/, '') || url.origin;
  } catch {
    return undefined;
  }
}

function applyObserveEvidence(
  attempt: ActionAttempt,
  input: { detail?: string; findings?: AttemptFinding[]; targetUrl?: string },
): ActionAttempt {
  let next = attempt;
  if (input.findings && input.findings.length > 0) next = { ...next, findings: input.findings };
  const targetUrl = persistableHttpUrl(input.targetUrl);
  if (targetUrl) next = { ...next, targetUrl };
  const detail = input.detail?.replace(/\s+/g, ' ').trim();
  if (detail && /^搜索/.test(detail)) next = { ...next, displaySummary: compactPageReading(detail, 80) };
  else if (input.findings && input.findings.length > 0 && next.displaySummary === OBSERVE_PHASE_SUMMARY) {
    next = { ...next, displaySummary: '搜索网页' };
  }
  return next;
}

export function attemptsAfterLoopPhase(input: {
  attempts: ActionAttempt[];
  phase: LoopPhaseName;
  step: number;
  roundId: string;
  now: number;
  detail?: string;
  findings?: AttemptFinding[];
  targetUrl?: string;
}): { next: ActionAttempt[]; changed: ActionAttempt[]; pageReading?: string } {
  const next = input.attempts.map(attempt => ({ ...attempt }));
  const changed: ActionAttempt[] = [];
  const liveIndexes = next
    .map((attempt, index) => (isLiveObserveAttempt(attempt) ? index : -1))
    .filter(index => index >= 0);

  const completeLive = () => {
    for (const index of liveIndexes) {
      const completed = completeObservePhaseAttempt(next[index]!, input.now);
      next[index] = completed;
      changed.push(completed);
    }
  };

  const pageReading = isHumanPageReading(input.detail) ? compactPageReading(input.detail!, 160) : undefined;

  if (input.phase === 'observe') {
    if (liveIndexes.length === 0) {
      const created = applyObserveEvidence(createObservePhaseAttempt(input.roundId, input.now, input.step), input);
      next.push(created);
      changed.push(created);
    } else {
      const index = liveIndexes[0]!;
      const patched = applyObserveEvidence(next[index]!, input);
      if (patched !== next[index]) {
        next[index] = patched;
        changed.push(patched);
      }
    }
    return { next, changed };
  }

  if (input.phase === 'reobserve') {
    completeLive();
    const created = applyObserveEvidence(createObservePhaseAttempt(input.roundId, input.now, input.step), input);
    next.push(created);
    changed.push(created);
    return { next, changed };
  }

  completeLive();
  return { next, changed, ...(pageReading && input.phase === 'decide' ? { pageReading } : {}) };
}
