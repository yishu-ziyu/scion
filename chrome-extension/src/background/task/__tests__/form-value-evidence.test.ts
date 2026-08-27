import { describe, expect, it } from 'vitest';
import type { CompletionCriterion } from '@extension/storage/lib/task';
import type { PageState } from '../../browser/views';
import { DOMElementNode } from '../../browser/dom/views';
import { checkCompletion } from '../completion';
import {
  deriveFillOnlyFormCriteria,
  digestFormField,
  digestFormValue,
  observeFormValueCriteria,
} from '../form-value-evidence';

function field(index: number, attributes: Record<string, string>): DOMElementNode {
  return new DOMElementNode({
    tagName: 'input',
    xpath: `/input[${index}]`,
    attributes,
    children: [],
    isVisible: true,
    isInteractive: true,
    isTopElement: true,
    isInViewport: true,
    highlightIndex: index,
  });
}

function state(nodes: DOMElementNode[]): PageState {
  return {
    tabId: 7,
    url: 'https://example.test/form',
    title: 'Form',
    elementTree: new DOMElementNode({
      tagName: 'body',
      xpath: '/body',
      attributes: {},
      children: nodes,
      isVisible: true,
    }),
    selectorMap: new Map(nodes.map(node => [node.highlightIndex as number, node])),
  } as unknown as PageState;
}

async function criterion(fieldName: string, value: string): Promise<CompletionCriterion> {
  return {
    id: 'criterion-form-value',
    roundId: 'round-1',
    targetRefId: 'tab-7',
    required: true,
    frozenAt: 100,
    notBefore: 100,
    timeoutMs: 1_000,
    baseline: false,
    kind: 'page_text',
    operator: 'present',
    expectedDigest: await digestFormValue(value),
    observationSource: 'form_value',
    formFieldDigest: await digestFormField(fieldName),
  };
}

describe('fill-only form completion evidence', () => {
  it('derives an exact-value criterion only when the user says not to submit', () => {
    const codeLike = 'eval(1); document.body.remove()';
    expect(
      deriveFillOnlyFormCriteria(
        `Fill the Name field with this exact plain text: "${codeLike}". Do not submit the form.`,
      ),
    ).toEqual([{ kind: 'form_value', operator: 'equals', field: 'Name', expected: codeLike, required: true }]);
    expect(deriveFillOnlyFormCriteria('Fill Name with Ada and submit.')).toEqual([]);
    expect(deriveFillOnlyFormCriteria('Fill the password field with "hunter2". Do not submit.')).toEqual([]);
  });

  it('returns boolean evidence for one matching ordinary field without persisting the raw value', async () => {
    const raw = 'eval(1); document.body.remove()';
    const frozen = await criterion('Name', raw);
    const observations = await observeFormValueCriteria({
      state: state([field(1, { type: 'text', name: 'Name', accname: 'Name', value: raw })]),
      criteria: [frozen],
      observedAt: 220,
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      criterionId: frozen.id,
      roundId: frozen.roundId,
      observedAt: 220,
      source: 'page',
      value: true,
    });
    expect(observations[0]?.targetRefId).toMatch(/^form:[a-f0-9]{64}$/);
    expect(JSON.stringify({ frozen, observations })).not.toContain(raw);
  });

  it('fails closed for a mismatch, duplicate field identity, or sensitive field', async () => {
    const frozen = await criterion('Name', 'Ada');
    const mismatch = await observeFormValueCriteria({
      state: state([field(1, { type: 'text', name: 'Name', accname: 'Name', value: 'Grace' })]),
      criteria: [frozen],
      observedAt: 220,
    });
    expect(mismatch[0]?.value).toBe(false);

    const duplicate = await observeFormValueCriteria({
      state: state([
        field(1, { type: 'text', name: 'Name', accname: 'Name', value: 'Ada' }),
        field(2, { type: 'text', name: 'Name', accname: 'Name', value: 'Ada' }),
      ]),
      criteria: [frozen],
      observedAt: 220,
    });
    expect(duplicate).toEqual([]);

    const sensitive = await criterion('OTP', '583920');
    const sensitiveObservations = await observeFormValueCriteria({
      state: state([
        field(3, { type: 'text', name: 'OTP', accname: 'OTP', autocomplete: 'one-time-code', value: '583920' }),
      ]),
      criteria: [sensitive],
      observedAt: 220,
    });
    expect(sensitiveObservations).toEqual([]);
  });

  it('forms completion evidence only from the fresh matching target', async () => {
    const frozen = await criterion('Name', 'Ada');
    const observations = await observeFormValueCriteria({
      state: state([field(1, { type: 'text', name: 'Name', accname: 'Name', value: 'Ada' })]),
      criteria: [frozen],
      observedAt: 220,
    });
    const bound = { ...frozen, targetRefId: observations[0]!.targetRefId };

    expect(checkCompletion({ now: 220, currentRoundId: 'round-1', criteria: [bound], observations })).toMatchObject({
      passed: true,
      evidence: [expect.objectContaining({ passed: true, value: true, targetRefId: bound.targetRefId })],
    });
    expect(
      checkCompletion({
        now: 220,
        currentRoundId: 'round-1',
        criteria: [bound],
        observations: [{ ...observations[0]!, targetRefId: 'form:' + '0'.repeat(64) }],
      }).evidence[0]?.reason,
    ).toBe('wrong_target');
    expect(
      checkCompletion({
        now: 220,
        currentRoundId: 'round-1',
        criteria: [{ ...bound, notBefore: 221 }],
        observations,
      }).evidence[0]?.reason,
    ).toBe('stale');
  });

  it('rejects a matching field when the page revision is not the frozen one', async () => {
    const frozen = { ...(await criterion('Name', 'Ada')), pageRevision: 'rev-1' };
    const observations = await observeFormValueCriteria({
      state: state([field(1, { type: 'text', name: 'Name', accname: 'Name', value: 'Ada' })]),
      criteria: [frozen],
      observedAt: 220,
      pageRevision: 'rev-2',
    });

    expect(observations[0]).toMatchObject({ pageRevision: 'rev-2', value: true });
    expect(
      checkCompletion({ now: 220, currentRoundId: 'round-1', criteria: [frozen], observations }).evidence[0]?.reason,
    ).toBe('wrong_target');
  });
});
