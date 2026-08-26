import { db } from './db';
import { createCrud } from './crud';
import type { SourceRow } from './db';

const crud = createCrud<SourceRow>(db.sources);

export const createSource = crud.create;
export const listSources = crud.list;
export const getSource = crud.get;
export const updateSource = crud.update;
export const deleteSource = crud.delete;

export const listSourcesByTask = async (taskId: string): Promise<SourceRow[]> =>
  db.sources.where('taskId').equals(taskId).sortBy('createdAt');
