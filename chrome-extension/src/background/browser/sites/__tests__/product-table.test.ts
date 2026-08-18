import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  csvEscape,
  extractProductsFromHtml,
  formatProductTableDeliverable,
  formatMostExpensiveProductConclusion,
  formatProductsCsv,
  formatProductsMarkdown,
  instructionRequestsMostExpensive,
  instructionRequestsProductTable,
  parseProductTableInstruction,
  productRowEvidenceText,
  productTableCompletionPlan,
} from '../product-table';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '../../../../../test/fixtures/products.html');
const fixtureHtml = readFileSync(fixturePath, 'utf8');

describe('product-table R1 tracer', () => {
  it('binds evidence to the complete row instead of a bag of cells', () => {
    expect(productRowEvidenceText({ name: 'A', price: '$1', rating: '5' })).toBe(
      productRowEvidenceText({ name: ' A ', price: '$1', rating: '5' }),
    );
    expect(productRowEvidenceText({ name: 'A', price: '$1', rating: '5' })).not.toBe(
      productRowEvidenceText({ name: 'A', price: '$2', rating: '5' }),
    );
  });

  it('parses e2e extract-to-CSV instruction', () => {
    const goal = parseProductTableInstruction('Extract products to a CSV table with name, price, rating');
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

  it.each([
    ['不要导出商品CSV表格', null],
    ['返回页面标题，但不要输出商品表格', null],
    ['Do not export the products as a CSV table', null],
    ['不要修改页面并导出商品CSV表格', { format: 'csv', minRows: 1 }],
  ])('gates the product-table skill on an affirmed local predicate: %s', (instruction, expected) => {
    expect(parseProductTableInstruction(instruction)).toEqual(expected);
  });

  it.each([
    ['打开商品清单页', null],
    ['Open the product listing page', null],
    ['导出商品表格但不要CSV改Markdown', { format: 'md', minRows: 1 }],
    ['Export the product table, but do not use CSV; use Markdown', { format: 'md', minRows: 1 }],
    ['不要全部商品，只前5并CSV', { format: 'csv', minRows: 5 }],
    ['Do not export all products; export the first 5 as CSV', { format: 'csv', minRows: 5 }],
  ])('consumes resolved table shape without rereading raw polarity: %s', (instruction, expected) => {
    expect(parseProductTableInstruction(instruction)).toEqual(expected);
  });

  it('recognizes an explicit highest-price request without changing ordinary table tasks', () => {
    expect(instructionRequestsMostExpensive('根据页面数据写出最贵商品的名称与价格')).toBe(true);
    expect(instructionRequestsMostExpensive('State the most expensive product and its price')).toBe(true);
    expect(instructionRequestsMostExpensive('Extract products to a CSV table')).toBe(false);
  });

  it.each([
    ['不要猜最贵商品；请根据页面数据写出最贵商品', true],
    ['不要猜最贵商品，请根据页面数据写出最贵商品', true],
    ["Don't guess; identify the most expensive product", true],
    ["Don't guess the most expensive product, identify it from the page", true],
    ['Do not invent data; state the most expensive product', true],
    ['不要猜最贵商品', false],
    ['不要找最贵商品', false],
    ["Don't guess the most expensive product", false],
    ['页面指出最贵商品后结束', false],
    ['The page identifies the most expensive product', false],
    ['打开最贵商品页', false],
    ['Open the most expensive product page', false],
    ['页面展示最贵商品，点击它', false],
    ['The page displays the most expensive product; click it', false],
    ['不要输出最贵商品', false],
    ['Do not identify the most expensive product', false],
    ['Do not identify the most expensive product, state it nowhere', false],
    ['不要不输出最贵商品', true],
    ['不可不返回最贵商品', true],
    ['Do not fail to identify the most expensive product', true],
    ['Never fail to provide the most expensive product', true],
    ['不要说上述结论是编造的；最贵商品的名称与价格', true],
  ])('distinguishes anti-fabrication guidance from a negated highest-price output: %s', (instruction, expected) => {
    expect(instructionRequestsMostExpensive(instruction)).toBe(expected);
  });

  it('derives the highest-price conclusion from rows, preserving the source price', () => {
    expect(
      formatMostExpensiveProductConclusion([
        { name: 'A', price: '$9.50', rating: '4' },
        { name: 'B', price: '$10.00', rating: '5' },
      ]),
    ).toBe('最贵商品是 B，价格为 $10.00。');
    expect(
      formatMostExpensiveProductConclusion([
        { name: 'First tie', price: '$10', rating: '4' },
        { name: 'Second tie', price: '$10.00', rating: '5' },
      ]),
    ).toBe('最贵商品是 First tie，价格为 $10。');
    expect(
      formatMostExpensiveProductConclusion([
        { name: 'Known', price: '$10', rating: '4' },
        { name: 'Unknown', price: '询价', rating: '5' },
      ]),
    ).toBeNull();
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
