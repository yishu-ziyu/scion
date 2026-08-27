import type { ChunkRecord, SourceRecord } from '@extension/wisebase-core';
import Dexie, { type Table } from 'dexie';

export interface ChatSessionRow {
  id: string;
  title: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageRow {
  id: string;
  sessionId: string;
  actor: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskRow {
  id: string;
  content: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface SourceRow {
  id: string;
  taskId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface NoteRow {
  id: string;
  taskId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export class ScionDB extends Dexie {
  chatSessions!: Table<ChatSessionRow, string>;
  chatMessages!: Table<ChatMessageRow, string>;
  tasks!: Table<TaskRow, string>;
  sources!: Table<SourceRow, string>;
  notes!: Table<NoteRow, string>;
  wisebaseSources!: Table<SourceRecord, string>;
  wisebaseChunks!: Table<ChunkRecord, string>;

  constructor(name = 'scion') {
    super(name);
    this.version(1).stores({
      chat_sessions: 'id, status, createdAt, updatedAt',
      chat_messages: 'id, sessionId, createdAt',
      tasks: 'id, status, createdAt, updatedAt',
      sources: 'id, taskId, createdAt',
      notes: 'id, taskId, createdAt',
    });
    this.version(2).stores({
      wisebase_sources: 'id, &fingerprint, canonicalUrl, sourceType, createdAt, updatedAt',
      wisebase_chunks: 'id, sourceId, &[sourceId+index]',
    });
    this.chatSessions = this.table('chat_sessions');
    this.chatMessages = this.table('chat_messages');
    this.tasks = this.table('tasks');
    this.sources = this.table('sources');
    this.notes = this.table('notes');
    this.wisebaseSources = this.table('wisebase_sources');
    this.wisebaseChunks = this.table('wisebase_chunks');
  }
}

export const db = new ScionDB();
