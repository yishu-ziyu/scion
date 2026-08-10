import { createSkillRegistry, type SkillRegistry } from './registry';
import { builtinSkills } from './builtin';
import { siteSkills } from './sites';
import type { BrowserSkill } from './types';

export * from './types';
export * from './registry';
export * from './discovery';
export * from './runtime';
export * from './learned/plan';
export { builtinSkills } from './builtin';
export { siteSkills } from './sites';

/** Default production skill set: generic builtins + site adapters. */
export function defaultSkills(): BrowserSkill[] {
  return [...builtinSkills, ...siteSkills];
}

export function createDefaultSkillRegistry(): SkillRegistry {
  return createSkillRegistry(defaultSkills());
}
