/**
 * Skill Discovery (product/022).
 * Pre-filter ≤ topK candidates from URL + intent + domain match.
 */
import type { SkillRegistry } from './registry';
import type { BrowserSkill, SkillCandidate, SkillRuntimeFlags } from './types';
import { isAtomicSkillInstruction } from './instruction-scope';

export interface DiscoverSkillsInput {
  registry: SkillRegistry;
  instruction: string;
  url: string;
  phaseId?: string;
  capabilities?: string[];
  flags?: SkillRuntimeFlags;
  topK?: number;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function domainMatches(manifestDomains: string[] | undefined, host: string): boolean {
  if (!manifestDomains || manifestDomains.length === 0) return true;
  if (manifestDomains.includes('*')) return true;
  return manifestDomains.some(domain => {
    const d = domain.toLowerCase().replace(/^\*\./, '');
    return host === d || host.endsWith(`.${d}`) || host.includes(d);
  });
}

function capabilityBoost(skill: BrowserSkill, wanted: string[] | undefined): number {
  if (!wanted || wanted.length === 0) return 0;
  const caps = new Set(skill.manifest.capabilities.map(c => c.toLowerCase()));
  let hit = 0;
  for (const w of wanted) {
    if (caps.has(w.toLowerCase())) hit += 1;
  }
  return hit * 2;
}

/**
 * Rank and return top skill candidates. Empty → caller falls back to generic loop.
 */
export function discoverSkills(input: DiscoverSkillsInput): SkillCandidate[] {
  if (!isAtomicSkillInstruction(input.instruction)) return [];

  const topK = input.topK ?? 5;
  const host = hostFromUrl(input.url);
  const candidates: SkillCandidate[] = [];

  for (const skill of input.registry.list({ enabledOnly: true })) {
    if (!domainMatches(skill.manifest.domains, host)) continue;

    let score = 0;
    let reason = 'domain';

    if (skill.match) {
      const m = skill.match({
        instruction: input.instruction,
        url: input.url,
        flags: input.flags,
      });
      if (!m || m.score <= 0) continue;
      score += m.score;
      reason = m.reason;
    } else {
      // Generic skills without match only surface when domain is specific or capability asked.
      if (!input.capabilities?.length && (!skill.manifest.domains || skill.manifest.domains.includes('*'))) {
        continue;
      }
      score = 1;
      reason = 'listed';
    }

    score += capabilityBoost(skill, input.capabilities);
    if (input.phaseId && skill.manifest.capabilities.includes(input.phaseId)) {
      score += 1;
    }

    candidates.push({ skill, score, reason });
  }

  candidates.sort((a, b) => b.score - a.score || a.skill.manifest.id.localeCompare(b.skill.manifest.id));
  return candidates.slice(0, topK);
}
