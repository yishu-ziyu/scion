import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';

export const EVIDENCE_RECORD_TYPES = [
  'user_discussion',
  'product',
  'repository',
  'browser_context',
  'product_principle',
] as const;
export type EvidenceRecordType = (typeof EVIDENCE_RECORD_TYPES)[number];
export type EvidenceConfidence = 'high' | 'medium' | 'low';
export type EvidencePriority = 'high' | 'medium' | 'low';
export type EvidenceStance = 'support' | 'oppose' | 'mixed' | 'neutral';

export interface EvidenceRecordDraft {
  recordType: EvidenceRecordType;
  source: string;
  sourceTitle: string;
  userProblem?: string;
  rawBasis: string;
  observation: string;
  inference: string;
  confidence: EvidenceConfidence;
  relatedProduct?: string;
  livingReaderCapability?: string;
  priority: EvidencePriority;
  stance: EvidenceStance;
  dedupeKey: string;
}

export interface EvidenceRecord extends EvidenceRecordDraft {
  id: string;
  taskId: string;
  capturedAt: number;
  canonicalSource: string;
}

export interface ResearchCapabilityDecisionDraft {
  title: string;
  userMoment: string;
  behaviorChange: string;
  whyNow: string;
  whyOthersLater: string;
  implementationDistance: string;
  mvp: string;
  successMetric: string;
  userEvidenceIds: string[];
  productEvidenceIds: string[];
  repositoryEvidenceIds: string[];
}

export interface ResearchDecision {
  capabilities: ResearchCapabilityDecisionDraft[];
  deferred: string[];
  contradictions: string[];
  createdAt: number;
}

export type ResearchDeliveryKind = 'research_table' | 'decision_document';

export interface ResearchDeliveryArtifact {
  kind: ResearchDeliveryKind;
  url: string;
  title: string;
  observedText: string;
  rowCount?: number;
  verifiedAt: number;
}

export interface EvidenceSpace {
  taskId: string;
  records: EvidenceRecord[];
  workCycles: number;
  createdAt: number;
  updatedAt: number;
  researchDecision?: ResearchDecision;
  researchDelivery?: Partial<Record<ResearchDeliveryKind, ResearchDeliveryArtifact>>;
}

export interface EvidenceSpaceProgress {
  total: number;
  userDiscussions: number;
  products: number;
  repository: number;
  browserContext: number;
  productPrinciples: number;
}

export interface AddEvidenceResult {
  space: EvidenceSpace;
  added: EvidenceRecord[];
  duplicateKeys: string[];
  rejected: Array<{ dedupeKey: string; reason: 'source_not_observed' | 'invalid_source' | 'invalid_record' }>;
}

export interface RecordResearchDecisionResult {
  space: EvidenceSpace;
  accepted: boolean;
  reasons: string[];
}

const MAX_RECORDS_PER_TASK = 1_000;
const evidenceStorage = createStorage<Record<string, EvidenceSpace>>(
  'task-evidence-space-v1',
  {},
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: false,
  },
);

function compact(value: string | undefined, max: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function searchableEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gi, '');
}

export function evidenceBasisAppearsInPage(rawBasis: string, pageText: string): boolean {
  const page = searchableEvidenceText(pageText);
  const basis = searchableEvidenceText(rawBasis);
  if (basis.length < 20 || page.length < 20) return false;
  if (page.includes(basis)) return true;
  return rawBasis
    .split(/\.{2,}|[\n。！？!?;]/)
    .map(searchableEvidenceText)
    .some(segment => segment.length >= 24 && page.includes(segment));
}

export function canonicalizeEvidenceSource(source: string): string | null {
  try {
    const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    const searchKeys: string[] = [];
    url.searchParams.forEach((_value, key) => searchKeys.push(key));
    for (const key of searchKeys) {
      if (/^(utm_|fbclid$|gclid$|ref$|source$|logging_in$|share_id$|context$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

export function isSearchResultsEvidenceSource(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const hostAndPath = `${host}${path}`;
    return (
      path.includes('/search') ||
      (/reddit\.com$/.test(host) && /^\/r\/[^/]+\/?$/.test(path)) ||
      (host === 'news.ycombinator.com' && /^\/(news|newest|show|ask|front)?\/?$/.test(path)) ||
      ((url.searchParams.has('q') || url.searchParams.has('query')) &&
        /(google|bing|duckduckgo|brave|search|github\.com|algolia)/.test(hostAndPath))
    );
  } catch {
    return false;
  }
}

export function isPrivateDashboardEvidenceSource(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === 'notebook.google.com' && /^\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isDiscussionOnlyProductSource(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (
      host === 'reddit.com' ||
      host === 'news.ycombinator.com' ||
      host === 'hn.algolia.com' ||
      host === 'x.com' ||
      host === 'twitter.com' ||
      host === 'zhihu.com' ||
      host === 'xiaohongshu.com'
    ) {
      return true;
    }
    return host === 'github.com' && /\/(?:issues|discussions)(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function evidenceSpaceProgress(space: EvidenceSpace | null | undefined): EvidenceSpaceProgress {
  const records = (space?.records ?? []).filter(
    record =>
      !isSearchResultsEvidenceSource(record.canonicalSource) &&
      !isPrivateDashboardEvidenceSource(record.canonicalSource) &&
      !(record.recordType === 'product' && isDiscussionOnlyProductSource(record.canonicalSource)),
  );
  const uniqueSources = (recordType: EvidenceRecordType) =>
    new Set(records.filter(record => record.recordType === recordType).map(record => record.canonicalSource)).size;
  const uniqueDiscussionCases = new Set(
    records
      .filter(record => record.recordType === 'user_discussion')
      .map(record => `${record.canonicalSource}\n${compact(record.rawBasis, 1_500).toLowerCase()}`),
  ).size;
  const uniqueProducts = new Set(
    records
      .filter(record => record.recordType === 'product')
      .map(record => record.relatedProduct?.replace(/\s+/g, ' ').trim().toLowerCase() || record.canonicalSource),
  ).size;
  return {
    total: records.length,
    userDiscussions: uniqueDiscussionCases,
    products: uniqueProducts,
    repository: uniqueSources('repository'),
    browserContext: uniqueSources('browser_context'),
    productPrinciples: uniqueSources('product_principle'),
  };
}

function normalizeDedupeKey(recordType: EvidenceRecordType, value: string): string {
  return `${recordType}:${compact(value, 512).toLowerCase()}`;
}

function validDraft(draft: EvidenceRecordDraft): boolean {
  return Boolean(
    compact(draft.sourceTitle, 240) &&
      compact(draft.rawBasis, 1_500).length >= 20 &&
      compact(draft.observation, 1_000).length >= 8 &&
      compact(draft.inference, 1_000) &&
      compact(draft.dedupeKey, 512),
  );
}

export function addEvidenceRecordsToSpace(input: {
  space?: EvidenceSpace | null;
  taskId: string;
  observedSource: string;
  drafts: EvidenceRecordDraft[];
  now: number;
}): AddEvidenceResult {
  const existing: EvidenceSpace = input.space ?? {
    taskId: input.taskId,
    records: [],
    workCycles: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const canonicalObserved = canonicalizeEvidenceSource(input.observedSource);
  const keys = new Set(existing.records.map(record => normalizeDedupeKey(record.recordType, record.dedupeKey)));
  const productSources = new Set(
    existing.records.filter(record => record.recordType === 'product').map(record => record.canonicalSource),
  );
  const added: EvidenceRecord[] = [];
  const duplicateKeys: string[] = [];
  const rejected: AddEvidenceResult['rejected'] = [];

  for (const draft of input.drafts.slice(0, 20)) {
    const key = normalizeDedupeKey(draft.recordType, draft.dedupeKey);
    const canonicalSource = canonicalizeEvidenceSource(draft.source);
    if (!canonicalSource) {
      rejected.push({ dedupeKey: key, reason: 'invalid_source' });
      continue;
    }
    if (!canonicalObserved || canonicalSource !== canonicalObserved) {
      rejected.push({ dedupeKey: key, reason: 'source_not_observed' });
      continue;
    }
    if (!validDraft(draft)) {
      rejected.push({ dedupeKey: key, reason: 'invalid_record' });
      continue;
    }
    if (keys.has(key)) {
      duplicateKeys.push(key);
      continue;
    }
    if (draft.recordType === 'product' && productSources.has(canonicalSource)) {
      duplicateKeys.push(key);
      continue;
    }
    if (existing.records.length + added.length >= MAX_RECORDS_PER_TASK) break;
    keys.add(key);
    if (draft.recordType === 'product') productSources.add(canonicalSource);
    added.push({
      ...draft,
      id: crypto.randomUUID(),
      taskId: input.taskId,
      source: compact(draft.source, 2_048),
      sourceTitle: compact(draft.sourceTitle, 240),
      userProblem: compact(draft.userProblem, 500) || undefined,
      rawBasis: compact(draft.rawBasis, 1_500),
      observation: compact(draft.observation, 1_000),
      inference: compact(draft.inference, 1_000),
      relatedProduct: compact(draft.relatedProduct, 240) || undefined,
      livingReaderCapability: compact(draft.livingReaderCapability, 240) || undefined,
      dedupeKey: compact(draft.dedupeKey, 512),
      capturedAt: input.now,
      canonicalSource,
    });
  }

  const space: EvidenceSpace = {
    ...existing,
    records: [...existing.records, ...added],
    updatedAt: added.length > 0 ? input.now : existing.updatedAt,
  };
  return { space, added, duplicateKeys, rejected };
}

export async function getEvidenceSpace(taskId: string): Promise<EvidenceSpace | null> {
  return (await evidenceStorage.get())[taskId] ?? null;
}

export async function addEvidenceRecords(input: {
  taskId: string;
  observedSource: string;
  drafts: EvidenceRecordDraft[];
  now?: number;
}): Promise<AddEvidenceResult> {
  const all = await evidenceStorage.get();
  const result = addEvidenceRecordsToSpace({
    space: all[input.taskId],
    taskId: input.taskId,
    observedSource: input.observedSource,
    drafts: input.drafts,
    now: input.now ?? Date.now(),
  });
  await evidenceStorage.set({ ...all, [input.taskId]: result.space });
  return result;
}

export async function advanceEvidenceWorkCycle(taskId: string, now = Date.now()): Promise<EvidenceSpace> {
  const all = await evidenceStorage.get();
  const current = all[taskId] ?? {
    taskId,
    records: [],
    workCycles: 0,
    createdAt: now,
    updatedAt: now,
  };
  const next = {
    ...current,
    workCycles: (current.workCycles ?? 0) + 1,
    updatedAt: now,
  };
  await evidenceStorage.set({ ...all, [taskId]: next });
  return next;
}

function validateResearchDecision(
  space: EvidenceSpace,
  draft: Omit<ResearchDecision, 'createdAt'>,
): string[] {
  const reasons: string[] = [];
  if (draft.capabilities.length !== 3) reasons.push('exactly_three_capabilities_required');
  const titles = new Set(draft.capabilities.map(item => compact(item.title, 240).toLowerCase()).filter(Boolean));
  if (titles.size !== 3) reasons.push('capability_titles_must_be_unique');
  if (draft.deferred.filter(item => compact(item, 500)).length === 0) reasons.push('deferred_items_required');

  const byId = new Map(space.records.map(record => [record.id, record]));
  for (const capability of draft.capabilities) {
    const label = compact(capability.title, 240) || 'untitled';
    const requiredText = [
      capability.userMoment,
      capability.behaviorChange,
      capability.whyNow,
      capability.whyOthersLater,
      capability.implementationDistance,
      capability.mvp,
      capability.successMetric,
    ];
    if (requiredText.some(value => compact(value, 1_000).length < 8)) {
      reasons.push(`${label}:seven_answers_required`);
    }

    const userSources = new Set(
      capability.userEvidenceIds
        .map(id => byId.get(id))
        .filter(record => record?.recordType === 'user_discussion' && !isSearchResultsEvidenceSource(record.canonicalSource))
        .map(record => record!.canonicalSource),
    );
    const productIdentities = new Set(
      capability.productEvidenceIds
        .map(id => byId.get(id))
        .filter(
          record =>
            record?.recordType === 'product' &&
            !isSearchResultsEvidenceSource(record.canonicalSource) &&
            !isDiscussionOnlyProductSource(record.canonicalSource),
        )
        .map(record => record!.relatedProduct?.trim().toLowerCase() || record!.canonicalSource),
    );
    const repositorySources = new Set(
      capability.repositoryEvidenceIds
        .map(id => byId.get(id))
        .filter(record => record?.recordType === 'repository')
        .map(record => record!.canonicalSource),
    );
    if (userSources.size < 2) reasons.push(`${label}:two_user_sources_required`);
    if (productIdentities.size < 1) reasons.push(`${label}:product_evidence_required`);
    if (repositorySources.size < 1) reasons.push(`${label}:repository_evidence_required`);
  }
  return reasons;
}

export function putResearchDecisionInSpace(input: {
  space: EvidenceSpace;
  draft: Omit<ResearchDecision, 'createdAt'>;
  now: number;
}): RecordResearchDecisionResult {
  const reasons = validateResearchDecision(input.space, input.draft);
  if (reasons.length > 0) return { space: input.space, accepted: false, reasons };
  const space: EvidenceSpace = {
    ...input.space,
    researchDecision: { ...input.draft, createdAt: input.now },
    updatedAt: input.now,
  };
  return { space, accepted: true, reasons: [] };
}

export async function recordResearchDecision(input: {
  taskId: string;
  draft: Omit<ResearchDecision, 'createdAt'>;
  now?: number;
}): Promise<RecordResearchDecisionResult> {
  const all = await evidenceStorage.get();
  const existing = all[input.taskId];
  if (!existing) {
    return {
      space: {
        taskId: input.taskId,
        records: [],
        workCycles: 0,
        createdAt: input.now ?? Date.now(),
        updatedAt: input.now ?? Date.now(),
      },
      accepted: false,
      reasons: ['evidence_space_missing'],
    };
  }
  const result = putResearchDecisionInSpace({
    space: existing,
    draft: input.draft,
    now: input.now ?? Date.now(),
  });
  if (result.accepted) await evidenceStorage.set({ ...all, [input.taskId]: result.space });
  return result;
}

export function researchDecisionReady(space: EvidenceSpace | null | undefined): boolean {
  if (!space?.researchDecision) return false;
  const { createdAt: _createdAt, ...draft } = space.researchDecision;
  return validateResearchDecision(space, draft).length === 0;
}

const REQUIRED_RESEARCH_TABLE_FIELDS = [
  '证据',
  '来源',
  '用户问题',
  '观察',
  '推断',
  '置信度',
  '相关产品',
  '对应 Living Reader 能力',
  '优先级',
] as const;

function isFeishuDocumentUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'feishu.cn' || host.endsWith('.feishu.cn') || host === 'larksuite.com' || host.endsWith('.larksuite.com');
  } catch {
    return false;
  }
}

export function putResearchDeliveryInSpace(input: {
  space: EvidenceSpace;
  kind: ResearchDeliveryKind;
  url: string;
  title: string;
  observedText: string;
  rowCount?: number;
  now: number;
}): { space: EvidenceSpace; accepted: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const observedText = compact(input.observedText, 30_000);
  if (!isFeishuDocumentUrl(input.url)) reasons.push('feishu_url_required');
  if (observedText.length < 20) reasons.push('visible_readback_required');
  if (input.kind === 'research_table') {
    const missingFields = REQUIRED_RESEARCH_TABLE_FIELDS.filter(field => !observedText.includes(field));
    if (missingFields.length > 0) reasons.push(`missing_table_fields:${missingFields.join(',')}`);
    if ((input.rowCount ?? 0) < evidenceSpaceProgress(input.space).total) reasons.push('table_row_count_below_evidence_count');
  } else {
    if (!researchDecisionReady(input.space)) reasons.push('research_decision_required');
    for (const heading of ['下一步做什么', '为什么', '暂时不做']) {
      if (!observedText.includes(heading)) reasons.push(`missing_first_screen_heading:${heading}`);
    }
    for (const capability of input.space.researchDecision?.capabilities ?? []) {
      if (!observedText.includes(capability.title)) reasons.push(`missing_capability_title:${capability.title}`);
    }
  }
  if (reasons.length > 0) return { space: input.space, accepted: false, reasons };
  const artifact: ResearchDeliveryArtifact = {
    kind: input.kind,
    url: compact(input.url, 2_048),
    title: compact(input.title, 240),
    observedText,
    rowCount: input.kind === 'research_table' ? input.rowCount : undefined,
    verifiedAt: input.now,
  };
  const space: EvidenceSpace = {
    ...input.space,
    researchDelivery: { ...input.space.researchDelivery, [input.kind]: artifact },
    updatedAt: input.now,
  };
  return { space, accepted: true, reasons: [] };
}

export async function recordResearchDelivery(input: {
  taskId: string;
  kind: ResearchDeliveryKind;
  url: string;
  title: string;
  observedText: string;
  rowCount?: number;
  now?: number;
}): Promise<{ space: EvidenceSpace | null; accepted: boolean; reasons: string[] }> {
  const all = await evidenceStorage.get();
  const existing = all[input.taskId];
  if (!existing) return { space: null, accepted: false, reasons: ['evidence_space_missing'] };
  const result = putResearchDeliveryInSpace({ ...input, space: existing, now: input.now ?? Date.now() });
  if (result.accepted) await evidenceStorage.set({ ...all, [input.taskId]: result.space });
  return result;
}

export function researchDeliveryReady(space: EvidenceSpace | null | undefined): boolean {
  if (!space || !researchDecisionReady(space)) return false;
  return Boolean(space.researchDelivery?.research_table && space.researchDelivery?.decision_document);
}
