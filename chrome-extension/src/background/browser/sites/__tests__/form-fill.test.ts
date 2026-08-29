import { describe, expect, it } from 'vitest';
import {
  pageHtmlShowsFormSuccess,
  pageShowsFormSuccess,
  parseFormFillSubmitInstruction,
  resolveFormFillIndicesFromCandidates,
  resolveFormFillIndicesFromState,
  successCuesFromInstruction,
} from '../form-fill';

describe('form-fill deterministic', () => {
  it('parses e2e fill instruction', () => {
    const goal = parseFormFillSubmitInstruction(
      'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
    );
    expect(goal).toEqual({
      nameText: 'FIELD_SENTINEL_8472',
      successText: 'Saved successfully',
    });
  });

  it('leaves English multi-field requests to the generic control loop', () => {
    expect(
      parseFormFillSubmitInstruction(
        'Fill Name with Ada and Email with ada@example.test, then submit; success is Saved successfully.',
      ),
    ).toBeNull();
  });

  it('leaves Chinese multi-field requests to the generic control loop', () => {
    expect(parseFormFillSubmitInstruction('姓名填张三，邮箱填 zhang@example.test，然后提交')).toBeNull();
  });

  it('does not infer a name-only task from an unlisted English field', () => {
    expect(parseFormFillSubmitInstruction('Fill Name with Ada and Department with Research, then submit.')).toBeNull();
  });

  it('does not infer a name-only task from an unlisted Chinese field', () => {
    expect(parseFormFillSubmitInstruction('把姓名填成小明，部门填成研发并提交')).toBeNull();
  });

  it('keeps the strict Chinese single-name form eligible', () => {
    expect(parseFormFillSubmitInstruction('把姓名填成小明并提交')).toEqual({
      nameText: '小明',
      successText: '保存成功',
    });
  });

  it('parses Chinese fill with a trailing on-page success cue', () => {
    expect(
      parseFormFillSubmitInstruction(
        '把名字填成 FIELD_SENTINEL_8472 然后提交。成功标志是页上出现 Saved successfully。',
      ),
    ).toEqual({
      nameText: 'FIELD_SENTINEL_8472',
      successText: 'Saved successfully',
    });
  });

  it('extracts Saved successfully from a multi-step Chinese brief', () => {
    const fused =
      '请按顺序做完。打开 http://127.0.0.1/brief 读候鸟简报并引用正文，打开 http://127.0.0.1/list 整理 6 个产品表，打开 http://127.0.0.1/form 把名字填成 FIELD_SENTINEL_8472 并提交，成功标志是页上出现 Saved successfully，最后用中文写纪要。';
    expect(successCuesFromInstruction(fused)).toEqual(['Saved successfully']);
    expect(successCuesFromInstruction('success is 页上出现 Saved successfully')).toEqual(['Saved successfully']);
    expect(pageShowsFormSuccess('Saved successfully', successCuesFromInstruction(fused)[0] ?? '')).toBe(true);
    expect(successCuesFromInstruction('点击当前页面的 Submit 按钮；看到 Saved successfully 后完成。')).toEqual([
      'Saved successfully',
    ]);
    expect(
      successCuesFromInstruction('Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.'),
    ).toEqual(['Saved successfully']);
  });

  it('extracts a named field value as the on-page success cue', () => {
    const fused =
      '请按顺序做完。打开 https://zh.wikipedia.org/wiki/候鸟 读这一页并引用一句正文。打开 https://news.ycombinator.com/ 把前 5 条标题整理成表。打开 https://httpbin.org/forms/post 把 Customer name 填成 FIELD_SENTINEL_8472 并提交。成功标志是页上出现 FIELD_SENTINEL_8472。最后用中文写纪要。';
    expect(successCuesFromInstruction(fused)).toEqual(['FIELD_SENTINEL_8472']);
    expect(pageShowsFormSuccess('custname FIELD_SENTINEL_8472', 'FIELD_SENTINEL_8472')).toBe(true);
  });

  it('resolves indices from state text', () => {
    const state = `
Current tab: {id: 1, url: http://127.0.0.1/form, title: form}
Interactive elements:
[1]<input id=name name=name /> Name
[2]<button id=submit type=submit>Submit</button>
`;
    expect(resolveFormFillIndicesFromState(state)).toEqual({ nameIndex: 1, submitIndex: 2 });
  });

  it('detects success text', () => {
    expect(pageShowsFormSuccess('Saved successfully', 'Saved successfully')).toBe(true);
    expect(pageShowsFormSuccess('still empty form', 'Saved successfully')).toBe(false);
  });

  it('does not treat success string inside script as form success (e2e fixture)', () => {
    const fixtureHtml = `<!doctype html>
<html><body>
<form id="fixture-form">
  <label>Name <input id="name" name="name" /></label>
  <button id="submit" type="submit">Submit</button>
</form>
<script>
  form.addEventListener('submit', async event => {
    if (response.ok) form.outerHTML = '<p id="saved">Saved successfully</p>';
  });
</script>
</body></html>`;
    expect(pageHtmlShowsFormSuccess(fixtureHtml, 'Saved successfully')).toBe(false);
    // Naive includes() would false-positive and skip fill entirely.
    expect(fixtureHtml.includes('Saved successfully')).toBe(true);
  });

  it('detects success in visible body after submit', () => {
    const afterSubmit = `<!doctype html><html><body><p id="saved">Saved successfully</p></body></html>`;
    expect(pageHtmlShowsFormSuccess(afterSubmit, 'Saved successfully')).toBe(true);
  });

  it('resolves indices from DOM candidates', () => {
    expect(
      resolveFormFillIndicesFromCandidates([
        { index: 1, tagName: 'input', type: 'text', name: 'name', id: 'name' },
        { index: 2, tagName: 'button', type: 'submit', text: 'Submit' },
      ]),
    ).toEqual({ nameIndex: 1, submitIndex: 2 });
  });
});
