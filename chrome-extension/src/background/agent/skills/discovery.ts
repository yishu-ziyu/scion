/**
 * Skill Discovery (decision 005).
 * Skills must not preempt the observe→decide loop by matching the user utterance.
 */
import type { SkillRegistry } from './registry';
import type { SkillCandidate, SkillRuntimeFlags } from './types';

export interface DiscoverSkillsInput {
  registry: SkillRegistry;
  instruction: string;
  url: string;
  phaseId?: string;
  capabilities?: string[];
  flags?: SkillRuntimeFlags;
  topK?: number;
}

export function discoverSkills(_input: DiscoverSkillsInput): SkillCandidate[] {
  return [];
}
