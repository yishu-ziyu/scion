import { describe, expect, it } from 'vitest';
import {
  answerPageAboutFromVisibleText,
  answerThemeAndCitationFromPage,
  instructionAsksPageAbout,
  instructionRequestsThemeAndCitation,
  isCurrentPageThemeCitationInstruction,
  mergePageAboutAnswer,
} from '../theme-citation';

const currentPageRead = '阅读当前页面，用一句中文概括核心主题，并引用一个正文中可见的细节；不要修改页面。';

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

  it('treats a current-page video-about question as page-about, not theme+citation', () => {
    const instruction = '现在这个页面的视频都是跟什么有关的';
    expect(instructionAsksPageAbout(instruction)).toBe(true);
    expect(instructionAsksPageAbout('这些视频都是跟什么有关的？')).toBe(true);
    expect(instructionAsksPageAbout('what is this page about')).toBe(true);
    expect(instructionAsksPageAbout(currentPageRead)).toBe(false);
    expect(instructionAsksPageAbout('当前页是不是 bilibili 首页？')).toBe(false);
    expect(isCurrentPageThemeCitationInstruction(instruction)).toBe(false);
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

describe('page-about visible quotes', () => {
  it('lists several visible titles the user can check', () => {
    const result = answerPageAboutFromVisibleText(
      [
        '首页',
        'Harness 实践:让 Agent 全自动制作知识讲解视频',
        '给智能体的记忆系统怎么落地',
        '前端性能优化清单 2026',
      ].join('\n'),
      '首页-个性推荐-哔哩哔哩',
    );
    expect(result?.quotes).toEqual([
      'Harness 实践:让 Agent 全自动制作知识讲解视频',
      '给智能体的记忆系统怎么落地',
      '前端性能优化清单 2026',
    ]);
    expect(result?.answer).toContain('这些内容包括：');
    expect(result?.answer).toContain('「Harness 实践:让 Agent 全自动制作知识讲解视频」');
    expect(
      answerPageAboutFromVisibleText('登录后享受更多精彩内容\nHarness 实践:让 Agent 全自动制作知识讲解视频')?.quotes,
    ).toEqual(['Harness 实践:让 Agent 全自动制作知识讲解视频']);
  });

  it('appends page quotes when the model theme has none', () => {
    const merged = mergePageAboutAnswer(
      '这些视频主要跟 Agent 和知识讲解有关。',
      'Harness 实践:让 Agent 全自动制作知识讲解视频\n给智能体的记忆系统怎么落地',
    );
    expect(merged).toContain('这些视频主要跟 Agent 和知识讲解有关。');
    expect(merged).toContain('「Harness 实践:让 Agent 全自动制作知识讲解视频」');
  });
});
