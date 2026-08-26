import { db } from './db';
import { createCrud } from './crud';
import type { TaskRow } from './db';

const crud = createCrud<TaskRow>(db.tasks);

export const createTask = crud.create;
export const listTasks = crud.list;
export const getTask = crud.get;
export const updateTask = crud.update;
export const deleteTask = crud.delete;
