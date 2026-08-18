import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractProductRowsFromHtml,
  formatProductTableDeliverable,
  isExtractProductsInstruction,
  productRowsToCsv,
} from '../extract-products';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productsFixture = readFileSync(
  path.resolve(__dirname, '../../../../../test/fixtures/products.html'),
  'utf8',
);

const tableHtml = `<!doctype html><html><body>
<table>
  <tr data-product><td>Alpha Widget</td><td>$12.99</td><td>4.5</td></tr>
  <tr data-product><td>Beta Gadget</td><td>$24.00</td><td>4.1</td></tr>
  <tr data-product><td>Gamma Tool</td><td>$9.50</td><td>3.8</td></tr>
  <tr data-product><td>Delta Kit</td><td>$41.20</td><td>4.9</td></tr>
  <tr data-product><td>Epsilon Pack</td><td>$18.75</td><td>4.0</td></tr>
</table>
</body></html>`;

describe('extract-products R1 tracer', () => {
  it('detects extract-to-csv instructions', () => {
    expect(
      isExtractProductsInstruction(
        'Extract products to a CSV table with name, price, rating',
      ),
    ).toBe(true);
    expect(isExtractProductsInstruction('Play the audio')).toBe(false);
  });

  it('parses table product rows', () => {
    const rows = extractProductRowsFromHtml(tableHtml);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0]).toEqual({ name: 'Alpha Widget', price: '$12.99', rating: '4.5' });
  });

  it('parses products.html list fixture (≥5 rows)', () => {
    const rows = extractProductRowsFromHtml(productsFixture);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0]).toMatchObject({
      name: 'Alpha Wireless Headphones',
      price: '$49.99',
      rating: '4.5',
    });
  });

  it('formats csv deliverable', () => {
    const rows = extractProductRowsFromHtml(tableHtml);
    const deliverable = formatProductTableDeliverable(rows, 'csv');
    expect(deliverable).toContain('name,price,rating');
    expect(deliverable).toContain('Alpha Widget');
    expect(productRowsToCsv(rows).split('\n').length).toBe(6);
  });
});
