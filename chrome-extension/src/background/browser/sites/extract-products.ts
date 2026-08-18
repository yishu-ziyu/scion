/**
 * Thin compatibility shim for R1 product extract.
 * Prefer `product-table.ts` (parse + CSV/MD + fixture list cards).
 */
export type { ProductRow } from './product-table';
export {
  extractProductsFromHtml as extractProductRowsFromHtml,
  formatProductsCsv as productRowsToCsv,
  formatProductTableDeliverable,
  instructionRequestsProductTable as isExtractProductsInstruction,
} from './product-table';
