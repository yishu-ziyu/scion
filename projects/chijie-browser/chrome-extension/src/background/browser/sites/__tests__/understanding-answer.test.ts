import { describe, expect, it } from 'vitest';
import {
  answerUnderstandingFromPage,
  isBilibiliHomeUrl,
  isUnderstandingOnlyInstruction,
  pageHost,
} from '../understanding-answer';

describe('isUnderstandingOnlyInstruction', () => {
  it('accepts A02-style identity questions', () => {
    expect(
      isUnderstandingOnlyInstruction('当前页是不是 bilibili 首页？只回答是或否并给出 URL host'),
    ).toBe(true);
    expect(isUnderstandingOnlyInstruction('用一句话说明当前页标题和网站域名')).toBe(true);
    expect(isUnderstandingOnlyInstruction('识别当前页')).toBe(true);
  });

  it('rejects action goals', () => {
    expect(isUnderstandingOnlyInstruction('打开第一行第一个视频')).toBe(false);
    expect(isUnderstandingOnlyInstruction('打开 https://www.wikipedia.org')).toBe(false);
    expect(isUnderstandingOnlyInstruction('点击提交并填写 Name')).toBe(false);
  });

  it('rejects multi-phase / long-horizon goals even if they mention 标题 or host', () => {
    expect(
      isUnderstandingOnlyInstruction(
        '这是一个多阶段任务：1) 进入英文维基；2) 搜索并打开 Artificial intelligence 条目；3) 在回复中写出当前页标题是否包含 Artificial intelligence，并带上 host。不要在搜索结果列表页就报完成。',
      ),
    ).toBe(false);
    expect(
      isUnderstandingOnlyInstruction(
        '调研 10 家竞品；输出对比表；写一份结论',
      ),
    ).toBe(false);
  });
});

describe('answerUnderstandingFromPage', () => {
  it('answers bilibili home yes/no with host', () => {
    expect(
      answerUnderstandingFromPage('当前页是不是 bilibili 首页？只回答是或否并给出 URL host', {
        url: 'https://www.bilibili.com/',
        title: '哔哩哔哩',
      }),
    ).toBe('是。host=bilibili.com');

    expect(
      answerUnderstandingFromPage('当前页是不是 bilibili 首页？', {
        url: 'https://www.bilibili.com/video/BV1xx',
        title: '视频',
      }),
    ).toBe('否。host=bilibili.com');
  });

  it('answers title + host', () => {
    expect(
      answerUnderstandingFromPage('用一句话说明当前页标题和网站域名', {
        url: 'https://www.wikipedia.org/',
        title: 'Wikipedia',
      }),
    ).toBe('标题：Wikipedia；域名：wikipedia.org');
  });
});

describe('helpers', () => {
  it('pageHost and isBilibiliHomeUrl', () => {
    expect(pageHost('https://www.bilibili.com/')).toBe('bilibili.com');
    expect(isBilibiliHomeUrl('https://www.bilibili.com/')).toBe(true);
    expect(isBilibiliHomeUrl('https://www.bilibili.com/video/BV1')).toBe(false);
  });
});
