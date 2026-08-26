import type { Table, UpdateSpec } from 'dexie';

export interface RowBase {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export type CreateInput<T extends RowBase> = Omit<T, 'createdAt' | 'updatedAt'> &
  Partial<Pick<T, 'createdAt' | 'updatedAt'>>;

export type UpdateInput<T extends RowBase> = Partial<Omit<T, 'id' | 'createdAt'>>;

export function createCrud<T extends RowBase>(table: Table<T, string>) {
  return {
    create: async (input: CreateInput<T>): Promise<T> => {
      const now = Date.now();
      const row = { createdAt: now, updatedAt: now, ...input } as T;
      await table.add(row);
      return row;
    },
    list: async (): Promise<T[]> => table.orderBy('createdAt').toArray(),
    get: async (id: string): Promise<T | undefined> => table.get(id),
    update: async (id: string, patch: UpdateInput<T>): Promise<T | undefined> => {
      const count = await table.update(id, { ...patch, updatedAt: Date.now() } as UpdateSpec<T>);
      return count === 0 ? undefined : table.get(id);
    },
    delete: async (id: string): Promise<void> => table.delete(id),
  };
}
