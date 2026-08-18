import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';
import type { TaskSession } from './types';

const storage = createStorage<Record<string, TaskSession>>(
  'task-runtime-v1',
  {},
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

export async function getTask(id: string): Promise<TaskSession | null> {
  return (await storage.get())[id] ?? null;
}

export async function getActiveTask(): Promise<TaskSession | null> {
  const tasks = Object.values(await storage.get());
  const nonTerminal = tasks.filter(task => !['completed', 'failed', 'cancelled'].includes(task.status));
  return (nonTerminal.length > 0 ? nonTerminal : tasks).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

export async function saveTask(task: TaskSession): Promise<void> {
  await storage.set(tasks => ({ ...tasks, [task.id]: task }));
}
