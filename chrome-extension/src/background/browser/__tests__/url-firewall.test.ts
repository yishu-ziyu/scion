import { describe, expect, it } from 'vitest';
import { isUrlAllowed } from '../util';

describe('isUrlAllowed private-host SSRF guard', () => {
  const none: string[] = [];

  it('denies loopback and private hosts with default (empty) lists', () => {
    expect(isUrlAllowed('http://127.0.0.1:3000/form', none, none)).toBe(false);
    expect(isUrlAllowed('http://localhost:3000/form', none, none)).toBe(false);
    expect(isUrlAllowed('http://[::1]:3000/form', none, none)).toBe(false);
    expect(isUrlAllowed('http://192.168.1.1/', none, none)).toBe(false);
    expect(isUrlAllowed('http://10.0.0.8/', none, none)).toBe(false);
    expect(isUrlAllowed('http://172.16.0.1/', none, none)).toBe(false);
  });

  it('keeps denying cloud metadata even when allowlisted', () => {
    expect(isUrlAllowed('http://169.254.169.254/latest/meta-data', ['169.254.169.254'], none)).toBe(false);
  });

  it('allows a private host only when explicitly allowlisted', () => {
    expect(isUrlAllowed('http://127.0.0.1:53168/form?run=0', ['127.0.0.1'], none)).toBe(true);
    expect(isUrlAllowed('http://127.0.0.1:53168/form?run=0', ['127.0.0.1:53168/form?run=0'], none)).toBe(true);
  });

  it('lets the deny list beat an allowlist entry for private hosts', () => {
    expect(isUrlAllowed('http://127.0.0.1:53168/form', ['127.0.0.1'], ['127.0.0.1:53168/form'])).toBe(false);
  });

  it('keeps public URLs working with empty lists (firewall off semantics)', () => {
    expect(isUrlAllowed('https://www.youtube.com/', none, none)).toBe(true);
  });

  it('keeps dangerous prefixes blocked unconditionally', () => {
    expect(isUrlAllowed('chrome-extension://abcdef/', none, none)).toBe(false);
    expect(isUrlAllowed('file:///etc/passwd', none, none)).toBe(false);
    expect(isUrlAllowed('javascript:alert(1)', none, none)).toBe(false);
  });

  it('applies allow/deny domain matching for public hosts', () => {
    expect(isUrlAllowed('https://example.com/page', ['example.com'], none)).toBe(true);
    expect(isUrlAllowed('https://sub.example.com/page', ['example.com'], none)).toBe(true);
    expect(isUrlAllowed('https://evil.example.com/page', ['example.com'], ['evil.example.com'])).toBe(false);
  });
});
