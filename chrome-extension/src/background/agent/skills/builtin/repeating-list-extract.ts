/**
 * Builtin skill: repeating product list → table artifact (R1).
 */
import { parseProductTableInstruction } from '../../../browser/sites/product-table';
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

    return {
      decision: {
        kind: 'action',
        name: 'extract_content',
        args: {
          goal: context.instruction,
          schema: 'name,price,rating',
          intent: 'extract repeating list via extract_content',
        },
        observation: 'Use extract_content for the repeating list. Skill does not finish the task.',
      },
    };
  },
};
