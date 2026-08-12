import { honestFailureStatus } from './eval-verification.mjs';

export function selectUniqueNewRuntimeTask(tasks, priorTaskIds, lockedTaskId = '') {
  const prior = new Set((priorTaskIds || []).map(String));
  const candidates = (tasks || []).filter(task => task?.id && !prior.has(String(task.id)));
  const candidate = candidates.length === 1 ? candidates[0] : null;
  return {
    candidate,
    candidateCount: candidates.length,
    scopeInvalid: candidates.length > 1 || Boolean(candidate && lockedTaskId && candidate.id !== lockedTaskId),
  };
}

export function buildActionScenarioEvidence({
  label,
  runtimeTask,
  completion,
  boundTab,
  activeTab,
  pageEvidence = '',
  expectedEffect = '',
  error,
}) {
  const visibleReceiptCount = Number.isInteger(completion?.receiptCount) ? completion.receiptCount : 0;
  const runtimeReceiptCount = runtimeTask?.receipt?.id ? 1 : 0;
  return {
    label,
    terminal_status: runtimeTask?.status || completion?.status || 'running',
    runtime_status: runtimeTask?.status || '',
    ui_status: completion?.status || '',
    receipt_id: runtimeTask?.receipt?.id || completion?.visibleReceiptId || '',
    receipt_count: Math.max(visibleReceiptCount, runtimeReceiptCount),
    completion_result: completion?.resultText || '',
    completion_result_count: Number.isInteger(completion?.resultCount) ? completion.resultCount : 0,
    deliverable: completion?.answer || '',
    deliverable_count: Number.isInteger(completion?.deliverableCount) ? completion.deliverableCount : 0,
    page_evidence: String(pageEvidence || ''),
    expected_effect: String(expectedEffect || ''),
    runtime_task_id: runtimeTask?.id || '',
    runtime_round_id: runtimeTask?.roundId || '',
    scoped_card_count: Number.isInteger(completion?.scopedCardCount) ? completion.scopedCardCount : 0,
    ui_task_id: completion?.uiTaskId || '',
    ui_round_id: completion?.uiRoundId || '',
    visible_receipt_id: completion?.visibleReceiptId || '',
    has_runtime_receipt: Boolean(runtimeTask?.receipt?.id),
    runtime_receipt_id: runtimeTask?.receipt?.id || '',
    runtime_receipt_task_id: runtimeTask?.receipt?.taskId || '',
    runtime_receipt_round_id: runtimeTask?.receipt?.roundId || '',
    task_tab_id: runtimeTask?.activeTabId ?? null,
    target_tab_ids: runtimeTask?.targetTabIds || [],
    bound_tab_id: boundTab?.id ?? null,
    active_tab_id: activeTab?.id ?? null,
    error: String(error?.message || error || '')
      .replace(/\s+/g, ' ')
      .slice(0, 240),
  };
}

export function isAttributableActionFailure(scenario, { scopeInvalid = false, wrongTab = null } = {}) {
  return (
    !scopeInvalid &&
    wrongTab === 0 &&
    honestFailureStatus(scenario?.terminal_status) &&
    honestFailureStatus(scenario?.runtime_status) &&
    scenario?.ui_status === scenario.runtime_status &&
    scenario?.terminal_status === scenario.runtime_status &&
    Boolean(scenario?.runtime_task_id) &&
    Boolean(scenario?.runtime_round_id) &&
    scenario?.scoped_card_count === 1 &&
    scenario?.ui_task_id === scenario.runtime_task_id &&
    scenario?.ui_round_id === scenario.runtime_round_id &&
    scenario?.has_runtime_receipt === false &&
    !scenario?.runtime_receipt_id &&
    !scenario?.runtime_receipt_task_id &&
    !scenario?.runtime_receipt_round_id &&
    !scenario?.visible_receipt_id &&
    scenario?.receipt_count === 0 &&
    scenario?.completion_result_count === 0 &&
    scenario?.deliverable_count === 0
  );
}
