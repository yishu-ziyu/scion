import { describe, expect, it } from 'vitest';
import {
  ANSWER_OR_ATTACH,
  JUDGE_PAGE_THEN_WRITE,
  READ_PAGE_BEFORE_RESULT,
  WRITE_RESULT_NOT_ACK,
  judgeVisibleVideoOpenComplete,
  resolveControlDelivery,
} from '../control-delivery';

describe('resolveControlDelivery', () => {
  it('answers without attaching when the first decide has no page', () => {
    expect(
      resolveControlDelivery({
        done: true,
        observation: '你好，需要我帮你在页面上做什么？',
        hasAction: false,
        hasPageBody: false,
        pageAttached: false,
      }),
    ).toEqual({ kind: 'complete' });
  });

  it('does not force a page read when no page is attached and the model has not acted', () => {
    expect(
      resolveControlDelivery({
        done: false,
        observation: '',
        hasAction: false,
        hasPageBody: false,
        pageAttached: false,
      }),
    ).toEqual({ kind: 'retry', feedback: ANSWER_OR_ATTACH });
  });

  it('lets a first page action through before any attach', () => {
    expect(
      resolveControlDelivery({
        done: false,
        observation: '打开 YouTube',
        hasAction: true,
        hasPageBody: false,
        pageAttached: false,
      }),
    ).toEqual({ kind: 'act' });
  });

  it('reads the page instead of accepting an acknowledgement as done', () => {
    expect(
      resolveControlDelivery({
        done: true,
        observation: '好的，我来阅读当前页面。',
        hasAction: false,
        hasPageBody: false,
      }),
    ).toEqual({ kind: 'read_page', observation: READ_PAGE_BEFORE_RESULT });
  });

  it('rejects an acknowledgement after the page was already read', () => {
    expect(
      resolveControlDelivery({
        done: true,
        observation: '好的，我来阅读当前页面。',
        hasAction: false,
        hasPageBody: true,
      }),
    ).toEqual({ kind: 'retry', feedback: WRITE_RESULT_NOT_ACK });
  });

  it('completes when the observation is a checkable result', () => {
    expect(
      resolveControlDelivery({
        done: true,
        observation: '主题：自组织记忆。引用：用于结构化长程推理。',
        hasAction: false,
        hasPageBody: true,
      }),
    ).toEqual({ kind: 'complete' });
  });

  it('reads the page when the model neither acts nor writes a result', () => {
    expect(
      resolveControlDelivery({
        done: false,
        observation: '',
        hasAction: false,
        hasPageBody: false,
      }),
    ).toEqual({ kind: 'read_page', observation: READ_PAGE_BEFORE_RESULT });
  });

  it('retries judgment when the page is visible but the model neither acts nor finishes', () => {
    expect(
      resolveControlDelivery({
        done: false,
        observation: '',
        hasAction: false,
        hasPageBody: true,
      }),
    ).toEqual({ kind: 'retry', feedback: JUDGE_PAGE_THEN_WRITE });
  });

  it('completes a written result even when the model forgot the done bit', () => {
    expect(
      resolveControlDelivery({
        done: false,
        observation: '主题：自组织记忆。引用：用于结构化长程推理。',
        hasAction: false,
        hasPageBody: true,
      }),
    ).toEqual({ kind: 'complete' });
  });

  it('finishes an open-video sentence on the watch page', () => {
    expect(
      judgeVisibleVideoOpenComplete(
        '打开b站，搜索绝命墨菲，然后点击第一行的第二个视频',
        'https://www.bilibili.com/video/BV1kguq6YEN6/',
        '《传教士》第5期：圣杀者领取追杀令，上帝视频通话小镇！【墨菲】_哔哩哔哩_bilibili',
      ),
    ).toBe('已打开「《传教士》第5期：圣杀者领取追杀令，上帝视频通话小镇！【墨菲】」');
  });

  it('leaves a real action alone', () => {
    expect(
      resolveControlDelivery({
        done: false,
        observation: 'first video',
        hasAction: true,
        hasPageBody: false,
      }),
    ).toEqual({ kind: 'act' });
  });
});
