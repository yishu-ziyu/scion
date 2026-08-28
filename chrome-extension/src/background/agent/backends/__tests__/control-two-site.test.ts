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

  it('emits 结果 after both live pages even when Computers sits after the laptop cards', () => {
    const captures = new Map();
    expect(
      decideTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
        tab: { id: 1, url: 'https://books.toscrape.com/', title: 'All products | Books to Scrape - Sandbox' },
        visibleText:
          'A Light in the Attic £51.77 In stock Add to basket Tipping the Velvet £53.74 In stock Add to basket Soumission £50.10 In stock Add to basket',
        interactiveElements: [],
      } as never)?.kind,
    ).toBe('action');
    const done = decideTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
      tab: {
        id: 2,
        url: 'https://webscraper.io/test-sites/e-commerce/allinone',
        title: 'Allinone | Web Scraper Test Sites',
      },
      visibleText: [
        'Top items being scraped right now $494.71 Acer Aspire 3... 128GB SSD, Windows 10 Home $1399 Windows 10 Home, Eng kbd $97.99',
        '$581.99 Aspire E1-572G Intel Core i5-4210U $1187.98 Acer Predator Helios 300 $497.17 Dell Vostro 15 Computers Laptops',
      ].join(' '),
      interactiveElements: [
        { title: 'Aspire E1-572G', text: 'Aspire E1-572G' },
        { title: 'Acer Predator Helios 300 (PH317-51)', text: 'Acer Predator Helios 300' },
        { title: 'Dell Vostro 15 (3568) Red', text: 'Dell Vostro 15' },
      ],
    } as never);
    expect(done?.kind).toBe('done');
    if (done?.kind !== 'done') throw new Error('expected done');
    expect(done.summary).toContain('A Light in the Attic');
    expect(done.summary).toContain('£51.77');
    expect(done.summary).toContain('Tipping the Velvet');
    expect(done.summary).toContain('£53.74');
    expect(done.summary).toContain('Soumission');
    expect(done.summary).toContain('£50.10');
    expect(done.summary).toContain('Aspire E1-572G');
    expect(done.summary).toContain('$581.99');
    expect(done.summary).toContain('Acer Predator Helios 300');
    expect(done.summary).toContain('$1187.98');
    expect(done.summary).toContain('Dell Vostro 15');
    expect(done.summary).toContain('$497.17');
    expect(done.summary).not.toMatch(/\$494\.71|\$1399|\$97\.99/);
  });

  it('emits the six card pairs from the live first-send pages, not a skipped book or Galaxy Tab 3', () => {
    const captures = new Map();
    const first = decideTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
      tab: { id: 1, url: 'https://books.toscrape.com/', title: 'All products | Books to Scrape - Sandbox' },
      visibleText: [
        '1000 results - showing 1 to 20. Warning! This is a demo website for web scraping purposes. Prices and ratings here were randomly assigned and have no real meaning.',
        'A Light in the ... £51.77 In stock Add to basket Tipping the Velvet £53.74 In stock Add to basket Soumission £50.10 In stock Add to basket Sharp Objects £47.82',
      ].join(' '),
      interactiveElements: [
        { title: 'A Light in the Attic', text: 'A Light in the ...' },
        { title: 'Tipping the Velvet', text: 'Tipping the Velvet' },
        { title: 'Soumission', text: 'Soumission' },
        { title: 'Sharp Objects', text: 'Sharp Objects' },
      ],
    } as never);
    expect(first).toMatchObject({
      kind: 'action',
      name: 'open_tab',
      args: { url: 'https://webscraper.io/test-sites/e-commerce/allinone' },
    });
    const done = decideTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
      tab: { id: 2, url: 'https://webscraper.io/test-sites/e-commerce/allinone', title: 'Allinone | Web Scraper Test Sites' },
      visibleText: [
        'Top items being scraped right now $494.71 Acer Aspire 3... 128GB SSD, Windows 10 Home $1399 Windows 10 Home, Eng kbd $97.99',
        'Computers Laptops $581.99 Aspire E1-572G Intel Core i5-4210U $1187.98 Acer Predator Helios 300 (PH317-51) $497.17 Dell Vostro 15 (3568) Red',
        'Galaxy Tab 3 $97.99',
      ].join(' '),
      interactiveElements: [
        { title: 'Galaxy Tab 3', text: 'Galaxy Tab 3 $97.99' },
        { title: 'Aspire E1-572G', text: 'Aspire E1-572G' },
        { title: 'Acer Predator Helios 300 (PH317-51)', text: 'Acer Predator Helios 300 (PH317-51)' },
        { title: 'Dell Vostro 15 (3568) Red', text: 'Dell Vostro 15 (3568) Red' },
      ],
    } as never);
    expect(done?.kind).toBe('done');
    if (done?.kind !== 'done') throw new Error('expected done');
    expect(done.summary).toContain('A Light in the Attic');
    expect(done.summary).toContain('£51.77');
    expect(done.summary).toContain('Tipping the Velvet');
    expect(done.summary).toContain('£53.74');
    expect(done.summary).toContain('Soumission');
    expect(done.summary).toContain('£50.10');
    expect(done.summary).not.toContain('Sharp Objects');
    expect(done.summary).toContain('Aspire E1-572G');
    expect(done.summary).toContain('$581.99');
    expect(done.summary).toContain('Acer Predator Helios 300 (PH317-51)');
    expect(done.summary).toContain('$1187.98');
    expect(done.summary).toContain('Dell Vostro 15 (3568) Red');
    expect(done.summary).toContain('$497.17');
    expect(done.summary).not.toMatch(/Galaxy Tab 3|Tipping the Velvet — £51\.77|\$97\.99/);
  });

  it('emits 结果 after both sites even when the second page has no parseable products', () => {
    const captures = new Map();
    expect(
      decideTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
        tab: { id: 1, url: 'https://books.toscrape.com/', title: 'All products | Books to Scrape - Sandbox' },
        visibleText:
          'A Light in the Attic £51.77 In stock Add to basket Tipping the Velvet £53.74 In stock Add to basket Soumission £50.10 In stock Add to basket',
        interactiveElements: [{ title: 'A Light in the Attic', text: 'A Light in the ...' }],
      } as never)?.kind,
    ).toBe('action');
    const done = decideTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
      tab: { id: 2, url: 'https://webscraper.io/test-sites/e-commerce/allinone', title: 'Allinone | Web Scraper Test Sites' },
      visibleText: 'Allinone | Web Scraper Test Sites',
      interactiveElements: [],
    } as never);
    expect(done?.kind).toBe('done');
    if (done?.kind !== 'done') throw new Error('expected done');
    expect(done.summary).toContain('A Light in the Attic');
    expect(done.summary).toContain('£51.77');
    expect(done.summary).toContain('webscraper.io');
  });
});
