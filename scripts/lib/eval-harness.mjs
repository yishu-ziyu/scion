/** Fields that identify one reproducible eval arm. */
export const EVAL_IDENTITY_FIELDS = [
  'campaign_stamp',
  'arm_hash',
  'run_id',
  'task_id',
  'attempt',
  'git_sha',
  'model',
  'prompt_version',
  'policy_tag',
  'attach_mode',
  'provider',
  'provider_base_url',
  'feature_flags_hash',
];

export const ALLOWED_EVAL_OUTCOMES = new Set(['verified_pass', 'fail', 'invalid_run']);
export const EVAL_SECURITY_FIELDS = ['false_complete', 'wrong_tab', 'unapproved_commit'];

export function evalIdentityKey(row) {
  return JSON.stringify(EVAL_IDENTITY_FIELDS.map(field => String(row[field] ?? '')));
}

export function uniqueEvalRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('cannot merge zero eval rows');
  const byIdentity = new Map();
  const seenAttempts = new Set();
  for (const row of rows) {
    const taskAttempt = `${row.task_id}\u0000${row.attempt}`;
    if (seenAttempts.has(taskAttempt)) {
      throw new Error(`duplicate task attempt task=${row.task_id} attempt=${row.attempt}`);
    }
    seenAttempts.add(taskAttempt);
    const key = evalIdentityKey(row);
    if (byIdentity.has(key)) {
      throw new Error(
        `duplicate eval identity task=${row.task_id} attempt=${row.attempt} git=${row.git_sha} model=${row.model}`,
      );
    }
    byIdentity.set(key, row);
  }
  return [...byIdentity.values()];
}

export function parseMatrixRows(output) {
  const rows = [];
  const pattern = /(?:^|\n)matrix_row\s+([^\r\n]+)/g;
  for (const match of String(output || '').matchAll(pattern)) {
    try {
      rows.push(JSON.parse(match[1]));
    } catch {
      // A malformed protocol line is equivalent to a missing matrix row.
    }
  }
  return rows;
}

export function matrixProtocolCount(output) {
  return (String(output || '').match(/(?:^|\n)matrix_row\s+/g) || []).length;
}

/** Validate the runner-owned protocol before matrix identity is applied. */
export function validateRunnerMatrixRow(row, { taskId, attempt, identity = null }) {
  const errors = [];
  if (String(row?.task_id ?? '') !== String(taskId)) errors.push(`task_id=${row?.task_id ?? '<missing>'}`);
  if (Number(row?.attempt) !== attempt || !Number.isInteger(Number(row?.attempt))) {
    errors.push(`attempt=${row?.attempt ?? '<missing>'}`);
  }
  if (!ALLOWED_EVAL_OUTCOMES.has(row?.outcome)) errors.push(`outcome=${row?.outcome ?? '<missing>'}`);
  for (const field of EVAL_SECURITY_FIELDS) {
    if (![0, 1, '0', '1'].includes(row?.[field])) errors.push(`${field}=${row?.[field] ?? '<missing>'}`);
  }
  for (const field of [
    'campaign_stamp',
    'arm_hash',
    'run_id',
    'model',
    'provider',
    'provider_base_url',
    'feature_flags_hash',
    'prompt_version',
    'policy_tag',
    'attach_mode',
  ]) {
    if (!String(row?.[field] ?? '').trim()) errors.push(`${field}=<missing>`);
  }
  if (identity) {
    for (const [field, expected] of Object.entries(identity)) {
      if (String(row?.[field] ?? '') !== String(expected ?? '')) {
        errors.push(`${field}=${row?.[field] ?? '<missing>'} expected=${expected}`);
      }
    }
  }
  return errors;
}

export function missingMatrixRow({ taskId, attempt, model, promptVersion, policyTag, latencyMs, exitCode }) {
  return {
    task_id: taskId,
    attempt,
    model,
    prompt_version: promptVersion,
    policy_tag: policyTag,
    outcome: 'invalid_run',
    false_complete: 0,
    wrong_tab: 0,
    unapproved_commit: 0,
    latency_ms: latencyMs,
    failure_class: 'harness_protocol',
    notes: `missing matrix_row; exit=${exitCode}`,
  };
}

/** Matrix-owned identity wins over stale/hard-coded values emitted by legacy runners. */
export function canonicalizeMatrixRow(row, identity) {
  return {
    ...row,
    campaign_stamp: identity.campaignStamp ?? row.campaign_stamp,
    arm_hash: identity.armHash ?? row.arm_hash,
    run_id: identity.runId ?? row.run_id,
    task_id: identity.taskId,
    attempt: identity.attempt,
    git_sha: identity.gitSha,
    model: identity.model,
    prompt_version: identity.promptVersion,
    policy_tag: identity.policyTag,
  };
}

export function reconcileRunnerExit(row, exitCode) {
  if (exitCode === 0 || row.outcome !== 'verified_pass') return row;
  return {
    ...row,
    outcome: 'invalid_run',
    failure_class: 'harness_exit',
    notes: `${row.notes ? `${row.notes}; ` : ''}runner emitted pass but exited ${exitCode}`,
  };
}

export function inferAttachMode({ connectUrl = '', script = [] } = {}) {
  if (script.some(part => String(part).includes('eval-022-unit-gates'))) return 'unit';
  if (connectUrl) return 'connected_cdp';
  if (script.some(part => /(?:e2e|eval-(?:public|frontier)-task)\.mjs$/.test(String(part)))) {
    return 'launched_chrome_for_testing';
  }
  return 'unknown';
}
