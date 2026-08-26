import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createSession, listSessions, getSession, updateSession, deleteSession } from './chatSessions';
import {
  createMessage,
  listMessages,
  getMessage,
  updateMessage,
  deleteMessage,
  listMessagesBySession,
} from './chatMessages';
import { createTask, listTasks, getTask, updateTask, deleteTask } from './tasks';
import { createSource, getSource, updateSource, deleteSource, listSourcesByTask } from './sources';
import { createNote, getNote, updateNote, deleteNote, listNotesByTask } from './notes';

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()));
});

describe('chatSessions repository', () => {
  it('creates, gets, lists, updates and deletes a session', async () => {
    const created = await createSession({ id: 's1', title: 'first', status: 'active' });
    expect(created.createdAt).toBeGreaterThan(0);
    expect(created.updatedAt).toBe(created.createdAt);

    expect(await getSession('s1')).toMatchObject({ id: 's1', title: 'first', status: 'active' });
    expect(await listSessions()).toHaveLength(1);

    const updated = await updateSession('s1', { status: 'archived' });
    expect(updated).toMatchObject({ id: 's1', status: 'archived' });
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    await deleteSession('s1');
    expect(await getSession('s1')).toBeUndefined();
    expect(await listSessions()).toHaveLength(0);
  });

  it('returns undefined when updating a missing session', async () => {
    expect(await updateSession('nope', { status: 'x' })).toBeUndefined();
  });
});

describe('chatMessages repository', () => {
  it('supports basic CRUD', async () => {
    const created = await createMessage({ id: 'm1', sessionId: 's1', actor: 'user', content: 'hi' });
    expect(await getMessage('m1')).toMatchObject({ id: 'm1', actor: 'user', content: 'hi' });

    const updated = await updateMessage('m1', { content: 'hello' });
    expect(updated).toMatchObject({ content: 'hello' });

    expect(await listMessages()).toHaveLength(1);

    await deleteMessage('m1');
    expect(await getMessage('m1')).toBeUndefined();
    expect(created.id).toBe('m1');
  });

  it('lists messages by sessionId in createdAt order', async () => {
    await createMessage({ id: 'm2', sessionId: 's1', actor: 'assistant', content: 'b', createdAt: 200 });
    await createMessage({ id: 'm1', sessionId: 's1', actor: 'user', content: 'a', createdAt: 100 });
    await createMessage({ id: 'm3', sessionId: 's2', actor: 'user', content: 'other', createdAt: 50 });

    const messages = await listMessagesBySession('s1');
    expect(messages.map(m => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('tasks repository', () => {
  it('supports basic CRUD', async () => {
    await createTask({ id: 't1', content: 'do something', status: 'pending' });
    expect(await getTask('t1')).toMatchObject({ id: 't1', status: 'pending' });

    const updated = await updateTask('t1', { status: 'done' });
    expect(updated).toMatchObject({ status: 'done' });

    expect(await listTasks()).toHaveLength(1);

    await deleteTask('t1');
    expect(await getTask('t1')).toBeUndefined();
  });
});

describe('sources repository', () => {
  it('supports basic CRUD and lists by taskId', async () => {
    await createSource({ id: 'src1', taskId: 't1', content: 'https://a.example', createdAt: 100 });
    await createSource({ id: 'src2', taskId: 't1', content: 'https://b.example', createdAt: 200 });
    await createSource({ id: 'src3', taskId: 't2', content: 'https://c.example' });

    expect(await getSource('src1')).toMatchObject({ content: 'https://a.example' });

    const updated = await updateSource('src1', { content: 'https://a2.example' });
    expect(updated).toMatchObject({ content: 'https://a2.example' });

    const byTask = await listSourcesByTask('t1');
    expect(byTask.map(s => s.id)).toEqual(['src1', 'src2']);

    await deleteSource('src1');
    expect(await getSource('src1')).toBeUndefined();
  });
});

describe('notes repository', () => {
  it('supports basic CRUD and lists by taskId', async () => {
    await createNote({ id: 'n1', taskId: 't1', content: 'note one', createdAt: 100 });
    await createNote({ id: 'n2', taskId: 't1', content: 'note two', createdAt: 200 });
    await createNote({ id: 'n3', taskId: 't2', content: 'other task note' });

    expect(await getNote('n1')).toMatchObject({ content: 'note one' });

    const updated = await updateNote('n2', { content: 'note two v2' });
    expect(updated).toMatchObject({ content: 'note two v2' });

    const byTask = await listNotesByTask('t1');
    expect(byTask.map(n => n.id)).toEqual(['n1', 'n2']);

    await deleteNote('n1');
    expect(await getNote('n1')).toBeUndefined();
  });
});
