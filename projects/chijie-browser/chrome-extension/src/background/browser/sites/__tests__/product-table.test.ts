import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  csvEscape,
  extractProductsFromHtml,
  formatProductTableDeliverable,
  formatProductsCsv,
  formatProductsMarkdown,
  instructionRequestsProductTable,
  parseProductTableInstruction,
  productTableCompletionPlan,
} from '../product-table';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '../../../../../test/fixtures/products.html');
const fixtureHtml = readFileSync(fixturePath, 'utf8');

describe('product-table R1 tracer', () => {
  it('parses e2e extract-to-CSV instruction', () => {
    const goal = parseProductTableInstruction(
      'Extract products to a CSV table with name, price, rating',
    );
    expect(goal).toEqual({ format: 'csv', minRows: 1 });
  });

  it('parses Chinese export instruction as CSV', () => {
    const goal = parseProductTableInstruction('把当前页商品导出为 CSV 表，含名称、价格、评分');
    expect(goal?.format).toBe('csv');
  });

  it('parses markdown preference when CSV not mentioned', () => {
    const goal = parseProductTableInstruction('Extract products to a markdown table with name and price');
    expect(goal?.format).toBe('md');
  });

  it('rejects unrelated instructions', () => {
    expect(parseProductTableInstruction('Fill Name with X and submit')).toBeNull();
    expect(parseProductTableInstruction('play the video')).toBeNull();
    expect(instructionRequestsProductTable('copy first comment')).toBe(false);
  });

  it('extracts ≥5 products from local fixture HTML', () => {
    const rows = extractProductsFromHtml(fixtureHtml);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0]).toMatchObject({
      name: 'Alpha Wireless Headphones',
      price: '$49.99',
      rating: '4.5',
    });
    expect(rows.map(r => r.name)).toContain('Epsilon Notebook Stand');
  });

  it('formats CSV with header and product rows', () => {
    const rows = extractProductsFromHtml(fixtureHtml);
    const csv = formatProductsCsv(rows);
    expect(csv.startsWith('name,price,rating\n')).toBe(true);
    expect(csv).toContain('Alpha Wireless Headphones,$49.99,4.5');
    expect(csv.split('\n').length).toBe(rows.length + 1);
  });

  it('formats markdown table', () => {
    const md = formatProductsMarkdown([
      { name: 'A', price: '$1', rating: '5' },
      { name: 'B', price: '$2', rating: '4' },
    ]);
    expect(md).toContain('| name | price | rating |');
    expect(md).toContain('| A | $1 | 5 |');
  });

  it('csvEscape quotes commas', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('plain')).toBe('plain');
  });

  it('deliverable is substantive multi-line table text', () => {
    const rows = extractProductsFromHtml(fixtureHtml);
    const deliverable = formatProductTableDeliverable(rows, 'csv');
    expect(deliverable).toMatch(/已提取 \d+ 件商品/);
    expect(deliverable).toContain('name,price,rating');
    expect(deliverable.split('\n').length).toBeGreaterThanOrEqual(6);
  });

  it('completion plan carries CSV deliverable summary', () => {
    const rows = extractProductsFromHtml(fixtureHtml);
    const plan = productTableCompletionPlan(rows);
    expect(plan?.summary).toContain('name,price,rating');
    expect(plan?.summary).toContain('Alpha Wireless Headphones');
  });

  it('extracts from simple HTML table rows', () => {
    const html = `
      <table>
        <tr><th>name</th><th>price</th><th>rating</th></tr>
        <tr><td>Widget</td><td>$10</td><td>4.1</td></tr>
        <tr><td>Gadget</td><td>$12</td><td>3.8</td></tr>
      </table>`;
    const rows = extractProductsFromHtml(html);
    expect(rows).toEqual([
      { name: 'Widget', price: '$10', rating: '4.1' },
      { name: 'Gadget', price: '$12', rating: '3.8' },
    ]);
  });
});
