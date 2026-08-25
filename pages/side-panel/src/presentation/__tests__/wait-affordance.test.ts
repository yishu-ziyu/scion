import { describe, expect, it } from 'vitest';
import { taskAllowsDirectionChange, taskLocksComposer, taskNeedsDirectStop, waitUserAction } from '../wait-affordance';

describe('waitUserAction (TaskManager-aligned)', () => {
  it.each(['proof_required', 'commit_outcome_uncertain', 'skill_inputs_required', undefined, null] as const)(
    '%s has no fake resume/retry CTA',
    reason => {
      expect(waitUserAction(reason)).toBeNull();
    },
  );

  it.each(['login_required', 'captcha_required'] as const)('%s continues through a user-authored follow-up', reason => {
    expect(waitUserAction(reason)).toBe('continue-in-composer');
  });

  it.each(['target_missing', 'target_ambiguous', 'confirm_execute'] as const)(
    '%s asks for a clarifying follow-up',
    reason => {
      expect(waitUserAction(reason)).toBe('clarify-in-composer');
    },
  );

  it('keeps inputs-required and uncertain commits locked without an invalid follow-up affordance', () => {
    expect(taskLocksComposer('inputs_required', 'skill_inputs_required')).toBe(true);
    expect(taskAllowsDirectionChange('inputs_required', 'skill_inputs_required')).toBe(false);
    expect(taskLocksComposer('waiting_user', 'commit_outcome_uncertain')).toBe(true);
    expect(taskAllowsDirectionChange('waiting_user', 'commit_outcome_uncertain')).toBe(false);
  });

  it('uses the clarifying follow-up as the single primary path for target recovery', () => {
    expect(taskLocksComposer('waiting_user', 'target_ambiguous')).toBe(false);
    expect(taskAllowsDirectionChange('waiting_user', 'target_ambiguous')).toBe(false);
    expect(taskAllowsDirectionChange('waiting_user', 'target_missing')).toBe(false);
    expect(taskLocksComposer('waiting_user', 'confirm_execute')).toBe(false);
    expect(taskAllowsDirectionChange('waiting_user', 'confirm_execute')).toBe(false);
  });

  it.each(['waiting_user', 'inputs_required', 'interrupted'] as const)('%s exposes Stop directly', status => {
    expect(taskNeedsDirectStop(status)).toBe(true);
  });

  it.each(['running', 'paused', 'completed', 'failed', 'cancelled'] as const)('%s may demote or omit Stop', status => {
    expect(taskNeedsDirectStop(status)).toBe(false);
  });
});
