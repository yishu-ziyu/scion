import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractWebpageContext } from '../src/extract';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}.html`, import.meta.url)), 'utf8');

describe('extractWebpageContext', () => {
  it('extracts article structure and source anchors', () => {
    const result = extractWebpageContext(fixture('article'));

    expect(result).toMatchObject({
      sourceType: 'webpage',
      title: 'How Context Windows Work',
      url: 'https://example.com/context',
      trustLevel: 'untrusted',
    });
    expect(result.blocks).toEqual([
      { type: 'heading', level: 1, text: 'How Context Windows Work' },
      { type: 'paragraph', text: 'A context window limits how much text a model can consider at once.' },
      { type: 'heading', level: 2, text: 'Why budgets matter' },
      { type: 'paragraph', text: 'Useful context should keep the source structure while removing repeated chrome.' },
      { type: 'list', ordered: false, items: ['Keep headings', 'Remove navigation'] },
      { type: 'paragraph', text: 'Read the full guide.' },
      {
        type: 'table',
        rows: [
          ['Model', 'Window'],
          ['Small', '8k'],
        ],
      },
    ]);
    expect(result.anchors).toEqual([
      { id: 'how-context-windows-work', blockIndex: 0, text: 'How Context Windows Work' },
      { id: 'why-budgets-matter', blockIndex: 2, text: 'Why budgets matter' },
      { id: 'full-guide', blockIndex: 5, text: 'full guide', href: 'https://example.com/guide' },
    ]);
  });

  it('keeps list pages and standalone links', () => {
    const result = extractWebpageContext(fixture('list'), { url: 'https://example.com/releases' });
    expect(result.blocks).toContainEqual({
      type: 'list',
      ordered: true,
      items: [
        'Version 3 adds table extraction.',
        'Version 2 adds selection context.',
        'Version 1 adds article extraction.',
      ],
    });
    expect(result.blocks).toContainEqual({
      type: 'link',
      text: 'Browse the archive',
      href: 'https://example.com/archive',
    });
    expect(result.blocks.flatMap(block => ('text' in block ? [block.text] : [])).join(' ')).not.toContain('Docs API');
  });

  it('rejects navigation, advertising, comments, aside and footer noise', () => {
    const result = extractWebpageContext(fixture('noisy'));
    const text = JSON.stringify(result.blocks);
    expect(text).toContain("page's actual answer");
    expect(text).not.toMatch(/cookie|Buy this|unrelated|comments|Terms Privacy/i);
  });

  it('handles uppercase tags and omitted paragraph closing tags', () => {
    const result = extractWebpageContext(
      '<HTML><HEAD><TITLE>Caps</TITLE></HEAD><BODY><MAIN><H1 id="TOP">Caps</H1><P>First<P>Second</MAIN></BODY></HTML>',
      { url: 'https://example.com/caps' },
    );

    expect(result.blocks).toEqual([
      { type: 'heading', level: 1, text: 'Caps' },
      { type: 'paragraph', text: 'First' },
      { type: 'paragraph', text: 'Second' },
    ]);
    expect(result.anchors[0].id).toBe('TOP');
  });

  it('returns an empty safe bundle for blank input', () => {
    expect(extractWebpageContext('   ')).toEqual({
      sourceType: 'webpage',
      title: '',
      url: '',
      blocks: [],
      anchors: [],
      trustLevel: 'untrusted',
    });
  });
});
