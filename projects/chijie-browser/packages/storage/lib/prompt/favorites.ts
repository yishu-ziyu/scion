import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export interface FavoritePrompt {
  kind?: 'prompt';
  id: number;
  title: string;
  content: string;
}

export interface SkillInput {
  name: string;
  label: string;
  required: true;
}

export type CompletionCriterionTemplate =
  | { kind: 'url'; operator: 'equals' | 'starts_with'; expectedTemplate: string; required: boolean }
  | { kind: 'page_text'; operator: 'present' | 'absent'; expectedTemplate: string; required: boolean }
  | {
      kind: 'element_state';
      operator: 'equals';
      expected: 'visible' | 'hidden' | 'enabled' | 'disabled';
      required: boolean;
    }
  | { kind: 'media_state'; operator: 'equals'; expected: 'playing' | 'paused'; required: boolean }
  | { kind: 'user_confirmed'; operator: 'equals'; expected: true; required: boolean };

export interface FavoriteSkill {
  kind: 'skill';
  id: number;
  title: string;
  instructionTemplate: string;
  inputs: SkillInput[];
  criteria: CompletionCriterionTemplate[];
  approvalPolicy: 'default' | 'always_confirm_commits';
  sourceTaskId: string;
  version: 1;
}

export type FavoriteItem = FavoritePrompt | FavoriteSkill;
export type NewSkillDefinition = Omit<FavoriteSkill, 'id'>;

const LEGACY_DEFAULT_PROMPTS = [
  {
    id: 1,
    title: '📚 Explore AI Papers',
    content:
      '- Go to https://huggingface.co/papers and click through each of the first 3 papers.\n- For each paper:\n  - Record the title, URL and upvotes\n  - Summarise the abstract section\n- Finally, compile together a summary of all 3 papers, ranked by upvotes',
  },
  {
    id: 2,
    title: '🐦 Follow us on X/Twitter!',
    content: 'Follow us at https://x.com/nanobrowser_ai to stay updated on the latest news and features!',
  },
  {
    id: 3,
    title: '🌟 Star us on GitHub!',
    content:
      "Open the Nanobrowser repository at https://github.com/nanobrowser/nanobrowser and check if you've already starred it. If not, please support us by giving us a star!",
  },
] as const;

/** Match only untouched defaults from older installs; never infer provenance from user text. */
export function isLegacyDefaultFavoritePrompt(item: FavoriteItem): boolean {
  if (item.kind === 'skill') return false;
  return LEGACY_DEFAULT_PROMPTS.some(
    prompt => prompt.id === item.id && prompt.title === item.title && prompt.content === item.content,
  );
}

export interface FavoritesStorage {
  nextId: number;
  prompts: FavoriteItem[];
}

export interface FavoritePromptsStorage {
  addPrompt: (title: string, content: string) => Promise<FavoritePrompt>;
  updatePrompt: (id: number, title: string, content: string) => Promise<FavoritePrompt | undefined>;
  updatePromptTitle: (id: number, title: string) => Promise<FavoriteItem | undefined>;
  removePrompt: (id: number) => Promise<void>;
  getAllPrompts: () => Promise<FavoriteItem[]>;
  getPromptById: (id: number) => Promise<FavoritePrompt | undefined>;
  reorderPrompts: (draggedId: number, targetId: number) => Promise<void>;
  addSkill: (skill: NewSkillDefinition) => Promise<FavoriteSkill>;
  getSkill: (id: number) => Promise<FavoriteSkill | undefined>;
  subscribe: (listener: () => void) => () => void;
}

const SKILL_INPUT_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const SKILL_PLACEHOLDER = /{{\s*([^{}]+?)\s*}}/g;
const SENSITIVE_SKILL_TEXT = /\b(password|token|secret|credential)\b/i;
const SENSITIVE_INPUT_SEGMENT = /^(password|token|secret|credential)(?:\d.*)?$/i;
const DOM_INDEX_TOKEN = /\[\d+\]/;

export function parseSkillInputs(template: string): SkillInput[] {
  const names: string[] = [];
  for (const match of template.matchAll(SKILL_PLACEHOLDER)) {
    const name = match[1]?.trim() ?? '';
    if (!SKILL_INPUT_NAME.test(name)) throw new Error('invalid_skill_input');
    if (name.split('_').some(segment => SENSITIVE_INPUT_SEGMENT.test(segment))) {
      throw new Error('invalid_skill_input');
    }
    if (!names.includes(name)) names.push(name);
  }
  if (
    template.replace(SKILL_PLACEHOLDER, '').includes('{{') ||
    template.replace(SKILL_PLACEHOLDER, '').includes('}}')
  ) {
    throw new Error('invalid_skill_input');
  }
  return names.map(name => ({ name, label: name, required: true }));
}

export function assertExactSkillInputs(inputs: SkillInput[], values: Record<string, string>): void {
  const expected = inputs.map(input => input.name).sort();
  const actual = Object.keys(values).sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new Error('invalid_skill_input');
  }
  for (const name of expected) {
    const value = values[name];
    if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) {
      throw new Error('invalid_skill_input');
    }
  }
}

export function compileSkillTemplate(template: string, values: Record<string, string>): string {
  const inputs = parseSkillInputs(template);
  assertExactSkillInputs(inputs, values);
  return template.replace(SKILL_PLACEHOLDER, (_placeholder, rawName: string) => values[rawName.trim()]);
}

export function createSkillDefinition(input: {
  title: string;
  instructionTemplate: string;
  criteria: CompletionCriterionTemplate[];
  sourceTaskId: string;
}): NewSkillDefinition {
  const title = input.title.trim();
  const instructionTemplate = input.instructionTemplate.trim();
  if (!title || !instructionTemplate || !input.sourceTaskId) throw new Error('invalid_skill');
  if (SENSITIVE_SKILL_TEXT.test(instructionTemplate) || DOM_INDEX_TOKEN.test(instructionTemplate)) {
    throw new Error('invalid_skill');
  }
  const inputs = parseSkillInputs(instructionTemplate);
  if (input.criteria.length === 0 || input.criteria.some(criterion => JSON.stringify(criterion).includes('{{'))) {
    throw new Error('invalid_skill_criterion');
  }
  return {
    kind: 'skill',
    title,
    instructionTemplate,
    inputs,
    criteria: structuredClone(input.criteria),
    approvalPolicy: 'default',
    sourceTaskId: input.sourceTaskId,
    version: 1,
  };
}

// Initial state with proper typing
const initialState: FavoritesStorage = {
  nextId: 1,
  prompts: [],
};

// Create the favorites storage
const favoritesStorage: BaseStorage<FavoritesStorage> = createStorage('favorites', initialState, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

/**
 * Creates a storage interface for managing favorite prompts
 */
export function createFavoritesStorage(): FavoritePromptsStorage {
  return {
    addPrompt: async (title: string, content: string): Promise<FavoritePrompt> => {
      // Check if prompt with same content already exists
      const { prompts } = await favoritesStorage.get();
      const existingPrompt = prompts.find(
        (prompt): prompt is FavoritePrompt => prompt.kind !== 'skill' && prompt.content === content,
      );

      // If exists, return the existing prompt
      if (existingPrompt) {
        return existingPrompt;
      }

      // Otherwise add new prompt
      let created!: FavoritePrompt;
      await favoritesStorage.set(prev => {
        const id = prev.nextId;
        created = { id, title, content };

        return {
          nextId: id + 1,
          prompts: [created, ...prev.prompts],
        };
      });

      return created;
    },

    updatePrompt: async (id: number, title: string, content: string): Promise<FavoritePrompt | undefined> => {
      let updatedPrompt: FavoritePrompt | undefined;

      await favoritesStorage.set(prev => {
        const updatedPrompts = prev.prompts.map(prompt => {
          if (prompt.id === id && prompt.kind !== 'skill') {
            updatedPrompt = { ...prompt, title, content };
            return updatedPrompt;
          }
          return prompt;
        });

        // If prompt wasn't found, leave the storage unchanged
        if (!updatedPrompt) {
          return prev;
        }

        return {
          ...prev,
          prompts: updatedPrompts,
        };
      });

      return updatedPrompt;
    },

    updatePromptTitle: async (id: number, title: string): Promise<FavoriteItem | undefined> => {
      let updatedPrompt: FavoriteItem | undefined;

      await favoritesStorage.set(prev => {
        const updatedPrompts = prev.prompts.map(prompt => {
          if (prompt.id === id) {
            updatedPrompt = { ...prompt, title };
            return updatedPrompt;
          }
          return prompt;
        });

        // If prompt wasn't found, leave the storage unchanged
        if (!updatedPrompt) {
          return prev;
        }

        return {
          ...prev,
          prompts: updatedPrompts,
        };
      });

      return updatedPrompt;
    },

    removePrompt: async (id: number): Promise<void> => {
      await favoritesStorage.set(prev => ({
        ...prev,
        prompts: prev.prompts.filter(prompt => prompt.id !== id),
      }));
    },

    getAllPrompts: async (): Promise<FavoriteItem[]> => {
      const currentState = await favoritesStorage.get();
      let prompts = currentState.prompts;

      // Purge untouched upstream defaults from installs that already seeded chrome.storage.
      if (prompts.some(isLegacyDefaultFavoritePrompt)) {
        await favoritesStorage.set(prev => ({
          ...prev,
          prompts: prev.prompts.filter(item => !isLegacyDefaultFavoritePrompt(item)),
        }));
        prompts = (await favoritesStorage.get()).prompts;
      }

      return [...prompts];
    },

    getPromptById: async (id: number): Promise<FavoritePrompt | undefined> => {
      const { prompts } = await favoritesStorage.get();
      return prompts.find((prompt): prompt is FavoritePrompt => prompt.id === id && prompt.kind !== 'skill');
    },

    reorderPrompts: async (draggedId: number, targetId: number): Promise<void> => {
      await favoritesStorage.set(prev => {
        // Create a copy of the current prompts
        const promptsCopy = [...prev.prompts];

        // Find indexes
        const sourceIndex = promptsCopy.findIndex(prompt => prompt.id === draggedId);
        const targetIndex = promptsCopy.findIndex(prompt => prompt.id === targetId);

        // Ensure both indexes are valid
        if (sourceIndex === -1 || targetIndex === -1) {
          return prev; // No changes if either index is invalid
        }

        // Reorder by removing dragged item and inserting at target position
        const [movedItem] = promptsCopy.splice(sourceIndex, 1);
        promptsCopy.splice(targetIndex, 0, movedItem);

        return {
          ...prev,
          prompts: promptsCopy,
        };
      });
    },

    addSkill: async (skill: NewSkillDefinition): Promise<FavoriteSkill> => {
      const canonical = createSkillDefinition({
        title: skill.title,
        instructionTemplate: skill.instructionTemplate,
        criteria: skill.criteria,
        sourceTaskId: skill.sourceTaskId,
      });
      const existing = (await favoritesStorage.get()).prompts.find(
        (item): item is FavoriteSkill =>
          item.kind === 'skill' &&
          item.sourceTaskId === canonical.sourceTaskId &&
          item.title === canonical.title &&
          item.instructionTemplate === canonical.instructionTemplate &&
          JSON.stringify(item.criteria) === JSON.stringify(canonical.criteria),
      );
      if (existing) return existing;
      let stored!: FavoriteSkill;
      await favoritesStorage.set(previous => {
        stored = { ...canonical, approvalPolicy: skill.approvalPolicy, id: previous.nextId };
        return {
          nextId: previous.nextId + 1,
          prompts: [stored, ...previous.prompts],
        };
      });
      return stored;
    },

    getSkill: async (id: number): Promise<FavoriteSkill | undefined> => {
      const { prompts } = await favoritesStorage.get();
      return prompts.find((prompt): prompt is FavoriteSkill => prompt.id === id && prompt.kind === 'skill');
    },

    subscribe: listener => favoritesStorage.subscribe(listener),
  };
}

// Export an instance of the storage by default
export default createFavoritesStorage();
