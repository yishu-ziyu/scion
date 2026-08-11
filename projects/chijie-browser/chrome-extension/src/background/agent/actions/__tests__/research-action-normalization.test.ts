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
});
