import { describe, expect, it } from 'vitest';
import { createTableArtifact, createTextArtifact } from '../artifact';
import {
  acceptTask,
  matchingStoredResult,
  namedTakeawayText,
  produceResult,
  recordStep,
  resultIsPresentAndMatches,
} from '../task-result';
import type { ActionAttempt } from '@extension/storage/lib/task';

function step(id: string): ActionAttempt {
  return {
    id,
    roundId: 'round-1',
    actionName: 'extract_content',
    effect: 'read',
    argsDigest: 'args',
    state: 'observed',
    proposedAt: 1,
    observedAt: 2,
  };
}

describe('acceptTask / recordStep / produceResult / resultIsPresentAndMatches', () => {
  it('accepts a current-page book summary as a summary result', () => {
    const asked = acceptTask('Write a short summary of the first three books on this page.');
    expect(asked.askedKind).toBe('summary');
  });

  it('accepts a form task with the named success sentence', () => {
    const asked = acceptTask('Fill Name with Ada and submit; success is Saved successfully.');
    expect(asked.askedKind).toBe('summary');
    expect(asked.askedText).toBe('Saved successfully');
  });

  it('records steps by id without dropping earlier ones', () => {
    const first = step('a');
    const updated = { ...first, displaySummary: '抽取表格' };
    const steps = recordStep(recordStep([], first), updated);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.displaySummary).toBe('抽取表格');
    expect(recordStep(steps, step('b'))).toHaveLength(2);
  });

  it('does not treat a generic task as done without a matching result', () => {
    const asked = acceptTask('告诉我这一页在讲什么');
    expect(resultIsPresentAndMatches(asked, null)).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: 'done' })).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: 'User instruction' })).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: '这一页在讲记忆系统如何组织长程推理。' })).toBe(
      true,
    );
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: '告诉我这一页在讲什么' })).toBe(false);
    expect(
      resultIsPresentAndMatches(asked, {
        kind: 'summary',
        body: '告诉我这一页在讲什么。这一页在讲记忆系统。',
      }),
    ).toBe(false);
    expect(produceResult({ asked, summary: '告诉我这一页在讲什么' })).toBeNull();
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: 'hi' })).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: 'yes' })).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: '好的' })).toBe(false);
    expect(
      resultIsPresentAndMatches(acceptTask('perform an outcome that needs my confirmation'), {
        kind: 'summary',
        body: '已确认完成',
      }),
    ).toBe(false);
  });

  it('produces CSV as the result from a table artifact', () => {
    const asked = acceptTask('Extract products to a CSV table with name, price, rating');
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [
        { name: 'Alpha', price: '$49.99', rating: '4.5' },
        { name: 'Beta', price: '$9', rating: '4' },
      ],
      sources: [{ url: 'https://fixture.local/products' }],
    });
    const result = produceResult({
      asked,
      artifacts: [artifact],
      summary: 'Extracted 2 records. Task is not complete.',
    });
    expect(result?.kind).toBe('table');
    expect(result?.body).toContain('name,price,rating');
    expect(result?.body).toContain('Alpha,$49.99,4.5');
    expect(resultIsPresentAndMatches(asked, result)).toBe(true);
    expect(
      resultIsPresentAndMatches(asked, produceResult({ asked, summary: 'Extracted 2 records. Task is not complete.' })),
    ).toBe(false);
  });

  it('produces the asked success sentence, not page-status chrome', () => {
    const asked = acceptTask('Fill Name with Ada and submit; success is Saved successfully.');
    expect(
      produceResult({
        asked,
        summary: 'Form saved: Saved successfully',
      })?.body,
    ).toBe('Saved successfully');
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: '页面状态已确认' })).toBe(false);
    expect(produceResult({ asked, pageSuccessText: 'Saved successfully' })?.body).toBe('Saved successfully');
  });

  it('matches a named success or submitted takeaway even when that sentence is bare status', () => {
    const submitted = acceptTask('Fill Name with Ada and submit; success is submitted.');
    expect(submitted.askedText).toBe('submitted');
    expect(produceResult({ asked: submitted, pageSuccessText: 'submitted' })?.body).toBe('submitted');
    expect(resultIsPresentAndMatches(submitted, { kind: 'summary', body: 'submitted' })).toBe(true);
    expect(resultIsPresentAndMatches(submitted, { kind: 'summary', body: 'Submitted.' })).toBe(false);

    const success = acceptTask('Fill Name with Ada and submit; success is Success.');
    expect(success.askedText).toBe('Success');
    expect(produceResult({ asked: success, pageSuccessText: 'Success!' })?.body).toBe('Success');
    expect(resultIsPresentAndMatches(success, { kind: 'summary', body: 'Success' })).toBe(true);

    const skill = { ...acceptTask('Fill the form'), askedText: namedTakeawayText('Success!') };
    expect(skill.askedText).toBe('Success!');
    expect(produceResult({ asked: skill, pageSuccessText: 'Success!' })?.body).toBe('Success!');
    expect(resultIsPresentAndMatches(skill, { kind: 'summary', body: 'Success!' })).toBe(true);

    const saved = acceptTask('Fill Name with Ada and submit; success is Saved successfully.');
    expect(resultIsPresentAndMatches(saved, { kind: 'summary', body: 'success' })).toBe(false);
    expect(resultIsPresentAndMatches(saved, { kind: 'summary', body: 'submitted' })).toBe(false);
  });

  it('keeps a prefixed CSV summary as the table the user can take', () => {
    const asked = acceptTask('Extract products to a CSV table with name, price, rating');
    const summary = [
      '已提取 2 件商品（CSV）：',
      'name,price,rating',
      'Alpha Wireless Headphones,$49.99,4.5',
      'Beta Mechanical Keyboard,$89.00,4.8',
    ].join('\n');
    const result = produceResult({ asked, summary });
    expect(result?.kind).toBe('table');
    expect(result?.body).toContain('name,price,rating');
    expect(result?.body).toContain('Alpha Wireless Headphones');
    expect(resultIsPresentAndMatches(asked, result)).toBe(true);
  });

  it('keeps a matching table summary when artifacts are also present', () => {
    const asked = acceptTask('Extract products to a CSV table with name, price, rating');
    const conclusion = '最贵商品是 Beta Mechanical Keyboard，价格为 $89.00。';
    const summary = [
      '已提取 2 件商品（CSV）：',
      'name,price,rating',
      'Alpha Wireless Headphones,$49.99,4.5',
      'Beta Mechanical Keyboard,$89.00,4.8',
      conclusion,
    ].join('\n');
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [
        { name: 'Alpha Wireless Headphones', price: '$49.99', rating: '4.5' },
        { name: 'Beta Mechanical Keyboard', price: '$89.00', rating: '4.8' },
      ],
      sources: [{ url: 'http://127.0.0.1/products' }],
    });
    const result = produceResult({ asked, artifacts: [artifact], summary });
    expect(result?.body).toContain('name,price,rating');
    expect(result?.body).toContain(conclusion);
  });

  it('does not let a 1-row matching summary replace a fuller artifact table', () => {
    const asked = acceptTask('Extract products to a CSV table with name, price, rating');
    expect(asked.askedMinRows).toBe(1);
    const thinSummary = ['已提取 1 件商品（CSV）：', 'name,price,rating', 'Alpha Wireless Headphones,$49.99,4.5'].join(
      '\n',
    );
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [
        { name: 'Alpha Wireless Headphones', price: '$49.99', rating: '4.5' },
        { name: 'Beta Mechanical Keyboard', price: '$89.00', rating: '4.8' },
      ],
      sources: [{ url: 'http://127.0.0.1/products' }],
    });
    const result = produceResult({ asked, artifacts: [artifact], summary: thinSummary });
    expect(result?.body).toContain('Alpha Wireless Headphones');
    expect(result?.body).toContain('Beta Mechanical Keyboard');
    expect(result?.body).not.toContain('已提取 1 件商品');
  });

  it('merges tables from later sources into one CSV instead of returning only the first', () => {
    const asked = acceptTask('Extract products to a CSV table with name, price, rating');
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '$1', rating: '5' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const later = createTableArtifact({
      title: 'shop-b',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Beta', price: '$2', rating: '4' }],
      sources: [{ url: 'https://b.test/products' }],
    });
    const result = produceResult({ asked, artifacts: [first, later] });
    expect(result?.kind).toBe('table');
    expect(result?.body.match(/name,price,rating/g)?.length).toBe(1);
    expect(result?.body).toContain('Alpha,$1,5');
    expect(result?.body).toContain('Beta,$2,4');
    expect(result?.body).toContain('https://a.test/products');
    expect(result?.body).toContain('https://b.test/products');
    expect(resultIsPresentAndMatches(asked, result)).toBe(true);
  });

  it('does not treat a text artifact as a table result', () => {
    const asked = acceptTask('Extract products to a CSV table with name, price, rating');
    const result = produceResult({
      asked,
      artifacts: [createTextArtifact({ title: 'note', text: 'Extracted 0 records. Task is not complete.' })],
    });
    expect(resultIsPresentAndMatches(asked, result)).toBe(false);
  });

  it('does not treat navigation chrome as the result of a content task', () => {
    const asked = acceptTask('告诉我这一页在讲什么');
    expect(asked.askedSideEffect).toBeUndefined();
    expect(
      produceResult({
        asked,
        summary: 'done',
        observedUrl: 'https://example.com/page',
        observedOutcome: '视频正在播放',
      }),
    ).toBeNull();
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: '已打开 example.com' })).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'summary', body: '目标标签已关闭' })).toBe(false);
  });

  it('accepts opened-host chrome only when the task asked to open a site', () => {
    const asked = acceptTask('open youtube');
    expect(asked.askedSideEffect).toBe('open');
    expect(produceResult({ asked, observedUrl: 'https://www.youtube.com/' })?.body).toBe('已打开 youtube.com');
  });

  it('does not treat a two-character summary as a file or report result', () => {
    expect(resultIsPresentAndMatches(acceptTask('download this file'), { kind: 'summary', body: 'hi' })).toBe(false);
    expect(resultIsPresentAndMatches(acceptTask('download this file'), { kind: 'file', body: 'hi' })).toBe(false);
    expect(resultIsPresentAndMatches(acceptTask('写一份研究报告'), { kind: 'summary', body: 'hi' })).toBe(false);
    expect(resultIsPresentAndMatches(acceptTask('写一份研究报告'), { kind: 'report', body: 'hi' })).toBe(false);
    expect(resultIsPresentAndMatches(acceptTask('write a draft'), { kind: 'draft', body: 'hi' })).toBe(false);
    expect(
      resultIsPresentAndMatches(acceptTask('写一份研究报告'), {
        kind: 'report',
        body: '结论：样本不足，需要更多来源。',
      }),
    ).toBe(true);
  });

  it('does not match a report whose body is the acceptTask instruction', () => {
    expect(
      resultIsPresentAndMatches(acceptTask('请写一份关于记忆系统的研究报告'), {
        kind: 'report',
        body: '请写一份关于记忆系统的研究报告',
      }),
    ).toBe(false);
  });

  it('does not complete a download from opened-host, pause chrome, or leftover summary', () => {
    const asked = acceptTask('download this file');
    expect(asked.askedKind).toBe('file');
    expect(resultIsPresentAndMatches(asked, { kind: 'file', body: '已打开 example.com' })).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'file', body: '视频已暂停' })).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'file', body: '页面上有一个下载按钮。' })).toBe(false);
    expect(
      produceResult({
        asked,
        summary: '页面上有一个下载按钮。',
        observedUrl: 'https://example.com/file',
        observedOutcome: '视频已暂停',
      }),
    ).toBeNull();
    expect(resultIsPresentAndMatches(asked, { kind: 'file', body: 'invoice.pdf' })).toBe(true);
    expect(resultIsPresentAndMatches(asked, { kind: 'file', body: '下载已完成' })).toBe(true);
    expect(resultIsPresentAndMatches(asked, { kind: 'file', body: '下载已开始' })).toBe(false);
    expect(produceResult({ asked, observedOutcome: '下载已开始' })).toBeNull();
    expect(resultIsPresentAndMatches(asked, { kind: 'file', body: 'see example.com' })).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'file', body: 'cdn.example.org' })).toBe(false);
    expect(resultIsPresentAndMatches(asked, { kind: 'file', body: '调研完成了请查看 report.pdf' })).toBe(false);
    expect(produceResult({ asked, summary: '调研完成了请查看 report.pdf' })).toBeNull();
    expect(produceResult({ asked, summary: 'invoice.pdf' })?.body).toBe('invoice.pdf');
  });

  it('refuses a cut CSV body that no longer matches the produced table', () => {
    const asked = acceptTask('Extract products to a CSV table with name, price, rating');
    const produced = produceResult({
      asked,
      summary: [
        'name,price,rating',
        'Alpha Wireless Headphones,$49.99,4.5',
        'Beta Mechanical Keyboard,$89.00,4.8',
      ].join('\n'),
    });
    expect(produced?.kind).toBe('table');
    expect(matchingStoredResult(asked, produced!, 'name,price,rating')).toBeNull();
    expect(matchingStoredResult(asked, produced!, produced!.body)).toEqual(produced);
  });

  it('refuses a CSV that drops below askedMinRows', () => {
    const asked = acceptTask('Do not export all products; export the first 5 as CSV with name, price, rating');
    expect(asked.askedMinRows).toBe(5);
    const rows = Array.from({ length: 5 }, (_, index) => `Item${index + 1},$${index},4.${index}`);
    const produced = produceResult({
      asked,
      summary: ['name,price,rating', ...rows].join('\n'),
    });
    expect(produced?.kind).toBe('table');
    const belowMin = ['name,price,rating', ...rows.slice(0, 3)].join('\n');
    expect(matchingStoredResult(asked, produced!, belowMin)).toBeNull();
    expect(matchingStoredResult(asked, produced!, produced!.body)).toEqual(produced);
  });

  it('refuses a 2000-character prefix of a produced report', () => {
    const asked = acceptTask('写一份研究报告');
    const produced = produceResult({
      asked,
      summary: `结论：样本覆盖了三个来源。${'补充说明。'.repeat(400)}`,
    });
    expect(produced?.kind).toBe('report');
    expect(produced!.body.length).toBeGreaterThan(2000);
    expect(matchingStoredResult(asked, produced!, produced!.body.slice(0, 2000))).toBeNull();
    expect(matchingStoredResult(asked, produced!, produced!.body)).toEqual(produced);
  });

  it('keeps paragraph breaks in a report body instead of collapsing whitespace', () => {
    const asked = acceptTask('写一份研究报告');
    const summary = ['第一段：来源不足。', '', '第二段：需要补访。'].join('\n');
    const produced = produceResult({ asked, summary });
    expect(produced?.kind).toBe('report');
    expect(produced?.body).toBe(summary);
    expect(produced?.body).toContain('\n');
  });

  it('does not treat comma prose as a table result', () => {
    const asked = acceptTask('Extract products to a CSV table');
    expect(asked.askedKind).toBe('table');
    expect(
      resultIsPresentAndMatches(asked, {
        kind: 'table',
        body: ['We extracted the products, as requested.', 'Please review the results, then confirm.'].join('\n'),
      }),
    ).toBe(false);
    expect(
      produceResult({
        asked,
        summary: ['We extracted the products, as requested.', 'Please review the results, then confirm.'].join('\n'),
      }),
    ).toBeNull();
  });

  it('does not treat a markdown header and separator as a table result', () => {
    const asked = acceptTask('Extract products to a CSV table with name, price, rating');
    const emptyMarkdown = ['| name | price | rating |', '| --- | --- | --- |'].join('\n');
    expect(resultIsPresentAndMatches(asked, { kind: 'table', body: emptyMarkdown })).toBe(false);
    expect(produceResult({ asked, summary: emptyMarkdown })).toBeNull();
    const withRow = ['| name | price | rating |', '| --- | --- | --- |', '| Alpha | $1 | 5 |'].join('\n');
    expect(resultIsPresentAndMatches(asked, { kind: 'table', body: withRow })).toBe(true);
  });
});
