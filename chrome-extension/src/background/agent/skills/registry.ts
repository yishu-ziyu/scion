/**
 * Skill Registry (product/022).
 */
import type { BrowserSkill, SkillManifest } from './types';

export class SkillRegistry {
  private readonly skills = new Map<string, BrowserSkill>();

  register(skill: BrowserSkill): void {
    const id = skill.manifest.id;
    if (!id) throw new Error('skill_missing_id');
    this.skills.set(id, skill);
  }

  registerAll(skills: BrowserSkill[]): void {
    for (const skill of skills) this.register(skill);
  }

  get(id: string): BrowserSkill | undefined {
    return this.skills.get(id);
  }

  list(options?: { enabledOnly?: boolean }): BrowserSkill[] {
    const all = [...this.skills.values()];
    if (options?.enabledOnly === false) return all;
    return all.filter(s => s.manifest.enabled !== false);
  }

  manifests(): SkillManifest[] {
    return this.list().map(s => s.manifest);
  }

  clear(): void {
    this.skills.clear();
  }

  size(): number {
    return this.skills.size;
  }
}

export function createSkillRegistry(initial?: BrowserSkill[]): SkillRegistry {
  const registry = new SkillRegistry();
  if (initial) registry.registerAll(initial);
  return registry;
}
