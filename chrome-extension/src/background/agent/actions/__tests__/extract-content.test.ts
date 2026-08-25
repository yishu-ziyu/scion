import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ActionBuilder } from '../builder';
import { extractContentActionSchema } from '../schemas';
import {
  extractStructuredRecords,
  parseExtractedRecords,
  parseModelExtractedRecords,
  runExtractContent,
} from '../extract-content';
import { tableRowCount } from '../../../task/artifact';
import type { AgentContext } from '../../types';

const here = dirname(fileURLToPath(import.meta.url));
const productsHtml = readFileSync(join(here, '../../../../../test/fixtures/products.html'), 'utf8');

function fieldedRows(rows: Array<Record<string, string>>): Array<Record<string, string>> {
  return rows.filter(row => Object.keys(row).length >= 2 && Object.values(row).some(value => value.trim()));
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
