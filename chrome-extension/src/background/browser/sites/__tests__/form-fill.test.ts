import { describe, expect, it } from 'vitest';
import {
  pageHtmlShowsFormSuccess,
  pageShowsFormSuccess,
  parseFormFillSubmitInstruction,
  resolveFormFillIndicesFromCandidates,
  resolveFormFillIndicesFromState,
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
