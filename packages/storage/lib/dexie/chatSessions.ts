import { db } from './db';
import { createCrud } from './crud';
import type { ChatSessionRow } from './db';

const crud = createCrud<ChatSessionRow>(db.chatSessions);

export const createSession = crud.create;
export const listSessions = crud.list;
export const getSession = crud.get;
export const updateSession = crud.update;
export const deleteSession = crud.delete;
