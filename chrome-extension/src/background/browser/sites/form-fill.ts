/**
 * Deterministic form fill for O1 / e2e fixture (and simple Name+Submit pages).
 * Avoids mid-model click-only no_progress on the classic fill→submit path.
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
  // Keep the whole instruction shape strict. This skill only knows one field;
  // any clause between its value and submit belongs to the generic control loop.
  const en = text.match(
    /^Fill\s+(?:the\s+)?Name(?:\s+field)?\s+with\s+([A-Za-z0-9_@.-]{1,80})\s+and\s+submit(?:\s*;\s*success\s+is\s+([^.;]+))?\s*[.]?$/i,
  );
  if (en) {
    return {
      nameText: en[1].replace(/[;,."']+$/g, ''),
      successText: (en[2] || 'Saved successfully').replace(/[;.]+$/g, '').trim(),
    };
  }

  // ZH: 把名字填成 XXX 并提交。值后面必须直接出现提交短语；
  // 如果中间还有第二个字段赋值，这个表达式不会匹配。
  const zh = text.match(
    /^(?:请\s*)?(?:把\s*)?(?:名字|姓名|Name)\s*(?:字段)?\s*(?:填成|填入|填为|填写成|填写为|写成)\s*[「“"']?([^\s,，;；。.!！？「」“”"']{1,80}?)[」”"']?\s*(?:,|，)?\s*(?:并|然后|再)?\s*(?:点击\s*)?(?:提交|submit)\s*[。.!！]?$/i,
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
