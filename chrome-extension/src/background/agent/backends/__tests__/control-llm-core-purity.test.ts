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
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(codeOnly).not.toMatch(/from ['"][^'"]*browser\/sites\//);
    expect(codeOnly).not.toMatch(/import\(['"][^'"]*browser\/sites\//);
    expect(codeOnly).not.toMatch(/from ['"][^'"]*sites\/(bilibili|youtube|form-fill|product-table|public-shortcuts)/);
    // Must route through kernel + skills.
    expect(codeOnly).toMatch(/createBrowserKernel/);
    expect(codeOnly).toMatch(/createSkillRuntime|skillRuntime/);
    expect(codeOnly).toMatch(/settleProposedDone/);
    expect(codeOnly).toMatch(/from '\.\/control-supervise'/);
    expect(codeOnly).toMatch(/reportLoopPhase/);
    expect(codeOnly).toMatch(/searchObserveLoopPhase/);
    expect(codeOnly).toMatch(/waitForLoad:\s*false/);
    const persistSerp = codeOnly.slice(
      codeOnly.indexOf('const persistSerpObserve'),
      codeOnly.indexOf('const observeFrame'),
    );
    expect(persistSerp).toMatch(/searchObserveLoopPhase/);
    expect(persistSerp).toMatch(/collectSearchFindings/);
    const reobserveAt = codeOnly.indexOf('reobserve: async ()');
    const reobserve = codeOnly.slice(reobserveAt, codeOnly.indexOf('resolveQueuedAction: action', reobserveAt));
    expect(reobserveAt).toBeGreaterThan(0);
    expect(reobserve).toMatch(/persistSerpObserve/);
    const parseAt = codeOnly.indexOf('parseControlPolicyDecision');
    const parseBlock = codeOnly.slice(parseAt, codeOnly.indexOf('control JSON parse failed', parseAt));
    expect(parseBlock.indexOf('filterPageSummaryActions')).toBeGreaterThan(0);
    expect(parseBlock.indexOf('filterPageSummaryActions')).toBeLessThan(parseBlock.indexOf('applyInaccessibleIframeGate'));
  });

  it('mailbox ask writes userVisibleText as the round page reading', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../control-llm.ts'), 'utf8');
    const askAt = source.indexOf("mailbox.kind === 'ask'");
    expect(askAt).toBeGreaterThan(0);
    const ask = source.slice(askAt, source.indexOf("mailbox.kind === 'open'", askAt));
    expect(ask).toContain('persistPageReading(mailbox.userVisibleText)');
    expect(ask).toContain("kind: 'waiting_user'");
    expect(ask).toContain("reason: 'target_ambiguous'");
  });
});
