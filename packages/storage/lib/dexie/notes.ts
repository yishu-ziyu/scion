import { db } from './db';
import { createCrud } from './crud';
import type { NoteRow } from './db';

const crud = createCrud<NoteRow>(db.notes);

export const createNote = crud.create;
export const listNotes = crud.list;
export const getNote = crud.get;
export const updateNote = crud.update;
export const deleteNote = crud.delete;

export const listNotesByTask = async (taskId: string): Promise<NoteRow[]> =>
  db.notes.where('taskId').equals(taskId).sortBy('createdAt');
