import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../log';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('log redaction', () => {
  it('masks sk- style keys in plain message strings', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger('Test');
    logger.info('calling with key sk-abcdef1234567890 done');
    const printed = spy.mock.calls.flat().join(' ');
    expect(printed).not.toContain('sk-abcdef1234567890');
    expect(printed).toContain('***7890');
  });

  it('masks apiKey fields on logged objects, including nested ones', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger('Test');
    logger.error('request failed', {
      apiKey: 'mm-plaintext-key-4242',
      detail: { authorization: 'Bearer abcdefghijklmnop' },
      harmless: 'visible',
    });
    const printed = JSON.stringify(spy.mock.calls);
    expect(printed).not.toContain('mm-plaintext-key-4242');
    expect(printed).not.toContain('Bearer abcdefghijklmnop');
    expect(printed).toContain('***4242');
    expect(printed).toContain('visible');
  });

  it('leaves non-secret values untouched', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger('Test');
    logger.info('model=MiniMax-M3 base=https://api.minimaxi.com/v1');
    const printed = spy.mock.calls.flat().join(' ');
    expect(printed).toContain('model=MiniMax-M3 base=https://api.minimaxi.com/v1');
  });
});
