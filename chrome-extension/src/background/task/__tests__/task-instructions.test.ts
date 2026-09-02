import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recallTaskInstruction, rememberTaskInstruction } from '../task-instructions';

type Store = Record<string, unknown>;

describe('task instruction recovery store', () => {
  let storage: Store;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[] | null) => {
            const wanted = keys === null ? Object.keys(storage) : Array.isArray(keys) ? keys : [keys];
            const out: Store = {};
            for (const key of wanted) if (key in storage) out[key] = storage[key];
            return out;
          }),
          set: vi.fn(async (patch: Store) => {
            Object.assign(storage, patch);
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips an instruction for a live task', async () => {
    storage['task-runtime-v1'] = { 'task-1': { id: 'task-1' } };
    await rememberTaskInstruction('task-1', 'Fill Name and submit; success is Saved successfully.');
    await expect(recallTaskInstruction('task-1')).resolves.toBe('Fill Name and submit; success is Saved successfully.');
  });

  it('keeps the id being written even when the task row is not persisted yet', async () => {
    // manager.start calls rememberAcceptedTask before persist(task).
    storage['task-runtime-v1'] = {};
    await rememberTaskInstruction('task-2', 'composed instruction');
    await expect(recallTaskInstruction('task-2')).resolves.toBe('composed instruction');
  });

  it('garbage-collects records whose task no longer exists on the next write', async () => {
    storage['task-runtime-v1'] = { 'task-live': { id: 'task-live' } };
    await rememberTaskInstruction('task-dead', 'old instruction');
    await rememberTaskInstruction('task-live', 'fresh instruction');
    await expect(recallTaskInstruction('task-dead')).resolves.toBeUndefined();
    await expect(recallTaskInstruction('task-live')).resolves.toBe('fresh instruction');
  });

  it('never stores empty or whitespace-only instructions', async () => {
    storage['task-runtime-v1'] = { 'task-3': { id: 'task-3' } };
    await rememberTaskInstruction('task-3', 'real instruction');
    await rememberTaskInstruction('task-3', '   ');
    await expect(recallTaskInstruction('task-3')).resolves.toBe('real instruction');
  });

  it('degrades gracefully without chrome.storage', async () => {
    vi.unstubAllGlobals();
    await expect(rememberTaskInstruction('task-4', 'x')).resolves.toBeUndefined();
    await expect(recallTaskInstruction('task-4')).resolves.toBeUndefined();
  });
});
