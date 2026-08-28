import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The JSON-in-text control driver is retired. Production is ToolLoopAgent.
 */
describe('retired JSON control driver', () => {
  it('is not on the factory production path and no longer extracts JSON from model text', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const factory = readFileSync(join(here, '../../factory.ts'), 'utf8');
    const retired = readFileSync(join(here, '../control-llm.ts'), 'utf8');
    expect(factory).toContain('createToolLoopControlDriver');
    expect(factory).not.toMatch(/createLlmControlDriver/);
    expect(retired).not.toContain('export async function createLlmControlDriver');
    expect(retired).not.toContain('extractJsonFromModelOutput');
  });
});
