import { describe, expect, it } from 'vitest';
import { deriveFailedResult } from '../failed-result';

describe('deriveFailedResult', () => {
  it('says the work did not land, without repeating the goal or model jargon', () => {
    const view = deriveFailedResult({
      failureCategory: 'max_steps',
    });
    expect(view.sentence).toBe('试了几轮，还是没做成。');
    expect(view.action).toBe('再说一次');
    expect(view.sentence + view.action).not.toMatch(/模型|步数|耗尽|llm|max_steps|打开这个网页/i);
  });

  it('names the last real step when one exists', () => {
    const view = deriveFailedResult({
      failureCategory: 'no_progress',
      lastStepTitle: '点击第二个视频',
    });
    expect(view.sentence).toBe('点击第二个视频之后，还是没做成。');
    expect(view.sentence).not.toContain('获取页面快照');
  });

  it('does not treat a snapshot-only step as progress', () => {
    const view = deriveFailedResult({
      failureCategory: 'model_loop',
      lastStepTitle: '获取页面快照',
    });
    expect(view.sentence).toBe('试了几轮，还是没做成。');
  });

  it('does not blame a missing control when the last step was opening a site', () => {
    const view = deriveFailedResult({
      failureCategory: 'action_failed',
      lastStepTitle: '打开 youtube.com',
    });
    expect(view.sentence).toBe('想打开 youtube.com，但没打开成。');
    expect(view.sentence).not.toContain('控件');
    expect(view.action).toBe('再说一次');
  });

  it('asks the user to log in when that is the stop reason', () => {
    const view = deriveFailedResult({ failureCategory: 'login_required' });
    expect(view.sentence).toContain('登录');
    expect(view.action).toContain('处理好了');
  });
});
