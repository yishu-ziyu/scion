/**
 * Builtin skill: read the current page and return a theme sentence plus one
 * visible citation. Does not click or navigate.
 */
import {
  answerThemeAndCitationFromPage,
  isCurrentPageThemeCitationInstruction,
} from '../../../browser/sites/theme-citation';
import type { BrowserSkill, SkillResult } from '../types';

export const themeCitationSkill: BrowserSkill = {
  manifest: {
    id: 'builtin.theme-citation',
    version: '1.0.0',
    description: 'Summarize the current page theme and quote one visible body detail.',
    capabilities: ['understand_page', 'answer'],
    domains: ['*'],
    requiredPrimitives: [],
    risk: 'read',
  },
  match({ instruction }) {
    if (!isCurrentPageThemeCitationInstruction(instruction)) return null;
    return { score: 94, reason: 'current_page_theme_citation' };
  },
  async run(context): Promise<SkillResult> {
    if (!isCurrentPageThemeCitationInstruction(context.instruction)) {
      return { decision: { kind: 'continue', reason: 'not_theme_citation' } };
    }

    let pageText = [context.observationText, context.frame?.text].filter(Boolean).join('\n');
    if (pageText.replace(/\s+/g, '').length < 20) {
      const extracted = await context.kernel.extract<string>({});
      if (extracted.ok && typeof extracted.data === 'string') {
        pageText = extracted.data;
      }
    }

    const result = answerThemeAndCitationFromPage(pageText, context.frame?.tab.title ?? '');
    if (!result) {
      return { decision: { kind: 'continue', reason: 'page_text_too_thin' } };
    }

    return {
      decision: {
        kind: 'done',
        summary: result.answer,
        criteria: [
          {
            kind: 'page_text',
            operator: 'present',
            expected: result.quote.slice(0, 160),
            required: true,
          },
        ],
      },
    };
  },
};
