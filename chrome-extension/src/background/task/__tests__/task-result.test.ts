import { describe, expect, it } from 'vitest';
import { createTableArtifact, createTextArtifact } from '../artifact';
import { acceptTask, produceResult, recordStep, resultIsPresentAndMatches } from '../task-result';
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
  it('accepts an extract-table task as a table result', () => {
    const asked = acceptTask('Extract products to a CSV table with name, price, rating');
    expect(asked.askedKind).toBe('table');
    expect(asked.askedTableFields).toEqual(['name', 'price', 'rating']);
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
    expect(resultIsPresentAndMatches(acceptTask('写一份研究报告'), { kind: 'summary', body: 'hi' })).toBe(false);
    expect(
      resultIsPresentAndMatches(acceptTask('写一份研究报告'), {
        kind: 'report',
        body: '结论：样本不足，需要更多来源。',
      }),
    ).toBe(true);
  });
});
