/**
 * Deterministic form fill for O1 / e2e fixture (and simple Name+Submit pages).
 * Avoids mid-model click-only no_progress on the classic fill→approve-submit path.
 */

export type FormFillGoal = {
  nameText: string;
  successText: string;
};

/**
 * Parse fill-name-and-submit instructions (e2e + Chinese product phrasing).
 */
export function parseFormFillSubmitInstruction(instruction: string): FormFillGoal | null {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // e2e: Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.
  // Do not require end-of-string — instruction may gain follow-ups.
  const en = text.match(
    /Fill\s+(?:the\s+)?Name(?:\s+field)?\s+with\s+(\S+)\s+and\s+submit(?:\s*;\s*success\s+is\s+([^.;]+))?/i,
  );
  if (en) {
    return {
      nameText: en[1].replace(/[;,."']+$/g, ''),
      successText: (en[2] || 'Saved successfully').replace(/[;.]+$/g, '').trim(),
    };
  }

  // Broader EN: fill name with X … submit
  if (/\bfill\b/i.test(text) && /\bname\b/i.test(text) && /\bsubmit\b/i.test(text)) {
    const withText = text.match(/\bwith\s+([A-Za-z0-9_\-@.]{2,80})/i);
    if (withText) {
      return {
        nameText: withText[1],
        successText:
          text.match(/success(?:\s+is)?\s+([^.;]+)/i)?.[1]?.replace(/[;.]+$/g, '').trim() || 'Saved successfully',
      };
    }
  }

  // ZH: 把名字填成 XXX 并提交 / 填写姓名 XXX 然后提交
  const zh = text.match(
    /(?:把)?(?:名字|姓名|Name)\s*(?:字段)?\s*(?:填[成入为]|写成)\s*[「"']?([^\s「」"']{1,80})[」"']?.*(?:提交|submit)/i,
  );
  if (zh) {
    return {
      nameText: zh[1],
      successText: text.includes('Saved successfully') ? 'Saved successfully' : '保存成功',
    };
  }

  return null;
}

/**
 * Resolve highlight indices from control state text (clickable list).
 * Prefers Name-labeled inputs and Submit buttons.
 */
export function resolveFormFillIndicesFromState(stateText: string): {
  nameIndex: number;
  submitIndex: number;
} | null {
  const lines = stateText.split(/\n+/);
  let nameIndex: number | undefined;
  let submitIndex: number | undefined;

  for (const line of lines) {
    const m = line.match(/\[(\d+)\]/);
    if (!m) continue;
    const index = Number(m[1]);
    if (!Number.isFinite(index)) continue;
    const lower = line.toLowerCase();

    if (
      nameIndex === undefined &&
      (/<input\b/i.test(line) || /\binput\b/i.test(line) || /textbox|text/i.test(line)) &&
      (/name/i.test(line) || /姓名|名字/.test(line) || /type=['"]?text/i.test(line))
    ) {
      nameIndex = index;
      continue;
    }
    if (
      nameIndex === undefined &&
      (/<input\b/i.test(line) || /\binput\b/i.test(line)) &&
      !/submit|password|hidden|checkbox|radio/i.test(lower)
    ) {
      // First plain text-like input on a minimal form fixture.
      nameIndex = index;
      continue;
    }
    if (
      submitIndex === undefined &&
      (/submit/i.test(line) || /type=['"]?submit/i.test(line) || /提交/.test(line) || /<button\b/i.test(line))
    ) {
      // Prefer explicit Submit text
      if (/submit|提交/i.test(line)) {
        submitIndex = index;
      } else if (submitIndex === undefined && /<button\b/i.test(line)) {
        submitIndex = index;
      }
    }
  }

  // Second pass: any button if submit still missing
  if (nameIndex !== undefined && submitIndex === undefined) {
    for (const line of lines) {
      const m = line.match(/\[(\d+)\]/);
      if (!m) continue;
      if (/button|submit|提交/i.test(line)) {
        submitIndex = Number(m[1]);
        break;
      }
    }
  }

  if (nameIndex === undefined || submitIndex === undefined) return null;
  if (nameIndex === submitIndex) return null;
  return { nameIndex, submitIndex };
}

export function pageShowsFormSuccess(stateText: string, successText: string): boolean {
  const needle = successText.trim();
  if (!needle) return false;
  return stateText.includes(needle);
}

/**
 * Visible-body success only. Raw getContent() includes <script> source, and the e2e
 * fixture keeps `Saved successfully` as a string literal until submit — that must not
 * count as done (O1: empty attempts + proof_required false complete).
 */
export function pageHtmlShowsFormSuccess(html: string, successText: string): boolean {
  const needle = successText.trim();
  if (!needle || !html) return false;
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  return visible.includes(needle);
}

export type FormIndexCandidate = {
  index: number;
  tagName: string;
  type?: string;
  name?: string;
  id?: string;
  text?: string;
};

/**
 * Prefer DOM selector map (highlightIndex) over brittle state-text parsing.
 */
export function resolveFormFillIndicesFromCandidates(
  candidates: FormIndexCandidate[],
): { nameIndex: number; submitIndex: number } | null {
  let nameIndex: number | undefined;
  let submitIndex: number | undefined;

  for (const c of candidates) {
    const tag = (c.tagName || '').toLowerCase();
    const type = (c.type || '').toLowerCase();
    const name = `${c.name || ''} ${c.id || ''} ${c.text || ''}`.toLowerCase();

    if (
      nameIndex === undefined &&
      tag === 'input' &&
      type !== 'submit' &&
      type !== 'password' &&
      type !== 'hidden' &&
      type !== 'checkbox' &&
      type !== 'radio' &&
      type !== 'button'
    ) {
      if (/name|姓名|名字/.test(name) || type === 'text' || type === '' || type === 'search' || type === 'email') {
        nameIndex = c.index;
      }
    }
    if (submitIndex === undefined) {
      if (type === 'submit' || /submit|提交/.test(name) || (tag === 'button' && type !== 'button')) {
        submitIndex = c.index;
      }
    }
  }

  if (nameIndex === undefined) {
    for (const c of candidates) {
      if ((c.tagName || '').toLowerCase() === 'input') {
        const type = (c.type || '').toLowerCase();
        if (!['submit', 'password', 'hidden', 'checkbox', 'radio', 'button'].includes(type)) {
          nameIndex = c.index;
          break;
        }
      }
    }
  }
  if (submitIndex === undefined) {
    for (const c of candidates) {
      const tag = (c.tagName || '').toLowerCase();
      if (tag === 'button' || (c.type || '').toLowerCase() === 'submit') {
        submitIndex = c.index;
        break;
      }
    }
  }

  if (nameIndex === undefined || submitIndex === undefined || nameIndex === submitIndex) return null;
  return { nameIndex, submitIndex };
}
