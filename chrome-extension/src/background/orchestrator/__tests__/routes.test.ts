import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const orchestratorDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (name.endsWith('.ts')) found.push(full);
  }
  return found;
}

describe('orchestrator product routes', () => {
  it('must not hardcode translation, page_summary, or 这一页 as a product route', () => {
    const banned = /翻译|translate this page|page_summary/;
    const files = [...sourceFiles(orchestratorDir), join(orchestratorDir, '../chat-stream.ts')];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(banned);
      expect(text, file).not.toContain('这一页');
    }
  });

  it('must not attach the debugger or call getCurrentPage; page reads stay on the content script', () => {
    const banned = /getCurrentPage|attachPuppeteer|debugger\.attach/;
    const files = [...sourceFiles(orchestratorDir), join(orchestratorDir, '../chat-stream.ts')];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(banned);
    }
    const liveHost = readFileSync(join(orchestratorDir, 'live-host.ts'), 'utf8');
    expect(liveHost).toContain('collectPageContextFromTab');
  });
});
