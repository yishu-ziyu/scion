import { describe, expect, it } from 'vitest';
import { deriveWaitAsk } from '../wait-ask';

describe('deriveWaitAsk', () => {
  it('splits the which-webmail question into 谷歌 and 微软', () => {
    const ask = deriveWaitAsk({
      status: 'waiting_user',
      waitReason: 'target_ambiguous',
      pageReading: '要打开的是哪家网页邮箱？谷歌还是微软？',
    });
    expect(ask?.prompt).toBe('要打开的是哪家网页邮箱？谷歌还是微软？');
    expect(ask?.options.map(option => option.sendText)).toEqual(['谷歌', '微软']);
    expect(ask?.options.map(option => option.label)).toEqual(['谷歌', '微软']);
  });

  it('splits a usual-mailbox yes/no question into 是 and 不是', () => {
    const ask = deriveWaitAsk({
      status: 'waiting_user',
      waitReason: 'target_ambiguous',
      pageReading: '谷歌是不是你常用的邮箱？说是的话，下次我会直接打开。',
    });
    expect(ask?.options.map(option => option.sendText)).toEqual(['是', '不是']);
    expect(
      deriveWaitAsk({
        status: 'waiting_user',
        waitReason: 'target_ambiguous',
        pageReading: '微软是不是你常用的邮箱？说是的话，下次我会直接打开。',
      })?.options.map(option => option.sendText),
    ).toEqual(['是', '不是']);
  });

  it('splits three short 还是 choices', () => {
    const ask = deriveWaitAsk({
      status: 'waiting_user',
      waitReason: 'target_missing',
      pageReading: '要点哪一个？上边还是中间还是下边？',
    });
    expect(ask?.options.map(option => option.sendText)).toEqual(['上边', '中间', '下边']);
  });

  it('does not invent options for login even when pageReading contains 还是', () => {
    expect(
      deriveWaitAsk({
        status: 'waiting_user',
        waitReason: 'login_required',
        pageReading: '需要登录。用账号还是验证码？',
      }),
    ).toBeNull();
  });

  it('does not draw options without a pageReading question', () => {
    expect(
      deriveWaitAsk({
        status: 'waiting_user',
        waitReason: 'target_ambiguous',
        pageReading: '当前是搜索结果页，第四条是某某教程',
      }),
    ).toBeNull();
    expect(
      deriveWaitAsk({
        status: 'waiting_user',
        waitReason: 'target_ambiguous',
      }),
    ).toBeNull();
    expect(
      deriveWaitAsk({
        status: 'running',
        waitReason: 'target_ambiguous',
        pageReading: '要打开的是哪家网页邮箱？谷歌还是微软？',
      }),
    ).toBeNull();
  });

  it('prefers stored waitAsk over parsing pageReading', () => {
    const ask = deriveWaitAsk({
      status: 'waiting_user',
      waitReason: 'target_ambiguous',
      pageReading: '要打开的是哪家网页邮箱？谷歌还是微软？',
      waitAsk: {
        prompt: '这几个都对得上「教程」，要哪一个？',
        options: [
          { label: '入门教程', sendText: '入门教程' },
          { label: '进阶教程', sendText: '进阶教程' },
        ],
      },
    });
    expect(ask?.prompt).toBe('这几个都对得上「教程」，要哪一个？');
    expect(ask?.options.map(option => option.sendText)).toEqual(['入门教程', '进阶教程']);
  });

  it('does not draw 仅聊天 / 执行 from a leftover confirm_execute waitAsk', () => {
    const ask = deriveWaitAsk({
      status: 'waiting_user',
      waitReason: 'confirm_execute',
      waitAsk: {
        prompt: '要我现在操作这个网页吗？',
        options: [
          { label: '仅聊天', sendText: '仅聊天' },
          { label: '执行', sendText: '执行' },
        ],
      },
    });
    expect(ask).toBeNull();
  });

  it('keeps proof, commit uncertainty, and skill inputs off this card', () => {
    const pageReading = '要打开的是哪家网页邮箱？谷歌还是微软？';
    expect(deriveWaitAsk({ status: 'waiting_user', waitReason: 'proof_required', pageReading })).toBeNull();
    expect(deriveWaitAsk({ status: 'waiting_user', waitReason: 'commit_outcome_uncertain', pageReading })).toBeNull();
    expect(deriveWaitAsk({ status: 'inputs_required', waitReason: 'skill_inputs_required', pageReading })).toBeNull();
  });
});
