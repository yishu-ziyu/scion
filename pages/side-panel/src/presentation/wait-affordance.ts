/** Primary waiting surface; every returned action must match TaskManager's transition contract. */

import type { TaskStatus, WaitReason } from '@extension/storage';

export type WaitUserAction = 'continue-in-composer' | 'clarify-in-composer';

/**
 * `waiting_user` cannot receive `resume`; only a user-authored follow-up can continue
 * login/captcha/target recovery. Proof has its own confirm command. Commit uncertainty
 * deliberately has no retry command, and skill inputs have no in-task submission contract.
 */
export function waitUserAction(waitReason: WaitReason | undefined | null): WaitUserAction | null {
  if (waitReason === 'login_required' || waitReason === 'captcha_required') return 'continue-in-composer';
  if (waitReason === 'target_missing' || waitReason === 'target_ambiguous') return 'clarify-in-composer';
  return null;
}

export function taskAllowsDirectionChange(status: TaskStatus, reason?: WaitReason): boolean {
  if (status === 'inputs_required') return false;
  if (
    status === 'waiting_user' &&
    (reason === 'commit_outcome_uncertain' || reason === 'target_missing' || reason === 'target_ambiguous')
  ) {
    return false;
  }
  return true;
}

/** Waiting and interrupted states must expose Stop without hiding it behind a menu. */
export function taskNeedsDirectStop(status: TaskStatus): boolean {
  return status === 'waiting_user' || status === 'inputs_required' || status === 'interrupted';
}

export function taskLocksComposer(status: TaskStatus, reason?: WaitReason): boolean {
  return (
    status === 'interrupted' ||
    status === 'inputs_required' ||
    (status === 'waiting_user' && reason === 'commit_outcome_uncertain')
  );
}
