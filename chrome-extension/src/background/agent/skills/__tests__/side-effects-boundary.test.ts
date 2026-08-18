/**
 * 022 Side Effects Gate: Skills must not call chrome.* or BrowserContext directly.
 * All browser side effects go Skill → BrowserKernel → dispatchAction.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skillsRoot = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Forbidden direct browser APIs inside skill implementation files (not types/tests). */
const FORBIDDEN = [
  /chrome\.tabs\b/,
  /chrome\.debugger\b/,
  /chrome\.scripting\b/,
  /from\s+['"][^'"]*browser\/context['"]/,
  /from\s+['"]\.\.\/\.\.\/browser\/context['"]/,
  /new\s+BrowserContext\b/,
  // Value usage of BrowserContext (not comments / BrowserKernel)
  /:\s*BrowserContext\b/,
  /as\s+BrowserContext\b/,
  /<\s*BrowserContext\b/,
];

describe('022 Skill side-effect boundary', () => {
  const files = walk(skillsRoot).filter(f => {
    // Allow kernel type imports only via type-only; runtime files checked below.
    return !f.endsWith('/types.ts') && !f.includes('/__tests__/');
  });

  it('enumerates skill source files', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const rel = path.relative(skillsRoot, file);
    it(`${rel} does not call chrome.* or BrowserContext runtime`, () => {
      const code = readFileSync(file, 'utf8');
      // Strip import type lines so type-only BrowserKernel refs in comments ok
      const runtimeCode = code
        .split('\n')
        .filter(line => !/^\s*import\s+type\b/.test(line))
        .join('\n');
      for (const pattern of FORBIDDEN) {
        // BrowserKernel type imports are ok; BrowserContext is not
        if (pattern.source.includes('BrowserContext') && /import\s+type[\s\S]*BrowserContext/.test(code) && !/BrowserContext\b/.test(runtimeCode.replace(/import\s+type[\s\S]*?;/g, ''))) {
          continue;
        }
        expect(runtimeCode, `${rel} matches ${pattern}`).not.toMatch(pattern);
      }
    });
  }

  it('skills import BrowserKernel only as type or via SkillContext', () => {
    const runtimeFiles = files.filter(f => /\/(builtin|sites)\//.test(f));
    for (const file of runtimeFiles) {
      const code = readFileSync(file, 'utf8');
      // Must use context.kernel for act, not bare chrome
      if (code.includes('async run')) {
        expect(code.includes('chrome.tabs') || code.includes('chrome.debugger')).toBe(false);
      }
    }
  });
});
