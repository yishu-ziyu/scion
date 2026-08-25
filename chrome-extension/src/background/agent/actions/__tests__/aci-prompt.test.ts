import { describe, expect, it } from 'vitest';
import { renderActionSchemaPrompt } from '../action-prompt';
import { Action } from '../builder';
import { ActionResult } from '../../types';
import {
  ALL_ACTION_SCHEMAS,
  clickElementActionSchema,
  inputTextActionSchema,
  recordEvidenceActionSchema,
  recordResearchDecisionActionSchema,
  searchGoogleActionSchema,
  switchTabActionSchema,
  waitActionSchema,
  type ActionSchema,
} from '../schemas';

function promptFor(schema: ActionSchema): string {
  return new Action(async () => new ActionResult({ extractedContent: 'ok' }), schema, true).prompt();
}

describe('action ACI prompt', () => {
  it('renders when/not-when/examples/boundary into the model-facing prompt', () => {
    const prompt = promptFor(clickElementActionSchema);
    expect(prompt).toBe(renderActionSchemaPrompt(clickElementActionSchema));
    expect(prompt).toContain('When to use:');
    expect(prompt).toContain('Do NOT use when:');
    expect(prompt).toContain('Examples:');
    expect(prompt).toContain('stale index');
    expect(prompt).toContain("'index'");
    expect(prompt).toContain("'query'");
  });

  it('exposes input_text fields after ZodEffects unwrap', () => {
    const prompt = renderActionSchemaPrompt(inputTextActionSchema);
    expect(prompt).toContain('{input_text: {');
    expect(prompt).toContain("'text'");
    expect(prompt).toContain("'index'");
    expect(prompt).toContain("'query'");
  });

  it.each([
    ['search_google', searchGoogleActionSchema, 'open-ended lookup'],
    ['wait', waitActionSchema, 'explicitly asks to wait'],
    ['switch_tab', switchTabActionSchema, 'wrong_tab'],
  ] as const)('%s renders ACI fields in prompt', (_name, schema, marker) => {
    const prompt = promptFor(schema);
    expect(prompt).toContain('When to use:');
    expect(prompt).toContain('Do NOT use when:');
    expect(prompt).toContain('Examples:');
    expect(prompt).toContain('Returns:');
    expect(prompt).toContain('Cost hint:');
    expect(prompt).toContain(marker);
  });

  it('every exported ActionSchema has full ACI metadata', () => {
    for (const schema of ALL_ACTION_SCHEMAS) {
      expect(schema.whenToUse, `${schema.name}.whenToUse`).toBeTruthy();
      expect(schema.whenNotToUse, `${schema.name}.whenNotToUse`).toBeTruthy();
      expect(schema.examples?.length, `${schema.name}.examples`).toBeGreaterThan(0);
      expect(schema.returns, `${schema.name}.returns`).toBeTruthy();
      expect(schema.costHint, `${schema.name}.costHint`).toBeTruthy();
      expect(renderActionSchemaPrompt(schema), `${schema.name} type labels`).not.toContain("'type': 'undefined'");
    }
  });

  it('normalizes single-record model variants before strict evidence validation', () => {
    const action = new Action(async () => new ActionResult({ extractedContent: 'ok' }), recordEvidenceActionSchema);
    const record = {
      record_type: 'product',
      source: 'https://example.com/',
      source_title: 'Example Domain',
      raw_basis: 'Example Domain is illustrative content used in documentation examples.',
      observation: 'The page is a minimal example product surface.',
      inference: 'It can exercise durable evidence recording.',
      confidence: 'high',
      priority: 'low',
      stance: 'neutral',
      dedupe_key: 'product:example-domain',
    };

    expect(action.parse(record)).toEqual({ records: [record] });
    expect(action.parse({ record })).toEqual({ records: [record] });
    expect(action.parse({ evidence: [record] })).toEqual({ records: [record] });
  });

  it('reports invalid action structure without echoing field values', () => {
    const action = new Action(
      async () => new ActionResult({ extractedContent: 'ok' }),
      recordResearchDecisionActionSchema,
    );

    try {
      action.parse({ capabilities: [{ title: 'Incomplete', answers: { userMoment: 'sensitive-value' } }] });
      throw new Error('expected parse to fail');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('Input shape:');
      expect(message).toContain('answers');
      expect(message).not.toContain('sensitive-value');
    }
  });
});
