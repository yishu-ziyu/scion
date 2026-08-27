import { describe, expect, it } from 'vitest';
import { contextBlockText, type ContextBlock, type ParagraphBlock } from '@extension/context-engine';
import { parsePdfText } from '../src/pdf';

const paragraphs = (blocks: ContextBlock[]): ParagraphBlock[] =>
  blocks.filter((block): block is ParagraphBlock => block.type === 'paragraph');

describe('parsePdfText', () => {
  it('turns each page into a heading plus paragraphs and a page anchor', () => {
    const bundle = parsePdfText([{ text: 'First page body.' }, { text: 'Second page body.' }]);
    expect(bundle.sourceType).toBe('document');
    expect(bundle.trustLevel).toBe('untrusted');
    expect(bundle.blocks).toEqual([
      { type: 'heading', level: 2, text: '第 1 页' },
      { type: 'paragraph', text: 'First page body.' },
      { type: 'heading', level: 2, text: '第 2 页' },
      { type: 'paragraph', text: 'Second page body.' },
    ]);
    expect(bundle.anchors).toEqual([
      { id: 'page-1', blockIndex: 0, text: '第 1 页', href: '#page=1' },
      { id: 'page-2', blockIndex: 2, text: '第 2 页', href: '#page=2' },
    ]);
  });

  it('uses explicit page numbers, labels, and keeps gaps as anchors', () => {
    const bundle = parsePdfText([
      { page: 5, text: 'Intro.' },
      { page: 12, label: 'XII', text: 'Appendix.' },
    ]);
    expect(bundle.anchors.map(a => [a.id, a.href])).toEqual([
      ['page-5', '#page=5'],
      ['page-XII', '#page=12'],
    ]);
    expect(bundle.blocks[0]).toEqual({ type: 'heading', level: 2, text: '第 5 页' });
    expect(bundle.blocks[2]).toEqual({ type: 'heading', level: 2, text: '第 XII 页' });
  });

  it('builds hrefs against metadata.url and preserves Chinese text', () => {
    const bundle = parsePdfText([{ text: '第一页\n中文内容。\n第二段文字。' }], {
      url: 'https://example.com/doc.pdf',
      title: '论文',
    });
    expect(bundle.title).toBe('论文');
    expect(bundle.url).toBe('https://example.com/doc.pdf');
    expect(bundle.anchors[0].href).toBe('https://example.com/doc.pdf#page=1');
    expect(bundle.blocks[0]).toEqual({ type: 'heading', level: 2, text: '第 1 页' });
    expect(bundle.blocks[1]).toEqual({ type: 'paragraph', text: '第一页中文内容。第二段文字。' });
  });

  it('splits paragraphs on blank lines and joins line breaks', () => {
    const bundle = parsePdfText([{ text: 'Para one line one.\nPara one line two.\n\nPara two.' }]);
    expect(bundle.blocks[1]).toEqual({ type: 'paragraph', text: 'Para one line one. Para one line two.' });
    expect(bundle.blocks[2]).toEqual({ type: 'paragraph', text: 'Para two.' });
  });

  it('accepts lines arrays and plain strings (with \\f page separators)', () => {
    const fromLines = parsePdfText([{ lines: ['Hello', 'World'] }]);
    expect(fromLines.blocks[1]).toEqual({ type: 'paragraph', text: 'Hello World' });

    const fromString = parsePdfText('Page one text.\fPage two text.');
    expect(contextBlockText(fromString.blocks[0])).toBe('第 1 页');
    expect(contextBlockText(fromString.blocks[2])).toBe('第 2 页');
    expect(fromString.blocks[3]).toEqual({ type: 'paragraph', text: 'Page two text.' });
  });

  it('splits very long paragraphs at sentence boundaries', () => {
    const long = 'A'.repeat(400) + '。' + 'B'.repeat(400);
    const bundle = parsePdfText([{ text: long }]);
    const texts = paragraphs(bundle.blocks).map(b => b.text);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts[0]).toContain('A');
    expect(texts[1]).toContain('B');
  });

  it('skips empty, whitespace-only, and malformed pages', () => {
    const bundle = parsePdfText([{ text: '' }, { text: '   \n  ' }, {}, { text: 'Only.' }]);
    expect(bundle.blocks).toEqual([
      { type: 'heading', level: 2, text: '第 4 页' },
      { type: 'paragraph', text: 'Only.' },
    ]);
    expect(bundle.anchors).toHaveLength(1);
  });

  it('handles missing page numbers by falling back to input order', () => {
    const bundle = parsePdfText([{ page: 0, text: 'zero' }, { text: 'one' }]);
    expect(bundle.anchors.map(a => a.href)).toEqual(['#page=1', '#page=2']);
    expect(contextBlockText(bundle.blocks[0])).toBe('第 1 页');
  });

  it('accepts a single page item without wrapping it in an array', () => {
    const bundle = parsePdfText({ text: 'Solo page.' });
    expect(bundle.blocks[0]).toEqual({ type: 'heading', level: 2, text: '第 1 页' });
    expect(bundle.blocks[1]).toEqual({ type: 'paragraph', text: 'Solo page.' });
  });

  it('allows trustLevel override from metadata', () => {
    const bundle = parsePdfText([{ text: 'x' }], { trustLevel: 'trusted' });
    expect(bundle.trustLevel).toBe('trusted');
  });
});
