import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';
import type { CompletionCriterionTemplate } from '../prompt/favorites';

export interface SkillSaveMeta {
  templates: CompletionCriterionTemplate[];
  unsafe: boolean;
}

const storage = createStorage<Record<string, SkillSaveMeta>>(
  'task-skill-save-v1',
  {},
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

function key(taskId: string, roundId: string): string {
  return `${taskId}:${roundId}`;
}

export async function putSkillSaveMeta(
  taskId: string,
  roundId: string,
  meta: SkillSaveMeta,
): Promise<void> {
  await storage.set(previous => ({
    ...previous,
    [key(taskId, roundId)]: structuredClone(meta),
  }));
}

export async function getSkillSaveMeta(
  taskId: string,
  roundId: string,
): Promise<SkillSaveMeta | null> {
  return (await storage.get())[key(taskId, roundId)] ?? null;
}

export async function clearSkillSaveMetaForTask(taskId: string): Promise<void> {
  const prefix = `${taskId}:`;
  await storage.set(previous => {
    const next = { ...previous };
    for (const entry of Object.keys(next)) {
      if (entry.startsWith(prefix)) delete next[entry];
    }
    return next;
  });
}
