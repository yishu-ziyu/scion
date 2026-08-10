/**
 * Builtin skill: repeating product list → table artifact (R1).
 */
import {
  extractProductsFromHtml,
  formatProductTableDeliverable,
  parseProductTableInstruction,
} from '../../../browser/sites/product-table';
import { createTableArtifact } from '../../../task/artifact';
import type { BrowserSkill, SkillResult } from '../types';

export const repeatingListExtractSkill: BrowserSkill = {
  manifest: {
    id: 'builtin.repeating-list-extract',
    version: '1.0.0',
    description: 'Extract repeating product rows (name/price/rating) into a table artifact.',
    capabilities: ['extract_list', 'compare_items', 'table_deliverable'],
    domains: ['*'],
    requiredPrimitives: [],
    risk: 'read',
  },
  match({ instruction }) {
    const goal = parseProductTableInstruction(instruction);
    if (!goal) return null;
    return { score: 90, reason: 'product_table_instruction' };
  },
  async run(context): Promise<SkillResult> {
    const goal = parseProductTableInstruction(context.instruction);
    if (!goal) return { decision: { kind: 'continue', reason: 'no_product_goal' } };

    const extracted = await context.kernel.extract<string>({});
    if (!extracted.ok || typeof extracted.data !== 'string') {
      return { decision: { kind: 'continue', reason: 'html_unavailable' } };
    }
    const rows = extractProductsFromHtml(extracted.data);
    if (rows.length < goal.minRows) {
      return {
        decision: {
          kind: 'continue',
          reason: 'insufficient_rows',
        },
      };
    }

    const summary = formatProductTableDeliverable(rows, goal.format);
    const artifact = createTableArtifact({
      title: 'Product table',
      columns: ['name', 'price', 'rating'],
      rows: rows.map(r => ({ name: r.name, price: r.price, rating: r.rating })),
      sources: context.frame?.tab.url
        ? [{ url: context.frame.tab.url, title: context.frame.tab.title }]
        : [],
    });

    return {
      decision: {
        kind: 'done',
        summary,
        criteria: [],
        artifact,
      },
      output: { rows, artifact },
    };
  },
};
