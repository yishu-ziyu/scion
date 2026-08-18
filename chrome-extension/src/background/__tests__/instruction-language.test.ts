import { describe, expect, it } from 'vitest';
import {
  analyzeInstructionLanguage,
  instructionAffirmedTargetValue,
  instructionAffirmsTarget,
} from '../instruction-language';

describe('instruction language analysis', () => {
  it.each([
    ['不要输出最终结果', 'returned_deliverable', false],
    ['不要不输出最终结果', 'returned_deliverable', true],
    ['不可不返回最终结果', 'returned_deliverable', true],
    ['不得不提供最终结果', 'returned_deliverable', true],
    ['Do not fail to return the final result', 'returned_deliverable', true],
    ['Never fail to provide the final result', 'returned_deliverable', true],
    ['绝不能漏掉最终结果', 'returned_deliverable', true],
    ['请勿省略最终答案', 'returned_deliverable', true],
    ['别忘了返回最终结果', 'returned_deliverable', true],
    ['不要输出任何内容，等接口返回结果后完成', 'returned_deliverable', false],
    ['不要总结但要列出两点', 'returned_deliverable', true],
    ["Don't guess; identify the most expensive product", 'most_expensive', true],
    ['Do not identify the most expensive product, state it nowhere', 'most_expensive', false],
    ['不要说上述结论是编造的；最贵商品的名称与价格', 'most_expensive', true],
  ] as const)('assigns action polarity by negation parity: %s', (instruction, target, expected) => {
    expect(instructionAffirmsTarget(analyzeInstructionLanguage(instruction), target)).toBe(expected);
  });

  it.each([
    // Coordinated predicates establish a new local action scope.
    ['不要修改页面并返回结果', 'returned_deliverable', true],
    ['Do not modify the page and return the result', 'returned_deliverable', true],
    ['不要修改页面且输出结果', 'returned_deliverable', true],
    ['Do not modify the page but provide the answer', 'returned_deliverable', true],
    ['不要总结而要列出两点', 'returned_deliverable', true],
    ['Do not explain and do not return the result', 'returned_deliverable', false],
    // An external actor observing or producing a value is not a user deliverable.
    ['Once the page returns the answer, stop', 'returned_deliverable', false],
    ['The service will provide the answer; then finish', 'returned_deliverable', false],
    ['页面返回结果并提供答案', 'returned_deliverable', false],
    ['The service returns the result and provides the answer', 'returned_deliverable', false],
    ['返回结果给我', 'returned_deliverable', true],
    // Target semantics stay attached to the predicate and its actor.
    ['不要找最贵商品', 'most_expensive', false],
    ['页面指出最贵商品后结束', 'most_expensive', false],
    ['The page identifies the most expensive product', 'most_expensive', false],
    ['找出最贵商品', 'most_expensive', true],
    // Structured shapes use the same predicate truth as returned deliverables.
    ['不要导出商品CSV表格', 'structured_table', false],
    ['返回页面标题，但不要输出表格', 'structured_table', false],
    ['不要修改页面并输出商品表格', 'structured_table', true],
    ['The page displays a product table', 'structured_table', false],
    ['返回页面标题，但不要给出结论', 'conclusion', false],
    ['不要修改页面并给出结论', 'conclusion', true],
    // Adjacent combinations freeze the rule instead of individual phrasings.
    ['页面不会返回结果，但请返回结果给我', 'returned_deliverable', true],
    ['不要不找最贵商品', 'most_expensive', true],
    ['The page does not identify the most expensive product, but identify it for me', 'most_expensive', true],
    ['不要不导出商品表格', 'structured_table', true],
    ['The service provides a conclusion', 'conclusion', false],
    ['The service provides background but return a conclusion to me', 'conclusion', true],
  ] as const)('binds actor, target, and polarity within each predicate: %s', (instruction, target, expected) => {
    expect(instructionAffirmsTarget(analyzeInstructionLanguage(instruction), target)).toBe(expected);
  });

  it.each([
    ['无需依次访问 https://a.test 和 https://b.test', false],
    ['不要按顺序访问 https://a.test 和 https://b.test', false],
    ['Do not visit https://a.test then https://b.test', false],
    ['Never open https://a.test before https://b.test', false],
    ['依次访问 https://a.test 和 https://b.test', true],
    ['Visit https://a.test then https://b.test', true],
    ['1. 访问 https://a.test; 2. 访问 https://b.test', true],
    ['先打开 https://a.test，再打开 https://b.test，最后回到 https://a.test', true],
    ['不要不依次访问 https://a.test 和 https://b.test', true],
    ['Do not fail to visit https://a.test then https://b.test', true],
    ['Do not browse randomly, but visit https://a.test then https://b.test', true],
    ['Compare https://a.test and https://b.test', false],
  ])('assigns polarity to the ordered-source predicate: %s', (instruction, expected) => {
    expect(instructionAffirmsTarget(analyzeInstructionLanguage(instruction), 'ordered_sources')).toBe(expected);
  });

  it.each([
    ['不要输出表格但请输出表格', 'structured_table', true],
    ['请输出表格但不要输出表格', 'structured_table', false],
    ['Do not output a table, but output a table', 'structured_table', true],
    ['Output a table, but do not output a table', 'structured_table', false],
    ['不要给出结论但请给出结论', 'conclusion', true],
    ['请给出结论但不要给出结论', 'conclusion', false],
    ['Do not identify the most expensive product, but identify the most expensive product', 'most_expensive', true],
    ['Identify the most expensive product, but do not identify the most expensive product', 'most_expensive', false],
  ] as const)(
    'resolves repeated target occurrences from the last applicable agent predicate: %s',
    (text, target, expected) => {
      const analysis = analyzeInstructionLanguage(text);
      expect(
        analysis.clauses.flatMap(clause => clause.targets).filter(mention => mention.target === target),
      ).toHaveLength(2);
      expect(instructionAffirmsTarget(analysis, target)).toBe(expected);
    },
  );

  it.each([
    ['返回上一页', 'returned_deliverable'],
    ['返回首页', 'returned_deliverable'],
    ['返回列表', 'returned_deliverable'],
    ['返回商品页', 'returned_deliverable'],
    ['Return to the previous page', 'returned_deliverable'],
    ['Return to the product page', 'returned_deliverable'],
    ['打开商品清单页', 'structured_table'],
    ['Open the product listing page', 'structured_table'],
    ['打开最贵商品页', 'most_expensive'],
    ['Open the most expensive product page', 'most_expensive'],
    ['页面展示最贵商品，点击它', 'most_expensive'],
    ['The page displays the most expensive product; click it', 'most_expensive'],
  ] as const)('does not turn navigation, page state, or listing nouns into an output target: %s', (text, target) => {
    expect(instructionAffirmsTarget(analyzeInstructionLanguage(text), target)).toBe(false);
  });

  it.each([
    ['不要随意打开页面，但按顺序访问 https://a.test 和 https://b.test', true],
    ['Do not open random pages, but visit https://a.test then https://b.test', true],
    ['不要按顺序访问 https://a.test 和 https://b.test', false],
    ['Do not visit https://a.test then https://b.test', false],
  ])('binds order polarity only to the source-sequence predicate: %s', (text, expected) => {
    expect(instructionAffirmsTarget(analyzeInstructionLanguage(text), 'ordered_sources')).toBe(expected);
  });

  it.each([
    ['导出商品表格但不要CSV改Markdown', 'table_format', 'md'],
    ['Export the product table, but do not use CSV; use Markdown', 'table_format', 'md'],
    ['不要全部商品，只前5并CSV', 'product_row_count', 5],
    ['Do not export all products; export the first 5 as CSV', 'product_row_count', 5],
  ] as const)('resolves affirmed table-shape values from their own spans: %s', (text, target, expected) => {
    expect(instructionAffirmedTargetValue(analyzeInstructionLanguage(text), target)).toBe(expected);
  });

  it('keeps format and completeness polarity separate', () => {
    const analysis = analyzeInstructionLanguage('不要全部商品，只前5并CSV');
    expect(instructionAffirmsTarget(analysis, 'structured_table')).toBe(true);
    expect(instructionAffirmsTarget(analysis, 'complete_product_table')).toBe(false);
    expect(instructionAffirmedTargetValue(analysis, 'table_format')).toBe('csv');
  });

  it('exposes predicate, actor, polarity, and exact spans instead of discarding external mentions', () => {
    const instruction = 'The page identifies the most expensive product; return the result to me.';
    const analysis = analyzeInstructionLanguage(instruction);
    const mentions = analysis.clauses.flatMap(clause => clause.targets);

    expect(mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'most_expensive',
          actor: 'external',
          polarity: 'affirmed',
          predicate: 'identifies',
        }),
        expect.objectContaining({
          target: 'returned_deliverable',
          actor: 'agent',
          polarity: 'affirmed',
          predicate: 'return',
        }),
      ]),
    );
    expect(mentions.every(mention => instruction.slice(mention.start, mention.end) === mention.predicate)).toBe(true);
  });

  it('returns every URL occurrence with an exact span and does not consume adjacent Chinese', () => {
    const instruction = '打开https://example.com后给出结果';
    const analysis = analyzeInstructionLanguage(instruction);

    expect(analysis.urls).toEqual([
      {
        value: 'https://example.com',
        start: instruction.indexOf('https://'),
        end: instruction.indexOf('后给出'),
      },
    ]);
    expect(instruction.slice(analysis.urls[0].start, analysis.urls[0].end)).toBe('https://example.com');
  });

  it('preserves duplicate URL occurrences instead of turning the instruction into a set', () => {
    const instruction = '先打开 https://a.test，然后打开 https://b.test，最后回到 https://a.test。';
    const analysis = analyzeInstructionLanguage(instruction);

    expect(analysis.urls.map(url => url.value)).toEqual(['https://a.test', 'https://b.test', 'https://a.test']);
    expect(analysis.urls.every(url => instruction.slice(url.start, url.end) === url.value)).toBe(true);
  });

  it('keeps balanced URL punctuation but excludes prose punctuation and external-actor returns', () => {
    const instruction = '先打开 (https://example.com/path_(x))，wait for the API to return the result.';
    const analysis = analyzeInstructionLanguage(instruction);

    expect(analysis.urls).toEqual([
      {
        value: 'https://example.com/path_(x)',
        start: instruction.indexOf('https://'),
        end: instruction.indexOf(')，'),
      },
    ]);
    expect(instructionAffirmsTarget(analysis, 'returned_deliverable')).toBe(false);
  });
});
