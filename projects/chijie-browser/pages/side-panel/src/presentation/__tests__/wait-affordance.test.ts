import { describe, expect, it } from 'vitest';
import { waitUserActionTestId } from '../wait-affordance';

describe('waitUserActionTestId (g3-wait-afford)', () => {
  it('proof_required stays on criterion-confirm (no wait-continue/retry)', () => {
    expect(waitUserActionTestId('proof_required')).toBeNull();
    expect(waitUserActionTestId(undefined)).toBeNull();
    expect(waitUserActionTestId(null)).toBeNull();
    expect(waitUserActionTestId('')).toBeNull();
  });

  it('commit_outcome_uncertain maps to wait-retry', () => {
    expect(waitUserActionTestId('commit_outcome_uncertain')).toBe('wait-retry');
  });

  it.each([
    'login_required',
    'captcha_required',
    'target_missing',
    'target_ambiguous',
    'approval_rejected',
    'skill_inputs_required',
  ] as const)('%s maps to wait-continue', reason => {
    expect(waitUserActionTestId(reason)).toBe('wait-continue');
  });
});
