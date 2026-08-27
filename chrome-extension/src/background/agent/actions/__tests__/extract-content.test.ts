import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ActionBuilder } from '../builder';
import { extractContentActionSchema } from '../schemas';
import {
  extractStructuredRecords,
  htmlHasNextPage,
  parseExtractedRecords,
  parseModelExtractedRecords,
  runExtractContent,
} from '../extract-content';
import { tableDataRows, tableRowCount } from '../../../task/artifact';
import type { ActionResult, AgentContext } from '../../types';

const here = dirname(fileURLToPath(import.meta.url));
const productsHtml = readFileSync(join(here, '../../../../../test/fixtures/products.html'), 'utf8');
const allinoneHtml = readFileSync(join(here, '../../../../../test/fixtures/allinone-product-cards.html'), 'utf8');
const booksHtml = readFileSync(join(here, '../../../../../test/fixtures/books-product-pods.html'), 'utf8');

function fieldedRows(rows: Array<Record<string, string>>): Array<Record<string, string>> {
  return rows.filter(row => Object.keys(row).length >= 2 && Object.values(row).some(value => value.trim()));
}

function pagedTableHtml(
  rows: Array<[string, string]>,
  next: 'rel' | 'text' | 'aria' | 'cn' | 'more' | 'none' = 'none',
): string {
  const body = rows.map(([name, qty]) => `<tr><td>${name}</td><td>${qty}</td></tr>`).join('');
  const pager =
    next === 'rel'
      ? '<a rel="next" href="/p2">Next</a>'
      : next === 'text'
        ? '<a href="/p2">Next</a>'
        : next === 'aria'
          ? '<button type="button" aria-label="Next page">→</button>'
          : next === 'cn'
            ? '<a href="/p2">下一页</a>'
            : next === 'more'
              ? '<button type="button">Load more</button>'
              : '';
  return `<table><tr><th>Name</th><th>Qty</th></tr>${body}</table>${pager}`;
}

function rowNames(result: ActionResult): string[] {
  if (!result.artifact) return [];
  return tableDataRows(result.artifact).map(row => String(row.name ?? ''));
}

describe('extractStructuredRecords', () => {
  it('extracts at least 5 fielded rows from the products fixture', () => {
    const rows = extractStructuredRecords(productsHtml);
    expect(fieldedRows(rows).length).toBeGreaterThanOrEqual(5);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        name: 'Alpha Wireless Headphones',
        price: '$49.99',
        rating: '4.5',
      }),
    );
    expect(rows.map(row => row.name)).toContain('Zeta Webcam Cover');
  });

  it('extracts a generic HTML table without product-specific fields', () => {
    const html = `
      <table>
        <tr><th>City</th><th>Pop</th></tr>
        <tr><td>Oslo</td><td>700000</td></tr>
        <tr><td>Bergen</td><td>280000</td></tr>
      </table>
    `;
    const rows = extractStructuredRecords(html);
    expect(rows).toEqual([
      { city: 'Oslo', pop: '700000' },
      { city: 'Bergen', pop: '280000' },
    ]);
  });

  it('uses optional schema only to pick field names', () => {
    const rows = extractStructuredRecords(productsHtml, ['name', 'price']);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(rows[0]).sort()).toEqual(['name', 'price']);
  });

  it('maps Chinese schema names onto English product fields', () => {
    const rows = extractStructuredRecords(productsHtml, ['名称', '价格', '评分']);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(rows[0]!).sort()).toEqual(['价格', '名称', '评分']);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        名称: 'Alpha Wireless Headphones',
        价格: '$49.99',
        评分: '4.5',
      }),
    );
  });

  it('reads product-wrapper cards instead of footer columns for name,price,rating', () => {
    const rows = extractStructuredRecords(allinoneHtml, ['name', 'price', 'rating']);
    expect(rows).toEqual([
      { name: 'Asus ROG Strix GL553VD-DM535T', price: '$1101.83', rating: '2' },
      { name: 'Nokia 123', price: '$24.99', rating: '3' },
      { name: 'MSI GL62M 7REX2', price: '$1199', rating: '2' },
    ]);
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/Products|Company|Resources|Contact|Web Scraper Cloud|About us/);
  });

  it('reads product_pod cards instead of sidebar categories for name,price,rating', () => {
    const rows = extractStructuredRecords(booksHtml, ['name', 'price', 'rating']);
    expect(rows).toEqual([
      { name: 'A Light in the Attic', price: '£51.77', rating: '3' },
      { name: 'Tipping the Velvet', price: '£53.74', rating: '1' },
      { name: 'Sharp Objects', price: '£47.82', rating: '4' },
    ]);
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/Travel|Mystery|Historical Fiction|Sequential Art/);
  });
});

describe('extract_content action', () => {
  it('reads products.html via getContent, writes artifact JSON, and does not complete the task', async () => {
    const getContent = vi.fn(async () => productsHtml);
    const getReadabilityContent = vi.fn(async () => ({ content: productsHtml }));
    const result = await runExtractContent(
      { goal: 'name, price, rating', schema: 'name,price,rating' },
      {
        getContent,
        getReadabilityContent,
        url: () => 'https://example.test/products',
        title: async () => 'Product List Fixture',
      },
    );

    expect(getContent).toHaveBeenCalled();
    expect(result.isDone).toBe(false);
    expect(result.success).toBe(true);
    expect(result.artifact?.type).toBe('table');
    expect(tableRowCount(result.artifact!)).toBeGreaterThanOrEqual(5);
    const rows = parseExtractedRecords(result.extractedContent);
    expect(fieldedRows(rows).length).toBeGreaterThanOrEqual(5);
    expect(result.extractedContent).toContain(result.artifact?.id ?? 'missing-artifact');
    expect(result.extractedContent).toMatch(/Task is not complete/);
    expect(result.hasMorePages).toBe(false);
    expect(result.artifact?.sources).toEqual([
      expect.objectContaining({ url: 'https://example.test/products', title: 'Product List Fixture' }),
    ]);
  });

  it('stores origin and path only on the extract source, not query or fragment', async () => {
    const result = await runExtractContent(
      { goal: 'name, price, rating', schema: 'name,price,rating' },
      {
        getContent: async () => productsHtml,
        url: () => 'https://example.test/products?utm=1#list',
        title: async () => 'Product List Fixture',
      },
    );
    expect(result.artifact?.sources).toEqual([expect.objectContaining({ url: 'https://example.test/products' })]);
  });

  it('falls back to getReadabilityContent when getContent is empty', async () => {
    const result = await runExtractContent(
      { goal: 'list rows' },
      {
        getContent: async () => '',
        getReadabilityContent: async () => productsHtml,
      },
    );
    expect(fieldedRows(parseExtractedRecords(result.extractedContent)).length).toBeGreaterThanOrEqual(5);
    expect(result.isDone).toBe(false);
  });

  it('stores a name/price/rating table from product-wrapper cards, not footer columns', async () => {
    const result = await runExtractContent(
      { goal: 'Extract products to a CSV table with name, price, rating', schema: 'name,price,rating' },
      {
        getContent: async () => allinoneHtml,
        url: () => 'https://webscraper.io/test-sites/e-commerce/allinone',
        title: async () => 'Web Scraper | Test Sites',
      },
    );
    expect(result.isDone).toBe(false);
    expect(result.success).toBe(true);
    expect(result.artifact?.type).toBe('table');
    expect(tableRowCount(result.artifact!)).toBe(3);
    expect(tableDataRows(result.artifact!)).toEqual([
      { name: 'Asus ROG Strix GL553VD-DM535T', price: '$1101.83', rating: '2' },
      { name: 'Nokia 123', price: '$24.99', rating: '3' },
      { name: 'MSI GL62M 7REX2', price: '$1199', rating: '2' },
    ]);
    expect(result.extractedContent).not.toMatch(/Web Scraper Cloud|About us/);
  });

  it('stores a name/price/rating table from product_pod cards, not sidebar categories', async () => {
    const result = await runExtractContent(
      { goal: 'Extract products to a CSV table with name, price, rating', schema: 'name,price,rating' },
      {
        getContent: async () => booksHtml,
        url: () => 'https://books.toscrape.com/',
        title: async () => 'All products | Books to Scrape',
      },
    );
    expect(result.artifact?.type).toBe('table');
    expect(tableDataRows(result.artifact!)).toEqual([
      { name: 'A Light in the Attic', price: '£51.77', rating: '3' },
      { name: 'Tipping the Velvet', price: '£53.74', rating: '1' },
      { name: 'Sharp Objects', price: '£47.82', rating: '4' },
    ]);
    expect(result.extractedContent).not.toMatch(/Travel|Mystery/);
  });

  it('returns empty JSON without an artifact and without completing when nothing structured is found', async () => {
    const result = await runExtractContent(
      { goal: 'any table' },
      { getContent: async () => '<p>Just a paragraph with no list or table.</p>' },
    );
    expect(result.isDone).toBe(false);
    expect(result.artifact).toBeNull();
    expect(result.extractedContent).toMatch(/Extracted 0 records/);
  });

  it('extracts repeating cards that are not list items', () => {
    const html = `
      <section>
        <article class="card"><span class="item-name">One</span><span class="item-qty">2</span></article>
        <article class="card"><span class="item-name">Two</span><span class="item-qty">5</span></article>
        <article class="card"><span class="item-name">Three</span><span class="item-qty">9</span></article>
      </section>
    `;
    expect(extractStructuredRecords(html)).toEqual([
      { name: 'One', qty: '2' },
      { name: 'Two', qty: '5' },
      { name: 'Three', qty: '9' },
    ]);
  });

  it('observe action returns only matching controls and is not done', async () => {
    const node = (tagName: string, attributes: Record<string, string>, text: string) => ({
      tagName,
      attributes,
      getAllTextTillNextClickableElement: (): string => text,
    });
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getState: async () => ({
          tabId: 1,
          url: 'https://example.test/form',
          title: 'Form',
          selectorMap: new Map([
            [1, node('a', {}, 'Home')],
            [2, node('button', { type: 'submit' }, '提交')],
            [3, node('button', {}, 'Cancel')],
          ]),
        }),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const observe = actions.find(action => action.name() === 'observe');
    expect(observe).toBeTruthy();
    const result = await observe!.call({ query: '提交' });
    expect(result.isDone).toBe(false);
    expect(result.extractedContent).toContain('[2]');
    expect(result.extractedContent).toContain('提交');
    expect(result.extractedContent).not.toContain('[1]');
    expect(result.extractedContent).not.toContain('Cancel');
  });

  it('is registered on ActionBuilder and stays not-done', async () => {
    const context = {
      emitEvent: vi.fn(),
      browserContext: {
        getCurrentPage: async () => ({
          getContent: async () => productsHtml,
          getReadabilityContent: async () => ({ content: productsHtml }),
          url: () => 'https://example.test/products',
          title: async () => 'Product List Fixture',
        }),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    expect(actions.some(action => action.name() === 'observe')).toBe(true);
    const extract = actions.find(action => action.name() === 'extract_content');
    expect(extract).toBeTruthy();
    expect(extract?.schema).toBe(extractContentActionSchema);
    const result = await extract!.call({ goal: 'name,price,rating' });
    expect(result.isDone).toBe(false);
    expect(fieldedRows(parseExtractedRecords(result.extractedContent)).length).toBeGreaterThanOrEqual(5);
  });

  it('calls the worker model only when local parse finds no rows', async () => {
    const extractWithModel = vi.fn(async () => '[{"city":"Oslo","pop":"700000"},{"city":"Bergen","pop":"280000"}]');
    const result = await runExtractContent(
      { goal: 'city and population' },
      { getContent: async () => '<p>Oslo 700000. Bergen 280000. Just prose.</p>' },
      { extractWithModel },
    );
    expect(extractWithModel).toHaveBeenCalledTimes(1);
    expect(result.isDone).toBe(false);
    expect(parseExtractedRecords(result.extractedContent)).toEqual([
      { city: 'Oslo', pop: '700000' },
      { city: 'Bergen', pop: '280000' },
    ]);
  });

  it('does not call the worker model when local parse already has rows', async () => {
    const extractWithModel = vi.fn(async () => '[]');
    const result = await runExtractContent(
      { goal: 'name,price,rating', schema: 'name,price,rating' },
      { getContent: async () => productsHtml },
      { extractWithModel },
    );
    expect(extractWithModel).not.toHaveBeenCalled();
    expect(fieldedRows(parseExtractedRecords(result.extractedContent)).length).toBeGreaterThanOrEqual(5);
  });

  it('parses a JSON array from model prose', () => {
    expect(parseModelExtractedRecords('Here:\n[{"name":"A","price":"1"}]\n', ['name', 'price'])).toEqual([
      { name: 'A', price: '1' },
    ]);
  });

  it('merges the next results page into one table when advancePage succeeds', async () => {
    let html = pagedTableHtml(
      [
        ['A', '1'],
        ['B', '2'],
      ],
      'rel',
    );
    const advancePage = vi.fn(async () => {
      html = pagedTableHtml(
        [
          ['C', '3'],
          ['D', '4'],
        ],
        'none',
      );
      return true;
    });
    const result = await runExtractContent(
      { goal: 'name, qty' },
      { getContent: async () => html, url: () => 'https://example.test/list', title: async () => 'List' },
      { advancePage },
    );
    expect(advancePage).toHaveBeenCalledTimes(1);
    expect(result.isDone).toBe(false);
    expect(result.hasMorePages).toBe(false);
    expect(result.extractedContent).toMatch(/Task is not complete/);
    expect(rowNames(result)).toEqual(['A', 'B', 'C', 'D']);
    expect(tableRowCount(result.artifact!)).toBe(4);
  });

  it('returns the first page and hasMorePages when Next exists but advancePage is omitted', async () => {
    const result = await runExtractContent(
      { goal: 'name, qty' },
      {
        getContent: async () =>
          pagedTableHtml(
            [
              ['A', '1'],
              ['B', '2'],
            ],
            'rel',
          ),
      },
    );
    expect(result.isDone).toBe(false);
    expect(result.hasMorePages).toBe(true);
    expect(rowNames(result)).toEqual(['A', 'B']);
    expect(result.extractedContent).toMatch(/Task is not complete/);
  });

  it('stops advancing when the next page adds no new rows', async () => {
    const page1 = pagedTableHtml(
      [
        ['A', '1'],
        ['B', '2'],
      ],
      'rel',
    );
    let html = page1;
    const advancePage = vi.fn(async () => {
      html = page1;
      return true;
    });
    const result = await runExtractContent({ goal: 'name, qty' }, { getContent: async () => html }, { advancePage });
    expect(advancePage).toHaveBeenCalledTimes(1);
    expect(rowNames(result)).toEqual(['A', 'B']);
    expect(result.hasMorePages).toBe(false);
  });

  it('caps extra pages at 8 and leaves hasMorePages when Next remains', async () => {
    let pageNo = 1;
    const htmlFor = (n: number) => pagedTableHtml([[`R${n}`, String(n)]], 'rel');
    let html = htmlFor(1);
    const advancePage = vi.fn(async () => {
      pageNo += 1;
      html = htmlFor(pageNo);
      return true;
    });
    const result = await runExtractContent({ goal: 'name, qty' }, { getContent: async () => html }, { advancePage });
    expect(advancePage).toHaveBeenCalledTimes(7);
    expect(rowNames(result)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
    expect(result.hasMorePages).toBe(true);
    expect(result.isDone).toBe(false);
  });

  it('detects Next, rel=next, 下一页, aria-label next, and load more from HTML only', () => {
    expect(htmlHasNextPage(pagedTableHtml([['A', '1']], 'rel'))).toBe(true);
    expect(htmlHasNextPage(pagedTableHtml([['A', '1']], 'text'))).toBe(true);
    expect(htmlHasNextPage(pagedTableHtml([['A', '1']], 'cn'))).toBe(true);
    expect(htmlHasNextPage(pagedTableHtml([['A', '1']], 'aria'))).toBe(true);
    expect(htmlHasNextPage(pagedTableHtml([['A', '1']], 'more'))).toBe(true);
    expect(htmlHasNextPage(pagedTableHtml([['A', '1']], 'none'))).toBe(false);
    expect(
      htmlHasNextPage(
        '<p>Next we compare the two rows.</p><table><tr><th>Name</th><th>Qty</th></tr><tr><td>A</td><td>1</td></tr></table>',
      ),
    ).toBe(false);
  });

  it('clicks a live Next control when extract_content is wired through ActionBuilder', async () => {
    let html = pagedTableHtml(
      [
        ['A', '1'],
        ['B', '2'],
      ],
      'rel',
    );
    const nextNode = {
      tagName: 'a',
      attributes: { rel: 'next', href: '/p2' },
      getAllTextTillNextClickableElement: (): string => 'Next',
    };
    const state = {
      tabId: 1,
      url: 'https://example.test/list',
      title: 'List',
      selectorMap: new Map<number, typeof nextNode>([[4, nextNode]]),
    };
    const clickElementNode = vi.fn(async () => {
      html = pagedTableHtml(
        [
          ['C', '3'],
          ['D', '4'],
        ],
        'none',
      );
      state.selectorMap = new Map();
    });
    const context = {
      emitEvent: vi.fn(),
      options: { useVision: false },
      browserContext: {
        getCurrentPage: async () => ({
          getContent: async () => html,
          url: () => 'https://example.test/list',
          title: async () => 'List',
          getState: async () => state,
          getDomElementByIndex: (index: number) => state.selectorMap.get(index),
          clickElementNode,
          waitForPageAndFramesLoad: async () => undefined,
          isFileUploader: () => false,
        }),
      },
    } as unknown as AgentContext;
    const actions = new ActionBuilder(context, {} as BaseChatModel).buildDefaultActions();
    const extract = actions.find(action => action.name() === 'extract_content');
    const result = await extract!.call({ goal: 'name, qty' });
    expect(clickElementNode).toHaveBeenCalledTimes(1);
    expect(rowNames(result)).toEqual(['A', 'B', 'C', 'D']);
    expect(result.hasMorePages).toBe(false);
    expect(result.isDone).toBe(false);
  });

  it('does not import or call the product-list skill/parser', () => {
    const files = [
      join(here, '../builder.ts'),
      join(here, '../extract-content.ts'),
      join(here, '../schemas.ts'),
      join(here, '../../backends/control-llm.ts'),
      join(here, '../../backends/control-policy.ts'),
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/extractProductsFromHtml/);
      expect(source, file).not.toMatch(/repeating-list-extract/);
      expect(source, file).not.toMatch(/builtin\.repeating-list-extract/);
    }
  });
});
