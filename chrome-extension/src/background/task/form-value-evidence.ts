import type { CompletionCriterion } from '@extension/storage/lib/task';
import { isSensitiveFormControl, type FormControlDescriptor } from '../browser/form-value';
import type { DOMElementNode } from '../browser/dom/views';
import type { PageState } from '../browser/views';
import type { CompletionCriterionDraft, ProbeObservation } from './contracts';
import { captureActionFrame } from './action-frame';
import { sha256 } from './digest';

type PageTextCriterion = Extract<CompletionCriterion, { kind: 'page_text' }>;
export type FormValueCriterion = PageTextCriterion & {
  observationSource: 'form_value';
  formFieldDigest: string;
};

function normalizeFieldName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function digestFormField(value: string): Promise<string> {
  return sha256(normalizeFieldName(value));
}

/** Values are exact. Hashing is the only persistence boundary. */
export function digestFormValue(value: string): Promise<string> {
  return sha256(value);
}

export function isFormValueCriterion(criterion: CompletionCriterion): criterion is FormValueCriterion {
  return (
    criterion.kind === 'page_text' &&
    criterion.observationSource === 'form_value' &&
    typeof criterion.formFieldDigest === 'string'
  );
}

export function splitFormValueCriteria(criteria: CompletionCriterion[]): {
  formCriteria: FormValueCriterion[];
  pageCriteria: CompletionCriterion[];
} {
  const formCriteria: FormValueCriterion[] = [];
  const pageCriteria: CompletionCriterion[] = [];
  for (const criterion of criteria) {
    if (isFormValueCriterion(criterion)) formCriteria.push(criterion);
    else pageCriteria.push(criterion);
  }
  return { formCriteria, pageCriteria };
}

function noSubmitRequested(instruction: string): boolean {
  return /\b(?:do\s+not|don't|dont|without)\s+(?:clicking\s+)?submit\b|\bdo\s+not\s+submit\s+the\s+form\b|(?:不要|不许|无需|别)\s*(?:点击)?(?:提交|发送)|只填(?:写|入)?.{0,20}不提交/i.test(
    instruction,
  );
}

function cleanFieldName(value: string): string {
  return value
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')
    .replace(/^(?:the)\s+/i, '')
    .replace(/\s+(?:field|input)$/i, '')
    .trim();
}

function assignmentFromInstruction(instruction: string): { field: string; value: string } | null {
  const exactQuoted =
    /\b(?:fill|enter|type|put)\s+(?:the\s+)?(.{1,80}?)\s+(?:field|input)\s+with\s+(?:this\s+)?(?:exact\s+)?(?:plain\s+)?text\s*:\s*(["'])([\s\S]{1,240}?)\2/i.exec(
      instruction,
    );
  if (exactQuoted) return { field: cleanFieldName(exactQuoted[1] ?? ''), value: exactQuoted[3] ?? '' };

  const quoted =
    /\b(?:fill|enter|type|put)\s+(?:the\s+)?(.{1,80}?)(?:\s+(?:field|input))?\s+with\s+(["'])([\s\S]{1,240}?)\2/i.exec(
      instruction,
    );
  if (quoted) return { field: cleanFieldName(quoted[1] ?? ''), value: quoted[3] ?? '' };

  const unquoted =
    /\b(?:fill|enter|type|put)\s+(?:the\s+)?(.{1,80}?)(?:\s+(?:field|input))?\s+with\s+(.{1,160}?)(?=\s+(?:and|then)\b|[;.\n]|$)/i.exec(
      instruction,
    );
  if (unquoted) {
    const value = (unquoted[2] ?? '').replace(/^(?:this\s+)?(?:exact\s+)?(?:plain\s+)?text\s*:\s*/i, '').trim();
    return { field: cleanFieldName(unquoted[1] ?? ''), value };
  }

  const chinese =
    /(?:把|在)?\s*["“']?(.{1,40}?)["”']?\s*(?:字段|输入框|栏)(?:中)?\s*(?:填入|填写|输入|设为|填成)\s*["“']([^"”'\n]{1,160})["”']/i.exec(
      instruction,
    );
  return chinese ? { field: cleanFieldName(chinese[1] ?? ''), value: chinese[2] ?? '' } : null;
}

/** Derive only fill-without-submit proof. Submitted forms usually remove the field after success. */
export function deriveFillOnlyFormCriteria(instruction: string): CompletionCriterionDraft[] {
  if (!noSubmitRequested(instruction)) return [];
  const assignment = assignmentFromInstruction(instruction);
  if (!assignment?.field || !assignment.value || assignment.value.length > 240) return [];
  if (isSensitiveFormControl({ label: assignment.field })) return [];
  return [
    {
      kind: 'form_value',
      operator: 'equals',
      field: assignment.field,
      expected: assignment.value,
      required: true,
    },
  ];
}

const FILLABLE_TAGS = new Set(['input', 'textarea', 'select']);
const FILLABLE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'file',
  'submit',
  'button',
  'image',
  'reset',
  'hidden',
  'range',
  'color',
]);

function descriptor(node: DOMElementNode): FormControlDescriptor {
  const attrs = node.attributes ?? {};
  return {
    tagName: node.tagName,
    type: attrs.type,
    role: attrs.role,
    name: attrs.name,
    id: attrs.id,
    autocomplete: attrs.autocomplete,
    label: attrs.accname || attrs['aria-label'],
    placeholder: attrs.placeholder,
  };
}

function isFillable(node: DOMElementNode): boolean {
  const attrs = node.attributes ?? {};
  if (attrs.contenteditable === '' || attrs.contenteditable === 'true') return true;
  if (NON_TEXT_INPUT_TYPES.has((attrs.type ?? '').toLocaleLowerCase())) return false;
  return (
    FILLABLE_TAGS.has((node.tagName ?? '').toLocaleLowerCase()) ||
    FILLABLE_ROLES.has((attrs.role ?? '').toLocaleLowerCase())
  );
}

function fieldNames(node: DOMElementNode): string[] {
  const attrs = node.attributes ?? {};
  return [attrs.accname, attrs['aria-label'], attrs.placeholder, attrs.name, attrs.id]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeFieldName);
}

function pageIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function targetRefId(state: PageState, node: DOMElementNode): Promise<string> {
  const attrs = node.attributes ?? {};
  const identity = {
    tabId: state.tabId,
    page: pageIdentity(state.url),
    xpath: node.xpath ?? '',
    tag: node.tagName ?? '',
    type: attrs.type ?? '',
    role: attrs.role ?? '',
    name: attrs.name ?? '',
    id: attrs.id ?? '',
    label: attrs.accname || attrs['aria-label'] || '',
    placeholder: attrs.placeholder ?? '',
  };
  return `form:${await sha256(JSON.stringify(identity))}`;
}

interface FormCandidate {
  node: DOMElementNode;
  nameDigests: Set<string>;
}

async function safeCandidates(state: PageState): Promise<FormCandidate[]> {
  const candidates: FormCandidate[] = [];
  for (const node of state.selectorMap.values()) {
    if (!isFillable(node) || isSensitiveFormControl(descriptor(node))) continue;
    const names = [...new Set(fieldNames(node))];
    if (names.length === 0) continue;
    candidates.push({ node, nameDigests: new Set(await Promise.all(names.map(name => sha256(name)))) });
  }
  return candidates;
}

export async function observeFormValueCriteria(input: {
  state: PageState;
  criteria: CompletionCriterion[];
  observedAt: number;
  pageRevision?: string;
}): Promise<ProbeObservation[]> {
  const criteria = input.criteria.filter(isFormValueCriterion);
  if (criteria.length === 0) return [];
  const candidates = await safeCandidates(input.state);
  const observations: ProbeObservation[] = [];

  for (const criterion of criteria) {
    const matches = candidates.filter(candidate => candidate.nameDigests.has(criterion.formFieldDigest));
    if (matches.length !== 1) continue;
    const [candidate] = matches;
    const value = candidate!.node.attributes?.value ?? '';
    observations.push({
      criterionId: criterion.id,
      roundId: criterion.roundId,
      targetRefId: await targetRefId(input.state, candidate!.node),
      ...(input.pageRevision ? { pageRevision: input.pageRevision } : {}),
      observedAt: input.observedAt,
      source: 'page',
      value: (await digestFormValue(value)) === criterion.expectedDigest,
    });
  }
  return observations;
}
export async function observeCurrentFormValueCriteria(
  criteria: CompletionCriterion[],
  observedAt: number,
): Promise<ProbeObservation[]> {
  if (criteria.length === 0) return [];
  try {
    const { browserContext } = await import('../agent/factory');
    const state = await browserContext.getState(false, false, { waitForLoad: false });
    let pageRevision: string | undefined;
    try {
      pageRevision = (await captureActionFrame(state)).pageRevision;
    } catch {
      // Incomplete snapshots still prove the field value; revision is attached when the frame exists.
    }
    return observeFormValueCriteria({ state, criteria, observedAt, pageRevision });
  } catch {
    return [];
  }
}
