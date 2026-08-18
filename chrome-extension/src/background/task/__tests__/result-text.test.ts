import { describe, expect, it } from 'vitest';
import { isAcknowledgementOnly, isPlaceholderDelivery } from '../result-text';

describe('result-text', () => {
  it('rejects acknowledgements and empty placeholders', () => {
    expect(isAcknowledgementOnly('好的，我来阅读当前页面并概括核心主题。')).toBe(true);
    expect(isAcknowledgementOnly('好的，我来读取当前页面并提取主题和引用。')).toBe(true);
    expect(isAcknowledgementOnly('Okay, let me read the page.')).toBe(true);
    expect(isPlaceholderDelivery('')).toBe(true);
    expect(isPlaceholderDelivery('Control loop candidate complete')).toBe(true);
  });

  it('keeps a written result and does not treat bare done as an acknowledgement', () => {
    expect(isAcknowledgementOnly('核心主题：这是一套面向长程推理的记忆系统。')).toBe(false);
    expect(isPlaceholderDelivery('核心主题：这是一套面向长程推理的记忆系统。')).toBe(false);
    expect(isAcknowledgementOnly('done')).toBe(false);
    expect(isPlaceholderDelivery('done')).toBe(false);
  });
});
