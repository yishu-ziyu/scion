import { describe, expect, it } from 'vitest';
import { isAtomicSkillInstruction } from '../../agent/skills/instruction-scope';
import { bareWikipediaUrlsFromInstruction } from '../manager';
import {
  checkVerifiedRecordDeliverable,
  filterPageSummaryActions,
  formatVerifiedPagesForPrompt,
  instructionPointsAtCurrentPage,
  isPureCurrentPageSummaryInstruction,
  observationFrameForPageSummary,
  pageMatchesInstruction,
  pageSummaryDeliverable,
  pickVerifiedQuote,
  shouldCommitVerifiedPage,
  upsertVerifiedPageTarget,
  verifiedPageRecordsFromTargets,
  verifiedStepRecordsEnabled,
} from '../verified-step-records';
import type { BrowserTargetRef } from '@extension/storage/lib/task';

const IANA_INSTRUCTION = '1) 打开 IANA 首页 2) 打开英文维基 Web_browser 3) 写出两个页面的标题';

function pageRef(
  partial: Partial<BrowserTargetRef> & { id: string; normalizedUrl: string; title: string },
): BrowserTargetRef & { title: string; normalizedUrl: string } {
  return {
    kind: 'page',
    tabId: 7,
    frameId: 0,
    urlOrigin: 'https://example.test',
    digest: partial.id,
    ...partial,
  };
}

describe('verified step records', () => {
  it('enables numbered IANA + wiki title instructions and skips the YouTube skill short path', () => {
    expect(verifiedStepRecordsEnabled(IANA_INSTRUCTION)).toBe(true);
    expect(verifiedStepRecordsEnabled('打开 YouTube 并点击第一个视频')).toBe(false);
    expect(isAtomicSkillInstruction('打开 YouTube 并点击第一个视频')).toBe(true);
    expect(
      verifiedStepRecordsEnabled('Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.'),
    ).toBe(false);
  });

  it('does not treat Feishu wiki or Chinese Wikipedia naming as English Wikipedia', () => {
    expect(bareWikipediaUrlsFromInstruction('打开飞书维基 wiki/ExampleDoc')).toEqual([]);
    expect(bareWikipediaUrlsFromInstruction('打开飞书文档 wiki/ExampleDoc 并读这一页。')).toEqual([]);
    expect(bareWikipediaUrlsFromInstruction('进入中文维基；确认 URL 在 wiki/Web_browser 后再完成。')).toEqual([
      'https://zh.wikipedia.org/wiki/Web_browser',
    ]);
    expect(verifiedStepRecordsEnabled('打开飞书维基 wiki/ExampleDoc')).toBe(false);
    expect(verifiedStepRecordsEnabled('打开飞书决策文档，不要当成研究任务')).toBe(false);
  });

  it('formats verified pages for the control user prompt', () => {
    expect(
      formatVerifiedPagesForPrompt([
        { normalizedUrl: 'https://www.iana.org', title: 'Internet Assigned Numbers Authority' },
      ]),
    ).toBe('Verified pages:\n1. url=https://www.iana.org title=Internet Assigned Numbers Authority');
  });

  it('matches IANA host to the instruction and rejects an unrelated start tab', () => {
    expect(pageMatchesInstruction(IANA_INSTRUCTION, 'https://www.iana.org/')).toBe(true);
    expect(pageMatchesInstruction(IANA_INSTRUCTION, 'https://www.google.com/')).toBe(false);
    expect(instructionPointsAtCurrentPage('1) 读当前页 2) 写出标题')).toBe(true);
    expect(instructionPointsAtCurrentPage(IANA_INSTRUCTION)).toBe(false);
  });

  it('does not commit 404, empty title, or hostname-only title', () => {
    expect(
      shouldCommitVerifiedPage({
        title: '404 Not Found',
        url: 'https://www.iana.org/missing',
        visibleText: 'Not Found',
      }),
    ).toBe(false);
    expect(shouldCommitVerifiedPage({ title: '  ', url: 'https://www.iana.org' })).toBe(false);
    expect(shouldCommitVerifiedPage({ title: 'iana.org', url: 'https://www.iana.org' })).toBe(false);
    expect(
      shouldCommitVerifiedPage({
        title: 'Internet Assigned Numbers Authority',
        url: 'https://www.iana.org',
        visibleText: 'IANA coordinates unique names.',
      }),
    ).toBe(true);
  });

  it('picks a quote only when it is a substring of the visible text', () => {
    const visible = 'IANA coordinates unique names and numbers.\nSecond paragraph.';
    expect(pickVerifiedQuote(visible)).toBe('IANA coordinates unique names and numbers.');
    expect(pickVerifiedQuote('')).toBeUndefined();
  });

  it('upserts by normalized URL without changing visitSeq', () => {
    const first = upsertVerifiedPageTarget(
      [],
      pageRef({ id: 'page-1', normalizedUrl: 'https://www.iana.org', title: 'Internet Assigned Numbers Authority' }),
    );
    expect(first[0]?.visitSeq).toBe(1);
    const second = upsertVerifiedPageTarget(
      first,
      pageRef({
        id: 'page-2',
        normalizedUrl: 'https://www.iana.org',
        title: 'Internet Assigned Numbers Authority',
      }),
    );
    expect(second).toHaveLength(1);
    expect(second[0]?.id).toBe('page-1');
    expect(second[0]?.visitSeq).toBe(1);
    expect(verifiedPageRecordsFromTargets(second)).toEqual([
      {
        normalizedUrl: 'https://www.iana.org',
        title: 'Internet Assigned Numbers Authority',
        visitSeq: 1,
      },
    ]);
  });

  it('keeps different query identities as separate verified pages', () => {
    const red = pageRef({
      id: 'page-red',
      normalizedUrl: 'https://example.com',
      queryIdentityDigest: 'red-digest',
      title: 'Red page',
    });
    const blue = pageRef({
      id: 'page-blue',
      normalizedUrl: 'https://example.com',
      queryIdentityDigest: 'blue-digest',
      title: 'Blue page',
    });

    const refs = upsertVerifiedPageTarget(upsertVerifiedPageTarget([], red), blue);

    expect(refs).toHaveLength(2);
    expect(verifiedPageRecordsFromTargets(refs)).toEqual([
      expect.objectContaining({ queryIdentityDigest: 'red-digest', title: 'Red page' }),
      expect.objectContaining({ queryIdentityDigest: 'blue-digest', title: 'Blue page' }),
    ]);
  });

  it('requires every verified title in the answer when the instruction asks for titles', () => {
    const records = [{ title: 'Internet Assigned Numbers Authority' }, { title: 'Web browser' }];
    expect(checkVerifiedRecordDeliverable(IANA_INSTRUCTION, '做完了，两个页面都已打开。', records)).toEqual({
      passed: false,
      reasons: ['missing_verified_title'],
    });
    expect(checkVerifiedRecordDeliverable(IANA_INSTRUCTION, 'IANA 和 Web browser', records)).toEqual({
      passed: false,
      reasons: ['missing_verified_title'],
    });
    expect(
      checkVerifiedRecordDeliverable(IANA_INSTRUCTION, 'Internet Assigned Numbers Authority；Web browser', records),
    ).toEqual({ passed: true, reasons: [] });
    expect(checkVerifiedRecordDeliverable('打开 YouTube 并点击第一个视频', '已打开第一个视频', records)).toEqual({
      passed: true,
      reasons: [],
    });
  });

  it('rewrites click/fill/navigate to a page read for a pure current-page summary', () => {
    const click = { name: 'click_element', args: { index: 3 } };
    const fill = { name: 'input_text', args: { index: 1, text: 'Ada' } };
    const go = { name: 'go_to_url', args: { url: 'https://example.test/' } };
    const read = { name: 'read_page_text', args: { max_chars: 8_000 } };
    expect(filterPageSummaryActions('总结当前页面', [click, fill, go, read])).toEqual([
      { name: 'read_page_text', args: { max_chars: 20_000 } },
      { name: 'read_page_text', args: { max_chars: 20_000 } },
      { name: 'read_page_text', args: { max_chars: 20_000 } },
      read,
    ]);
    expect(filterPageSummaryActions('总结当前页面', [click], { pageBodyRead: true })).toEqual([]);
  });

  it('leaves queued acts unchanged when the user asked to operate the page', () => {
    const click = { name: 'click_element', args: { index: 3 } };
    expect(filterPageSummaryActions('总结当前页面，然后点击下一页', [click])).toEqual([click]);
    expect(filterPageSummaryActions('打开淘宝首页', [click])).toEqual([click]);
  });

  it('builds a takeable summary from page wording instead of a click plan', () => {
    expect(isPureCurrentPageSummaryInstruction('Write a short summary of the first three books on this page.')).toBe(
      true,
    );
    expect(observationFrameForPageSummary('总结当前页面', { inaccessible: true })).toBeNull();
    expect(observationFrameForPageSummary('打开淘宝首页', { inaccessible: true })).toEqual({ inaccessible: true });
    expect(
      pageSummaryDeliverable('click the first book', {
        title: 'All products | Books to Scrape',
        visibleText: 'A Light in the Attic £51.77 Tipping the Velvet £53.74 Soumission £50.10',
      }),
    ).toContain('A Light in the Attic');
    expect(
      pageSummaryDeliverable('A Light in the Attic, Tipping the Velvet, and Soumission are the first three books.', {
        title: 'ignored',
        visibleText: 'ignored',
      }),
    ).toBe('A Light in the Attic, Tipping the Velvet, and Soumission are the first three books.');
  });
});
