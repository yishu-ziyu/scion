import { db } from './db';
import { createCrud } from './crud';
import type { ChatMessageRow } from './db';

const crud = createCrud<ChatMessageRow>(db.chatMessages);

export const createMessage = crud.create;
export const listMessages = crud.list;
export const getMessage = crud.get;
export const updateMessage = crud.update;
export const deleteMessage = crud.delete;

export const listMessagesBySession = async (sessionId: string): Promise<ChatMessageRow[]> =>
  db.chatMessages.where('sessionId').equals(sessionId).sortBy('createdAt');
