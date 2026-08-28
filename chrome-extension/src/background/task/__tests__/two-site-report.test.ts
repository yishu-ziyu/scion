import { describe, expect, it } from 'vitest';
import { acceptTask, produceResult, resultIsPresentAndMatches } from '../task-result';
import {
  applyTwoSiteReportObservation,
  filterTwoSiteReportActions,
  formatTwoSiteReportCapturesForPrompt,
  isTwoSiteProductReportInstruction,
  parseNamePriceProducts,
  productCountFromInstruction,
  resolveTwoSiteReportTurn,
  twoSitePageFromFrame,
  twoSiteReportDeliverable,
  type TwoSiteReportCapture,
} from '../two-site-report';

const LIVE_INSTRUCTION =
  'Write a short report of the first 3 products on this page and the first 3 products on https://webscraper.io/test-sites/e-commerce/allinone. Include name and price from both sites.';

const BOOKS_TEXT = `All products
A Light in the Attic
£51.77
In stock
Add to basket
Tipping the Velvet
£53.74
In stock
Add to basket
Soumission
£50.10
In stock
Add to basket
Sharp Objects
£47.82`;

const ALLINONE_TEXT = `Allinone
Samsung Galaxy S
$407.99
2 reviews
Nokia 105
$67.99
1 reviews
Huawei P30
$499.99
3 reviews
Sony Xperia
$350.00`;

const LIVE_FAIL_BOOKS_TEXT = `A Light in the Attic
£51.77
Tipping the Velvet
£53.74
Soumission
£50.10
Sharp Objects
£47.82`;

const LIVE_FAIL_ALLINONE_TEXT = `Top items being scraped right now
$494.71
Acer Aspire 3...
Acer Aspire
128GB SSD, Windows 10 Home
$1399
Windows 10 Home, Eng kbd
$97.99
Computers
Laptops
$581.99
Aspire E1-572G
Intel Core i5-4210U, 8GB RAM, 1TB HDD, 15.6", Windows 8.1
7 reviews
$1187.98
Acer Predator Helios 300 (PH317-51)
15.6", Core i7-7700HQ, 8GB, 1TB + 128GB SSD, Windows 10 Home
7 reviews
$497.17
Dell Vostro 15 (3568) Red
Red, 15.6", Core i5-7200U, 4GB, 128GB SSD, Windows 10 Home, Eng kbd
7 reviews`;

const LIVE_ALLINONE_TEXT = `Top items being scraped right now
$679
Acer Aspire A5...
Acer Aspire A515-51-5654, Black, 15.6", FHD, Core i5-8250U, 8GB DDR4, 256GB SSD, Windows 10 Home, ENG
9 reviews
$1144.4
Dell Latitude...
Dell Latitude 5580, 15.6" FHD, Core i5-7300U, 8GB, 256GB SSD, Windows 10 Pro
10 reviews
$1178.19
Dell Latitude...
Dell Latitude 5580, 15.6" FHD, Core i5-7300U, 16GB, 256GB SSD, Linux + Windows 10 Home
6 reviews
Computers
Laptops
$581.99
Aspire E1-572G
Intel Core i5-4210U, 8GB RAM, 1TB HDD, 15.6", Windows 8.1
7 reviews
$1187.98
Acer Predator Helios 300 (PH317-51)
15.6", Core i7-7700HQ, 8GB, 1TB + 128GB SSD, Windows 10 Home
7 reviews
$497.17
Dell Vostro 15 (3568) Red
Red, 15.6", Core i5-7200U, 4GB, 128GB SSD, Windows 10 Home, Eng kbd
7 reviews`;

const LIVE_BOOKS_TEXT = `1000 results - showing 1 to 20.
A Light in the ...
£51.77
In stock
Add to basket
Tipping the Velvet
£53.74
In stock
Add to basket
Soumission
£50.10
In stock
Add to basket`;

function booksThenAllinone(): Map<string, TwoSiteReportCapture> {
  const captures = new Map<string, TwoSiteReportCapture>();
  applyTwoSiteReportObservation(LIVE_INSTRUCTION, captures, {
    url: 'https://books.toscrape.com/catalogue/category/books_1/index.html',
    title: 'All products | Books to Scrape',
    visibleText: BOOKS_TEXT,
  });
  applyTwoSiteReportObservation(LIVE_INSTRUCTION, captures, {
    url: 'https://webscraper.io/test-sites/e-commerce/allinone',
    title: 'Allinone | Web Scraper Test Sites',
    visibleText: ALLINONE_TEXT,
  });
  return captures;
}

describe('two-site product report', () => {
  it('detects the live two-site report and leaves table extract / one-page summary alone', () => {
    expect(isTwoSiteProductReportInstruction(LIVE_INSTRUCTION)).toBe(true);
    expect(productCountFromInstruction(LIVE_INSTRUCTION)).toBe(3);
    expect(
      isTwoSiteProductReportInstruction('Write a short summary of the first three books on this page.'),
    ).toBe(false);
    expect(
      isTwoSiteProductReportInstruction(
        'Extract products from https://a.test/products and https://b.test/products to a CSV table with name, price, rating',
      ),
    ).toBe(false);
  });

  it('parses the first three name/price rows from books and allinone wording', () => {
    expect(parseNamePriceProducts(BOOKS_TEXT, 3)).toEqual([
      { name: 'A Light in the Attic', price: '£51.77' },
      { name: 'Tipping the Velvet', price: '£53.74' },
      { name: 'Soumission', price: '£50.10' },
    ]);
    expect(parseNamePriceProducts(ALLINONE_TEXT, 3)).toEqual([
      { name: 'Samsung Galaxy S', price: '$407.99' },
      { name: 'Nokia 105', price: '$67.99' },
      { name: 'Huawei P30', price: '$499.99' },
    ]);
    expect(parseNamePriceProducts(LIVE_BOOKS_TEXT, 3)).toEqual([
      { name: 'A Light in the ...', price: '£51.77' },
      { name: 'Tipping the Velvet', price: '£53.74' },
      { name: 'Soumission', price: '£50.10' },
    ]);
    expect(parseNamePriceProducts(LIVE_FAIL_BOOKS_TEXT, 3)).toEqual([
      { name: 'A Light in the Attic', price: '£51.77' },
      { name: 'Tipping the Velvet', price: '£53.74' },
      { name: 'Soumission', price: '£50.10' },
    ]);
    expect(parseNamePriceProducts(LIVE_FAIL_BOOKS_TEXT, 3).map(item => item.name)).not.toContain('Sharp Objects');
    expect(parseNamePriceProducts(LIVE_FAIL_ALLINONE_TEXT, 3)).toEqual([
      { name: 'Aspire E1-572G', price: '$581.99' },
      { name: 'Acer Predator Helios 300 (PH317-51)', price: '$1187.98' },
      { name: 'Dell Vostro 15 (3568) Red', price: '$497.17' },
    ]);
    expect(parseNamePriceProducts(LIVE_ALLINONE_TEXT, 3)).toEqual([
      { name: 'Aspire E1-572G', price: '$581.99' },
      { name: 'Acer Predator Helios 300 (PH317-51)', price: '$1187.98' },
      { name: 'Dell Vostro 15 (3568) Red', price: '$497.17' },
    ]);
    expect(
      parseNamePriceProducts(LIVE_FAIL_ALLINONE_TEXT.replace(/\s+/g, ' '), 3).map(item => `${item.name} ${item.price}`),
    ).toEqual([
      'Aspire E1-572G $581.99',
      'Acer Predator Helios 300 $1187.98',
      'Dell Vostro 15 $497.17',
    ]);
    expect(
      parseNamePriceProducts(
        [
          'Top items being scraped right now $494.71 Acer Aspire 3... 128GB SSD, Windows 10 Home $1399 Windows 10 Home, Eng kbd $97.99',
          '$581.99 Aspire E1-572G Intel Core i5-4210U $1187.98 Acer Predator Helios 300 $497.17 Dell Vostro 15 Computers Laptops',
        ].join(' '),
        3,
      ),
    ).toEqual([
      { name: 'Aspire E1-572G', price: '$581.99' },
      { name: 'Acer Predator Helios 300', price: '$1187.98' },
      { name: 'Dell Vostro 15', price: '$497.17' },
    ]);
    expect(parseNamePriceProducts(LIVE_ALLINONE_TEXT, 3).map(item => item.name).join('\n')).not.toContain(
      'Top items being scraped right now',
    );
    expect(
      parseNamePriceProducts(
        'A Light in the Attic £51.77 Tipping the Velvet £53.74 Soumission £50.10 Sharp Objects £47.82',
        3,
      ),
    ).toEqual([
      { name: 'A Light in the Attic', price: '£51.77' },
      { name: 'Tipping the Velvet', price: '£53.74' },
      { name: 'Soumission', price: '£50.10' },
    ]);
    const collapsedBooks = [
      'Home Books Travel Mystery Historical Fiction Sequential Art Classics Philosophy Romance Womens Fiction Fiction Childrens Religion Nonfiction Music Default Science Fiction Sports and Games Fantasy New Adult Young Adult Science Poetry Paranormal Art Psychology Autobiography Parenting',
      '1000 results - showing 1 to 20. Warning! This is a demo website for web scraping purposes. Prices and ratings here were randomly assigned and have no real meaning.',
      'A Light in the Attic £51.77 In stock Add to basket Tipping the Velvet £53.74 In stock Add to basket Soumission £50.10 In stock Add to basket Sharp Objects £47.82',
    ].join(' ');
    expect(parseNamePriceProducts(collapsedBooks, 3)).toEqual([
      { name: 'A Light in the Attic', price: '£51.77' },
      { name: 'Tipping the Velvet', price: '£53.74' },
      { name: 'Soumission', price: '£50.10' },
    ]);
    expect(
      parseNamePriceProducts('Aspire E1-572G $581.99 Acer Predator Helios 300 $1187.98 Dell Vostro 15 $497.17', 3),
    ).toEqual([
      { name: 'Aspire E1-572G', price: '$581.99' },
      { name: 'Acer Predator Helios 300', price: '$1187.98' },
      { name: 'Dell Vostro 15', price: '$497.17' },
    ]);
    expect(
      parseNamePriceProducts('$581.99 Aspire E1-572G $1187.98 Acer Predator Helios 300 $497.17 Dell Vostro 15', 3),
    ).toEqual([
      { name: 'Aspire E1-572G', price: '$581.99' },
      { name: 'Acer Predator Helios 300', price: '$1187.98' },
      { name: 'Dell Vostro 15', price: '$497.17' },
    ]);
  });

  it('does not skip a truncated first book card or pair a later-grid tablet', () => {
    const collapsedTruncatedBooks = [
      'Home Books Travel Mystery Historical Fiction Sequential Art Classics Philosophy Romance Womens Fiction Fiction Childrens Religion Nonfiction Music Default Science Fiction Sports and Games Fantasy New Adult Young Adult Science Poetry Paranormal Art Psychology Autobiography Parenting',
      '1000 results - showing 1 to 20. Warning! This is a demo website for web scraping purposes. Prices and ratings here were randomly assigned and have no real meaning.',
      'A Light in the ... £51.77 In stock Add to basket Tipping the Velvet £53.74 In stock Add to basket Soumission £50.10 In stock Add to basket Sharp Objects £47.82',
    ].join(' ');
    expect(parseNamePriceProducts(collapsedTruncatedBooks, 3)).toEqual([
      { name: 'A Light in the ...', price: '£51.77' },
      { name: 'Tipping the Velvet', price: '£53.74' },
      { name: 'Soumission', price: '£50.10' },
    ]);
    expect(parseNamePriceProducts(collapsedTruncatedBooks, 3).map(item => item.name)).not.toContain('Sharp Objects');

    const booksPage = twoSitePageFromFrame({
      tab: { url: 'https://books.toscrape.com/', title: 'All products | Books to Scrape' },
      visibleText: collapsedTruncatedBooks,
      interactiveElements: [
        { title: 'A Light in the Attic', text: 'A Light in the ...' },
        { title: 'Tipping the Velvet', text: 'Tipping the Velvet' },
        { title: 'Soumission', text: 'Soumission' },
        { title: 'Sharp Objects', text: 'Sharp Objects' },
      ],
    });
    expect(parseNamePriceProducts(booksPage?.visibleText ?? '', 3)).toEqual([
      { name: 'A Light in the Attic', price: '£51.77' },
      { name: 'Tipping the Velvet', price: '£53.74' },
      { name: 'Soumission', price: '£50.10' },
    ]);

    const allinonePage = twoSitePageFromFrame({
      tab: { url: 'https://webscraper.io/test-sites/e-commerce/allinone', title: 'Allinone' },
      visibleText: [
        'Top items being scraped right now $494.71 Acer Aspire 3... Acer Aspire 128GB SSD, Windows 10 Home $1399 Windows 10 Home, Eng kbd $97.99',
        'Computers Laptops $581.99 Aspire E1-572G Intel Core i5-4210U, 8GB RAM, 1TB HDD, 15.6", Windows 8.1 7 reviews',
        '$1187.98 Acer Predator Helios 300 (PH317-51) 15.6", Core i7-7700HQ, 8GB, 1TB + 128GB SSD, Windows 10 Home 7 reviews',
        '$497.17 Dell Vostro 15 (3568) Red Red, 15.6", Core i5-7200U, 4GB, 128GB SSD, Windows 10 Home, Eng kbd 7 reviews',
        'Galaxy Tab 3 $97.99',
      ].join(' '),
      interactiveElements: [
        { title: 'Galaxy Tab 3', text: 'Galaxy Tab 3 $97.99' },
        { title: 'Aspire E1-572G', text: 'Aspire E1-572G' },
        { title: 'Acer Predator Helios 300 (PH317-51)', text: 'Acer Predator Helios 300 (PH317-51)' },
        { title: 'Dell Vostro 15 (3568) Red', text: 'Dell Vostro 15 (3568) Red' },
      ],
    });
    expect(parseNamePriceProducts(allinonePage?.visibleText ?? '', 3)).toEqual([
      { name: 'Aspire E1-572G', price: '$581.99' },
      { name: 'Acer Predator Helios 300 (PH317-51)', price: '$1187.98' },
      { name: 'Dell Vostro 15 (3568) Red', price: '$497.17' },
    ]);
    expect(parseNamePriceProducts(allinonePage?.visibleText ?? '', 3).map(item => `${item.name} ${item.price}`)).not.toContain(
      'Galaxy Tab 3 $97.99',
    );
  });

  it('opens the unread named URL after the current page is read, then emits 结果 instead of bouncing', () => {
    const captures = new Map<string, TwoSiteReportCapture>();
    expect(
      resolveTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
        url: 'https://books.toscrape.com/catalogue/category/books_1/index.html',
        visibleText: BOOKS_TEXT,
      }),
    ).toEqual({
      kind: 'open',
      url: 'https://webscraper.io/test-sites/e-commerce/allinone',
    });

    const afterSecond = resolveTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
      url: 'https://webscraper.io/test-sites/e-commerce/allinone',
      visibleText: ALLINONE_TEXT,
    });
    expect(afterSecond.kind).toBe('done');
    if (afterSecond.kind !== 'done') throw new Error('expected done');
    expect(afterSecond.summary).toContain('A Light in the Attic');
    expect(afterSecond.summary).toContain('£51.77');
    expect(afterSecond.summary).toContain('Samsung Galaxy S');
    expect(afterSecond.summary).toContain('$407.99');
    expect(afterSecond.summary).not.toContain('<article');
    expect(afterSecond.summary).not.toContain(LIVE_INSTRUCTION);

    expect(
      resolveTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
        url: 'https://books.toscrape.com/catalogue/category/books_1/index.html',
        visibleText: BOOKS_TEXT,
      }).kind,
    ).toBe('done');
  });

  it('opens the second site after an empty first-page read instead of rereading until fail', () => {
    const captures = new Map<TwoSiteReportCapture['key'], TwoSiteReportCapture>();
    expect(
      resolveTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
        url: 'https://books.toscrape.com/',
        visibleText: 'All products',
      }),
    ).toEqual({
      kind: 'open',
      url: 'https://webscraper.io/test-sites/e-commerce/allinone',
    });
    expect(captures.size).toBe(0);

    applyTwoSiteReportObservation(LIVE_INSTRUCTION, captures, {
      url: 'https://books.toscrape.com/',
      visibleText: BOOKS_TEXT,
    });
    expect(
      resolveTwoSiteReportTurn(LIVE_INSTRUCTION, captures, {
        url: 'https://webscraper.io/test-sites/e-commerce/allinone',
        visibleText: 'Allinone | Web Scraper Test Sites',
      }),
    ).toEqual({
      kind: 'read',
      url: 'https://webscraper.io/test-sites/e-commerce/allinone',
    });
    expect(twoSiteReportDeliverable(LIVE_INSTRUCTION, captures)).toBeNull();
  });

  it('reads collapsed first-page wording then opens allinone', () => {
    const captures = new Map<string, TwoSiteReportCapture>();
    const page = twoSitePageFromFrame({
      tab: { url: 'https://books.toscrape.com/', title: 'All products' },
      visibleText: [
        'Home Books Travel Mystery Historical Fiction Sequential Art Classics Philosophy Romance Womens Fiction Fiction Childrens Religion Nonfiction Music',
        'A Light in the Attic £51.77 In stock Add to basket Tipping the Velvet £53.74 In stock Add to basket Soumission £50.10 In stock Add to basket',
      ].join(' '),
      interactiveElements: [{ title: 'A Light in the Attic', text: 'A Light in the ... £51.77' }],
    });
    expect(
      resolveTwoSiteReportTurn(LIVE_INSTRUCTION, captures, page),
    ).toEqual({
      kind: 'open',
      url: 'https://webscraper.io/test-sites/e-commerce/allinone',
    });
    expect(captures.get('current-page')?.products).toEqual([
      { name: 'A Light in the Attic', price: '£51.77' },
      { name: 'Tipping the Velvet', price: '£53.74' },
      { name: 'Soumission', price: '£50.10' },
    ]);
  });

  it('rewrites switch_tab bounce toward the unread source, then drops nav once both are read', () => {
    const captures = new Map<string, TwoSiteReportCapture>();
    applyTwoSiteReportObservation(LIVE_INSTRUCTION, captures, {
      url: 'https://books.toscrape.com/',
      visibleText: BOOKS_TEXT,
    });
    const bounce = { name: 'switch_tab', args: { tab_id: 3 } };
    expect(filterTwoSiteReportActions(LIVE_INSTRUCTION, captures, [bounce])).toEqual([
      { name: 'open_tab', args: { url: 'https://webscraper.io/test-sites/e-commerce/allinone' } },
    ]);
    const both = booksThenAllinone();
    expect(filterTwoSiteReportActions(LIVE_INSTRUCTION, both, [bounce, { name: 'observe', args: {} }])).toEqual([]);
  });

  it('produces a takeable report 结果 from both captured pages', () => {
    const asked = acceptTask(LIVE_INSTRUCTION);
    expect(asked.askedKind).toBe('report');
    const body = twoSiteReportDeliverable(LIVE_INSTRUCTION, booksThenAllinone());
    expect(body).toBeTruthy();
    const produced = produceResult({ asked, summary: body ?? '' });
    expect(produced?.kind).toBe('report');
    expect(resultIsPresentAndMatches(asked, produced)).toBe(true);
    expect(produced?.body).toContain('Tipping the Velvet');
    expect(produced?.body).toContain('Nokia 105');
    expect(formatTwoSiteReportCapturesForPrompt(LIVE_INSTRUCTION, booksThenAllinone())).toContain(
      'A Light in the Attic £51.77',
    );
  });
});
