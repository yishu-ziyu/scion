import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('buildDomTree.js shadow and marker', () => {
  const src = readFileSync(resolve(__dirname, '../../../../../public/buildDomTree.js'), 'utf8');

  it('stamps data-scion-hi on highlighted nodes', () => {
    expect(src).toContain("setAttribute('data-scion-hi'");
  });

  it('treats visible shadow descendants as top instead of dropping them', () => {
    expect(src).toContain('Treat visible shadow descendants as top');
    expect(src).toMatch(/if \(shadowRoot instanceof ShadowRoot\) \{\s*return true;/);
  });

  it('still walks open shadow roots', () => {
    expect(src).toContain('node.shadowRoot');
    expect(src).toContain('node.shadowRoot.childNodes');
  });
});
