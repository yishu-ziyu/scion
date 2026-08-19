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
