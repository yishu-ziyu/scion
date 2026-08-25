import { describe, expect, it } from 'vitest';
import { deriveInstructionUrlPlan } from '../manager';
import {
  independentPagesMemory,
  independentTabRecords,
  instructionUrlPlanFromText,
  instructionUrlsStillToOpen,
  instructionWantsOpenedSearchResults,
  MAX_PARALLEL_TABS,
  pagesMatchingPlan,
  searchFindingUrlsToOpen,
  shouldPersistOpenedPage,
  urlsForIndependentOpen,
} from '../independent-urls';

const dualTitleInstruction =
  '打开 https://www.iana.org 和 https://en.wikipedia.org/wiki/Web_browser，写出两个页面的标题';
const orderedInstruction = '先打开 https://one.test/a 再打开 https://two.test/b';

describe('instructionUrlsStillToOpen', () => {
  it('matches deriveInstructionUrlPlan on independent vs ordered sentences', () => {
    expect(instructionUrlPlanFromText(dualTitleInstruction)).toMatchObject({
      sourceUrls: deriveInstructionUrlPlan(dualTitleInstruction).sourceUrls,
      requiresOrderedSourceProof: false,
    });
    expect(instructionUrlPlanFromText(orderedInstruction).requiresOrderedSourceProof).toBe(true);
  });

  it('opens two independent literals together', () => {
    expect(instructionUrlsStillToOpen(deriveInstructionUrlPlan(dualTitleInstruction))).toEqual([
      'https://www.iana.org',
      'https://en.wikipedia.org/wiki/Web_browser',
    ]);
  });

  it('does not open ordered first-then-next URLs together', () => {
    expect(instructionUrlsStillToOpen(deriveInstructionUrlPlan(orderedInstruction))).toEqual([]);
  });

  it('does not open a YouTube first-video sentence', () => {
    expect(instructionUrlsStillToOpen(deriveInstructionUrlPlan('打开 YouTube 并点击第一个视频'))).toEqual([]);
  });

  it('skips a URL already open as the current tab', () => {
    expect(
      instructionUrlsStillToOpen(deriveInstructionUrlPlan(dualTitleInstruction), ['https://www.iana.org/']),
    ).toEqual(['https://en.wikipedia.org/wiki/Web_browser']);
  });

  it('opens distinct query pages while ignoring duplicate fragments', () => {
    const plan = {
      sourceUrls: [
        'https://example.test/search?q=red#first',
        'https://example.test/search?q=blue',
        'https://example.test/search?q=red#second',
      ],
      requiresOrderedSourceProof: false,
    };

    expect(instructionUrlsStillToOpen(plan)).toEqual([
      'https://example.test/search?q=red#first',
      'https://example.test/search?q=blue',
    ]);
    expect(instructionUrlsStillToOpen(plan, ['https://example.test/search?q=red#already-open'])).toEqual([
      'https://example.test/search?q=blue',
    ]);
  });

  it('caps at five URLs', () => {
    const plan = {
      sourceUrls: [
        'https://a.test/1',
        'https://a.test/2',
        'https://a.test/3',
        'https://a.test/4',
        'https://a.test/5',
        'https://a.test/6',
      ],
      requiresOrderedSourceProof: false,
    };
    expect(instructionUrlsStillToOpen(plan)).toHaveLength(MAX_PARALLEL_TABS);
  });
});

describe('search finding URLs', () => {
  it('opens at most five finding URLs and skips ones already open', () => {
    const findings = [
      { url: 'https://one.test/a' },
      { url: 'https://one.test/a#dup' },
      { url: 'https://two.test/b' },
      { url: 'https://three.test/c' },
      { url: 'https://four.test/d' },
      { url: 'https://five.test/e' },
      { url: 'https://six.test/f' },
    ];
    expect(searchFindingUrlsToOpen(findings, ['https://one.test/a/'])).toEqual([
      'https://two.test/b',
      'https://three.test/c',
      'https://four.test/d',
      'https://five.test/e',
      'https://six.test/f',
    ]);
  });

  it('only plans search hits when the current page is a SERP and the user asked to open results', () => {
    expect(instructionWantsOpenedSearchResults('打开前 3 条结果并写出标题')).toBe(true);
    expect(instructionWantsOpenedSearchResults('打开 YouTube 并点击第一个视频')).toBe(false);
    expect(
      urlsForIndependentOpen({
        instruction: '打开前 3 条结果并写出标题',
        plan: { sourceUrls: [], requiresOrderedSourceProof: false },
        currentUrl: 'https://www.google.com/search?q=browsers',
        searchFindings: [{ url: 'https://www.iana.org' }, { url: 'https://en.wikipedia.org/wiki/Web_browser' }],
      }),
    ).toEqual(['https://www.iana.org', 'https://en.wikipedia.org/wiki/Web_browser']);
    expect(
      urlsForIndependentOpen({
        instruction: '打开 YouTube 并点击第一个视频',
        plan: { sourceUrls: [], requiresOrderedSourceProof: false },
        currentUrl: 'https://www.google.com/search?q=youtube',
        searchFindings: [{ url: 'https://www.youtube.com/watch?v=1' }],
      }),
    ).toEqual([]);
  });
});

describe('opened page records', () => {
  it('refuses empty titles and 404 shells', () => {
    expect(shouldPersistOpenedPage('https://www.iana.org', '')).toBe(false);
    expect(shouldPersistOpenedPage('https://missing.test', '404 Not Found')).toBe(false);
    expect(shouldPersistOpenedPage('https://www.iana.org', 'Internet Assigned Numbers Authority')).toBe(true);
  });

  it('writes URL + title onto the page target and an open_tab attempt', async () => {
    const records = await independentTabRecords({
      tab: {
        tabId: 21,
        requestedUrl: 'https://www.iana.org',
        pageUrl: 'https://www.iana.org/',
        title: 'Internet Assigned Numbers Authority',
      },
      roundId: 'round-1',
      now: 10,
    });
    expect(records?.target).toMatchObject({
      id: 'tab-21',
      kind: 'page',
      tabId: 21,
      normalizedUrl: 'https://www.iana.org',
      label: 'Internet Assigned Numbers Authority',
    });
    expect(records?.attempt).toMatchObject({
      actionName: 'open_tab',
      state: 'observed',
      targetUrl: 'https://www.iana.org',
    });
    expect(
      independentPagesMemory([{ url: 'https://www.iana.org', title: 'Internet Assigned Numbers Authority' }]),
    ).toContain('title=Internet Assigned Numbers Authority');
  });

  it('does not record a 404 page', async () => {
    await expect(
      independentTabRecords({
        tab: {
          tabId: 9,
          requestedUrl: 'https://missing.test/gone',
          pageUrl: 'https://missing.test/gone',
          title: '404 Not Found',
        },
        roundId: 'round-1',
        now: 10,
      }),
    ).resolves.toBeNull();
  });

  it('matches already-open tabs to the instruction plan', () => {
    expect(
      pagesMatchingPlan(deriveInstructionUrlPlan(dualTitleInstruction), [
        { url: 'https://www.iana.org/', title: 'Internet Assigned Numbers Authority' },
        { url: 'https://en.wikipedia.org/wiki/Web_browser', title: 'Web browser' },
      ]),
    ).toEqual([
      { url: 'https://www.iana.org/', title: 'Internet Assigned Numbers Authority' },
      { url: 'https://en.wikipedia.org/wiki/Web_browser', title: 'Web browser' },
    ]);
  });
});
