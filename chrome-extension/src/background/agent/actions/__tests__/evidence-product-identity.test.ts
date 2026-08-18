import { describe, expect, it } from 'vitest';

import {
  researchDecisionActionResult,
  resolveEvidenceProductIdentity,
  resolveProductEvidenceBasis,
  resolveUserDiscussionEvidenceBasis,
} from '../builder';

describe('researchDecisionActionResult', () => {
  it('returns observable success only for an accepted durable decision', () => {
    const result = researchDecisionActionResult({ accepted: true, reasons: [] });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.extractedContent).toContain('Research decision accepted');
  });

  it('returns an action error with the durable rejection reasons', () => {
    const result = researchDecisionActionResult({ accepted: false, reasons: ['unknown evidence reference'] });

    expect(result.success).toBe(false);
    expect(result.extractedContent).toBeNull();
    expect(result.error).toBe('Research decision rejected: unknown evidence reference');
    expect(result.includeInMemory).toBe(true);
  });
});

describe('resolveEvidenceProductIdentity', () => {
  it('replaces a Living Reader self-reference with the product visible in the page title', () => {
    expect(
      resolveEvidenceProductIdentity({
        pageUrl: 'https://readwise.io/read',
        pageTitle: 'Readwise Reader | The first read-it-later app built for power readers.',
        proposed: 'The Living Reader',
      }),
    ).toBe('Readwise Reader');
  });

  it('keeps a concrete product identity supplied by the model', () => {
    expect(
      resolveEvidenceProductIdentity({
        pageUrl: 'https://www.chatpdf.com/',
        pageTitle: 'ChatPDF',
        proposed: 'ChatPDF',
      }),
    ).toBe('ChatPDF');
  });

  it('does not rewrite Living Reader evidence from its own repository', () => {
    expect(
      resolveEvidenceProductIdentity({
        pageUrl: 'https://github.com/yishu-ziyu/living-reader',
        pageTitle: 'GitHub - yishu-ziyu/living-reader',
        proposed: 'Living Reader',
      }),
    ).toBe('Living Reader');
  });
});

describe('resolveProductEvidenceBasis', () => {
  const pageText = `
    Heptabase is an intelligent, visual knowledge base built for students, researchers, and lifelong learners.
    Ask AI to explain any sources, take notes, and organize your knowledge base for you.
  `;

  it('repairs a product paraphrase to a real visible page sentence', () => {
    expect(
      resolveProductEvidenceBasis({
        rawBasis: 'Heptabase combines a visual knowledge base with an AI tutor for serious learning.',
        observation: 'The product combines visual knowledge organization and AI-supported learning.',
        pageText,
      }),
    ).toBe('Heptabase is an intelligent, visual knowledge base built for students, researchers, and lifelong learners.');
  });

  it('rejects a product claim with no substantive page overlap', () => {
    expect(
      resolveProductEvidenceBasis({
        rawBasis: 'The tool automatically generates verified geographic simulations.',
        observation: 'It is a map simulator.',
        pageText,
      }),
    ).toBeNull();
  });

  it('uses an exact title-matched sentence for a cross-language product summary', () => {
    expect(
      resolveProductEvidenceBasis({
        rawBasis: '这是一个由 AI 驱动的 PDF 编辑器，可以总结和翻译文档。',
        observation: '产品把编辑、标注与 AI 阅读整合在一起。',
        pageTitle: 'UPDF: AI-Powered PDF Editor | Official Site',
        pageText: `
          Products
          The Next-Level AI-Powered PDF Editor
          Effortlessly edit, annotate, and convert PDFs across desktop and mobile.
        `,
      }),
    ).toBe('The Next-Level AI-Powered PDF Editor');
  });
});

describe('resolveUserDiscussionEvidenceBasis', () => {
  const pageText = `
    I uploaded a forty page PDF and it answered instantly, but the answer was vague and missed the actual argument.
    I had to return to the document and verify every citation myself.
  `;

  it('repairs a paraphrase only to a high-overlap visible user sentence', () => {
    expect(
      resolveUserDiscussionEvidenceBasis({
        rawBasis: 'The user uploaded a 40 page PDF but got a vague answer that missed the argument.',
        observation: 'Long PDF answers were instant but vague and omitted the argument.',
        userProblem: 'AI PDF answers lose important nuance.',
        pageText,
      }),
    ).toBe(
      'I uploaded a forty page PDF and it answered instantly, but the answer was vague and missed the actual argument.',
    );
  });

  it('rejects an unrelated visible sentence instead of inventing a quote', () => {
    expect(
      resolveUserDiscussionEvidenceBasis({
        rawBasis: 'The user wants an interactive historical map.',
        observation: 'Maps improve history learning.',
        userProblem: 'Spatial context is missing.',
        pageText,
      }),
    ).toBeNull();
  });
});
