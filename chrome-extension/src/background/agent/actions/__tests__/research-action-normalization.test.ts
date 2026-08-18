import { describe, expect, it } from 'vitest';
import { inspectEvidenceSpaceActionSchema, recordResearchDecisionActionSchema } from '../schemas';

function camelCapability(index: number) {
  return {
    name: `Capability ${index}`,
    userMoment: `Reader moment ${index}`,
    behaviorChange: `Behavior change ${index}`,
    whyNow: `Why this matters now ${index}`,
    whyNotOthers: `Why alternatives wait ${index}`,
    implementationGap: `Implementation distance ${index}`,
    mvpScope: `Smallest useful scope ${index}`,
    successMetric: `Observable success metric ${index}`,
    evidence: {
      users: [`user-${index}-a`, `user-${index}-b`],
      products: `product-${index}`,
      repo: [`repo-${index}`],
    },
  };
}

describe('research action input normalization', () => {
  it('clamps oversized evidence pages to the supported bound', () => {
    const normalized = inspectEvidenceSpaceActionSchema.normalizeInput?.({ offset: '4', limit: 100 });

    expect(inspectEvidenceSpaceActionSchema.schema.parse(normalized)).toEqual({ offset: 4, limit: 40 });
  });

  it('unwraps and normalizes harmless decision aliases before strict validation', () => {
    const normalized = recordResearchDecisionActionSchema.normalizeInput?.({
      researchDecision: {
        finalCapabilities: [camelCapability(1), camelCapability(2), camelCapability(3)],
        deferredItems: 'Generic PDF chat; broad social feed',
        counterEvidence: ['Some readers prefer external notes'],
      },
    });

    const parsed = recordResearchDecisionActionSchema.schema.parse(normalized) as {
      capabilities: Array<Record<string, unknown>>;
      deferred: string[];
      contradictions: string[];
    };
    expect(parsed.capabilities).toHaveLength(3);
    expect(parsed.capabilities[0]).toMatchObject({
      title: 'Capability 1',
      user_moment: 'Reader moment 1',
      why_others_later: 'Why alternatives wait 1',
      implementation_distance: 'Implementation distance 1',
      user_evidence_ids: ['user-1-a', 'user-1-b'],
      product_evidence_ids: ['product-1'],
      repository_evidence_ids: ['repo-1'],
    });
    expect(parsed.deferred).toEqual(['Generic PDF chat', 'broad social feed']);
    expect(parsed.contradictions).toEqual(['Some readers prefer external notes']);
  });

  it('does not invent missing decision content or evidence', () => {
    const normalized = recordResearchDecisionActionSchema.normalizeInput?.({
      capabilities: [{ title: 'Incomplete' }, camelCapability(2), camelCapability(3)],
      deferred: ['Later'],
    });

    expect(() => recordResearchDecisionActionSchema.schema.parse(normalized)).toThrow();
  });

  it('unwraps nested seven-question answers and evidence matrices without changing gate semantics', () => {
    const normalized = recordResearchDecisionActionSchema.normalizeInput?.({
      selectedCapabilities: Array.from({ length: 3 }, (_, index) => ({
        capability: `Capability ${index + 1}`,
        sevenQuestions: {
          userMoment: 'A concrete reader moment with enough detail',
          behaviorChange: 'The reader completes a clearly different behavior',
          whyNow: 'Current evidence makes this the next priority',
          whyOthersLater: 'Lower-ranked options have weaker cross-source support',
          implementationDistance: 'The repository already contains an adjacent primitive',
          mvpScope: 'Ship the smallest observable end-to-end slice',
          successMetric: 'Measure repeated successful use in the target moment',
        },
        evidenceMatrix: {
          users: [`user-${index}-1`, `user-${index}-2`],
          products: [`product-${index}`],
          repository: [`repository-${index}`],
        },
      })),
      deferredCapabilities: ['Generic assistant chat'],
      counterEvidence: ['Some readers prefer external tools'],
    });

    const parsed = recordResearchDecisionActionSchema.schema.parse(normalized) as {
      capabilities: Array<Record<string, unknown>>;
      deferred: string[];
    };
    expect(parsed.capabilities[0]).toMatchObject({
      title: 'Capability 1',
      user_evidence_ids: ['user-0-1', 'user-0-2'],
      product_evidence_ids: ['product-0'],
      repository_evidence_ids: ['repository-0'],
    });
    expect(parsed.deferred).toEqual(['Generic assistant chat']);
  });

  it('normalizes value-preserving live aliases but still rejects missing seven-question answers', () => {
    const normalized = recordResearchDecisionActionSchema.normalizeInput?.({
      capabilities: Array.from({ length: 3 }, (_, index) => ({
        title: `Capability ${index + 1}`,
        next_step: 'Ship the smallest useful reader workflow first',
        why: 'Cross-source evidence makes this the current priority',
        defer: 'Broader adjacent workflows remain outside this decision',
        user_pain: 'Readers lose context while moving between source text and notes',
        validation: 'At least eighty percent complete the workflow without leaving the reader',
        user_evidence_ids: [`user-${index}-1`, `user-${index}-2`],
        product_evidence_id: `product-${index}`,
        repository_evidence_id: `repository-${index}`,
      })),
    }) as { capabilities: Array<Record<string, unknown>> };

    expect(normalized.capabilities[0]).toMatchObject({
      user_moment: 'Readers lose context while moving between source text and notes',
      why_now: 'Cross-source evidence makes this the current priority',
      mvp: 'Ship the smallest useful reader workflow first',
      success_metric: 'At least eighty percent complete the workflow without leaving the reader',
      product_evidence_ids: ['product-0'],
      repository_evidence_ids: ['repository-0'],
    });
    expect(() => recordResearchDecisionActionSchema.schema.parse(normalized)).toThrow();
  });

  it('rejects a product-card payload even when its source ID aliases are valid', () => {
    const normalized = recordResearchDecisionActionSchema.normalizeInput?.({
      capabilities: Array.from({ length: 3 }, (_, index) => ({
        title: `Capability ${index + 1}`,
        definition: 'A broad product definition is not a seven-question decision',
        user_motivation: 'Readers want to understand difficult source material',
        target_user: 'Readers of long technical documents',
        core_mechanism: 'Connect source passages to structured explanation',
        interaction_model: 'Keep the interaction beside the source text',
        differentiator: 'Ground every result in the current source',
        tradeoff: 'Favor depth over broad assistant behavior',
        user_source_ids: [`user-${index}-1`, `user-${index}-2`],
        product_source_id: `product-${index}`,
        repository_source_id: `repository-${index}`,
        counter_evidence: 'Some readers prefer external notes',
      })),
      deferred: ['Generic assistant chat'],
    }) as { capabilities: Array<Record<string, unknown>> };

    expect(normalized.capabilities[0]).toMatchObject({
      user_evidence_ids: ['user-0-1', 'user-0-2'],
      product_evidence_ids: ['product-0'],
      repository_evidence_ids: ['repository-0'],
    });
    expect(() => recordResearchDecisionActionSchema.schema.parse(normalized)).toThrow();
  });

  it('accepts live source ID aliases when all seven exact semantic answers are present', () => {
    const normalized = recordResearchDecisionActionSchema.normalizeInput?.({
      capabilities: Array.from({ length: 3 }, (_, index) => ({
        title: `Capability ${index + 1}`,
        user_pain: 'Readers lose context while moving between source text and notes',
        behavior_change: 'Readers complete explanation and capture without leaving the source',
        why: 'Cross-source evidence makes this the current priority',
        why_others_later: 'Adjacent workflows have weaker evidence and can wait',
        implementation_distance: 'Existing reader primitives cover navigation but not grounded capture',
        next_step: 'Ship the smallest useful reader workflow first',
        validation: 'At least eighty percent complete the workflow without leaving the reader',
        user_source_ids: [`user-${index}-1`, `user-${index}-2`],
        product_source_id: `product-${index}`,
        repository_source_id: `repository-${index}`,
      })),
      deferred: ['Generic assistant chat'],
      contradictions: [],
    });

    const parsed = recordResearchDecisionActionSchema.schema.parse(normalized) as {
      capabilities: Array<Record<string, unknown>>;
    };
    expect(parsed.capabilities).toHaveLength(3);
    expect(parsed.capabilities[0]).toMatchObject({
      user_evidence_ids: ['user-0-1', 'user-0-2'],
      product_evidence_ids: ['product-0'],
      repository_evidence_ids: ['repository-0'],
    });
  });
});
