import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * product/022 hard gate: control-llm.ts must not import browser/sites/*.
 * Site knowledge lives under agent/skills/.
 */
describe('control-llm core purity (022)', () => {
  it('does not import browser/sites/*', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../control-llm.ts'), 'utf8');
    // Strip block/line comments so docstrings mentioning the ban do not false-positive.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(codeOnly).not.toMatch(/from ['"][^'"]*browser\/sites\//);
    expect(codeOnly).not.toMatch(/import\(['"][^'"]*browser\/sites\//);
    expect(codeOnly).not.toMatch(
      /from ['"][^'"]*sites\/(bilibili|youtube|form-fill|product-table|public-shortcuts)/,
    );
    // Must route through kernel + skills.
    expect(codeOnly).toMatch(/createBrowserKernel/);
    expect(codeOnly).toMatch(/createSkillRuntime|skillRuntime/);
    expect(codeOnly).toMatch(/settleProposedDone/);
    expect(codeOnly).toMatch(/from '\.\/control-supervise'/);
    expect(codeOnly).toMatch(/reportLoopPhase/);
    expect(codeOnly).toMatch(/waitForLoad:\s*false/);
  });
});
