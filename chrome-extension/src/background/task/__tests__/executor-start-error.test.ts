import { describe, expect, it } from 'vitest';
import {
  classifyCreateExecutorError,
  markSetupError,
  SETUP_ERROR_NAME,
} from '../executor-start-error';

describe('classifyCreateExecutorError (engine-start surface)', () => {
  it('marks setup errors with stable name', () => {
    const err = markSetupError('请先在设置页面中完成 API 密钥的设置。');
    expect(err.name).toBe(SETUP_ERROR_NAME);
    expect(classifyCreateExecutorError(err)).toBe('setup_failed');
  });

  it('classifies localized zh setup bodies as setup_failed (not executor_start_failed)', () => {
    expect(classifyCreateExecutorError(new Error('请先在设置页面中完成 API 密钥的设置。'))).toBe(
      'setup_failed',
    );
    expect(classifyCreateExecutorError(new Error('请先在设置中为导览代理选择一个模型。'))).toBe(
      'setup_failed',
    );
    expect(classifyCreateExecutorError(new Error('在设置中找不到提供者 minimax。'))).toBe('setup_failed');
  });

  it('classifies machine tokens as setup_failed', () => {
    expect(classifyCreateExecutorError(new Error('noApiKeys configured'))).toBe('setup_failed');
    expect(classifyCreateExecutorError(new Error('noNavigatorModel'))).toBe('setup_failed');
    expect(classifyCreateExecutorError(new Error('noProvider foo'))).toBe('setup_failed');
  });

  it('keeps unknown boom as executor_start_failed', () => {
    expect(classifyCreateExecutorError(new Error('boom'))).toBe('executor_start_failed');
    expect(classifyCreateExecutorError('string-throw')).toBe('executor_start_failed');
    expect(classifyCreateExecutorError(null)).toBe('executor_start_failed');
  });
});
