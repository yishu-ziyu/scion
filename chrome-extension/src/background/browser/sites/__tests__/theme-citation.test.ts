import { describe, expect, it } from 'vitest';
import {
  answerThemeAndCitationFromPage,
  instructionRequestsThemeAndCitation,
  isCurrentPageThemeCitationInstruction,
} from '../theme-citation';

const currentPageRead =
  '阅读当前页面，用一句中文概括核心主题，并引用一个正文中可见的细节；不要修改页面。';

describe('theme-citation instruction', () => {
  it('matches the current-page read contract and rejects multi-site work', () => {
    expect(instructionRequestsThemeAndCitation(currentPageRead)).toBe(true);
    expect(isCurrentPageThemeCitationInstruction(currentPageRead)).toBe(true);
    expect(
      isCurrentPageThemeCitationInstruction(
        '先确认 IANA Example Domains 的标题和 URL，再打开 Wikipedia 的 Web browser 条目，读取标题和首段定义，最终输出两条中文观察，每条都带 URL。',
      ),
    ).toBe(false);
    expect(isCurrentPageThemeCitationInstruction('当前页是不是 bilibili 首页？')).toBe(false);
  });
});

describe('answerThemeAndCitationFromPage', () => {
  it('returns a two-part answer grounded in visible body text', () => {
    const result = answerThemeAndCitationFromPage(
      ['EverMemOS', '用于结构化长程推理的自组织记忆操作系统', '面向各种用例的基于记忆的 AI 解决方案'].join('\n'),
      'EverMind',
    );

    expect(result).not.toBeNull();
    expect(result?.quote).toBe('用于结构化长程推理的自组织记忆操作系统');
    expect(result?.theme).toContain('核心主题');
    expect(result?.answer).toContain('\n「');
    expect(result?.answer.split('\n')).toHaveLength(2);
  });

  it('returns null when the page has no usable body lines', () => {
    expect(answerThemeAndCitationFromPage('首页\n登录', 'Home')).toBeNull();
  });
});
