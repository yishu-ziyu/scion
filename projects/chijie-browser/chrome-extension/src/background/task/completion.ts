import type { CompletionCriterion, CompletionEvidence } from '@extension/storage/lib/task';
import type { ProbeObservation } from './contracts';

export interface CompletionCheckInput {
  now: number;
  currentRoundId: string;
  criteria: CompletionCriterion[];
  observations: ProbeObservation[];
}

export interface CompletionCheckResult {
  passed: boolean;
  evidence: CompletionEvidence[];
}

export function checkCompletion(input: CompletionCheckInput): CompletionCheckResult {
  if (input.criteria.length === 0) return { passed: false, evidence: [] };

  const evidence = input.criteria.map(criterion => {
    const observation = latestObservation(input.observations, criterion);
    const reason = rejectionReason(input, criterion, observation);
    return {
      criterionId: criterion.id,
      roundId: observation?.roundId ?? input.currentRoundId,
      targetRefId: observation?.targetRefId ?? criterion.targetRefId,
      observedAt: observation?.observedAt ?? input.now,
      source: observation?.source ?? 'page',
      value: observation?.value ?? false,
      passed: reason === undefined,
      ...(reason ? { reason } : {}),
    } satisfies CompletionEvidence;
  });

  return {
    passed: input.criteria.every((criterion, index) => !criterion.required || evidence[index]?.passed === true),
    evidence,
  };
}

function latestObservation(
  observations: ProbeObservation[],
  criterion: CompletionCriterion,
): ProbeObservation | undefined {
  const candidates = observations.filter(item => item.criterionId === criterion.id);
  const bound = candidates.filter(
    item =>
      item.roundId === criterion.roundId &&
      item.targetRefId === criterion.targetRefId &&
      (criterion.kind !== 'user_confirmed' || item.source === 'user'),
  );
  return latest(bound.length > 0 ? bound : candidates);
}

function latest(observations: ProbeObservation[]): ProbeObservation | undefined {
  return observations.reduce<ProbeObservation | undefined>(
    (current, item) => (!current || item.observedAt >= current.observedAt ? item : current),
    undefined,
  );
}

function rejectionReason(
  input: CompletionCheckInput,
  criterion: CompletionCriterion,
  observation: ProbeObservation | undefined,
): CompletionEvidence['reason'] | undefined {
  if (criterion.roundId !== input.currentRoundId) return 'wrong_round';
  if (!observation) return 'mismatch';
  if (observation.roundId !== input.currentRoundId) return 'wrong_round';
  if (observation.targetRefId !== criterion.targetRefId) return 'wrong_target';
  if (observation.observedAt < criterion.notBefore) return 'stale';
  // Deadline starts from notBefore (advanced to executingAt on external commits),
  // not frozenAt. Otherwise any approval wait longer than timeoutMs always times out
  // even when the post-commit observation is fresh.
  const deadline = criterion.notBefore + criterion.timeoutMs;
  if (input.now > deadline || observation.observedAt > deadline) {
    return 'timed_out';
  }
  if (baselineSatisfies(criterion)) return 'already_true_at_baseline';
  if (criterion.kind === 'user_confirmed' && observation.source !== 'user') return 'mismatch';
  return matches(criterion, observation.value) ? undefined : 'mismatch';
}

function baselineSatisfies(criterion: CompletionCriterion): boolean {
  if (criterion.kind === 'user_confirmed') return false;
  return matches(criterion, criterion.baseline);
}

function matches(criterion: CompletionCriterion, value: boolean | string): boolean {
  switch (criterion.kind) {
    case 'url':
      return (
        typeof value === 'string' &&
        (criterion.operator === 'equals' ? value === criterion.expected : value.startsWith(criterion.expected))
      );
    case 'page_text':
      return typeof value === 'boolean' && value === (criterion.operator === 'present');
    case 'element_state':
    case 'media_state':
    case 'tab_state':
    case 'download_state':
      return value === criterion.expected;
    case 'user_confirmed':
      return value === true;
  }
}
