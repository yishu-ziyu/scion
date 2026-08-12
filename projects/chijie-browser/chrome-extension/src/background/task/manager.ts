import {
  advanceEvidenceWorkCycle,
  evidenceSpaceProgress,
  getActiveTask,
  getEvidenceSpace,
  getSkillSaveMeta,
  getTask,
  putSkillSaveMeta,
  resetEvidenceWorkCycles,
  researchDecisionReady,
  researchDeliveryReady,
  saveTask,
} from '@extension/storage/lib/task';
import favoritesStorage, {
  assertExactSkillInputs,
  compileSkillTemplate,
  createSkillDefinition,
  type CompletionCriterionTemplate,
} from '@extension/storage/lib/prompt/favorites';
import type {
  CommandAck,
  ActionAttempt,
  CompletionCriterion,
  CompletionEvidence,
  TaskCommand,
  TaskEvent,
  TaskRound,
  TaskSession,
  TaskSnapshot,
  TaskStatus,
} from '@extension/storage/lib/task';
import type {
  CompletionCriterionDraft,
  DispatchResult,
  ExecutorDriver,
  ExecutorHooks,
  ExecutorInput,
  ExecutorOutcome,
  ObserveCriteria,
  ProbeObservation,
} from './contracts';
import { StaleTaskRoundError } from './contracts';
import { buildAttemptDisplaySummary, buildAttemptTargetLabel } from './attempt-display';
import { ActionDispatcher, recoverAttempt } from './action-dispatcher';
import {
  checkCompletion,
  durableHttpCompletionUrl,
  redactedHttpUrlIdentity,
  type CompletionCheckInput,
} from './completion';
import type { TaskArtifact } from './artifact';
import { verifyCandidateComplete, type ArtifactCriterion } from './verification-engine';
import { sha256 } from './digest';
import { allowsVerifiedComplete } from './page-state';
import { resolveMediaArgs, resolveTabArgs } from './media';
import { toRedactedTaskSnapshot, traceStore } from './trace';
import {
  applyFinalDeliverableToMissionPlan,
  applyPassedCriteriaToMissionPlan,
  applySinglePhaseEvidence,
  attachCriteriaAcrossMissionPlan,
  refineMissionPlanFromInstruction,
} from './mission-plan';
import { ActionResult } from '../agent/types';
import { isUnderstandingOnlyInstruction } from '../browser/sites/understanding-answer';
import {
  extractResearchQuotas,
  isRecoverableResearchDecisionFailure,
  isRecoverableResearchFailure,
  maxResearchWorkCycles,
  renderResearchCheckpoint,
  researchQuotasMet,
  requiresStructuredResearchDecision,
} from './research-checkpoint';

export type { ExecutorDriver } from './contracts';

/** Observed tab presence for tab_state completion criteria. */
export type TabStateProbe = 'closed' | 'active' | 'inactive';
/** Observed download progress for download_state criteria (stub-safe). */
export type DownloadStateProbe = 'none' | 'started' | 'finished';

interface TaskManagerDeps {
  createExecutor: (input: ExecutorInput, hooks: ExecutorHooks) => Promise<ExecutorDriver>;
  switchTab: (tabId: number) => Promise<void>;
  observeCriteria: ObserveCriteria;
  now: () => number;
  /** Backoff after external_commit before re-probe (ms). Default covers async form rewrites. */
  postCommitVerifyDelaysMs?: number[];
  /** Probe tab existence/focus without requiring page attach (closed tabs). */
  probeTabState?: (tabId: number) => Promise<TabStateProbe>;
  /** Probe recent downloads API state; default 'none' never false-completes. */
  probeDownloadState?: () => Promise<DownloadStateProbe>;
}

const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled'];
const MAX_RESEARCH_DECISION_RETRIES = 3;

export interface InstructionDeliverableContract {
  required: boolean;
  requiresPageContent: boolean;
  requiresChinese: boolean;
  minimumItems: number;
  minimumItemsWithUrl: number;
  minimumDistinctUrls: number;
  eachItemNeedsUrl: boolean;
  requiresSourceOrder: boolean;
  minimumContentChars: number;
}

export interface InstructionDeliverableCheck {
  passed: boolean;
  reasons: string[];
}

const COUNT_WORDS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function parseRequestedCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0 && numeric <= 20) return numeric;
  return COUNT_WORDS[raw] ?? null;
}

export function normalizeProvenanceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return (url.origin + url.pathname).replace(/\/+$/, '') || url.origin;
  } catch {
    return null;
  }
}

export async function queryIdentityDigestForUrl(value: string): Promise<string | undefined> {
  return (await redactedHttpUrlIdentity(value))?.queryIdentityDigest;
}

export async function redactDeliverableUrlsForPersistence(value: string): Promise<string> {
  const matches = [...value.matchAll(/https?:\/\/[^\s<>"'，。；;）)\]}]+/gi)];
  if (matches.length === 0) return value;
  let cursor = 0;
  const chunks: string[] = [];
  for (const match of matches) {
    const index = match.index;
    if (index === undefined) continue;
    const raw = match[0].replace(/[.,，。!?！？]+$/, '');
    const trailing = match[0].slice(raw.length);
    chunks.push(value.slice(cursor, index));
    chunks.push((await durableHttpCompletionUrl(raw)) ?? '[invalid-url]');
    chunks.push(trailing);
    cursor = index + match[0].length;
  }
  chunks.push(value.slice(cursor));
  return chunks.join('');
}

function transientUrlIdentityKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const rawSearch = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    if (/%(?![0-9a-f]{2})/i.test(rawSearch)) return null;
    const pairs = rawSearch.split('&').map(pair => {
      if (!pair) return '';
      const separator = pair.indexOf('=');
      const rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
      const rawValue = separator >= 0 ? pair.slice(separator + 1) : '';
      const key = decodeURIComponent(rawKey.replace(/\+/g, '%20'));
      const valuePart = decodeURIComponent(rawValue.replace(/\+/g, '%20'));
      return `${encodeURIComponent(key)}=${encodeURIComponent(valuePart)}`;
    });
    const normalizedUrl = normalizeProvenanceUrl(value);
    return normalizedUrl ? `${normalizedUrl}\n${pairs.join('&')}` : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic, instruction-derived delivery contract. It deliberately checks
 * only explicit, falsifiable output shape (body content, count, full URLs);
 * semantic quality remains the executor's job and cannot be rescued by "done".
 */
export function deriveInstructionDeliverableContract(instruction: string): InstructionDeliverableContract {
  const text = instruction.replace(/\s+/g, ' ').trim();
  const itemMatch =
    /([一二两三四五六七八九十]|\d{1,2})\s*(?:条|项|个)\s*(?:中文|英文)?\s*(?:观察|结论|发现|要点|摘要|说明|回答|结果)/i.exec(
      text,
    ) ?? /\b(\d{1,2})\s+(?:observations?|findings?|items?|points?|results?)\b/i.exec(text);
  const minimumItems = parseRequestedCount(itemMatch?.[1]) ?? 1;
  const eachItemNeedsUrl =
    /(?:每|各)(?:条|项|个|一条|一个)?.{0,12}(?:带|附|包含|给出).{0,8}(?:完整)?\s*(?:URL|链接|网址)/i.test(text) ||
    /\beach\b.{0,16}\b(?:url|link)\b/i.test(text);
  const explicitUrlCount =
    parseRequestedCount(
      /([一二两三四五六七八九十]|\d{1,2})\s*(?:个|条)?\s*(?:完整)?\s*(?:URL|链接|网址)/i.exec(text)?.[1],
    ) ?? 0;
  const literalUrlCount = new Set(
    [...text.matchAll(/https?:\/\/[^\s<>"'，。；;）)\]}]+/gi)]
      .map(match => transientUrlIdentityKey(match[0].replace(/[.,，。!?！？]+$/, '')))
      .filter((key): key is string => Boolean(key)),
  ).size;
  const intentText = text.replace(/https?:\/\/[^\s<>"'，。；;）)\]}]+/gi, ' ');
  const requestsUrl =
    !/\bURL\s*host\b/i.test(text) &&
    (/(?:最终|完整|页面|当前|目标).{0,8}(?:URL|链接|网址)|(?:带上|给出|包含|附上|写出|列出|回复|输出).{0,16}(?:URL|链接|网址)|标题.{0,8}(?:URL|链接|网址)/i.test(
      text,
    ) ||
      /\b(?:include|provide|return|show|with)\b.{0,20}\b(?:url|link)\b/i.test(text));
  const minimumItemsWithUrl = eachItemNeedsUrl ? minimumItems : requestsUrl ? 1 : 0;
  const hasDistinctSourceSequence =
    eachItemNeedsUrl && /(?:先|首先).{0,160}(?:再|然后|随后).{0,160}(?:最终|最后|输出|回复)/.test(text);
  const minimumDistinctUrls = Math.max(
    explicitUrlCount,
    literalUrlCount,
    hasDistinctSourceSequence ? minimumItems : requestsUrl ? 1 : 0,
  );
  const explicitlyRequestsPageContent =
    /核心主题|正文|可见.{0,8}细节|细节|首段|第一段|定义|概括|摘要|总结|观察|引用|摘录|页面内容|展示的内容|描述.{0,12}(?:页面|内容)/.test(
      intentText,
    ) ||
    /\b(?:body|content|detail|definition|first paragraph|quote|extract|summari[sz]e|observation|describe)\b/i.test(
      intentText,
    );
  const referencesPageSource =
    literalUrlCount > 0 ||
    /(?:当前|这个|该|本)(?:[^\s。！？!?]{0,16})?(?:页面|网页|网站|标签页)|(?:页面|网页|网站)(?:上|中|里|所)/.test(
      intentText,
    ) ||
    /\b(?:this|the|current)\s+(?:page|webpage|site|tab)\b/i.test(intentText);
  const requestsFactAnswer =
    /告诉我|回答|给出|返回|查找|查询|是什么|是多少|是否|有没有|谁|何时|什么时候|多少钱|日期|价格|金额|数量|数值|数字|作者|发布|出版|上线|版本|事实/.test(
      intentText,
    ) ||
    /(?:页面|网页|网站|链接).{0,40}(?:声称|宣称|写道|提到|指出|显示|说明)/.test(intentText) ||
    /\b(?:tell me|answer|give|provide|return|find|report|what|who|when|how many|how much|does|do|is|are)\b/i.test(
      intentText,
    ) ||
    /\b(?:date|price|cost|amount|number|count|author|writer|creator|release|launch|publication|published|version|fact)\b/i.test(
      intentText,
    ) ||
    /\b(?:page|webpage|site|url)\b.{0,40}\b(?:claim|state|say|show|mention|report)\b/i.test(intentText);
  const asksMetadataIdentity =
    (/标题|域名|网站域名|网址|\btitle\b|\bdomain\b|\bhost\b|\burl\b/i.test(intentText) ||
      /(?:哪|什么|哪个)(?:个)?(?:网站|站点)|识别当前(?:页|页面|网站|站点)/.test(intentText)) &&
    !explicitlyRequestsPageContent &&
    !/日期|价格|金额|数量|数值|数字|作者|发布|出版|上线|版本|事实|声称|宣称|写道|提到|指出/.test(intentText) &&
    !/\b(?:date|price|cost|amount|number|count|author|writer|creator|release|launch|publication|published|version|fact|claim|state|say|show|mention|report)\b/i.test(
      intentText,
    );
  const requiresPageContent =
    explicitlyRequestsPageContent || (referencesPageSource && requestsFactAnswer && !asksMetadataIdentity);
  const required =
    requiresPageContent ||
    minimumItems > 1 ||
    minimumItemsWithUrl > 0 ||
    minimumDistinctUrls > 0 ||
    /复制|发给我|发我|告诉我|回复我|贴给我|第一条评论|评论内容|热评|摘录|回答|写出|列出|输出.{0,16}(?:观察|结论|发现|要点|结果)/.test(
      text,
    ) ||
    /\b(?:copy|tell me|send me|return|answer|output)\b/i.test(text) ||
    /\bextract\b.+\b(?:csv|table)\b/i.test(text) ||
    /\b(?:csv|table)\b.+\b(?:name|price|rating)\b/i.test(text) ||
    /(?:抽取|提取|导出).{0,24}(?:表|CSV|csv)/i.test(text);
  const minimumContentChars =
    /核心主题.{0,20}细节|细节.{0,20}核心主题|首段|第一段|定义|\bfirst paragraph\b|\bdefinition\b/i.test(text) ? 18 : 10;

  return {
    required,
    requiresPageContent,
    requiresChinese: /中文|用汉语|in chinese/i.test(text),
    minimumItems,
    minimumItemsWithUrl,
    minimumDistinctUrls,
    eachItemNeedsUrl,
    requiresSourceOrder: hasDistinctSourceSequence,
    minimumContentChars,
  };
}

function answerSegments(answer: string): string[] {
  return answer
    .split(/\n+|[；;]/)
    .flatMap(line => line.split(/(?<=[。！？!?])\s+/))
    .map(segment => segment.replace(/^\s*(?:[-*•]|\d{1,2}[.)、]|[一二两三四五六七八九十][、.])\s*/, '').trim())
    .filter(Boolean);
}

function isMetadataOnlySegment(segment: string): boolean {
  return (
    /^(?:标题|title|域名|host|URL|url|网址|页面地址|站点)\s*[:：=]/i.test(segment) ||
    /^页面(?:地址|状态).{0,24}(?:符合|到达|完成|正确|目标)/.test(segment) ||
    /^(?:已完成|完成|done|success|opened|已打开)[.!。！]*$/i.test(segment)
  );
}

function structuredTableCells(segment: string): string[] {
  const value = segment.trim();
  if (!value) return [];
  if (value.startsWith('|') && value.endsWith('|')) {
    return value
      .slice(1, -1)
      .split('|')
      .map(cell => cell.replace(/\\\|/g, '|').trim())
      .filter(Boolean);
  }

  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return quoted ? [] : cells.filter(Boolean);
}

function isStructuredTableMetadata(segment: string, explicitFields: string[]): boolean {
  if (/^已提取\s*\d+\s*件商品（(?:CSV|Markdown)）：?$/i.test(segment.trim())) return true;
  const cells = structuredTableCells(segment).map(cell => cell.toLowerCase());
  if (cells.length === 0) return false;
  if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) return true;
  return (
    explicitFields.length > 0 &&
    cells.length === explicitFields.length &&
    cells.every((cell, i) => cell === explicitFields[i])
  );
}

function isBasicSubstantiveAnswer(summary: string, goalText: string): boolean {
  const s = summary.replace(/\s+/g, ' ').trim();
  if (s.length < 8) return false;
  if (/^(?:好的|好[，,]|可以[，,]|收到|明白).{0,48}(?:我来|将|正在|马上|会)/.test(s)) return false;
  if (/^(?:sure|okay|ok)[,.! ]{0,3}(?:i(?:'ll| will)|let me)/i.test(s)) return false;
  if (/^Control loop candidate complete$/i.test(s)) return false;
  if (/^(done|完成|ok|已完成|success|好了|opened|playing|paused)[.!。！]*$/i.test(s)) return false;
  if (/^(视频|媒体).{0,12}(播放|暂停|核对)/.test(s)) return false;
  if (/^(目标)?标签已关闭/.test(s)) return false;
  if (/^页面(地址|状态)已/.test(s)) return false;
  if (/^下载已(开始|完成)/.test(s)) return false;
  if (/^(Browser opened|Switched to|Playing video|Opened |Paused video)/i.test(s)) return false;
  if (/User instruction/i.test(s)) return false;
  const goal = goalText.replace(/\s+/g, ' ').trim();
  if (goal && (s === goal || s.includes(goal) || (s.length <= goal.length + 4 && goal.includes(s)))) return false;
  return true;
}

export interface DeliverablePageEvidence {
  normalizedUrl: string;
  queryIdentityDigest?: string;
  textDigests?: string[];
  pageRevision?: string;
  visitSeq?: number;
  label?: string;
}

type DeliverableEvidenceInput = string | DeliverablePageEvidence;

async function pageEvidence(inputs?: Iterable<DeliverableEvidenceInput>): Promise<DeliverablePageEvidence[]> {
  const results = await Promise.all(
    [...(inputs ?? [])].map(async input => {
      if (typeof input === 'string') {
        const identity = await redactedHttpUrlIdentity(input);
        return identity ? { ...identity } : null;
      }
      const identity = await redactedHttpUrlIdentity(input.normalizedUrl);
      if (!identity) return null;
      return {
        ...input,
        normalizedUrl: identity.normalizedUrl,
        ...(input.queryIdentityDigest
          ? { queryIdentityDigest: input.queryIdentityDigest }
          : identity.queryIdentityDigest
            ? { queryIdentityDigest: identity.queryIdentityDigest }
            : {}),
      };
    }),
  );
  return results.filter((item): item is DeliverablePageEvidence => item !== null);
}

function quotedPassages(segment: string): string[] {
  return [...segment.matchAll(/[“"「『]([^”"」』]{8,240})[”"」』]/g)]
    .map(match => match[1]?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean);
}

async function firstSegmentIdentity(segment: string): Promise<DeliverablePageEvidence | null> {
  const raw = /https?:\/\/[^\s<>"'，。；;）)\]}]+/i.exec(segment)?.[0];
  return raw ? redactedHttpUrlIdentity(raw.replace(/[.,，。!?！？]+$/, '')) : null;
}

function provenanceIdentityKey(identity: DeliverablePageEvidence): string {
  return `${identity.normalizedUrl}\n${identity.queryIdentityDigest ?? 'no-query'}`;
}

function latestPageEvidence(items: DeliverablePageEvidence[]): DeliverablePageEvidence | undefined {
  return items.reduce<DeliverablePageEvidence | undefined>((latest, item) => {
    if (!latest) return item;
    if (item.visitSeq === undefined || latest.visitSeq === undefined) return item;
    return item.visitSeq >= latest.visitSeq ? item : latest;
  }, undefined);
}

function hasUnsupportedUnquotedClaim(segment: string): boolean {
  const residue = segment
    .replace(/https?:\/\/[^\s<>"'，。；;）)\]}]+/gi, '')
    .replace(/[“"「『][^”"」』]{8,240}[”"」』]/g, '')
    .replace(/^\s*(?:[-*•]|\d{1,2}[.)、]|[一二两三四五六七八九十][、.])\s*/, '')
    .replace(/[：:。.!！?？]/g, ' ')
    .trim();
  if (!residue) return false;
  const clauses = residue
    .split(/[，,、]/)
    .map(clause => clause.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return clauses.some(clause => {
    const sourceFrame =
      /^(?:(?:[A-Za-z][A-Za-z0-9 ._-]{0,40}|[\u4e00-\u9fffA-Za-z0-9._-]{1,20})\s*)?(?:页面|条目)(?:的)?(?:正文|首段|原文|内容)?(?:写道|记载|提到|指出|引用|如下)?$/;
    const contentFrame = /^(?:文章)?(?:核心|主题)?(?:与|和)?(?:正文)?(?:细节|内容|原文)(?:是|为|写道|如下)?$/;
    const englishFrame =
      /^(?:(?:[A-Za-z][A-Za-z0-9 ._-]{0,40})\s+)?(?:page|entry|body|lead|text|source)\s*(?:says|states|reads|shows|quote|excerpt)?$/i;
    return !sourceFrame.test(clause) && !contentFrame.test(clause) && !englishFrame.test(clause);
  });
}

async function instructionSourcePosition(instruction: string, evidence: DeliverablePageEvidence): Promise<number> {
  const lower = instruction.toLowerCase();
  for (const match of instruction.matchAll(/https?:\/\/[^\s<>"'，。；;）)\]}]+/gi)) {
    const identity = await redactedHttpUrlIdentity(match[0].replace(/[.,，。!?！？]+$/, ''));
    if (identity && provenanceIdentityKey(identity) === provenanceIdentityKey(evidence)) return match.index;
  }
  if (evidence.queryIdentityDigest) return -1;
  const exact = lower.indexOf(evidence.normalizedUrl.toLowerCase());
  if (exact >= 0) return exact;
  try {
    const hostname = new URL(evidence.normalizedUrl).hostname.replace(/^www\./, '');
    const positions = hostname
      .split('.')
      .filter(part => part.length >= 3)
      .map(part => lower.indexOf(part.toLowerCase()))
      .filter(position => position >= 0);
    if (positions.length > 0) return Math.min(...positions);
  } catch {
    return -1;
  }
  return -1;
}

async function quoteMatchesEvidence(quote: string, evidence: DeliverablePageEvidence): Promise<boolean> {
  if (!evidence.pageRevision || !evidence.textDigests?.length) return false;
  return evidence.textDigests.includes(await sha256(quote.replace(/\s+/g, ' ').trim()));
}

export async function checkInstructionDeliverable(
  instruction: string,
  answer: string,
  evidenceInputs?: Iterable<DeliverableEvidenceInput>,
): Promise<InstructionDeliverableCheck> {
  const contract = deriveInstructionDeliverableContract(instruction);
  const reasons: string[] = [];
  if (!isBasicSubstantiveAnswer(answer, instruction)) reasons.push('non_substantive');

  const rawAnswerUrls = [...answer.matchAll(/https?:\/\/[^\s<>"'，。；;）)\]}]+/gi)].map(match =>
    match[0].replace(/[.,，。!?！？]+$/, ''),
  );
  const orderedIdentities = (await Promise.all(rawAnswerUrls.map(value => redactedHttpUrlIdentity(value)))).filter(
    (identity): identity is DeliverablePageEvidence => identity !== null,
  );
  if (orderedIdentities.length !== rawAnswerUrls.length) reasons.push('invalid_url_provenance');
  const urls = new Set(orderedIdentities.map(provenanceIdentityKey));
  if (urls.size < contract.minimumDistinctUrls) reasons.push('distinct_url_count');
  const evidence = await pageEvidence(evidenceInputs);
  if (contract.minimumDistinctUrls > 0) {
    const visited = new Set(evidence.map(provenanceIdentityKey));
    if ([...urls].some(url => !visited.has(url))) {
      reasons.push('url_not_visited');
    }
  }

  const segments = answerSegments(answer);
  if (contract.minimumItems > 1) {
    const itemCount = segments.filter(segment => !isMetadataOnlySegment(segment)).length;
    if (itemCount < contract.minimumItems) reasons.push('item_count');
  }
  if (contract.minimumItemsWithUrl > 0) {
    const itemsWithUrl = segments.filter(segment => /https?:\/\//i.test(segment)).length;
    if (itemsWithUrl < contract.minimumItemsWithUrl) reasons.push('item_url_count');
  }

  if (contract.requiresPageContent) {
    const structuredTable =
      /\b(?:csv|table)\b/i.test(instruction) || /(?:表格|表|清单).{0,16}(?:字段|列|商品|产品)/.test(instruction);
    const explicitTableFields = structuredTable
      ? extractExplicitTableFields(instruction).map(field => field.toLowerCase())
      : [];
    const bodySegments = segments.filter(
      segment => !isMetadataOnlySegment(segment) && !isStructuredTableMetadata(segment, explicitTableFields),
    );
    const declaredTableRows = structuredTable
      ? Number(/^已提取\s*(\d+)\s*件商品（(?:CSV|Markdown)）/i.exec(segments[0] ?? '')?.[1])
      : Number.NaN;
    if (Number.isSafeInteger(declaredTableRows) && declaredTableRows !== bodySegments.length) {
      reasons.push('page_content_unsupported');
    }
    const bodyText = bodySegments
      .join(' ')
      .replace(/https?:\/\/[^\s<>"'，。；;）)\]}]+/gi, '')
      .replace(/\s+/g, '');
    if (bodyText.length < contract.minimumContentChars) reasons.push('page_content');

    const grounded: Array<{ target: DeliverablePageEvidence; segment: string }> = [];
    const requiredSegments = bodySegments;
    const currentPage = latestPageEvidence(evidence);
    const currentPageEvidence = currentPage?.pageRevision && currentPage.textDigests?.length ? [currentPage] : [];
    let ungroundedSegment = false;
    for (const segment of requiredSegments) {
      const segmentIdentity = await firstSegmentIdentity(segment);
      const latestIdentityTarget = segmentIdentity
        ? latestPageEvidence(
            evidence.filter(item => provenanceIdentityKey(item) === provenanceIdentityKey(segmentIdentity)),
          )
        : undefined;
      const targets = segmentIdentity
        ? latestIdentityTarget
          ? [latestIdentityTarget]
          : []
        : /https?:\/\//i.test(segment)
          ? []
          : currentPageEvidence;
      if (contract.eachItemNeedsUrl && !segmentIdentity) {
        ungroundedSegment = true;
        reasons.push('item_url_count');
      }
      const quotes = quotedPassages(segment);
      let matched: DeliverablePageEvidence | undefined;
      for (const target of targets) {
        const tableCells = structuredTable ? structuredTableCells(segment) : [];
        if (
          tableCells.length > 1 &&
          (await Promise.all(tableCells.map(cell => quoteMatchesEvidence(cell, target)))).every(Boolean)
        ) {
          matched = target;
        } else if (
          quotes.length > 0 &&
          (await Promise.all(quotes.map(quote => quoteMatchesEvidence(quote, target)))).every(Boolean)
        ) {
          matched = target;
        }
        if (matched) break;
      }
      if (matched) grounded.push({ target: matched, segment });
      else ungroundedSegment = true;
      if (!structuredTable && hasUnsupportedUnquotedClaim(segment)) reasons.push('page_content_unsupported');
    }
    if (grounded.length < contract.minimumItems || ungroundedSegment) reasons.push('page_content_ungrounded');

    if (contract.requiresSourceOrder && grounded.length >= contract.minimumItems) {
      const orderedTargets = grounded.slice(0, contract.minimumItems).map(item => item.target);
      const visitOrder = orderedTargets.map(item => item.visitSeq);
      const instructionOrder = await Promise.all(
        orderedTargets.map(item => instructionSourcePosition(instruction, item)),
      );
      const strictlyIncreasing = (values: number[]) =>
        values.every((value, index) => index === 0 || value > values[index - 1]);
      if (
        visitOrder.some(value => !Number.isSafeInteger(value)) ||
        instructionOrder.some(value => value < 0) ||
        !strictlyIncreasing(visitOrder as number[]) ||
        !strictlyIncreasing(instructionOrder)
      ) {
        reasons.push('source_order_unverified');
      }
    }
  }
  if (contract.requiresChinese && !/[\u4e00-\u9fff]/.test(answer)) reasons.push('language');
  return { passed: reasons.length === 0, reasons };
}

export function extractExplicitTableFields(instruction: string): string[] {
  const text = instruction.replace(/\s+/g, ' ').trim();
  const candidates: string[] = [];
  const english = /\bwith\s+([a-z][a-z0-9 _-]*(?:\s*,\s*[a-z][a-z0-9 _-]*)+(?:\s*,?\s+and\s+[a-z][a-z0-9 _-]*)?)/i.exec(
    text,
  )?.[1];
  const chinese =
    /(?:字段|列)(?:为|是|包含|包括)?\s*[:：]?\s*([A-Za-z\u4e00-\u9fff][^。；;]{1,100})/.exec(text)?.[1] ??
    /[（(]([A-Za-z\u4e00-\u9fff][^）)]{1,100})[）)]/.exec(text)?.[1];
  for (const group of [english, chinese]) {
    if (!group) continue;
    candidates.push(
      ...group
        .split(/\s*(?:,|，|、|\band\b|和|及)\s*/i)
        .map(field => field.trim().toLowerCase())
        .filter(field => /^[a-z][a-z0-9_-]{0,31}$|^[\u4e00-\u9fff]{1,12}$/.test(field)),
    );
  }
  return [...new Set(candidates)].slice(0, 12);
}

export class TaskManager {
  private readonly drivers = new Map<string, ExecutorDriver>();
  private readonly dispatchers = new Map<string, ActionDispatcher>();
  private readonly launches = new Map<string, symbol>();
  private readonly instructions = new Map<string, string>();
  private readonly criterionTemplates = new Map<string, CompletionCriterionTemplate[]>();
  private readonly lockedCriteriaRounds = new Set<string>();
  private readonly unsafeSkillCriteriaRounds = new Set<string>();
  private readonly listeners = new Set<(event: TaskEvent) => void>();
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TaskManagerDeps) {}

  dispatch(command: TaskCommand): Promise<CommandAck> {
    const result = this.transition.then(() => this.dispatchNow(command));
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async snapshot(taskId: string): Promise<TaskSnapshot | null> {
    return getTask(taskId);
  }

  async activeSnapshot(): Promise<TaskSnapshot | null> {
    return getActiveTask();
  }

  subscribe(listener: (event: TaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async interruptActive(): Promise<void> {
    await this.queueTransition(async () => {
      const task = await getActiveTask();
      if (!task || !['running', 'paused'].includes(task.status)) return;
      await this.stopTaskRuntime(task.id);
      task.status = 'interrupted';
      this.currentRound(task).status = 'interrupted';
      task.revision += 1;
      await this.persist(task);
    });
  }

  async recover(): Promise<void> {
    let autoResumeTaskId: string | null = null;
    await this.queueTransition(async () => {
      const task = await getActiveTask();
      if (task && (task.status as string) === 'waiting_approval') {
        task.status = 'interrupted';
        this.currentRound(task).status = 'interrupted';
        task.revision += 1;
        await this.persist(task);
        return;
      }
      // A user pause is authoritative across service-worker or extension reloads.
      // Research recovery may resume interrupted/running work, but must never turn
      // an explicit pause back into autonomous execution.
      if (task?.status === 'paused') return;
      const round = task ? this.currentRound(task) : null;
      const legacyUncertainWait = task?.status === 'waiting_user' && round?.waitReason === 'commit_outcome_uncertain';
      const recoverableResearchFailure =
        task?.status === 'failed' && isRecoverableResearchFailure(round?.failureCategory);
      const interruptedResearch = task?.status === 'interrupted';
      if (
        !task ||
        !round ||
        (!['running', 'paused'].includes(task.status) &&
          !legacyUncertainWait &&
          !recoverableResearchFailure &&
          !interruptedResearch)
      ) {
        return;
      }
      let hasUncertainCommit = false;
      for (const taskRound of task.rounds) {
        taskRound.attempts = taskRound.attempts.map(attempt => {
          if (
            attempt.effect === 'external_commit' &&
            (attempt.state === 'executing' || attempt.state === 'uncertain')
          ) {
            hasUncertainCommit = true;
          }
          const recovered = recoverAttempt(attempt);
          return recovered;
        });
      }
      if (hasUncertainCommit) {
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = 'commit_outcome_uncertain';
      } else if (task.sourceSkillId !== undefined) {
        task.status = 'inputs_required';
        round.status = 'inputs_required';
        round.waitReason = 'skill_inputs_required';
      } else {
        let instruction = this.instructions.get(task.id);
        if (!instruction && task.chatSessionId && round.instructionMessageId) {
          const { chatHistoryStore } = await import('@extension/storage/lib/chat');
          const session = await chatHistoryStore.getSession(task.chatSessionId);
          instruction = session?.messages.find(message => message.id === round.instructionMessageId)?.content;
        }
        if (instruction && extractResearchQuotas(instruction)) {
          this.instructions.set(task.id, instruction);
          task.status = 'running';
          round.status = 'running';
          delete round.waitReason;
          delete round.failureCategory;
          autoResumeTaskId = task.id;
        } else {
          task.status = 'interrupted';
          round.status = 'interrupted';
        }
      }
      task.revision += 1;
      await this.persist(task);
    });
    if (autoResumeTaskId) void this.runCurrentRound(autoResumeTaskId);
  }

  private async dispatchNow(command: TaskCommand): Promise<CommandAck> {
    const existing = await getTask(command.taskId);
    const duplicate = existing ? this.findAck(existing, command.commandId) : undefined;
    if (duplicate) return duplicate;

    if (command.type === 'start') {
      if (existing) return this.reject(existing, command.commandId, 'invalid_transition');
      const active = await getActiveTask();
      if (active && !TERMINAL_STATUSES.includes(active.status)) {
        return {
          accepted: false,
          commandId: command.commandId,
          taskId: command.taskId,
          revision: 0,
          error: 'invalid_transition',
        };
      }
      if (active) await this.stopTaskRuntime(active.id);
      return this.start(command);
    }

    if (command.type === 'run_skill') {
      if (existing) return this.reject(existing, command.commandId, 'invalid_transition');
      return this.runSkill(command);
    }

    if (!existing) {
      return {
        accepted: false,
        commandId: command.commandId,
        taskId: command.taskId,
        revision: 0,
        error: 'not_found',
      };
    }

    if (command.expectedRevision !== existing.revision) {
      return this.reject(existing, command.commandId, 'stale_revision');
    }

    switch (command.type) {
      case 'pause':
        return this.pause(existing, command.commandId);
      case 'resume':
        return this.resume(existing, command.commandId);
      case 'retry_research':
        return this.retryResearch(existing, command);
      case 'follow_up':
        return this.followUp(existing, command);
      case 'cancel':
        return this.cancel(existing, command.commandId);
      case 'confirm_completion':
        return this.confirmCompletion(existing, command);
      case 'save_skill':
        return this.saveSkill(existing, command);
    }
  }

  private async start(command: Extract<TaskCommand, { type: 'start' }>): Promise<CommandAck> {
    if (!command.instruction.trim() || command.tabId < 0) {
      return {
        accepted: false,
        commandId: command.commandId,
        taskId: command.taskId,
        revision: 0,
        error: 'invalid_input',
      };
    }

    const now = this.deps.now();
    const roundId = crypto.randomUUID();
    const ack: CommandAck = {
      accepted: true,
      commandId: command.commandId,
      taskId: command.taskId,
      revision: 1,
    };
    const plan = refineMissionPlanFromInstruction(command.instruction, now);
    // Persist only the plan's canonical action label; raw instruction text,
    // entities, secrets, and success phrases remain in ephemeral/chat storage.
    const round: TaskRound = {
      id: roundId,
      instructionMessageId: command.instructionMessageId,
      instructionSummary: 'User instruction',
      status: 'running',
      commandAcks: { [command.commandId]: ack },
      criteria: [],
      attempts: [],
      evidence: [],
    };
    const task: TaskSession = {
      id: command.taskId,
      goalSummary: plan.goal,
      chatSessionId: command.chatSessionId,
      instructionMessageId: command.instructionMessageId,
      status: 'running',
      revision: 1,
      activeTabId: command.tabId,
      currentRoundId: roundId,
      targetRefs: [],
      rounds: [round],
      plan,
      createdAt: now,
      updatedAt: now,
    };
    // Seed page bind evidence immediately so UI shows the same tab the user intended
    // (Phase 1 S1). Digest stays empty until observe; label is title-only for display.
    try {
      await this.deps.switchTab(command.tabId);
      const tab = await chrome.tabs.get(command.tabId);
      let urlOrigin = 'null';
      let normalizedUrl: string | undefined;
      let queryIdentityDigest: string | undefined;
      if (tab.url) {
        try {
          urlOrigin = new URL(tab.url).origin;
          const identity = await redactedHttpUrlIdentity(tab.url);
          normalizedUrl = identity?.normalizedUrl;
          queryIdentityDigest = identity?.queryIdentityDigest;
        } catch {
          urlOrigin = 'null';
        }
      }
      const label = (tab.title ?? '').trim() || undefined;
      task.targetRefs = [
        {
          id: `tab-${command.tabId}`,
          kind: 'page',
          tabId: command.tabId,
          frameId: 0,
          urlOrigin,
          ...(normalizedUrl ? { normalizedUrl } : {}),
          ...(queryIdentityDigest ? { queryIdentityDigest } : {}),
          digest: '',
          label,
          visitSeq: 1,
          observedAt: now,
        },
      ];
    } catch {
      // Keep empty targetRefs; runCurrentRound will attach or fail honestly.
    }
    this.instructions.set(task.id, command.instruction);
    await this.persist(task);
    void this.runCurrentRound(task.id);
    return ack;
  }

  private async saveSkill(
    task: TaskSession,
    command: Extract<TaskCommand, { type: 'save_skill' }>,
  ): Promise<CommandAck> {
    const round = task.rounds.find(item => item.id === command.roundId);
    const key = this.roundKey(task.id, command.roundId);
    const persisted = await getSkillSaveMeta(task.id, command.roundId);
    const templates = this.criterionTemplates.get(key) ?? persisted?.templates;
    if (
      task.status !== 'completed' ||
      task.currentRoundId !== command.roundId ||
      !round?.receipt ||
      !templates ||
      templates.length === 0
    ) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }
    if (this.unsafeSkillCriteriaRounds.has(key) || persisted?.unsafe) {
      return this.reject(task, command.commandId, 'invalid_input');
    }

    try {
      const definition = createSkillDefinition({
        title: command.title,
        instructionTemplate: command.instructionTemplate,
        criteria: templates,
        sourceTaskId: task.id,
      });
      await favoritesStorage.addSkill(definition);
    } catch {
      return this.reject(task, command.commandId, 'invalid_input');
    }

    const ack = this.accept(task, command.commandId);
    await this.persist(task);
    return ack;
  }

  private async runSkill(command: Extract<TaskCommand, { type: 'run_skill' }>): Promise<CommandAck> {
    if (command.tabId < 0) return this.commandError(command, 'invalid_input');
    const active = await getActiveTask();
    if (active && !TERMINAL_STATUSES.includes(active.status)) {
      return this.commandError(command, 'invalid_transition');
    }

    const skill = await favoritesStorage.getSkill(command.skillId);
    if (!skill) return this.commandError(command, 'not_found');

    let renderedInstruction = '';
    try {
      assertExactSkillInputs(skill.inputs, command.values);
      renderedInstruction = compileSkillTemplate(skill.instructionTemplate, command.values);
    } catch {
      return this.commandError(command, 'invalid_input');
    }

    if (active) await this.stopTaskRuntime(active.id);
    await this.deps.switchTab(command.tabId);

    const now = this.deps.now();
    const roundId = crypto.randomUUID();
    let criteria: CompletionCriterion[];
    try {
      criteria = await this.freezeSkillCriteria(skill.criteria, roundId, command.tabId);
    } catch {
      renderedInstruction = '';
      return this.commandError(command, 'invalid_input');
    }
    const ack: CommandAck = {
      accepted: true,
      commandId: command.commandId,
      taskId: command.taskId,
      revision: 1,
    };
    let plan = refineMissionPlanFromInstruction(renderedInstruction, now);
    plan = attachCriteriaAcrossMissionPlan(
      plan,
      criteria.map(item => item.id),
      now,
    );
    const task: TaskSession = {
      id: command.taskId,
      goalSummary: `Run Skill: ${skill.title}`,
      sourceSkillId: skill.id,
      status: 'running',
      revision: 1,
      activeTabId: command.tabId,
      currentRoundId: roundId,
      targetRefs: [],
      rounds: [
        {
          id: roundId,
          instructionSummary: `Run Skill: ${skill.title}`,
          status: 'running',
          commandAcks: { [command.commandId]: ack },
          criteria,
          attempts: [],
          evidence: [],
        },
      ],
      plan,
      createdAt: now,
      updatedAt: now,
    };
    this.instructions.set(task.id, renderedInstruction);
    renderedInstruction = '';
    const templateKey = this.roundKey(task.id, roundId);
    this.criterionTemplates.set(templateKey, structuredClone(skill.criteria));
    this.lockedCriteriaRounds.add(templateKey);
    await putSkillSaveMeta(task.id, roundId, {
      templates: structuredClone(skill.criteria),
      unsafe: false,
    });
    await this.persist(task);
    void this.runCurrentRound(task.id);
    return ack;
  }

  private commandError(
    command: Extract<TaskCommand, { type: 'run_skill' }>,
    error: 'not_found' | 'invalid_transition' | 'invalid_input',
  ): CommandAck {
    return {
      accepted: false,
      commandId: command.commandId,
      taskId: command.taskId,
      revision: 0,
      error,
    };
  }

  private async pause(task: TaskSession, commandId: string): Promise<CommandAck> {
    if (task.status !== 'running') return this.reject(task, commandId, 'invalid_transition');
    task.status = 'paused';
    this.currentRound(task).status = 'paused';
    // Mission plan is durable across pause: do not rebuild or clear task.plan.
    const ack = this.accept(task, commandId);
    await this.persist(task);
    this.drivers.get(task.id)?.pause();
    return ack;
  }

  private async resume(task: TaskSession, commandId: string): Promise<CommandAck> {
    if (!['paused', 'interrupted'].includes(task.status)) {
      return this.reject(task, commandId, 'invalid_transition');
    }
    task.status = 'running';
    this.currentRound(task).status = 'running';
    // Resume continues the existing plan object (phase titles / progress), not a fresh skeleton.
    const ack = this.accept(task, commandId);
    await this.persist(task);
    const driver = this.drivers.get(task.id);
    if (driver) driver.resume();
    else void this.runCurrentRound(task.id);
    return ack;
  }

  private async rehydrateInstruction(
    task: TaskSession,
    round: TaskRound,
    options: { forceResearchContext?: boolean } = {},
  ): Promise<string | undefined> {
    let current = this.instructions.get(task.id);
    let priorResearch: string | undefined;
    if (task.chatSessionId) {
      const { chatHistoryStore } = await import('@extension/storage/lib/chat');
      const session = await chatHistoryStore.getSession(task.chatSessionId);
      current =
        current ??
        (round.instructionMessageId
          ? session?.messages.find(message => message.id === round.instructionMessageId)?.content
          : undefined);
      priorResearch = [...(session?.messages ?? [])]
        .reverse()
        .find(
          message =>
            (message.actor === 'user' || message.actor === undefined) &&
            Boolean(extractResearchQuotas(message.content)),
        )?.content;
    }
    if (current && extractResearchQuotas(current)) return current;
    const shouldCarryResearchContext =
      options.forceResearchContext ||
      Boolean(
        current &&
          (requiresStructuredResearchDecision(current) ||
            /record_research_decision|decision_evidence_shortlist|剩余调研|研究收集门/i.test(current)),
      );
    if (priorResearch && shouldCarryResearchContext) {
      return current && current !== priorResearch
        ? `${priorResearch}\n\nLatest user correction (follow this while preserving the durable research gates):\n${current}`
        : priorResearch;
    }
    return current ?? priorResearch;
  }

  private async retryResearch(
    task: TaskSession,
    command: Extract<TaskCommand, { type: 'retry_research' }>,
  ): Promise<CommandAck> {
    const round = this.currentRound(task);
    if (task.status !== 'failed' || task.sourceSkillId !== undefined) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }

    const instruction = await this.rehydrateInstruction(task, round, { forceResearchContext: true });
    if (!instruction || !extractResearchQuotas(instruction)) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }

    await this.stopTaskRuntime(task.id);
    await resetEvidenceWorkCycles(task.id, this.deps.now());
    this.instructions.set(task.id, instruction);
    if (command.tabId !== undefined) task.activeTabId = command.tabId;
    task.status = 'running';
    round.status = 'running';
    delete round.failureCategory;
    delete round.waitReason;
    const ack = this.accept(task, command.commandId);
    await this.persist(task);
    void this.runCurrentRound(task.id);
    return ack;
  }

  private async followUp(task: TaskSession, command: Extract<TaskCommand, { type: 'follow_up' }>): Promise<CommandAck> {
    const round = this.currentRound(task);
    if (
      !['running', 'paused', 'interrupted', 'waiting_user', 'completed'].includes(task.status) ||
      !command.instruction.trim() ||
      (task.status === 'waiting_user' && round.waitReason === 'commit_outcome_uncertain')
    ) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }
    const previousStatus = task.status;
    const roundId = crypto.randomUUID();
    const now = this.deps.now();
    task.status = 'running';
    task.currentRoundId = roundId;
    task.chatSessionId = command.chatSessionId;
    task.instructionMessageId = command.instructionMessageId;
    task.rounds.push({
      id: roundId,
      instructionMessageId: command.instructionMessageId,
      instructionSummary: command.changeType === 'direction_change' ? 'Direction changed' : 'User instruction',
      changeType: command.changeType ?? 'follow_up',
      createdAt: now,
      status: 'running',
      commandAcks: {},
      criteria: [],
      attempts: [],
      evidence: [],
    });
    const ack = this.accept(task, command.commandId);
    this.instructions.set(task.id, command.instruction);
    await this.persist(task);
    const driver = this.drivers.get(task.id);
    if (!driver) void this.runCurrentRound(task.id);
    else {
      driver.addFollowUp(command.instruction);
      if (previousStatus === 'paused' || previousStatus === 'interrupted') driver.resume();
      if (['waiting_user', 'completed'].includes(previousStatus)) {
        void this.runDriver(task.id, driver, roundId, command.instruction);
      }
    }
    return ack;
  }

  private async cancel(task: TaskSession, commandId: string): Promise<CommandAck> {
    if (TERMINAL_STATUSES.includes(task.status)) return this.reject(task, commandId, 'invalid_transition');
    task.status = 'cancelled';
    this.currentRound(task).status = 'cancelled';
    const ack = this.accept(task, commandId);
    await this.persist(task);
    await this.stopTaskRuntime(task.id);
    return ack;
  }

  private accept(task: TaskSession, commandId: string): CommandAck {
    task.revision += 1;
    const ack: CommandAck = {
      accepted: true,
      commandId,
      taskId: task.id,
      revision: task.revision,
    };
    this.currentRound(task).commandAcks[commandId] = ack;
    return ack;
  }

  private async reject(
    task: TaskSession,
    commandId: string,
    error: 'stale_revision' | 'invalid_transition' | 'invalid_input',
  ): Promise<CommandAck> {
    const ack: CommandAck = {
      accepted: false,
      commandId,
      taskId: task.id,
      revision: task.revision,
      error,
    };
    this.currentRound(task).commandAcks[commandId] = ack;
    await this.persist(task);
    return ack;
  }

  private findAck(task: TaskSession, commandId: string): CommandAck | undefined {
    for (const round of task.rounds) {
      const ack = round.commandAcks[commandId];
      if (ack) return ack;
    }
    return undefined;
  }

  private currentRound(task: TaskSession): TaskRound {
    const round = task.rounds.find(item => item.id === task.currentRoundId);
    if (!round) throw new Error('Task current round is missing');
    return round;
  }

  private executorHooks(taskId: string): ExecutorHooks {
    const dispatcher = new ActionDispatcher({
      now: this.deps.now,
      persistAttempt: attempt => this.persistAttempt(taskId, attempt),
      observe: async (request, parsedArgs, phase) => {
        const { browserContext } = await import('../agent/factory');
        const page = await browserContext.getCurrentPage();
        if (request.action.name() === 'control_media') {
          const targetDigest = this.readStringField(parsedArgs, 'target_digest');
          const observed = await page.observeMedia(targetDigest);
          if (observed.kind !== 'bound') {
            return { effectTarget: { tag: 'video' }, evidence: [] };
          }
          let urlOrigin = 'null';
          try {
            urlOrigin = new URL(page.url()).origin;
          } catch {
            // Keep the redacted null origin for non-URL pages.
          }
          const targetRefId = `media:${observed.targetDigest}`;
          // After-act digest evidence feeds continuous control; completion still needs criteria.
          const evidence =
            phase === 'after'
              ? [
                  {
                    criterionId: `media-state:${request.roundId}`,
                    roundId: request.roundId,
                    targetRefId,
                    observedAt: this.deps.now(),
                    source: 'page' as const,
                    value: observed.state,
                    passed: true,
                  },
                ]
              : [];
          return {
            target: {
              id: targetRefId,
              kind: 'media',
              tabId: page.tabId,
              frameId: 0,
              urlOrigin,
              digest: observed.targetDigest,
            },
            effectTarget: { tag: 'video' },
            evidence,
          };
        }
        if (request.action.name() === 'close_tab' || request.action.name() === 'switch_tab') {
          const tabId =
            this.readNumberField(parsedArgs, 'tab_id') ?? (Number.isSafeInteger(page.tabId) ? page.tabId : undefined);
          const targetRefId = tabId !== undefined ? `tab-${tabId}` : `tab-${page.tabId}`;
          let urlOrigin = 'null';
          try {
            urlOrigin = new URL(page.url()).origin;
          } catch {
            // Keep redacted null origin.
          }
          const digest = await sha256(`${request.action.name()}:${targetRefId}`);
          let evidence: CompletionEvidence[] = [];
          if (phase === 'after' && tabId !== undefined) {
            const tabState = await this.probeTabState(tabId);
            const expected = request.action.name() === 'close_tab' ? 'closed' : 'active';
            evidence = [
              {
                criterionId: `tab-state:${request.roundId}`,
                roundId: request.roundId,
                targetRefId,
                observedAt: this.deps.now(),
                source: 'page',
                value: tabState === 'inactive' && expected === 'active' ? 'inactive' : tabState,
                passed: tabState === expected,
              },
            ];
          }
          return {
            target: {
              id: targetRefId,
              kind: 'page',
              tabId: tabId ?? page.tabId,
              frameId: 0,
              urlOrigin,
              digest,
            },
            effectTarget: { tag: 'tab' },
            evidence,
          };
        }
        const observation = await page.observeActionTarget(request.action.name(), parsedArgs, phase);
        return {
          target: observation.target,
          effectTarget: observation,
          evidence: [],
          pageRevision: observation.pageRevision,
        };
      },
    });
    this.dispatchers.set(taskId, dispatcher);
    return {
      onPlan: async (roundId, criteria) => {
        let task = await getTask(taskId);
        if (!task || task.status !== 'running' || task.currentRoundId !== roundId) {
          throw new StaleTaskRoundError();
        }
        if (!this.lockedCriteriaRounds.has(this.roundKey(taskId, roundId))) {
          // Models often return empty completion_criteria; fall back to instruction cues
          // so external_commit can still settle with a verified receipt.
          const drafts =
            criteria.length > 0
              ? criteria
              : this.extractImplicitCompletionCriteria(
                  this.instructions.get(taskId) ?? '',
                  task.targetRefs.find(ref => ref.kind === 'page')?.urlOrigin,
                );
          await this.freezeCriteria(taskId, roundId, drafts);
        } else if (this.currentRound(task).criteria.length === 0) {
          throw new Error('Locked Skill criteria are missing');
        }
        task = await getTask(taskId);
        if (!task || task.status !== 'running' || task.currentRoundId !== roundId) {
          throw new StaleTaskRoundError();
        }
      },
      dispatchAction: async (roundId, action, rawArgs) => {
        const task = await getTask(taskId);
        if (!task || task.status !== 'running' || task.currentRoundId !== roundId) {
          throw new StaleTaskRoundError();
        }
        let resolvedArgs = rawArgs;
        if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
          const withTab = resolveTabArgs(action.name(), rawArgs as Record<string, unknown>, task);
          const resolution = resolveMediaArgs(action.name(), withTab, task);
          if (resolution.kind === 'waiting_user') {
            return this.blockMediaAction(taskId, roundId, action.name(), rawArgs, resolution.reason);
          }
          resolvedArgs = resolution.args;
        }
        if (
          action.name() === 'control_media' &&
          resolvedArgs &&
          typeof resolvedArgs === 'object' &&
          !Array.isArray(resolvedArgs) &&
          !this.readStringField(resolvedArgs, 'target_digest')
        ) {
          const { browserContext } = await import('../agent/factory');
          const page = await browserContext.getCurrentPage();
          const observed = await page.observeMedia();
          if (observed.kind !== 'bound') {
            const reason = observed.kind === 'ambiguous' ? 'target_ambiguous' : 'target_missing';
            return this.blockMediaAction(taskId, roundId, action.name(), resolvedArgs, reason);
          }
          resolvedArgs = { ...(resolvedArgs as Record<string, unknown>), target_digest: observed.targetDigest };
        }
        const result = await dispatcher.dispatch({
          taskId,
          roundId,
          action,
          rawArgs: resolvedArgs,
        });
        if (result.targetRef) await this.persistTarget(taskId, roundId, result.targetRef);
        if (result.actionResult.error === 'media_target_missing') {
          await this.persistMediaWait(taskId, roundId, 'target_missing');
        } else if (result.actionResult.error === 'media_target_ambiguous') {
          await this.persistMediaWait(taskId, roundId, 'target_ambiguous');
        } else if (!result.actionResult.error && result.attempt.state === 'observed') {
          // Page evidence beats model "done": settle when criteria already hold.
          // external_commit: retry with backoff (async form rewrite).
          // reversible/read (nav, video click): one immediate probe so we stop on /watch
          // without stalling the next step behind multi-second backoff.
          if (result.attempt.effect === 'external_commit') {
            await this.tryVerifyAfterSuccessfulAct(taskId, roundId);
          } else {
            await this.tryVerifyAfterSuccessfulActOnce(taskId, roundId);
          }
        }
        return result;
      },
    };
  }

  /**
   * After a successful act (navigate, click, or authorized external commit), re-probe
   * frozen criteria. Real MiniMax loops often keep stepping without emitting
   * candidate_complete; page evidence is enough for a verified receipt.
   * Fixture/real forms often rewrite DOM after an async fetch - one immediate
   * probe races the update, so retry with short backoff.
   * Only automatic criteria participate - user_confirmed still needs the panel.
   */
  private async tryVerifyAfterSuccessfulAct(taskId: string, roundId: string): Promise<void> {
    // Immediate + short backoff: form fixtures rewrite after async fetch; do not block long.
    const delaysMs = this.deps.postCommitVerifyDelaysMs ?? [0, 250, 600, 1200];
    for (const delayMs of delaysMs) {
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      const settled = await this.tryVerifyAfterSuccessfulActOnce(taskId, roundId);
      if (settled) return;
    }
  }

  /** @returns true when the task was completed (or is no longer verifiable). */
  private async tryVerifyAfterSuccessfulActOnce(taskId: string, roundId: string): Promise<boolean> {
    const task = await getTask(taskId);
    if (!task || task.status !== 'running' || task.currentRoundId !== roundId) return true;
    const round = this.currentRound(task);
    const automaticCriteria = round.criteria.filter(item => item.kind !== 'user_confirmed');
    if (automaticCriteria.length === 0) return true;
    // Mixed plans still need a user click; only pure automatic sets can settle here.
    if (round.criteria.some(item => item.kind === 'user_confirmed')) return true;
    let observations: ProbeObservation[] = [];
    try {
      observations = await this.observeTaskCriteria(task, automaticCriteria);
    } catch {
      return false;
    }
    const checked = checkCompletion({
      now: this.deps.now(),
      currentRoundId: round.id,
      criteria: automaticCriteria,
      observations,
    });
    // product/007: no verified complete without required criteria evidence (expect / page proof).
    const canComplete = allowsVerifiedComplete({
      completionPassed: checked.passed,
      hasRequiredCriteria: automaticCriteria.some(c => c.required),
    });
    // Multi-intent goals (play + copy comment) must not settle on media criteria alone.
    // Keep the loop alive so the agent can still extract/return text.
    const instructionForRound =
      this.instructions.get(taskId) ||
      task.goalSummary ||
      (round.instructionSummary && round.instructionSummary !== 'User instruction' ? round.instructionSummary : '') ||
      '';
    const deliverableBlocks =
      this.instructionRequestsUserDeliverable(instructionForRound) &&
      !(await this.hasSubstantiveDeliverableAnswer(
        round.instructionSummary?.trim() ?? '',
        instructionForRound,
        this.visitedPageEvidence(task),
      ));

    if (!canComplete || deliverableBlocks) {
      // Partial evidence still advances mission phases before full task complete.
      const passedIds = checked.evidence.filter(item => item.passed).map(item => item.criterionId);
      if (task.plan && passedIds.length > 0) {
        await this.queueTransition(async () => {
          const current = await getTask(taskId);
          if (!current?.plan || current.status !== 'running' || current.currentRoundId !== roundId) return;
          const next = applyPassedCriteriaToMissionPlan(current.plan, passedIds, this.deps.now());
          if (next === current.plan) return;
          current.plan = next;
          current.revision += 1;
          await this.persist(current);
        });
      }
      return false;
    }
    let completed = false;
    await this.queueTransition(async () => {
      const current = await getTask(taskId);
      if (!current || current.status !== 'running' || current.currentRoundId !== roundId) return;
      const currentRound = this.currentRound(current);
      currentRound.evidence.push(...checked.evidence);
      this.syncMissionPlanFromEvidence(current, checked.evidence);
      completed = await this.persistVerifiedReceipt(current, currentRound, checked.evidence);
    });
    if (completed) await this.stopTaskRuntime(taskId);
    return completed;
  }

  private readStringField(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object' || !(key in value)) return undefined;
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' ? field : undefined;
  }

  private readNumberField(value: unknown, key: string): number | undefined {
    if (!value || typeof value !== 'object' || !(key in value)) return undefined;
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === 'number' && Number.isFinite(field)) return field;
    if (typeof field === 'string' && field.trim() !== '') {
      const n = Number(field.trim());
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  }

  private async probeTabState(tabId: number): Promise<TabStateProbe> {
    if (this.deps.probeTabState) return this.deps.probeTabState(tabId);
    return 'inactive';
  }

  private async probeDownloadState(): Promise<DownloadStateProbe> {
    if (this.deps.probeDownloadState) return this.deps.probeDownloadState();
    return 'none';
  }

  private async blockMediaAction(
    taskId: string,
    roundId: string,
    actionName: string,
    rawArgs: unknown,
    reason: 'target_missing' | 'target_ambiguous',
  ): Promise<DispatchResult> {
    const proposedAt = this.deps.now();
    const displayInput = { actionName, args: rawArgs };
    let attempt: ActionAttempt = {
      id: crypto.randomUUID(),
      roundId,
      actionName,
      effect: 'reversible',
      argsDigest: await sha256(JSON.stringify(rawArgs)),
      displaySummary: buildAttemptDisplaySummary(displayInput),
      targetLabel: buildAttemptTargetLabel(displayInput),
      state: 'proposed',
      proposedAt,
    };
    await this.persistAttempt(taskId, attempt);
    attempt = { ...attempt, state: 'blocked' };
    await this.persistAttempt(taskId, attempt);
    await this.persistMediaWait(taskId, roundId, reason);
    return {
      actionResult: new ActionResult({
        error: reason === 'target_ambiguous' ? 'media_target_ambiguous' : 'media_target_missing',
      }),
      attempt,
      evidence: [],
    };
  }

  private async persistMediaWait(
    taskId: string,
    roundId: string,
    reason: 'target_missing' | 'target_ambiguous',
  ): Promise<void> {
    await this.queueTransition(async () => {
      const task = await getTask(taskId);
      if (!task || task.status !== 'running' || task.currentRoundId !== roundId) return;
      await this.persistWaitingUser(task, this.currentRound(task), reason);
    });
  }

  private async persistAttempt(taskId: string, attempt: ActionAttempt): Promise<void> {
    let stopDriver = false;
    await this.queueTransition(async () => {
      const task = await getTask(taskId);
      const round = task?.rounds.find(item => item.id === attempt.roundId);
      if (!task || !round) return;
      const isCurrentRound = task.currentRoundId === attempt.roundId;
      if (attempt.state === 'executing' && (task.status !== 'running' || !isCurrentRound)) {
        throw new Error('Task is not running');
      }
      const index = round.attempts.findIndex(item => item.id === attempt.id);
      if (index === -1) round.attempts.push(structuredClone(attempt));
      else round.attempts[index] = structuredClone(attempt);
      if (attempt.state === 'executing') {
        const notBefore = attempt.executingAt ?? this.deps.now();
        for (const criterion of round.criteria) criterion.notBefore = Math.max(criterion.notBefore, notBefore);
      }
      if (attempt.state === 'uncertain' && isCurrentRound && !TERMINAL_STATUSES.includes(task.status)) {
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = 'commit_outcome_uncertain';
        stopDriver = true;
      }
      task.revision += 1;
      await this.persist(task);
    });
    if (stopDriver) {
      await this.stopTaskRuntime(taskId);
    }
  }

  private async persistTarget(
    taskId: string,
    roundId: string,
    target: TaskSession['targetRefs'][number],
  ): Promise<void> {
    let enrichedTarget = target;
    if (target.kind === 'page') {
      try {
        const tab = await chrome.tabs.get(target.tabId);
        const label = tab.title?.replace(/\s+/g, ' ').trim().slice(0, 160);
        let urlOrigin = target.urlOrigin;
        let normalizedUrl = target.normalizedUrl;
        let queryIdentityDigest = target.queryIdentityDigest;
        if (tab.url && (!normalizedUrl || !queryIdentityDigest)) {
          try {
            urlOrigin = new URL(tab.url).origin;
            const identity = await redactedHttpUrlIdentity(tab.url);
            normalizedUrl = identity?.normalizedUrl ?? normalizedUrl;
            queryIdentityDigest = identity?.queryIdentityDigest;
          } catch {
            // Keep the page-observer origin.
          }
        }
        enrichedTarget = {
          ...target,
          urlOrigin,
          ...(normalizedUrl ? { normalizedUrl } : {}),
          ...(queryIdentityDigest ? { queryIdentityDigest } : {}),
          ...(label ? { label } : {}),
        };
      } catch {
        // A tab may close between observation and persistence; the observed
        // target remains valid provenance without an optional title label.
      }
    }
    await this.queueTransition(async () => {
      const task = await getTask(taskId);
      if (!task) return;
      if (task.currentRoundId !== roundId) {
        const sourceIndex = task.rounds.findIndex(item => item.id === roundId);
        const currentIndex = task.rounds.findIndex(item => item.id === task.currentRoundId);
        const currentRound = task.rounds[currentIndex];
        if (
          sourceIndex !== currentIndex - 1 ||
          !currentRound ||
          currentRound.criteria.length > 0 ||
          currentRound.attempts.length > 0
        ) {
          return;
        }
      }
      const index = task.targetRefs.findIndex(item => item.id === enrichedTarget.id);
      const existingTarget = index >= 0 ? task.targetRefs[index] : undefined;
      if (enrichedTarget.kind === 'page') {
        const nextVisitSeq = task.targetRefs.reduce((max, item) => Math.max(max, item.visitSeq ?? 0), 0) + 1;
        const capturedTextDigests = enrichedTarget.textDigests;
        const capturedBodyDigest = enrichedTarget.bodyDigest;
        const capturedPageRevision = enrichedTarget.pageRevision;
        const capturedQueryIdentity = enrichedTarget.queryIdentityDigest;
        enrichedTarget = {
          ...existingTarget,
          ...enrichedTarget,
          visitSeq: nextVisitSeq,
          observedAt: enrichedTarget.observedAt ?? this.deps.now(),
        };
        if (!capturedTextDigests?.length) delete enrichedTarget.textDigests;
        if (!capturedBodyDigest) delete enrichedTarget.bodyDigest;
        if (!capturedPageRevision) delete enrichedTarget.pageRevision;
        if (!capturedQueryIdentity) delete enrichedTarget.queryIdentityDigest;
      }
      if (index === -1) task.targetRefs.push(enrichedTarget);
      else if (enrichedTarget.kind === 'media') {
        task.targetRefs.splice(index, 1);
        task.targetRefs.push(enrichedTarget);
      } else task.targetRefs[index] = enrichedTarget;
      task.activeTabId = enrichedTarget.tabId;
      task.revision += 1;
      await this.persist(task);
    });
  }

  private async captureCurrentPageEvidence(taskId: string, roundId: string): Promise<void> {
    try {
      const { browserContext } = await import('../agent/factory');
      const page = await browserContext.getCurrentPage();
      const observation = await page.observeActionTarget('read_page_text', {}, 'after');
      if (observation.target.kind !== 'page') return;
      await this.persistTarget(taskId, roundId, observation.target);
    } catch {
      await this.persistPageCaptureFailure(taskId, roundId);
    }
  }

  private async persistPageCaptureFailure(taskId: string, roundId: string): Promise<void> {
    const task = await getTask(taskId);
    if (!task) return;
    const latestPage = [...task.targetRefs]
      .filter(target => target.kind === 'page' && target.normalizedUrl)
      .sort((left, right) => (right.visitSeq ?? -1) - (left.visitSeq ?? -1))[0];
    let identity = latestPage
      ? {
          normalizedUrl: latestPage.normalizedUrl!,
          ...(latestPage.queryIdentityDigest ? { queryIdentityDigest: latestPage.queryIdentityDigest } : {}),
        }
      : null;
    let urlOrigin = latestPage?.urlOrigin ?? 'null';
    try {
      const tab = await chrome.tabs.get(task.activeTabId);
      if (tab.url) {
        const currentIdentity = await redactedHttpUrlIdentity(tab.url);
        if (currentIdentity) {
          identity = currentIdentity;
          urlOrigin = new URL(tab.url).origin;
        }
      }
    } catch {
      // The last redacted page identity is enough to invalidate stale evidence.
    }
    if (!identity) return;
    const digest = await sha256(JSON.stringify({ tabId: task.activeTabId, ...identity, capture: 'failed' }));
    await this.persistTarget(taskId, roundId, {
      id: `page-failed-${digest.slice(0, 16)}`,
      kind: 'page',
      tabId: task.activeTabId,
      frameId: 0,
      urlOrigin,
      ...identity,
      observedAt: this.deps.now(),
      digest,
    });
  }

  private interruptTaskRuntime(taskId: string): void {
    this.dispatchers.get(taskId)?.interrupt();
  }

  private async stopTaskRuntime(taskId: string): Promise<void> {
    this.interruptTaskRuntime(taskId);
    const driver = this.drivers.get(taskId);
    this.drivers.delete(taskId);
    this.dispatchers.delete(taskId);
    this.instructions.delete(taskId);
    for (const key of this.lockedCriteriaRounds) {
      if (key.startsWith(`${taskId}:`)) this.lockedCriteriaRounds.delete(key);
    }
    for (const key of this.unsafeSkillCriteriaRounds) {
      if (key.startsWith(`${taskId}:`)) this.unsafeSkillCriteriaRounds.delete(key);
    }
    if (driver) await driver.stop();
  }

  private async runCurrentRound(taskId: string): Promise<void> {
    if (this.launches.has(taskId)) return;
    const launch = Symbol(taskId);
    this.launches.set(taskId, launch);

    try {
      let task = await getTask(taskId);
      if (!task || task.status !== 'running') return;
      await this.deps.switchTab(task.activeTabId);

      task = await getTask(taskId);
      if (!task || task.status !== 'running' || this.launches.get(taskId) !== launch) return;
      let round = this.currentRound(task);
      let instruction = this.instructions.get(taskId);
      const shouldRehydrate =
        !instruction ||
        (!extractResearchQuotas(instruction) &&
          (requiresStructuredResearchDecision(instruction) ||
            /record_research_decision|decision_evidence_shortlist|剩余调研|研究收集门/i.test(instruction)));
      if (shouldRehydrate) {
        instruction = await this.rehydrateInstruction(task, round);
        task = await getTask(taskId);
        if (!task || task.status !== 'running' || this.launches.get(taskId) !== launch) return;
        round = this.currentRound(task);
        instruction = this.instructions.get(taskId) ?? instruction;
      }
      if (!instruction) {
        // Dead-end if we wait for "proof" with no criteria UI. Fail honestly.
        task.status = 'failed';
        round.status = 'failed';
        round.failureCategory = 'missing_instruction';
        task.revision += 1;
        await this.persist(task);
        return;
      }

      const roundId = round.id;
      const isSkillRun = task.sourceSkillId !== undefined;
      // Freeze instruction-derived success text before the agent acts so baseline is pre-submit.
      if (!isSkillRun && !this.lockedCriteriaRounds.has(this.roundKey(taskId, roundId))) {
        const tabOrigin = task.targetRefs.find(ref => ref.kind === 'page')?.urlOrigin;
        const implicit = this.extractImplicitCompletionCriteria(instruction, tabOrigin);
        if (implicit.length > 0) {
          await this.freezeCriteria(taskId, roundId, implicit);
        }
      }
      let driver: ExecutorDriver;
      try {
        driver = await this.deps.createExecutor(
          {
            taskId,
            roundId,
            instruction,
            tabId: task.activeTabId,
            plan: task.plan
              ? {
                  id: task.plan.id,
                  goal: task.plan.goal,
                  phases: task.plan.phases.map(phase => ({
                    id: phase.id,
                    title: phase.title,
                    status: phase.status,
                  })),
                }
              : undefined,
          },
          this.executorHooks(taskId),
        );
      } finally {
        if (isSkillRun) this.instructions.delete(taskId);
      }

      task = await getTask(taskId);
      if (
        !task ||
        task.status !== 'running' ||
        this.launches.get(taskId) !== launch ||
        task.currentRoundId !== roundId
      ) {
        await driver.stop();
        if (task?.status === 'running' && this.launches.get(taskId) === launch) {
          this.launches.delete(taskId);
          void this.runCurrentRound(taskId);
        }
        return;
      }

      this.drivers.set(taskId, driver);
      this.launches.delete(taskId);
      await this.runDriver(taskId, driver, roundId, instruction);
    } catch (error) {
      // Surface start failures (missing model, createExecutor throw) on the round for UI.
      const category =
        error instanceof Error && /noApiKeys|noNavigator|noProvider|setup/i.test(error.message)
          ? 'setup_failed'
          : 'executor_start_failed';
      await this.queueTransition(async () => {
        const task = await getTask(taskId);
        if (!task || task.status !== 'running') return;
        task.status = 'failed';
        const round = this.currentRound(task);
        round.status = 'failed';
        round.failureCategory = category;
        task.revision += 1;
        await this.persist(task);
      });
    } finally {
      if (this.launches.get(taskId) === launch) this.launches.delete(taskId);
    }
  }

  private async runDriver(
    taskId: string,
    driver: ExecutorDriver,
    initialRoundId: string,
    instruction: string,
  ): Promise<void> {
    let runRoundId = initialRoundId;
    let verificationRetries = 0;
    let researchDecisionRetries = 0;
    for (;;) {
      const outcome = await driver.run(runRoundId);
      let task = await getTask(taskId);
      if (!this.canApplyDriverOutcome(task, taskId, driver)) return;
      if (task.currentRoundId !== runRoundId) {
        runRoundId = task.currentRoundId;
        verificationRetries = 0;
        continue;
      }
      const researchQuotas = extractResearchQuotas(instruction);
      const researchWorkCycleLimit = researchQuotas ? maxResearchWorkCycles(researchQuotas) : 0;
      if (outcome.kind !== 'candidate_complete') {
        if (outcome.kind === 'failed' && researchQuotas && requiresStructuredResearchDecision(instruction)) {
          const evidenceSpace = await getEvidenceSpace(taskId);
          const progress = evidenceSpaceProgress(evidenceSpace);
          if (
            researchQuotasMet(researchQuotas, progress) &&
            !researchDecisionReady(evidenceSpace) &&
            isRecoverableResearchDecisionFailure(outcome.category) &&
            researchDecisionRetries < MAX_RESEARCH_DECISION_RETRIES
          ) {
            researchDecisionRetries += 1;
            driver.addFollowUp(
              `The research collection gates are already complete. The previous structured decision attempt failed with ${outcome.category}. Do not browse, explain, or finish. Call record_research_decision now with exactly 3 capabilities. For every capability use these exact keys: title, user_moment, behavior_change, why_now, why_others_later, implementation_distance, mvp, success_metric, user_evidence_ids, product_evidence_ids, repository_evidence_ids. Also include top-level deferred and contradictions. Correct only the output shape or missing values, then retry the action.`,
            );
            continue;
          }
        }
        if (outcome.kind === 'failed' && researchQuotas && isRecoverableResearchFailure(outcome.category)) {
          const evidenceSpace = await getEvidenceSpace(taskId);
          const progress = evidenceSpaceProgress(evidenceSpace);
          const workCycles = evidenceSpace?.workCycles ?? 0;
          if (!researchQuotasMet(researchQuotas, progress) && workCycles < researchWorkCycleLimit - 1) {
            await advanceEvidenceWorkCycle(taskId, this.deps.now());
            driver.addFollowUp(
              outcome.category === 'evidence_required'
                ? `${renderResearchCheckpoint(researchQuotas, progress)} The current page is substantive and unrecorded. Stay on it and call record_evidence again. raw_basis must be copied verbatim from visible page text; do not navigate or finish.`
                : outcome.category === 'source_required'
                  ? `${renderResearchCheckpoint(researchQuotas, progress)} The current page is only search results or a community index. Do not call record_evidence and do not repeat the same search. Open one concrete unread result from this page.`
                  : `${renderResearchCheckpoint(researchQuotas, progress)} Previous cycle ended with ${outcome.category}; abandon the failing source or tactic and use an alternative.`,
            );
            continue;
          }
        }
        let handoffRoundId: string | undefined;
        await this.queueTransition(async () => {
          const current = await getTask(taskId);
          if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
          if (current.currentRoundId !== runRoundId) {
            handoffRoundId = current.currentRoundId;
            return;
          }
          await this.persistTerminalOrWaiting(current, outcome);
        });
        if (handoffRoundId) {
          runRoundId = handoffRoundId;
          verificationRetries = 0;
          continue;
        }
        return;
      }

      if (researchQuotas) {
        const evidenceSpace = await getEvidenceSpace(taskId);
        const progress = evidenceSpaceProgress(evidenceSpace);
        const workCycles = evidenceSpace?.workCycles ?? 0;
        if (!researchQuotasMet(researchQuotas, progress)) {
          if (workCycles < researchWorkCycleLimit - 1) {
            await advanceEvidenceWorkCycle(taskId, this.deps.now());
            driver.addFollowUp(
              `${renderResearchCheckpoint(researchQuotas, progress)} Candidate completion rejected because the durable research quotas are not met. Continue researching.`,
            );
            continue;
          }
          await this.queueTransition(async () => {
            const current = await getTask(taskId);
            if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
            const currentRound = this.currentRound(current);
            current.status = 'failed';
            currentRound.status = 'failed';
            currentRound.failureCategory = 'research_quota_unmet';
            delete currentRound.waitReason;
            current.revision += 1;
            current.updatedAt = this.deps.now();
            await this.persist(current);
          });
          return;
        }
        if (requiresStructuredResearchDecision(instruction) && !researchDecisionReady(evidenceSpace)) {
          if (workCycles < researchWorkCycleLimit - 1) {
            await advanceEvidenceWorkCycle(taskId, this.deps.now());
            driver.addFollowUp(
              'Research quotas are met, but the structured decision gate is not. Inspect the durable evidence space in filtered pages, then use record_research_decision with exactly 3 capabilities, seven answers each, and valid 2 user + 1 product + 1 repository evidence IDs per capability.',
            );
            continue;
          }
          await this.queueTransition(async () => {
            const current = await getTask(taskId);
            if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
            const currentRound = this.currentRound(current);
            current.status = 'failed';
            currentRound.status = 'failed';
            currentRound.failureCategory = 'research_decision_unmet';
            delete currentRound.waitReason;
            current.revision += 1;
            current.updatedAt = this.deps.now();
            await this.persist(current);
          });
          return;
        }
        if (requiresStructuredResearchDecision(instruction) && !researchDeliveryReady(evidenceSpace)) {
          if (workCycles < researchWorkCycleLimit - 1) {
            await advanceEvidenceWorkCycle(taskId, this.deps.now());
            driver.addFollowUp(
              'The structured decision is accepted, but Feishu delivery readback is incomplete. Write the full evidence table and final decision document, reopen each final Feishu page, and call record_research_delivery for research_table and decision_document.',
            );
            continue;
          }
          await this.queueTransition(async () => {
            const current = await getTask(taskId);
            if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
            const currentRound = this.currentRound(current);
            current.status = 'failed';
            currentRound.status = 'failed';
            currentRound.failureCategory = 'research_delivery_unmet';
            delete currentRound.waitReason;
            current.revision += 1;
            current.updatedAt = this.deps.now();
            await this.persist(current);
          });
          return;
        }
        if (requiresStructuredResearchDecision(instruction) && researchDeliveryReady(evidenceSpace)) {
          await this.queueTransition(async () => {
            const current = await getTask(taskId);
            if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
            if (current.currentRoundId !== runRoundId) return;
            const currentRound = this.currentRound(current);
            const answer = outcome.summary.trim();
            if (answer)
              currentRound.instructionSummary = (await redactDeliverableUrlsForPersistence(answer)).slice(0, 2000);
            // The durable decision plus both reopened Feishu readbacks replace any
            // planner-generated user-confirmation criterion for this research contract.
            currentRound.criteria = currentRound.criteria.filter(criterion => criterion.kind !== 'user_confirmed');
            delete currentRound.waitReason;
            delete currentRound.failureCategory;
            await this.persistVerifiedReceipt(current, currentRound, []);
          });
          return;
        }
      }

      if (
        outcome.kind === 'candidate_complete' &&
        deriveInstructionDeliverableContract(this.instructions.get(taskId) ?? '').requiresPageContent
      ) {
        await this.captureCurrentPageEvidence(taskId, runRoundId);
        const withPageEvidence = await getTask(taskId);
        if (withPageEvidence && this.canApplyDriverOutcome(withPageEvidence, taskId, driver)) task = withPageEvidence;
      }

      let round = task.rounds.find(item => item.id === runRoundId);
      if (!round) return;
      if (round.criteria.length === 0) {
        // Live open-site goals often omit planner criteria; re-derive from the instruction
        // while still running so we can verify the page URL and emit a receipt.
        const instruction = this.instructions.get(taskId) ?? '';
        const recoveryDrafts = this.extractImplicitCompletionCriteria(
          instruction,
          task.targetRefs.find(ref => ref.kind === 'page')?.urlOrigin,
        );
        if (recoveryDrafts.length > 0) {
          await this.freezeCriteria(taskId, runRoundId, recoveryDrafts);
          const afterFreeze = await getTask(taskId);
          if (
            afterFreeze &&
            this.canApplyDriverOutcome(afterFreeze, taskId, driver) &&
            afterFreeze.currentRoundId === runRoundId &&
            this.currentRound(afterFreeze).criteria.length > 0
          ) {
            // Freeze may have run after navigate, so baseline already matches the page.
            // Clear baselines so post-act page evidence can pass checkCompletion.
            await this.queueTransition(async () => {
              const current = await getTask(taskId);
              if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
              if (current.currentRoundId !== runRoundId) return;
              if (current.status !== 'running') return;
              const currentRound = this.currentRound(current);
              for (const criterion of currentRound.criteria) {
                if (criterion.kind === 'url') criterion.baseline = '';
                else if (typeof criterion.baseline === 'boolean') criterion.baseline = false;
              }
              current.revision += 1;
              await this.persist(current);
            });
            const recovered = await getTask(taskId);
            if (
              recovered &&
              this.canApplyDriverOutcome(recovered, taskId, driver) &&
              recovered.currentRoundId === runRoundId &&
              this.currentRound(recovered).criteria.length > 0
            ) {
              task = recovered;
              round = this.currentRound(recovered);
            }
          }
        }
      }
      if (round.criteria.length === 0) {
        // Understanding / open-ended goals often have no freezeable criteria.
        // Prefer complete with the model summary (answer) over hang or opaque fail.
        // product/022: when artifacts are present, Independent Verifier must pass first.
        const rawAnswer = outcome.kind === 'candidate_complete' ? outcome.summary.trim() : '';
        const instructionForRound =
          this.instructions.get(taskId) ||
          task.goalSummary ||
          (round.instructionSummary && round.instructionSummary !== 'User instruction'
            ? round.instructionSummary
            : '') ||
          '';
        const artifacts =
          outcome.kind === 'candidate_complete' && Array.isArray(outcome.artifacts) ? outcome.artifacts : [];
        const answer = await this.selectCandidateDeliverableText(
          rawAnswer,
          artifacts,
          instructionForRound,
          this.visitedPageEvidence(task),
        );
        const needsDeliverable = this.instructionRequestsUserDeliverable(instructionForRound);
        const deliverableOk =
          answer.length > 0 &&
          (!needsDeliverable ||
            (await this.hasSubstantiveDeliverableAnswer(answer, instructionForRound, this.visitedPageEvidence(task))));
        let artifactVerified = false;
        if (artifacts.length > 0) {
          const artifactGate = this.verifyArtifactsIndependently(
            artifacts,
            this.instructions.get(taskId) ?? task.goalSummary ?? '',
          );
          artifactVerified = artifactGate.complete;
          const evidence = artifactGate.artifactEvidence ?? [];
          const passedN = evidence.filter(e => e.passed).length;
          const failedN = evidence.filter(e => !e.passed).length;
          const verifySpan = await traceStore.beginSpan({
            taskId,
            roundId: runRoundId,
            kind: 'verify',
            name: 'verify.artifacts',
            startedAt: this.deps.now(),
            data: {
              verdict: artifactGate.verdict,
              artifact_count: artifacts.length,
              // product/022 Trace Gate: Verifier span contract
              criteria: evidence.map(e => e.kind).join(',') || 'none',
              passed: passedN,
              failed: failedN,
              inconclusive: artifactGate.verdict === 'INCONCLUSIVE' ? 1 : 0,
              evidence_ref: artifacts[0]?.id ?? 'none',
            },
          });
          await traceStore.finishSpan(verifySpan, artifactGate.complete ? 'ok' : 'fail');
        }
        let retry = false;
        let handoffRoundId: string | undefined;
        await this.queueTransition(async () => {
          const current = await getTask(taskId);
          if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
          if (current.currentRoundId !== runRoundId) {
            handoffRoundId = current.currentRoundId;
            return;
          }
          const currentRound = this.currentRound(current);
          if (deliverableOk && artifactVerified) {
            // Surface the answer on the round for UI; keep goalSummary generic.
            currentRound.instructionSummary = (await redactDeliverableUrlsForPersistence(answer)).slice(0, 2000);
            delete currentRound.waitReason;
            delete currentRound.failureCategory;
            await this.persistVerifiedReceipt(
              current,
              currentRound,
              [],
              true,
              artifacts.map(artifact => 'artifact:' + artifact.id),
            );
            return;
          }
          if (verificationRetries < 1) {
            current.revision += 1;
            await this.persist(current);
            retry = true;
            return;
          }
          // No deliverable after a bounded retry — fail honestly, never ask for confirmation.
          current.status = 'failed';
          currentRound.status = 'failed';
          currentRound.failureCategory =
            artifacts.length > 0 ? 'artifact_verification_failed' : 'no_completion_criteria';
          delete currentRound.waitReason;
          current.revision += 1;
          current.updatedAt = this.deps.now();
          await this.persist(current);
        });
        if (handoffRoundId) {
          runRoundId = handoffRoundId;
          verificationRetries = 0;
          continue;
        }
        if (retry) {
          verificationRetries += 1;
          driver.addFollowUp(
            artifacts.length > 0
              ? 'The artifact is not independently verified. Inspect the page, add required browser criteria, then return the requested deliverable.'
              : 'No browser completion criterion was verified. Inspect the current page, propose a required observable criterion, and only then return the answer.',
          );
          continue;
        }
        return;
      }
      const instructionForCandidate =
        this.instructions.get(taskId) ||
        task.goalSummary ||
        (round.instructionSummary && round.instructionSummary !== 'User instruction' ? round.instructionSummary : '') ||
        '';
      const candidateArtifacts =
        outcome.kind === 'candidate_complete' && Array.isArray(outcome.artifacts) ? outcome.artifacts : [];
      if (candidateArtifacts.length > 0 && round.criteria.some(item => item.kind === 'user_confirmed')) {
        const automaticCriteria = round.criteria.filter(item => item.kind !== 'user_confirmed');
        let automaticObservations: ProbeObservation[] = [];
        if (automaticCriteria.length > 0) {
          try {
            automaticObservations = await this.observeTaskCriteria(task, automaticCriteria);
          } catch {
            automaticObservations = [];
          }
        }
        const artifactGate = this.verifyArtifactsIndependently(
          candidateArtifacts,
          instructionForCandidate,
          automaticCriteria.length > 0
            ? {
                now: this.deps.now(),
                currentRoundId: round.id,
                criteria: automaticCriteria,
                observations: automaticObservations,
              }
            : undefined,
        );
        if (!artifactGate.complete) {
          let retryArtifact = false;
          let artifactHandoffRoundId: string | undefined;
          await this.queueTransition(async () => {
            const current = await getTask(taskId);
            if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
            if (current.currentRoundId !== runRoundId) {
              artifactHandoffRoundId = current.currentRoundId;
              return;
            }
            const currentRound = this.currentRound(current);
            if (verificationRetries < 1) {
              current.revision += 1;
              await this.persist(current);
              retryArtifact = true;
              return;
            }
            current.status = 'failed';
            currentRound.status = 'failed';
            currentRound.failureCategory = 'artifact_verification_failed';
            delete currentRound.waitReason;
            current.revision += 1;
            await this.persist(current);
          });
          if (artifactHandoffRoundId) {
            runRoundId = artifactHandoffRoundId;
            verificationRetries = 0;
            continue;
          }
          if (retryArtifact) {
            verificationRetries += 1;
            driver.addFollowUp(
              'The text artifact is not browser-grounded. Inspect the page and add a required observable criterion before asking the user to confirm.',
            );
            continue;
          }
          return;
        }
      }
      if (round.criteria.some(item => item.kind === 'user_confirmed')) {
        const automaticCriteria = round.criteria.filter(item => item.kind !== 'user_confirmed');
        let automaticEvidence: CompletionEvidence[] = [];
        if (automaticCriteria.length > 0) {
          let observations: ProbeObservation[] = [];
          try {
            observations = await this.observeTaskCriteria(task, automaticCriteria);
          } catch {
            observations = [];
          }
          automaticEvidence = checkCompletion({
            now: this.deps.now(),
            currentRoundId: round.id,
            criteria: automaticCriteria,
            observations,
          }).evidence;
        }
        let handoffRoundId: string | undefined;
        await this.queueTransition(async () => {
          const current = await getTask(taskId);
          if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
          if (current.currentRoundId !== runRoundId) {
            handoffRoundId = current.currentRoundId;
            return;
          }
          const currentRound = this.currentRound(current);
          currentRound.evidence.push(...automaticEvidence);
          this.syncMissionPlanFromEvidence(current, automaticEvidence);
          await this.persistWaitingUser(current, currentRound, 'proof_required');
        });
        if (handoffRoundId) {
          runRoundId = handoffRoundId;
          verificationRetries = 0;
          continue;
        }
        return;
      }

      let observations: ProbeObservation[] = [];
      try {
        observations = await this.observeTaskCriteria(task, round.criteria);
      } catch {
        observations = [];
      }
      const checked = checkCompletion({
        now: this.deps.now(),
        currentRoundId: round.id,
        criteria: round.criteria,
        observations,
      });
      const rawOutcomeAnswer = outcome.kind === 'candidate_complete' ? outcome.summary.trim() : '';
      // Multi-intent goals like "play + copy first comment" must not complete on media alone.
      const instructionForRound =
        this.instructions.get(taskId) ||
        task.goalSummary ||
        (round.instructionSummary && round.instructionSummary !== 'User instruction' ? round.instructionSummary : '') ||
        '';
      const needsDeliverable = this.instructionRequestsUserDeliverable(instructionForRound);
      const outcomeAnswer = await this.selectCandidateDeliverableText(
        rawOutcomeAnswer,
        candidateArtifacts,
        instructionForRound,
        this.visitedPageEvidence(task),
      );
      const deliverableOk =
        !needsDeliverable ||
        (await this.hasSubstantiveDeliverableAnswer(
          outcomeAnswer,
          instructionForRound,
          this.visitedPageEvidence(task),
        ));
      const artifactGate =
        candidateArtifacts.length > 0
          ? this.verifyArtifactsIndependently(candidateArtifacts, instructionForRound, {
              now: this.deps.now(),
              currentRoundId: round.id,
              criteria: round.criteria,
              observations,
            })
          : null;
      const artifactsVerified = artifactGate?.complete ?? true;
      let retry = false;
      let handoffRoundId: string | undefined;
      await this.queueTransition(async () => {
        const current = await getTask(taskId);
        if (!this.canApplyDriverOutcome(current, taskId, driver)) return;
        if (current.currentRoundId !== round.id) {
          handoffRoundId = current.currentRoundId;
          return;
        }
        const currentRound = this.currentRound(current);
        currentRound.evidence.push(...checked.evidence);
        this.syncMissionPlanFromEvidence(current, checked.evidence);
        // Optional-only criteria must not mint a verified receipt (sticky false complete).
        if (
          allowsVerifiedComplete({
            completionPassed: checked.passed,
            hasRequiredCriteria: currentRound.criteria.some(criterion => criterion.required),
          }) &&
          deliverableOk &&
          artifactsVerified
        ) {
          if (outcomeAnswer.length > 0) {
            currentRound.instructionSummary = (await redactDeliverableUrlsForPersistence(outcomeAnswer)).slice(0, 2000);
          }
          await this.persistVerifiedReceipt(
            current,
            currentRound,
            checked.evidence,
            true,
            candidateArtifacts.map(artifact => 'artifact:' + artifact.id),
          );
          return;
        }
        // Criteria green but user still asked for text we never got — keep working, do not fake done.
        if (
          allowsVerifiedComplete({
            completionPassed: checked.passed,
            hasRequiredCriteria: currentRound.criteria.some(criterion => criterion.required),
          }) &&
          ((!deliverableOk && needsDeliverable) || !artifactsVerified) &&
          verificationRetries < 1
        ) {
          current.revision += 1;
          await this.persist(current);
          retry = true;
          return;
        }
        if (verificationRetries >= 1) {
          if (
            (needsDeliverable && !deliverableOk) ||
            !artifactsVerified ||
            this.isReadOnlyCandidate(instructionForRound)
          ) {
            // Missing requested text is not something the user can prove for us.
            current.status = 'failed';
            currentRound.status = 'failed';
            currentRound.failureCategory = artifactsVerified ? 'no_action' : 'artifact_verification_failed';
            delete currentRound.waitReason;
            current.revision += 1;
            current.updatedAt = this.deps.now();
            await this.persist(current);
            return;
          }
          await this.persistWaitingUser(current, currentRound, 'proof_required');
          return;
        }
        current.revision += 1;
        await this.persist(current);
        retry = true;
      });
      if (handoffRoundId) {
        runRoundId = handoffRoundId;
        verificationRetries = 0;
        continue;
      }
      if (!retry) return;
      const latest = await getTask(taskId);
      if (!this.canApplyDriverOutcome(latest, taskId, driver)) return;
      if (latest.currentRoundId !== runRoundId) {
        runRoundId = latest.currentRoundId;
        verificationRetries = 0;
        continue;
      }
      verificationRetries += 1;
      if (needsDeliverable && !deliverableOk && checked.passed) {
        const missing = (
          await checkInstructionDeliverable(instructionForRound, outcomeAnswer, this.visitedPageEvidence(task))
        ).reasons.join(', ');
        driver.addFollowUp(
          'Page checks passed but the requested deliverable is incomplete (' +
            (missing || 'content') +
            '). Return the requested body text, item count, and distinct full URLs before finishing.',
        );
      } else {
        driver.addFollowUp('Completion was not verified; inspect the current page and continue.');
      }
    }
  }

  /**
   * product/022 Independent Verifier for TaskArtifact deliverables.
   * Does not read Executor reasoning — only artifacts + instruction-derived criteria.
   */
  private verifyArtifactsIndependently(
    artifacts: TaskArtifact[],
    instruction: string,
    completion?: CompletionCheckInput,
  ) {
    const artifactCriteria = this.deriveArtifactCriteria(instruction, artifacts);
    return verifyCandidateComplete({
      artifacts,
      artifactCriteria,
      ...(completion ? { completion } : {}),
    });
  }

  private deriveArtifactCriteria(instruction: string, artifacts: TaskArtifact[]) {
    const text = instruction.replace(/\s+/g, ' ').trim();
    const criteria: ArtifactCriterion[] = [{ kind: 'artifact_exists' }];
    const wantsTable =
      /\b(csv|table)\b/i.test(text) ||
      /表格|清单/.test(text) ||
      artifacts.some(a => a.type === 'table' || a.type === 'recordset');
    if (wantsTable) {
      const explicitFields = extractExplicitTableFields(text);
      if (explicitFields.length > 0) {
        criteria.push({
          kind: 'artifact_schema',
          expected: explicitFields,
        });
      }
      const minRows = /\b(\d+)\b/.exec(text)?.[1];
      const expectedRows = minRows ? Number(minRows) : 1;
      // For extract tasks require at least 1 row; if user said N, require N.
      criteria.push({
        kind: 'artifact_row_count',
        operator: '>=',
        expected: Number.isFinite(expectedRows) && expectedRows > 0 ? expectedRows : 1,
      });
      criteria.push({ kind: 'artifact_source_count', operator: '>=', expected: 1 });
    }
    return criteria;
  }

  private textFromArtifact(artifact: TaskArtifact): string {
    if (artifact.type !== 'text' || !artifact.data || typeof artifact.data !== 'object') return '';
    const text = (artifact.data as { text?: unknown }).text;
    return typeof text === 'string' ? text.trim() : '';
  }

  /**
   * A text artifact is allowed to carry the chat deliverable, but mere artifact
   * existence is not enough. Prefer the first candidate that satisfies the same
   * instruction-derived contract used for ordinary model summaries.
   */
  private async selectCandidateDeliverableText(
    summary: string,
    artifacts: TaskArtifact[],
    instruction: string,
    pageEvidence?: Iterable<DeliverableEvidenceInput>,
  ): Promise<string> {
    const artifactTexts = artifacts.map(artifact => this.textFromArtifact(artifact)).filter(Boolean);
    const candidates = [summary.trim(), ...artifactTexts];
    if (artifactTexts.length > 1) candidates.push(artifactTexts.join('\n'));
    for (const candidate of candidates) {
      if ((await checkInstructionDeliverable(instruction, candidate, pageEvidence)).passed) return candidate;
    }
    return candidates.find(Boolean) ?? '';
  }

  private visitedPageEvidence(task: TaskSession): DeliverablePageEvidence[] {
    return task.targetRefs.flatMap(target =>
      target.kind === 'page' && target.normalizedUrl
        ? [
            {
              normalizedUrl: target.normalizedUrl,
              ...(target.queryIdentityDigest ? { queryIdentityDigest: target.queryIdentityDigest } : {}),
              ...(target.textDigests?.length ? { textDigests: target.textDigests } : {}),
              ...(target.pageRevision ? { pageRevision: target.pageRevision } : {}),
              ...(target.visitSeq !== undefined ? { visitSeq: target.visitSeq } : {}),
              ...(target.label ? { label: target.label } : {}),
            },
          ]
        : [],
    );
  }

  /** User expects content returned in chat (comment, copy, summary), not only page side-effects. */
  private instructionRequestsUserDeliverable(instruction: string): boolean {
    return deriveInstructionDeliverableContract(instruction).required;
  }

  private instructionRequestsReadOnlyPageDeliverable(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    const referencesCurrentPage =
      /(?:当前|这个|本)(?:[^。！？!?]{0,20})?(?:页面|网页|网站|标签页)|(?:页面|网页)(?:上|中|展示|内容)/.test(text) ||
      /\b(?:this|the|current)\s+(?:page|webpage|site|tab)\b/i.test(text);
    const requestsReading =
      /说明|描述|总结|摘要|概括|读取|读一下|提取|摘录|展示的内容|是什么|有哪些/.test(text) ||
      /\b(?:summari[sz]e|describe|read|extract|quote|tell me|what(?:'s| is)|what are)\b/i.test(text);
    return referencesCurrentPage && requestsReading;
  }

  private isReadOnlyCandidate(instruction: string): boolean {
    return this.instructionRequestsReadOnlyPageDeliverable(instruction) || isUnderstandingOnlyInstruction(instruction);
  }

  private instructionUsesReadOnlyBrowserEvidence(instruction: string): boolean {
    return this.isReadOnlyCandidate(instruction);
  }

  private async hasSubstantiveDeliverableAnswer(
    summary: string,
    goalText = '',
    pageEvidence?: Iterable<DeliverableEvidenceInput>,
  ): Promise<boolean> {
    return (await checkInstructionDeliverable(goalText, summary, pageEvidence)).passed;
  }

  private canApplyDriverOutcome(task: TaskSession | null, taskId: string, driver: ExecutorDriver): task is TaskSession {
    return Boolean(task && this.drivers.get(taskId) === driver && task.status === 'running');
  }

  /**
   * Probe completion against the task's bound tab, not whatever tab is currently
   * focused (side-panel tabs / e2e focus steal would otherwise miss page_text).
   * tab_state / download_state do not require a live page attach (closed tabs).
   */
  private async observeTaskCriteria(task: TaskSession, criteria: CompletionCriterion[]): Promise<ProbeObservation[]> {
    const now = this.deps.now();
    const tabCriteria = criteria.filter(criterion => criterion.kind === 'tab_state');
    const downloadCriteria = criteria.filter(criterion => criterion.kind === 'download_state');
    const pageCriteria = criteria.filter(
      criterion => criterion.kind !== 'tab_state' && criterion.kind !== 'download_state',
    );

    const tabObservations: ProbeObservation[] = [];
    for (const criterion of tabCriteria) {
      const tabId = this.tabIdFromTargetRef(criterion.targetRefId) ?? task.activeTabId;
      const state = await this.probeTabState(tabId);
      tabObservations.push({
        criterionId: criterion.id,
        roundId: criterion.roundId,
        targetRefId: criterion.targetRefId.startsWith('tab-') ? criterion.targetRefId : `tab-${tabId}`,
        observedAt: now,
        source: 'page',
        value: state === 'closed' ? 'closed' : state === 'active' ? 'active' : 'inactive',
      });
    }

    const downloadObservations: ProbeObservation[] = [];
    for (const criterion of downloadCriteria) {
      const state = await this.probeDownloadState();
      downloadObservations.push({
        criterionId: criterion.id,
        roundId: criterion.roundId,
        targetRefId: criterion.targetRefId,
        observedAt: now,
        source: 'page',
        value: state,
      });
    }

    let pageObservations: ProbeObservation[] = [];
    if (pageCriteria.length > 0) {
      if (Number.isSafeInteger(task.activeTabId)) {
        try {
          await this.deps.switchTab(task.activeTabId);
        } catch {
          // Tab may have been closed; page criteria then simply miss.
        }
      }
      pageObservations = await this.deps.observeCriteria(pageCriteria);
    }
    return [...tabObservations, ...downloadObservations, ...pageObservations];
  }

  private tabIdFromTargetRef(targetRefId: string): number | undefined {
    if (!targetRefId.startsWith('tab-')) return undefined;
    const n = Number(targetRefId.slice(4));
    return Number.isSafeInteger(n) ? n : undefined;
  }

  private applyOutcome(task: TaskSession, outcome: ExecutorOutcome): void {
    const round = this.currentRound(task);
    switch (outcome.kind) {
      case 'candidate_complete':
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = 'proof_required';
        break;
      case 'waiting_user':
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = outcome.reason;
        break;
      case 'paused':
        task.status = 'paused';
        round.status = 'paused';
        break;
      case 'cancelled':
        task.status = 'cancelled';
        round.status = 'cancelled';
        break;
      case 'failed':
        task.status = 'failed';
        round.status = 'failed';
        round.failureCategory = outcome.category || 'unknown';
        break;
    }
  }

  private async freezeCriteria(
    taskId: string,
    expectedRoundId: string,
    drafts: CompletionCriterionDraft[],
  ): Promise<void> {
    const instructionForFreeze = this.instructions.get(taskId) ?? '';
    const readOnlyBrowserEvidence = this.instructionUsesReadOnlyBrowserEvidence(instructionForFreeze);
    let boundPageTarget: TaskSession['targetRefs'][number] | undefined;
    if (readOnlyBrowserEvidence && drafts.some(draft => draft.kind === 'page_text')) {
      try {
        const { browserContext } = await import('../agent/factory');
        const page = await browserContext.getCurrentPage();
        const observation = await page.observeActionTarget('read_page_text', {}, 'after');
        if (observation.target.kind === 'page') boundPageTarget = observation.target;
      } catch {
        // Missing semantic capture intentionally keeps the deliverable unverified.
      }
    }
    await this.queueTransition(async () => {
      const task = await getTask(taskId);
      if (!task || task.status !== 'running' || task.currentRoundId !== expectedRoundId) return;
      const round = this.currentRound(task);
      if (round.criteria.length > 0 || drafts.length === 0) return;
      const frozenAt = this.deps.now();
      const tabTargetRefId = `tab-${task.activeTabId}`;
      const latestMediaTarget = [...task.targetRefs].reverse().find(target => target.kind === 'media');
      const userFieldValues = this.extractUserFieldValues(this.instructions.get(taskId) ?? '');
      const copiedFieldCriterion = drafts.some(
        draft => draft.kind === 'page_text' && userFieldValues.has(draft.expected.replace(/\s+/g, ' ').trim()),
      );
      const criteria = await Promise.all(
        drafts
          .slice(0, 8)
          .map(draft =>
            this.freezeCriterion(
              draft,
              round.id,
              draft.kind === 'media_state' && latestMediaTarget
                ? latestMediaTarget.id
                : draft.kind === 'download_state'
                  ? 'download:session'
                  : tabTargetRefId,
              frozenAt,
              userFieldValues,
            ),
          ),
      );
      // Baseline must probe the task tab. Side-panel / e2e focus would otherwise
      // rewrite targetRefId + activeTabId to the wrong page and break post-commit verify.
      const baseline = await this.observeTaskCriteria(task, criteria);
      const pageObservations = baseline.filter(
        observation =>
          observation.source === 'page' &&
          observation.roundId === round.id &&
          /^(?:tab-\d+|media:[a-f0-9]{64}|download:session)$/.test(observation.targetRefId),
      );
      const observedTabTargets = new Set(
        pageObservations.map(observation => observation.targetRefId).filter(target => target.startsWith('tab-')),
      );
      if (boundPageTarget) {
        const index = task.targetRefs.findIndex(item => item.id === boundPageTarget.id);
        const existing = index >= 0 ? task.targetRefs[index] : undefined;
        const visitSeq = task.targetRefs.reduce((max, item) => Math.max(max, item.visitSeq ?? 0), 0) + 1;
        const nextTarget = { ...existing, ...boundPageTarget, visitSeq };
        if (!boundPageTarget.textDigests?.length) delete nextTarget.textDigests;
        if (!boundPageTarget.bodyDigest) delete nextTarget.bodyDigest;
        if (!boundPageTarget.pageRevision) delete nextTarget.pageRevision;
        if (!boundPageTarget.queryIdentityDigest) delete nextTarget.queryIdentityDigest;
        if (index >= 0) task.targetRefs[index] = nextTarget;
        else task.targetRefs.push(nextTarget);
      }
      for (const criterion of criteria) {
        const observation = pageObservations.find(item => item.criterionId === criterion.id);
        if (boundPageTarget && criterion.kind === 'page_text') {
          criterion.targetRefId = boundPageTarget.id;
          criterion.pageRevision = boundPageTarget.pageRevision;
        } else if (observation) criterion.targetRefId = observation.targetRefId;
        criterion.baseline =
          readOnlyBrowserEvidence && (criterion.kind === 'page_text' || criterion.kind === 'url')
            ? false
            : (observation?.value ?? false);
      }
      if (observedTabTargets.size === 1) {
        const observedTabId = Number([...observedTabTargets][0].slice(4));
        if (Number.isSafeInteger(observedTabId)) task.activeTabId = observedTabId;
      }
      if (task.currentRoundId !== expectedRoundId) return;
      round.criteria = criteria;
      // First freeze: bind criterion ids onto the active mission phase (if empty).
      if (task.plan) {
        task.plan = attachCriteriaAcrossMissionPlan(
          task.plan,
          criteria.map(item => item.id),
          this.deps.now(),
        );
      }
      const key = this.roundKey(task.id, round.id);
      const templates = this.templatesFromCriteria(drafts, criteria);
      this.criterionTemplates.set(key, templates);
      if (copiedFieldCriterion) this.unsafeSkillCriteriaRounds.add(key);
      else this.unsafeSkillCriteriaRounds.delete(key);
      await putSkillSaveMeta(task.id, round.id, {
        templates: structuredClone(templates),
        unsafe: copiedFieldCriterion,
      });
      task.revision += 1;
      await this.persist(task);
    });
  }

  private async freezeSkillCriteria(
    templates: CompletionCriterionTemplate[],
    roundId: string,
    tabId: number,
  ): Promise<CompletionCriterion[]> {
    if (templates.length === 0 || templates.some(template => JSON.stringify(template).includes('{{'))) {
      throw new Error('invalid_skill_criterion');
    }
    const drafts = templates.map(template => this.skillTemplateDraft(template));
    const frozenAt = this.deps.now();
    const criteria = await Promise.all(
      drafts.map(draft => this.freezeCriterion(draft, roundId, `tab-${tabId}`, frozenAt, new Set())),
    );
    // Skill freeze is bound to the start command tab; never baseline against focus drift.
    if (Number.isSafeInteger(tabId)) {
      await this.deps.switchTab(tabId);
    }
    const baseline = await this.deps.observeCriteria(criteria);
    const observations = baseline.filter(
      observation =>
        observation.source === 'page' &&
        observation.roundId === roundId &&
        /^(?:tab-\d+|media:[a-f0-9]{64}|download:session)$/.test(observation.targetRefId),
    );
    for (const criterion of criteria) {
      const observation = observations.find(item => item.criterionId === criterion.id);
      if (observation) criterion.targetRefId = observation.targetRefId;
      criterion.baseline = observation?.value ?? false;
    }
    return criteria;
  }

  private skillTemplateDraft(template: CompletionCriterionTemplate): CompletionCriterionDraft {
    switch (template.kind) {
      case 'url':
      case 'page_text':
        return { ...template, expected: template.expectedTemplate };
      case 'element_state':
      case 'media_state':
      case 'tab_state':
      case 'download_state':
      case 'user_confirmed':
        return template;
    }
  }

  private templatesFromCriteria(
    drafts: CompletionCriterionDraft[],
    criteria: CompletionCriterion[],
  ): CompletionCriterionTemplate[] {
    return criteria.map((criterion, index) => {
      const draft = drafts[index];
      switch (criterion.kind) {
        case 'url':
          return {
            kind: 'url',
            operator: criterion.operator,
            expectedTemplate: criterion.expected,
            required: criterion.required,
          };
        case 'page_text': {
          if (draft?.kind !== 'page_text') throw new Error('Page-text criterion draft is missing');
          return {
            kind: 'page_text',
            operator: criterion.operator,
            expectedTemplate: draft.expected.replace(/\s+/g, ' ').trim(),
            required: criterion.required,
          };
        }
        case 'element_state':
          return {
            kind: 'element_state',
            operator: criterion.operator,
            expected: criterion.expected,
            required: criterion.required,
          };
        case 'media_state':
          return {
            kind: 'media_state',
            operator: criterion.operator,
            expected: criterion.expected,
            required: criterion.required,
          };
        case 'tab_state':
          return {
            kind: 'tab_state',
            operator: criterion.operator,
            expected: criterion.expected,
            required: criterion.required,
          };
        case 'download_state':
          return {
            kind: 'download_state',
            operator: criterion.operator,
            expected: criterion.expected,
            required: criterion.required,
          };
        case 'user_confirmed':
          return { kind: 'user_confirmed', operator: 'equals', expected: true, required: criterion.required };
      }
    });
  }

  private roundKey(taskId: string, roundId: string): string {
    return `${taskId}:${roundId}`;
  }

  private async freezeCriterion(
    draft: CompletionCriterionDraft,
    roundId: string,
    targetRefId: string,
    frozenAt: number,
    userFieldValues: Set<string>,
  ): Promise<CompletionCriterion> {
    const base = {
      id: crypto.randomUUID(),
      roundId,
      targetRefId,
      required: draft.required,
      frozenAt,
      notBefore: frozenAt,
      // Real agent loops + async page rewrites need more than a few seconds after commit.
      timeoutMs: 120_000,
      baseline: false,
    };
    switch (draft.kind) {
      case 'url': {
        const expected = await durableHttpCompletionUrl(draft.expected);
        if (!expected) throw new Error('invalid_url_criterion');
        return { ...base, kind: 'url', operator: draft.operator, expected };
      }
      case 'page_text': {
        const normalized = draft.expected.replace(/\s+/g, ' ').trim();
        if (!normalized || normalized.length > 160 || userFieldValues.has(normalized)) {
          return { ...base, kind: 'user_confirmed', operator: 'equals', expected: true };
        }
        return {
          ...base,
          kind: 'page_text',
          operator: draft.operator,
          expectedDigest: await sha256(normalized),
        };
      }
      case 'user_confirmed':
        return { ...base, kind: 'user_confirmed', operator: 'equals', expected: true };
      case 'element_state':
        return { ...base, kind: 'user_confirmed', operator: 'equals', expected: true };
      case 'media_state':
        return { ...base, kind: 'media_state', operator: draft.operator, expected: draft.expected };
      case 'tab_state':
        return { ...base, kind: 'tab_state', operator: draft.operator, expected: draft.expected };
      case 'download_state':
        return { ...base, kind: 'download_state', operator: draft.operator, expected: draft.expected };
    }
  }

  /**
   * When the planner omits completion_criteria, recover observable success signals from the user goal.
   * - Open-site goals ("打开 YouTube" / "open youtube") → url starts_with origin
   * - Open + open first video ("打开YouTube并点击第一个视频") → url starts_with /watch (or site equivalent)
   * - Explicit success text ("success is Saved successfully" / "until you see Done") → page_text
   */
  private extractImplicitCompletionCriteria(instruction: string, tabOrigin?: string): CompletionCriterionDraft[] {
    const drafts: CompletionCriterionDraft[] = [];
    const seen = new Set<string>();
    const fieldValues = this.extractUserFieldValues(instruction);

    // Explicit absolute URLs in the goal (long-horizon: "打开 https://en.wikipedia.org/wiki/…").
    for (const match of instruction.matchAll(/https?:\/\/[^\s"'<>，。；;]+/gi)) {
      try {
        const parsed = new URL(match[0].replace(/[)\].,，。]+$/, ''));
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
        const expected = `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
        if (!seen.has(expected)) {
          seen.add(expected);
          drafts.push({ kind: 'url', operator: 'starts_with', expected, required: true });
        }
      } catch {
        /* ignore bad URL */
      }
    }
    // Wikipedia article path without full host: wiki/Artificial_intelligence
    for (const match of instruction.matchAll(/\bwiki\/([A-Za-z0-9_().%-]+)/g)) {
      const slug = match[1];
      if (!slug) continue;
      const expected = `https://en.wikipedia.org/wiki/${slug}`;
      if (!seen.has(expected)) {
        seen.add(expected);
        drafts.push({ kind: 'url', operator: 'starts_with', expected, required: true });
      }
    }
    // Common long-horizon wiki title without URL: "Artificial intelligence 条目"
    if (
      /Artificial\s+intelligence/i.test(instruction) &&
      /条目|wiki|维基/i.test(instruction) &&
      !seen.has('https://en.wikipedia.org/wiki/Artificial_intelligence')
    ) {
      seen.add('https://en.wikipedia.org/wiki/Artificial_intelligence');
      drafts.push({
        kind: 'url',
        operator: 'starts_with',
        expected: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
        required: true,
      });
    }

    let completionUrl = this.extractOpenSiteCompletionUrl(instruction);
    // Already on bilibili/youtube + "open first video" (no "打开 bilibili" in text).
    if (!completionUrl && tabOrigin && this.instructionRequestsOpenMedia(instruction)) {
      try {
        const originUrl =
          tabOrigin.startsWith('http://') || tabOrigin.startsWith('https://') ? tabOrigin : `https://${tabOrigin}`;
        completionUrl = this.mediaWatchUrlForSite(originUrl);
      } catch {
        completionUrl = null;
      }
    }
    if (completionUrl && !seen.has(completionUrl)) {
      seen.add(completionUrl);
      drafts.push({ kind: 'url', operator: 'starts_with', expected: completionUrl, required: true });
    }

    const patterns = [
      /\bsuccess\s+is\s+["'“]?([^"'”.;\n]+)/gi,
      /\buntil\s+(?:you\s+)?(?:see|seeing)\s+["'“]?([^"'”.;\n]+)/gi,
      /成功(?:标志|信号|文案|是|为)?\s*[:：]?\s*["'「]?([^"'」.;。\n]+)/g,
      /看到\s*["'“「]?([^"'”」.;。\n]{2,80}?)(?=\s*["'”」]?\s*后\s*(?:[，,]\s*)?(?:完成|结束)|["'”」.;。\n]|$)/g,
    ];
    for (const pattern of patterns) {
      for (const match of instruction.matchAll(pattern)) {
        const expected = match[1]?.replace(/\s+/g, ' ').trim();
        if (!expected || expected.length > 160 || seen.has(expected) || fieldValues.has(expected)) continue;
        seen.add(expected);
        drafts.push({ kind: 'page_text', operator: 'present', expected, required: true });
      }
    }

    // T0 control goals: freeze observable criteria so model verbal done cannot complete alone.
    if (this.instructionRequestsCloseTab(instruction) && !seen.has('tab_state:closed')) {
      seen.add('tab_state:closed');
      drafts.push({ kind: 'tab_state', operator: 'equals', expected: 'closed', required: true });
    }
    if (this.instructionRequestsDownload(instruction) && !seen.has('download_state:finished')) {
      seen.add('download_state:finished');
      drafts.push({ kind: 'download_state', operator: 'equals', expected: 'finished', required: true });
    }
    // Media play/pause only when not an "open first video" navigation goal.
    if (!this.instructionRequestsOpenMedia(instruction) && !completionUrl) {
      if (this.instructionRequestsMediaPause(instruction) && !seen.has('media_state:paused')) {
        seen.add('media_state:paused');
        drafts.push({ kind: 'media_state', operator: 'equals', expected: 'paused', required: true });
      } else if (this.instructionRequestsMediaPlay(instruction) && !seen.has('media_state:playing')) {
        seen.add('media_state:playing');
        drafts.push({ kind: 'media_state', operator: 'equals', expected: 'playing', required: true });
      }
    }

    return drafts.slice(0, 3);
  }

  private instructionRequestsCloseTab(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /关掉(这个)?(页|标签|标签页|tab)?/i.test(text) ||
      /关闭(这个)?(页|标签|标签页|窗口)/.test(text) ||
      /关页/.test(text) ||
      /close\s+(this\s+)?(tab|page|window)/i.test(text) ||
      /close\s+the\s+(current\s+)?(tab|page)/i.test(text)
    );
  }

  private instructionRequestsDownload(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /下载(这个|该|一下)?(视频|影片|音频|文件|内容)?/.test(text) ||
      /\bdownload\s+(this\s+)?(video|audio|file|media)?\b/i.test(text)
    );
  }

  private instructionRequestsMediaPause(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /暂停/.test(text) ||
      /停一下/.test(text) ||
      /停下/.test(text) ||
      /停止播放/.test(text) ||
      /\bpause\b/i.test(text) ||
      /\bstop\s+(the\s+)?(video|audio|media|playback)\b/i.test(text)
    );
  }

  private instructionRequestsMediaPlay(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /播放/.test(text) ||
      /继续播/.test(text) ||
      /开始播/.test(text) ||
      /\bplay\b/i.test(text) ||
      /\bresume\s+(the\s+)?(video|audio|media|playback)\b/i.test(text)
    );
  }

  /**
   * Resolve the strongest url criterion for an open-site style goal.
   * Plain open → site origin. Open + click/play first video → watch/player path.
   */
  private extractOpenSiteCompletionUrl(instruction: string): string | null {
    const siteUrl = this.extractOpenSiteUrl(instruction);
    if (!siteUrl) return null;
    if (this.instructionRequestsOpenMedia(instruction)) {
      return this.mediaWatchUrlForSite(siteUrl) ?? siteUrl;
    }
    return siteUrl;
  }

  /** True when the user asked to open/click/play a video, not only land on the site home. */
  private instructionRequestsOpenMedia(instruction: string): boolean {
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return false;
    return (
      /点击.{0,32}(视频|影片)/.test(text) ||
      /打开.{0,48}(视频|影片)/.test(text) ||
      /看.{0,16}(一个|第一个|首个)?(视频|影片)/.test(text) ||
      /click.{0,40}(the\s+)?(first\s+)?video/i.test(text) ||
      /open.{0,48}(and\s+)?(play|watch).{0,24}video/i.test(text) ||
      /watch\s+(the\s+)?(first\s+)?video/i.test(text) ||
      /play\s+(the\s+)?(first\s+)?video/i.test(text)
    );
  }

  /** Site-specific watch/player URL prefix used as starts_with evidence. */
  private mediaWatchUrlForSite(siteUrl: string): string | null {
    try {
      const host = new URL(siteUrl).hostname.toLowerCase();
      if (
        host === 'youtu.be' ||
        host === 'www.youtube.com' ||
        host === 'youtube.com' ||
        host.endsWith('.youtube.com')
      ) {
        return 'https://www.youtube.com/watch';
      }
      if (host === 'www.bilibili.com' || host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
        return 'https://www.bilibili.com/video';
      }
    } catch {
      return null;
    }
    return null;
  }

  /** Map well-known "open / 打开 <site>" goals to a stable https origin for url criteria. */
  private extractOpenSiteUrl(instruction: string): string | null {
    const OPEN_SITE_URLS: Record<string, string> = {
      youtube: 'https://www.youtube.com',
      'you tube': 'https://www.youtube.com',
      油管: 'https://www.youtube.com',
      google: 'https://www.google.com',
      github: 'https://github.com',
      bilibili: 'https://www.bilibili.com',
      哔哩哔哩: 'https://www.bilibili.com',
      b站: 'https://www.bilibili.com',
    };
    const text = instruction.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    // Optional whitespace: users often write "打开YouTube" without a space.
    const match =
      text.match(/^\s*(?:打开|open)\s*(?:一下\s*|the\s+)?(.+?)\s*$/i) ||
      text.match(/(?:打开|open)\s*(?:一下\s*|the\s+)?(youtube|you\s*tube|google|github|bilibili|油管|哔哩哔哩|b站)\b/i);
    if (!match?.[1]) return null;
    const raw = match[1].replace(/\s+/g, ' ').trim().toLowerCase();
    if (!raw) return null;
    if (OPEN_SITE_URLS[raw]) return OPEN_SITE_URLS[raw];
    for (const [name, url] of Object.entries(OPEN_SITE_URLS)) {
      if (raw.includes(name)) return url;
    }
    // Bare host / URL fragment: "open example.com" or "打开 https://example.com/foo"
    try {
      const asUrl = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
      const parsed = new URL(asUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      if (!parsed.hostname.includes('.')) return null;
      return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    } catch {
      return null;
    }
  }

  private extractUserFieldValues(instruction: string): Set<string> {
    const values = new Set<string>();
    const addValue = (candidate: string | undefined) => {
      const value = candidate
        ?.replace(/\s+/g, ' ')
        .trim()
        .replace(/^["'“]|["'”]$/g, '');
      if (value) values.add(value);
    };
    for (const match of instruction.matchAll(/(?:=|:|：)\s*["']?([^,;\n"']{1,160})/g)) {
      addValue(match[1]);
    }
    const naturalLanguagePatterns = [
      /\b(?:fill|enter|type|put)\s+["“']?(.{1,160}?)["”']?\s+(?:into|in)\b/gi,
      /\bwith\s+["“']?(.{1,160}?)["”']?(?=\s+(?:and|then|at)\b|[,;.\n]|$)/gi,
      /\bset\s+[^,;\n]{1,60}?\s+to\s+["“']?(.{1,160}?)["”']?(?=\s+(?:and|then)\b|[,;.\n]|$)/gi,
      /(?:字段|栏)(?:中)?(?:填写|输入|填入|设为)\s*["“']?([^,，;；。\n"”']{1,80})/g,
      /(?:填写|输入|填入)\s*["“']?([^,，;；。\n"”']{1,80}?)["”']?\s*(?:到|至|进|在)/g,
    ];
    for (const pattern of naturalLanguagePatterns) {
      for (const match of instruction.matchAll(pattern)) addValue(match[1]);
    }
    for (const match of instruction.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d{3}-\d{2}-\d{4}\b/g)) {
      addValue(match[0]);
    }
    return values;
  }

  private async confirmCompletion(
    task: TaskSession,
    command: Extract<TaskCommand, { type: 'confirm_completion' }>,
  ): Promise<CommandAck> {
    const round = task.rounds.find(item => item.id === command.roundId);
    const criterion = round?.criteria.find(item => item.id === command.criterionId);
    const alreadyConfirmed = round?.evidence.some(
      item => item.criterionId === command.criterionId && item.source === 'user' && item.passed,
    );
    if (
      task.status !== 'waiting_user' ||
      task.currentRoundId !== command.roundId ||
      round?.waitReason !== 'proof_required' ||
      !criterion ||
      criterion.kind !== 'user_confirmed' ||
      alreadyConfirmed
    ) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }
    const observation: ProbeObservation = {
      criterionId: criterion.id,
      roundId: round.id,
      targetRefId: criterion.targetRefId,
      observedAt: this.deps.now(),
      source: 'user',
      value: true,
    };
    const priorObservations = round.evidence
      .filter(item => item.passed)
      .map(item => ({
        criterionId: item.criterionId,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: item.observedAt,
        source: item.source,
        value: item.value,
      }));
    const checked = checkCompletion({
      now: this.deps.now(),
      currentRoundId: round.id,
      criteria: round.criteria,
      observations: [...priorObservations, observation],
    });
    const confirmedEvidence = checked.evidence.find(
      item => item.criterionId === criterion.id && item.source === 'user' && item.passed,
    );
    if (!confirmedEvidence) return this.reject(task, command.commandId, 'invalid_transition');
    round.evidence.push(confirmedEvidence);
    this.syncMissionPlanFromEvidence(task, checked.evidence);
    const ack = this.accept(task, command.commandId);
    if (checked.passed) await this.persistVerifiedReceipt(task, round, checked.evidence, false);
    else await this.persist(task);
    return ack;
  }

  private async persistTerminalOrWaiting(task: TaskSession, outcome: ExecutorOutcome): Promise<void> {
    this.applyOutcome(task, outcome);
    task.revision += 1;
    await this.persist(task);
  }

  private async persistWaitingUser(
    task: TaskSession,
    round: TaskRound,
    reason: TaskRound['waitReason'],
  ): Promise<void> {
    task.status = 'waiting_user';
    round.status = 'waiting_user';
    round.waitReason = reason;
    task.revision += 1;
    await this.persist(task);
  }

  /**
   * Apply passed criterion evidence to the mission plan and advance phases when
   * the active phase's criteria are fully satisfied. Action counts never advance
   * user-visible phases because browser operations are not outcome progress.
   */
  private syncMissionPlanFromEvidence(task: TaskSession, evidence: CompletionEvidence[]): void {
    if (!task.plan) return;
    const now = this.deps.now();
    const passedIds = evidence.filter(item => item.passed).map(item => item.criterionId);
    let plan = task.plan;
    if (passedIds.length > 0) {
      plan =
        plan.phases.length === 1
          ? applySinglePhaseEvidence(plan, passedIds, now)
          : applyPassedCriteriaToMissionPlan(plan, passedIds, now);
    }
    task.plan = plan;
  }

  private async persistVerifiedReceipt(
    task: TaskSession,
    round: TaskRound,
    evidence: CompletionEvidence[],
    incrementRevision = true,
    artifactProofIds: string[] = [],
  ): Promise<boolean> {
    const passedEvidence = evidence.filter(item => item.passed);
    const visibleAnswer =
      round.instructionSummary && !['User instruction', 'Direction changed'].includes(round.instructionSummary)
        ? round.instructionSummary.trim()
        : '';
    let answerDigest: string | null = null;
    if (visibleAnswer && isBasicSubstantiveAnswer(visibleAnswer, '')) {
      answerDigest = await sha256(visibleAnswer);
    }

    if (task.plan) {
      const deliverableProof =
        artifactProofIds[0] ?? (answerDigest ? 'deliverable:' + answerDigest.slice(0, 16) : undefined);
      if (deliverableProof) {
        task.plan = applyFinalDeliverableToMissionPlan(task.plan, deliverableProof, this.deps.now());
      }
      // Every phase must carry its own criterion/evidence. A final answer may
      // close only an explicit active deliverable phase.
      const phaseWithoutOwnProof = task.plan.phases.some(
        phase =>
          phase.status !== 'done' ||
          phase.criteriaIds.length === 0 ||
          !phase.criteriaIds.every(id => phase.evidenceIds.includes(id)),
      );
      if (phaseWithoutOwnProof) {
        task.status = 'failed';
        round.status = 'failed';
        round.failureCategory = 'mission_plan_unverified';
        round.waitReason = undefined;
        if (incrementRevision) task.revision += 1;
        await this.persist(task);
        return false;
      }
    }

    round.receipt = {
      id: crypto.randomUUID(),
      taskId: task.id,
      roundId: round.id,
      verifiedAt: this.deps.now(),
      criterionIds: round.criteria.filter(item => item.required).map(item => item.id),
      evidenceDigests: [
        ...(await Promise.all(passedEvidence.map(item => sha256(JSON.stringify(item))))),
        ...(answerDigest ? [answerDigest] : []),
        ...(await Promise.all(artifactProofIds.map(id => sha256(id)))),
      ],
    };
    task.status = 'completed';
    round.status = 'completed';
    round.waitReason = undefined;
    this.lockedCriteriaRounds.delete(this.roundKey(task.id, round.id));
    if (incrementRevision) task.revision += 1;
    await this.persist(task);
    const snapshot = structuredClone(task);
    for (const listener of this.listeners) {
      listener({
        type: 'task_completed_verified',
        taskId: task.id,
        roundId: task.currentRoundId,
        revision: task.revision,
        receiptId: round.receipt.id,
        snapshot,
      });
    }
    return true;
  }

  private async persist(task: TaskSession): Promise<void> {
    task.updatedAt = this.deps.now();
    await saveTask(task);
    void traceStore.recordTaskSnapshot(toRedactedTaskSnapshot(task));
    const snapshot = structuredClone(task);
    for (const listener of this.listeners) {
      listener({
        type: 'snapshot',
        taskId: task.id,
        roundId: task.currentRoundId,
        revision: task.revision,
        snapshot,
      });
    }
  }

  private queueTransition(work: () => Promise<void>): Promise<void> {
    const result = this.transition.then(work);
    this.transition = result.catch(() => undefined);
    return result;
  }
}
