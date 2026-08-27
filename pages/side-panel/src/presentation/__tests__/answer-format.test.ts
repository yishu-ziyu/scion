import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnswerProse } from '../../components/AnswerProse';
import { attachSourceHrefs, parseAnswerBlocks, stripAnswerMarkup } from '../answer-format';

const FLATTENED_PRODUCT_CSV =
  'name,price,rating Alpha Wireless Headphones,$49.99,4.5 Beta Mechanical Keyboard,$89.00,4.8 Gamma USB-C Hub,$34.50,4.2 Delta Desk Lamp,$27.99,4.0 Epsilon Notebook Stand,$19.95,4.6 Zeta Webcam Cover,$8.49,3.9';

const NEWLINE_PRODUCT_CSV = [
  'name,price,rating',
  'Alpha Wireless Headphones,$49.99,4.5',
  'Beta Mechanical Keyboard,$89.00,4.8',
  'Gamma USB-C Hub,$34.50,4.2',
  'Delta Desk Lamp,$27.99,4.0',
  'Epsilon Notebook Stand,$19.95,4.6',
  'Zeta Webcam Cover,$8.49,3.9',
].join('\n');

function markupTextContent(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

describe('answer-format', () => {
  it('strips asterisks and splits a dumped list', () => {
    const raw =
      '当前页面是 **Bilibili（哔哩哔哩）首页 - 个性推荐**，主要展示推荐视频。 **页面结构与导航**： - 左侧侧边栏：首页。 - 一个搜索框。 1. **AI / 大模型**：智谱。 2. **编程**：Blender。';
    expect(stripAnswerMarkup(raw)).not.toContain('**');
    const blocks = parseAnswerBlocks(raw);
    expect(blocks[0]).toMatchObject({ type: 'p' });
    expect(blocks.some(block => block.type === 'ul')).toBe(true);
    expect(blocks.some(block => block.type === 'ol')).toBe(true);
    const first = blocks[0];
    if (first?.type !== 'p') throw new Error('expected paragraph');
    expect(first.spans.some(span => span.bold && span.text.includes('Bilibili'))).toBe(true);
    expect(first.spans.some(span => span.text.includes('页面结构'))).toBe(false);
    expect(
      blocks.some(block => block.type === 'section' && block.spans.some(span => span.text.includes('页面结构与导航'))),
    ).toBe(true);
    const numbered = blocks.find(block => block.type === 'ol');
    if (numbered?.type !== 'ol') throw new Error('expected numbered list');
    expect(numbered.items[0]?.some(span => span.bold && span.text.includes('AI / 大模型'))).toBe(true);
  });

  it('treats a whole-line bold label as a section, not as a paragraph of strong', () => {
    const blocks = parseAnswerBlocks('**报名入口**：\n- 官网首页\n普通一句。');
    expect(blocks.map(block => block.type)).toEqual(['section', 'ul', 'p']);
    expect(blocks[0]).toMatchObject({ type: 'section', spans: [{ text: '报名入口' }] });
  });

  it('treats a markdown heading line as a section without leaking # marks', () => {
    const blocks = parseAnswerBlocks('## 关键信息提炼\n正文一句。');
    expect(blocks.map(block => block.type)).toEqual(['section', 'p']);
    expect(blocks[0]).toMatchObject({ type: 'section', spans: [{ text: '关键信息提炼' }] });
  });

  it('reads a bold-wrapped numbered label as a numbered item, keeping the label bold', () => {
    const blocks = parseAnswerBlocks('**1. AI 产品经理角色定义** AI 产品经理 = 传统产品经理 + AI 技术理解。');
    expect(blocks.map(block => block.type)).toEqual(['ol']);
    const first = blocks[0];
    if (first?.type !== 'ol') throw new Error('expected numbered list');
    const spans = first.items[0] ?? [];
    expect(spans.some(span => span.bold && span.text.includes('AI 产品经理角色定义'))).toBe(true);
    expect(spans.some(span => span.text.includes('**'))).toBe(false);
    expect(spans.some(span => span.text.includes('传统产品经理'))).toBe(true);
  });

  it('strips heading marks so copy/paste sees human text', () => {
    expect(stripAnswerMarkup('## 关键信息提炼\n**加粗**一句。')).toBe('关键信息提炼\n加粗一句。');
  });

  it('marks a host mentioned in the answer so the user can open that page', () => {
    const blocks = attachSourceHrefs(parseAnswerBlocks('报名入口在 qingcheng.ai 首页。'), [
      { host: 'qingcheng.ai', url: 'https://qingcheng.ai/apply' },
    ]);
    expect(blocks[0]).toMatchObject({
      type: 'p',
      spans: [{ text: '报名入口在 qingcheng.ai 首页。', href: 'https://qingcheng.ai/apply' }],
    });
  });

  it('does not treat a flattened comma sentence as a table block', () => {
    const blocks = parseAnswerBlocks(FLATTENED_PRODUCT_CSV);
    expect(blocks).toEqual([
      {
        type: 'p',
        spans: [{ text: FLATTENED_PRODUCT_CSV }],
      },
    ]);
  });

  it('keeps CSV header and rows as separate lines instead of one paragraph', () => {
    const blocks = parseAnswerBlocks(NEWLINE_PRODUCT_CSV);
    expect(blocks).toEqual([{ type: 'pre', text: NEWLINE_PRODUCT_CSV }]);
    const html = renderToStaticMarkup(createElement(AnswerProse, { text: NEWLINE_PRODUCT_CSV }));
    expect(html).toContain('data-testid="completion-result"');
    expect(html).toContain('chijie-answer-table');
    expect(markupTextContent(html)).toBe(NEWLINE_PRODUCT_CSV);
    expect(markupTextContent(html).split('\n')[0]).toBe('name,price,rating');
    expect(markupTextContent(html).split('\n').length).toBe(7);
  });

  it('keeps a prefixed CSV takeaway as prose plus a newline table', () => {
    const text = `已提取 6 件商品（CSV）：\n${NEWLINE_PRODUCT_CSV}`;
    const blocks = parseAnswerBlocks(text);
    expect(blocks[0]).toMatchObject({
      type: 'p',
      spans: [{ text: '已提取 6 件商品（CSV）：' }],
    });
    expect(blocks[1]).toEqual({ type: 'pre', text: NEWLINE_PRODUCT_CSV });
    const html = renderToStaticMarkup(createElement(AnswerProse, { text }));
    expect(html).toContain('</p><pre class="chijie-answer-table">');
    expect(html).toContain(`<pre class="chijie-answer-table">${NEWLINE_PRODUCT_CSV}</pre>`);
    expect(markupTextContent(html)).toContain(NEWLINE_PRODUCT_CSV);
  });

  it('keeps CSV rows that look like numbered-list or dash-list markers', () => {
    const csv = ['name,price,rating', 'Widget 1. Edition,$10.00,4.5', 'Alpha,ready: - yes,4.0'].join('\n');
    expect(parseAnswerBlocks(csv)).toEqual([{ type: 'pre', text: csv }]);
    const html = renderToStaticMarkup(createElement(AnswerProse, { text: csv }));
    expect(markupTextContent(html)).toBe(csv);
    expect(markupTextContent(html).split('\n')).toEqual([
      'name,price,rating',
      'Widget 1. Edition,$10.00,4.5',
      'Alpha,ready: - yes,4.0',
    ]);
  });

  it('keeps a markdown table as header, separator, and data rows', () => {
    const markdown = ['| name | price | rating |', '| --- | --- | --- |', '| Alpha | $1 | 5 |'].join('\n');
    expect(parseAnswerBlocks(markdown)).toEqual([{ type: 'pre', text: markdown }]);
    expect(markupTextContent(renderToStaticMarkup(createElement(AnswerProse, { text: markdown })))).toBe(markdown);
  });

  it('still joins consecutive prose lines into one paragraph', () => {
    const blocks = parseAnswerBlocks('第一段结论。\n样本不足，需要补访。');
    expect(blocks).toEqual([
      {
        type: 'p',
        spans: [{ text: '第一段结论。 样本不足，需要补访。' }],
      },
    ]);
  });
});
