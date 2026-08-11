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
});
