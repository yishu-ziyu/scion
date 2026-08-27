import { contextBlockText } from '@extension/context-engine';
import { describe, expect, it } from 'vitest';
import { collectPageContext, PAGE_CONTEXT_FRAME_PAYLOAD_LIMIT } from './page-context';

function fakeDocument(html: string, title = 'Fixture title', url = 'https://example.test/fixture'): Document {
  return {
    title,
    URL: url,
    documentElement: { outerHTML: html },
  } as unknown as Document;
}

describe('collectPageContext', () => {
  it('extracts and truncates a huge DOM before returning a structured frame payload', () => {
    const noisyRows = Array.from(
      { length: 4_000 },
      (_, index) => `<p>row-${index} ${'large body '.repeat(8)}</p>`,
    ).join('');
    const document = fakeDocument(
      `<html><body><main><h1>Huge fixture</h1><p>START_UNIQUE_FACT</p>${noisyRows}<p>END_UNIQUE_FACT</p></main></body></html>`,
    );

    const payload = collectPageContext(document, 2_048);
    const serialized = JSON.stringify(payload);
    const readable = payload.bundle.blocks.map(contextBlockText).join('\n');

    expect(serialized.length).toBeLessThanOrEqual(2_048);
    expect(payload.truncated).toBe(true);
    expect(payload.bundle.trustLevel).toBe('untrusted');
    expect(readable).toContain('Huge fixture');
    expect(readable).toContain('END_UNIQUE_FACT');
    expect(payload).not.toHaveProperty('html');
    expect(serialized).not.toContain('<main>');
    expect(serialized).not.toContain('apiKey');
  });

  it('never exceeds the content-script hard cap even when a larger limit is requested', () => {
    const document = fakeDocument(`<main><p>${'body '.repeat(20_000)}</p></main>`);

    const payload = collectPageContext(document, PAGE_CONTEXT_FRAME_PAYLOAD_LIMIT * 10);

    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(PAGE_CONTEXT_FRAME_PAYLOAD_LIMIT);
    expect(payload.truncated).toBe(true);
  });

  it('strips credentials, query, and fragment from the page URL before it leaves the frame', () => {
    const document = fakeDocument(
      '<main><p>reset this password</p></main>',
      'Reset',
      'https://user:pass@example.test/reset?token=SECRET_TOKEN&next=/app#frag',
    );

    const payload = collectPageContext(document);
    const serialized = JSON.stringify(payload);

    expect(payload.bundle.url).toBe('https://example.test/reset');
    expect(serialized).not.toContain('SECRET_TOKEN');
    expect(serialized).not.toContain('user:pass');
    expect(serialized).not.toContain('#frag');
  });

  it('honors the smallest child-frame budget used by the background collector', () => {
    const document = fakeDocument(
      `<main><p>${'body '.repeat(2_000)}</p></main>`,
      'T'.repeat(4_000),
      `https://example.test/${'url-segment/'.repeat(2_000)}`,
    );

    const payload = collectPageContext(document, 521);

    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(521);
    expect(payload.truncated).toBe(true);
  });
});
