import { describe, expect, it } from 'vitest';
import {
  allowsVerifiedComplete,
  assertMutableStateBinding,
  classifyActOutcome,
  makePageRevision,
  readClaimedState,
} from '../page-state';

describe('product/007 P0 page-state', () => {
  it('makePageRevision is stable for same observe parts', () => {
    const a = makePageRevision({ tabId: 1, urlOrigin: 'https://a.test', snapshotDigest: 'dom1' });
    const b = makePageRevision({ tabId: 1, urlOrigin: 'https://a.test', snapshotDigest: 'dom1' });
    const c = makePageRevision({ tabId: 1, urlOrigin: 'https://a.test', snapshotDigest: 'dom2' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('rejects stale pageRevision (force re-observe)', () => {
    const r = assertMutableStateBinding({
      claimedRevision: '1|https://a.test|old',
      observedRevision: '1|https://a.test|new',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale_page_revision');
  });

  it('rejects stale target digest under same revision', () => {
    const r = assertMutableStateBinding({
      claimedRevision: 'rev-1',
      observedRevision: 'rev-1',
      claimedTargetDigest: 'btn-a',
      observedTargetDigest: 'btn-b',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale_target_ref');
  });

  it('allows matching revision + target', () => {
    const r = assertMutableStateBinding({
      claimedRevision: 'rev-1',
      observedRevision: 'rev-1',
      claimedTargetDigest: 'btn-a',
      observedTargetDigest: 'btn-a',
    });
    expect(r.ok).toBe(true);
  });

  it('allows missing claim (backward compatible path)', () => {
    expect(
      assertMutableStateBinding({
        observedRevision: 'rev-1',
        observedTargetDigest: 'btn-a',
      }).ok,
    ).toBe(true);
  });

  it('classifies external_commit without expect as unknown (delivery ≠ success)', () => {
    expect(
      classifyActOutcome({
        effect: 'external_commit',
        expectEvidence: [],
        hasExpect: false,
      }),
    ).toBe('unknown');
  });

  it('classifies expect all-pass as worked', () => {
    expect(
      classifyActOutcome({
        effect: 'external_commit',
        expectEvidence: [{ passed: true }, { passed: true }],
        hasExpect: true,
      }),
    ).toBe('worked');
  });

  it('classifies expect mismatch as didnt', () => {
    expect(
      classifyActOutcome({
        effect: 'external_commit',
        expectEvidence: [{ passed: false, reason: 'mismatch' }],
        hasExpect: true,
      }),
    ).toBe('didnt');
  });

  it('classifies timed_out expect as unknown', () => {
    expect(
      classifyActOutcome({
        effect: 'reversible',
        expectEvidence: [{ passed: false, reason: 'timed_out' }],
        hasExpect: true,
      }),
    ).toBe('unknown');
  });

  it('classifies transport uncertain as unknown', () => {
    expect(
      classifyActOutcome({
        effect: 'external_commit',
        expectEvidence: [],
        hasExpect: false,
        uncertain: true,
      }),
    ).toBe('unknown');
  });

  it('blocks verified complete without required criteria even if model says done', () => {
    expect(
      allowsVerifiedComplete({
        completionPassed: true,
        hasRequiredCriteria: false,
      }),
    ).toBe(false);
  });

  it('allows verified complete only when criteria exist and pass', () => {
    expect(
      allowsVerifiedComplete({
        completionPassed: true,
        hasRequiredCriteria: true,
      }),
    ).toBe(true);
    expect(
      allowsVerifiedComplete({
        completionPassed: false,
        hasRequiredCriteria: true,
      }),
    ).toBe(false);
  });

  it('readClaimedState accepts snake_case and camelCase', () => {
    expect(readClaimedState({ page_revision: 'r1', target_digest: 't1', expect: { text: 'ok' } })).toEqual({
      pageRevision: 'r1',
      targetDigest: 't1',
      hasExpectFlag: true,
    });
    expect(readClaimedState({ stateId: 's1' }).pageRevision).toBe('s1');
  });
});
