import { describe, expect, it } from 'vitest';
import { decideTwoSiteReportTurn, skipControlInitialObserve } from '../control-two-site';

const LIVE_INSTRUCTION =
  'Write a short report of the first 3 products on this page and the first 3 products on https://webscraper.io/test-sites/e-commerce/allinone. Include name and price from both sites.';

describe('two-site control decide', () => {
  it('observes the first page then opens allinone instead of calling the model', () => {
    expect(skipControlInitialObserve(LIVE_INSTRUCTION)).toBe(false);
    const captures = new Map();
    const first = decideTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
      tab: {
        id: 1,
        url: 'https://books.toscrape.com/',
        title: 'All products | Books to Scrape - Sandbox',
      },
      visibleText:
        'A Light in the Attic £51.77 In stock Add to basket Tipping the Velvet £53.74 In stock Add to basket Soumission £50.10 In stock Add to basket',
      interactiveElements: [{ title: 'A Light in the Attic', text: 'A Light in the ... £51.77' }],
    } as never);
    expect(first).toEqual({
      kind: 'action',
      name: 'open_tab',
      args: { url: 'https://webscraper.io/test-sites/e-commerce/allinone' },
      observation: '打开 https://webscraper.io/test-sites/e-commerce/allinone',
    });
    expect(
      decideTwoSiteReportTurn(LIVE_INSTRUCTION, new Map(), {
        tab: { id: 1, url: 'https://books.toscrape.com/', title: 'All products' },
        visibleText: '',
        interactiveElements: [],
      } as never),
    ).toMatchObject({
      kind: 'action',
      name: 'open_tab',
      args: { url: 'https://webscraper.io/test-sites/e-commerce/allinone' },
    });

    const second = decideTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
      tab: {
        id: 2,
        url: 'https://webscraper.io/test-sites/e-commerce/allinone',
        title: 'Allinone | Web Scraper Test Sites',
      },
      visibleText: 'Aspire E1-572G $581.99 Acer Predator Helios 300 $1187.98 Dell Vostro 15 $497.17',
      interactiveElements: [],
    } as never);
    expect(second?.kind).toBe('done');
    if (second?.kind !== 'done') throw new Error('expected done');
    expect(second.summary).toContain('A Light in the Attic');
    expect(second.summary).toContain('£51.77');
    expect(second.summary).toContain('Aspire E1-572G');
    expect(second.summary).toContain('$581.99');
    expect(second.summary).toContain('Acer Predator Helios 300');
    expect(second.summary).toContain('Dell Vostro 15');
    expect(second.summary).not.toContain('<div');
  });
});
