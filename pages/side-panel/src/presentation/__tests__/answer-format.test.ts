import { describe, expect, it } from 'vitest';
import { attachSourceHrefs, parseAnswerBlocks, stripAnswerMarkup } from '../answer-format';

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
});
