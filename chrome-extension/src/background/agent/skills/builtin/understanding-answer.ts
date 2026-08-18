/**
 * Builtin skill: understanding-only Q&A from current page (no act).
 */
import {
  answerUnderstandingFromPage,
  isUnderstandingOnlyInstruction,
} from '../../../browser/sites/understanding-answer';
import { createTextArtifact } from '../../../task/artifact';
import type { BrowserSkill, SkillResult } from '../types';

export const understandingAnswerSkill: BrowserSkill = {
  manifest: {
    id: 'builtin.understanding-answer',
    version: '1.0.0',
    description: 'Answer understanding-only questions from the current page without acting.',
    capabilities: ['understand_page', 'answer'],
    domains: ['*'],
    requiredPrimitives: [],
    risk: 'read',
  },
  match({ instruction }) {
    if (!isUnderstandingOnlyInstruction(instruction)) return null;
    return { score: 95, reason: 'understanding_only' };
  },
  async run(context): Promise<SkillResult> {
    if (!isUnderstandingOnlyInstruction(context.instruction)) {
      return { decision: { kind: 'continue', reason: 'not_understanding' } };
    }
    const url = context.frame?.tab.url ?? '';
    const title = context.frame?.tab.title ?? '';
    const summary = answerUnderstandingFromPage(context.instruction, { url, title });
    let evidenceUrl = '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        evidenceUrl = (parsed.origin + parsed.pathname).replace(/\/+$/, '') || parsed.origin;
      }
    } catch {
      // Without an observable http(s) URL this shortcut must fail closed.
    }
    const artifact = createTextArtifact({
      title: 'Understanding answer',
      text: summary,
      sources: url ? [{ url, title }] : [],
    });
    return {
      decision: {
        kind: 'done',
        summary,
        criteria: evidenceUrl ? [{ kind: 'url', operator: 'starts_with', expected: evidenceUrl, required: true }] : [],
        artifact,
      },
      output: { artifact },
    };
  },
};
