/**
 * Skill Discovery.
 * Atomic known-method tasks (form / extract / first video / media) may match.
 * Understanding / answer skills and long-horizon / chained instructions stay in
 * the observe→decide loop.
 */
import { isAtomicSkillInstruction } from './instruction-scope';
import type { SkillRegistry } from './registry';
import type { BrowserSkill, SkillCandidate, SkillRuntimeFlags } from './types';

export interface DiscoverSkillsInput {
  registry: SkillRegistry;
  instruction: string;
  url: string;
  phaseId?: string;
  capabilities?: string[];
  flags?: SkillRuntimeFlags;
  topK?: number;
}

const LOOP_OWNED_CAPABILITIES = new Set(['understand_page', 'answer']);

function hostMatches(domains: string[] | undefined, url: string): boolean {
  if (!domains || domains.length === 0 || domains.includes('*')) return true;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some(domain => {
    const needle = domain.replace(/^\*\./, '').replace(/^\./, '').toLowerCase();
    if (!needle) return false;
    return host === needle || host.endsWith(`.${needle}`);
  });
}

function skillStaysInLoop(skill: BrowserSkill): boolean {
  return (skill.manifest.capabilities ?? []).some(capability => LOOP_OWNED_CAPABILITIES.has(capability));
}

export function discoverSkills(input: DiscoverSkillsInput): SkillCandidate[] {
  if (input.flags?.enableSkillRuntime === false) return [];
  if (!isAtomicSkillInstruction(input.instruction)) return [];

  const topK = Math.max(1, input.topK ?? 5);
  const wanted = input.capabilities?.length ? new Set(input.capabilities) : null;
  const candidates: SkillCandidate[] = [];

  for (const skill of input.registry.list()) {
    if (skill.manifest.enabled === false) continue;
    if (skillStaysInLoop(skill)) continue;
    if (wanted && !(skill.manifest.capabilities ?? []).some(capability => wanted.has(capability))) continue;
    if (!hostMatches(skill.manifest.domains, input.url)) continue;
    const match = skill.match?.({
      instruction: input.instruction,
      url: input.url,
      flags: input.flags,
    });
    if (!match) continue;
    candidates.push({ skill, score: match.score, reason: match.reason });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates.slice(0, topK);
}
