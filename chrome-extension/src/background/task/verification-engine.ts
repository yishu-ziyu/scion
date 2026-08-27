/**
 * Independent VerificationEngine (product/022).
 * Executor/Skill/LLM may only propose candidate_complete.
 * Verifier does not read Executor reasoning.
 */
import { checkCompletion, type CompletionCheckInput, type CompletionCheckResult } from './completion';
import {
  artifactContains,
  tableArtifacts,
  tableColumns,
  tableDataRows,
  tableRowCount,
  uniqueArtifactSources,
  type TaskArtifact,
} from './artifact';

export type ArtifactCriterion =
  | { kind: 'artifact_exists'; required?: boolean }
  | { kind: 'artifact_contains'; expected: string; required?: boolean }
  | { kind: 'artifact_schema'; expected: string[]; required?: boolean }
  | { kind: 'artifact_row_count'; operator: '>=' | '=='; expected: number; required?: boolean }
  | { kind: 'artifact_source_count'; operator: '>=' | '=='; expected: number; required?: boolean };

export type VerificationVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface VerificationInput {
  /** Existing environment criteria check (url/page_text/...). */
  completion?: CompletionCheckInput;
  artifacts?: TaskArtifact[];
  artifactCriteria?: ArtifactCriterion[];
  /**
   * Optional LLM judge signal for semantic quality only.
   * Judge MUST NOT override deterministic failures.
   */
  llmJudge?: { passed: boolean; reason?: string };
}

export interface ArtifactCheckEvidence {
  kind: ArtifactCriterion['kind'];
  passed: boolean;
  reason?: string;
  observed?: string | number | boolean;
}

export interface VerificationResult {
  verdict: VerificationVerdict;
  /** True only for PASS. INCONCLUSIVE is treated as not complete. */
  complete: boolean;
  completion?: CompletionCheckResult;
  artifactEvidence: ArtifactCheckEvidence[];
  reasons: string[];
}

function cmp(op: '>=' | '==', left: number, right: number): boolean {
  return op === '>=' ? left >= right : left === right;
}

function checkExists(artifacts: TaskArtifact[]): ArtifactCheckEvidence {
  const passed = artifacts.length > 0;
  return {
    kind: 'artifact_exists',
    passed,
    reason: passed ? undefined : 'no_artifact',
    observed: artifacts.length,
  };
}

function checkContains(artifacts: TaskArtifact[], expected: string): ArtifactCheckEvidence {
  if (artifacts.length === 0) return { kind: 'artifact_contains', passed: false, reason: 'no_artifact' };
  const passed = artifacts.some(artifact => artifactContains(artifact, expected));
  return {
    kind: 'artifact_contains',
    passed,
    reason: passed ? undefined : 'missing_content',
    observed: passed,
  };
}

function isBlankRequiredCell(value: unknown): boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (typeof value === 'string') return value.trim() === '';
  return true;
}

function missingSchemaColumns(artifact: TaskArtifact, expected: string[]): string[] {
  const columns = tableColumns(artifact);
  const rows = tableDataRows(artifact);
  return expected.filter(name => {
    const key = columns.find(column => column.toLowerCase() === name.toLowerCase());
    if (!key) return true;
    if (rows.length === 0) return true;
    return rows.some(row => isBlankRequiredCell(row[key]));
  });
}

function checkSchema(artifacts: TaskArtifact[], expected: string[]): ArtifactCheckEvidence {
  const tables = tableArtifacts(artifacts);
  if (tables.length === 0) return { kind: 'artifact_schema', passed: false, reason: 'no_artifact' };
  const missing = [...new Set(tables.flatMap(table => missingSchemaColumns(table, expected)))];
  const passed = missing.length === 0;
  return {
    kind: 'artifact_schema',
    passed,
    reason: passed ? undefined : `missing_columns:${missing.join(',')}`,
    observed: tables.map(table => tableColumns(table).join(',')).join('|'),
  };
}

function checkRowCount(artifacts: TaskArtifact[], operator: '>=' | '==', expected: number): ArtifactCheckEvidence {
  const tables = tableArtifacts(artifacts);
  if (tables.length === 0) return { kind: 'artifact_row_count', passed: false, reason: 'no_artifact' };
  const n = tables.reduce((sum, table) => sum + tableRowCount(table), 0);
  if (tables.length > 1 && tables.some(table => tableRowCount(table) < 1)) {
    return { kind: 'artifact_row_count', passed: false, reason: 'empty_source_artifact', observed: n };
  }
  const passed = cmp(operator, n, expected);
  return {
    kind: 'artifact_row_count',
    passed,
    reason: passed ? undefined : 'row_count_mismatch',
    observed: n,
  };
}

function sourceCountArtifacts(artifacts: TaskArtifact[]): TaskArtifact[] {
  const tables = tableArtifacts(artifacts);
  if (tables.length === 0) return artifacts;
  return tables.filter(table => tableRowCount(table) >= 1);
}

function checkSourceCount(artifacts: TaskArtifact[], operator: '>=' | '==', expected: number): ArtifactCheckEvidence {
  if (artifacts.length === 0) return { kind: 'artifact_source_count', passed: false, reason: 'no_artifact' };
  const n = uniqueArtifactSources(sourceCountArtifacts(artifacts)).length;
  const passed = cmp(operator, n, expected);
  return {
    kind: 'artifact_source_count',
    passed,
    reason: passed ? undefined : 'source_count_mismatch',
    observed: n,
  };
}

export function checkArtifactCriteria(
  artifacts: TaskArtifact[],
  criteria: ArtifactCriterion[],
): ArtifactCheckEvidence[] {
  return criteria.map(criterion => {
    switch (criterion.kind) {
      case 'artifact_exists':
        return checkExists(artifacts);
      case 'artifact_contains':
        return checkContains(artifacts, criterion.expected);
      case 'artifact_schema':
        return checkSchema(artifacts, criterion.expected);
      case 'artifact_row_count':
        return checkRowCount(artifacts, criterion.operator, criterion.expected);
      case 'artifact_source_count':
        return checkSourceCount(artifacts, criterion.operator, criterion.expected);
      default:
        return { kind: 'artifact_exists', passed: false, reason: 'unknown_criterion' };
    }
  });
}

/**
 * Independent verification entrypoint.
 * INCONCLUSIVE => not complete (never success).
 */
export function verifyCandidateComplete(input: VerificationInput): VerificationResult {
  const reasons: string[] = [];
  const artifactEvidence = checkArtifactCriteria(input.artifacts ?? [], input.artifactCriteria ?? []);

  let completion: CompletionCheckResult | undefined;
  if (input.completion) {
    completion = checkCompletion(input.completion);
    if (!completion.passed) {
      reasons.push('completion_failed');
    }
  }

  const requiredArtifactFailed = (input.artifactCriteria ?? []).some((c, i) => {
    const required = c.required !== false;
    return required && artifactEvidence[i] && !artifactEvidence[i].passed;
  });
  if (requiredArtifactFailed) {
    reasons.push('artifact_failed');
  }

  // No criteria at all → inconclusive (cannot self-prove from executor summary alone).
  const hasEnvCriteria = Boolean(input.completion && input.completion.criteria.length > 0);
  const hasArtifactCriteria = (input.artifactCriteria ?? []).length > 0;
  if (!hasEnvCriteria && !hasArtifactCriteria) {
    return {
      verdict: 'INCONCLUSIVE',
      complete: false,
      completion,
      artifactEvidence,
      reasons: ['no_criteria'],
    };
  }

  const hasRequiredEnvCriterion = Boolean(input.completion?.criteria.some(criterion => criterion.required));
  const hasRequiredArtifactCriterion = (input.artifactCriteria ?? []).some(criterion => criterion.required !== false);
  if (!hasRequiredEnvCriterion && !hasRequiredArtifactCriterion) {
    return {
      verdict: 'INCONCLUSIVE',
      complete: false,
      completion,
      artifactEvidence,
      reasons: ['no_required_criteria'],
    };
  }

  if (reasons.length > 0) {
    return {
      verdict: 'FAIL',
      complete: false,
      completion,
      artifactEvidence,
      reasons,
    };
  }

  // Deterministic checks passed. LLM judge cannot override failures (already returned).
  // If judge fails on semantic quality, mark FAIL only when judge provided.
  if (input.llmJudge && input.llmJudge.passed === false) {
    return {
      verdict: 'FAIL',
      complete: false,
      completion,
      artifactEvidence,
      reasons: ['llm_judge_failed', input.llmJudge.reason ?? 'semantic_quality'],
    };
  }

  return {
    verdict: 'PASS',
    complete: true,
    completion,
    artifactEvidence,
    reasons: ['ok'],
  };
}
