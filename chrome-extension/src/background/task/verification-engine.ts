/**
 * Independent VerificationEngine (product/022).
 * Executor/Skill/LLM may only propose candidate_complete.
 * Verifier does not read Executor reasoning.
 */
import { checkCompletion, type CompletionCheckInput, type CompletionCheckResult } from './completion';
import { artifactContains, artifactSourceCount, tableColumns, tableRowCount, type TaskArtifact } from './artifact';

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

export function checkArtifactCriteria(
  artifacts: TaskArtifact[],
  criteria: ArtifactCriterion[],
): ArtifactCheckEvidence[] {
  return criteria.map(criterion => {
    const primary = artifacts[0];
    switch (criterion.kind) {
      case 'artifact_exists': {
        const passed = artifacts.length > 0;
        return {
          kind: criterion.kind,
          passed,
          reason: passed ? undefined : 'no_artifact',
          observed: artifacts.length,
        };
      }
      case 'artifact_contains': {
        if (!primary) {
          return { kind: criterion.kind, passed: false, reason: 'no_artifact' };
        }
        const passed = artifactContains(primary, criterion.expected);
        return {
          kind: criterion.kind,
          passed,
          reason: passed ? undefined : 'missing_content',
          observed: passed,
        };
      }
      case 'artifact_schema': {
        if (!primary) {
          return { kind: criterion.kind, passed: false, reason: 'no_artifact' };
        }
        const cols = tableColumns(primary).map(c => c.toLowerCase());
        const missing = criterion.expected.filter(c => !cols.includes(c.toLowerCase()));
        const passed = missing.length === 0;
        return {
          kind: criterion.kind,
          passed,
          reason: passed ? undefined : `missing_columns:${missing.join(',')}`,
          observed: cols.join(','),
        };
      }
      case 'artifact_row_count': {
        if (!primary) {
          return { kind: criterion.kind, passed: false, reason: 'no_artifact' };
        }
        const n = tableRowCount(primary);
        const passed = cmp(criterion.operator, n, criterion.expected);
        return {
          kind: criterion.kind,
          passed,
          reason: passed ? undefined : 'row_count_mismatch',
          observed: n,
        };
      }
      case 'artifact_source_count': {
        if (!primary) {
          return { kind: criterion.kind, passed: false, reason: 'no_artifact' };
        }
        const n = artifactSourceCount(primary);
        const passed = cmp(criterion.operator, n, criterion.expected);
        return {
          kind: criterion.kind,
          passed,
          reason: passed ? undefined : 'source_count_mismatch',
          observed: n,
        };
      }
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
