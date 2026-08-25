import { describe, expect, it } from 'vitest';
import { messageContentForChatInput, shouldClearComposerAfterDelivery } from '../ChatInput';

describe('ChatInput delivery contract', () => {
  const currentPage = {
    host: 'example.org',
    title: 'Example Domain',
    url: 'https://example.org/',
  };

  it('sends a typed literal IANA instruction without appending the current page URL or title', () => {
    const literalInstruction =
      '打开 https://www.iana.org 并告诉我页面标题。不要跟随，不要改变我当前的 Example Domain 页面。';

    expect(messageContentForChatInput(literalInstruction, currentPage)).toBe(literalInstruction);
    expect(messageContentForChatInput('读取 @当前页 的标题', currentPage)).toBe(
      '读取 @当前页（example.org · Example Domain https://example.org/） 的标题',
    );
  });

  it('clears the composer only after a delivered send', () => {
    expect(shouldClearComposerAfterDelivery({ delivered: false })).toBe(false);
    expect(shouldClearComposerAfterDelivery({ delivered: false, feedback: '输入已保留' })).toBe(false);
    expect(shouldClearComposerAfterDelivery({ delivered: true })).toBe(true);
  });
});
