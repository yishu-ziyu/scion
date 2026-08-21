/**
 * Task, steps, and result: `acceptTask`, `recordStep`, `produceResult`,
 * `resultIsPresentAndMatches`. Done only when `TaskResult` exists and matches.
 */
import type { ActionAttempt, TaskResult, TaskResultKind } from '@extension/storage/lib/task';
import { parseFormFillSubmitInstruction } from '../browser/sites/form-fill';
import { parseProductTableInstruction } from '../browser/sites/product-table';
import { artifactToResultText, type TaskArtifact } from './artifact';
import { isAcknowledgementOnly, isBasicSubstantiveAnswer, isPlaceholderDelivery } from './result-text';
import {
  csvOrMarkdownBlockSpans,
  csvOrMarkdownDataRowCount,
  firstCsvOrMarkdownHeaderLine,
  structuredTableCells,
} from './table-shape';

export type { TaskResult, TaskResultKind };

export type AskedSideEffect = 'open' | 'close_tab' | 'media_play' | 'media_pause' | 'download';

export interface AcceptedTask {
  instruction: string;
  askedKind: TaskResultKind;
  /** Exact sentence the user named as the result, if any (form success text). */
  askedText?: string;
  askedTableFields?: string[];
  askedMinRows?: number;
  /** Navigation or media/download side-effect the user named as the result. */
  askedSideEffect?: AskedSideEffect;
}

export interface ProduceResultInput {
  asked: AcceptedTask;
  artifacts?: TaskArtifact[];
  summary?: string;
  pageSuccessText?: string;
  observedUrl?: string;
  /** Page side-effect the user asked for (paused, closed, downloaded). */
  observedOutcome?: string;
}

const BARE_STATUS = /^(done|完成|ok|已完成|success|好了|opened|submitted|playing|paused|playing video)[.!。！]*$/i;

export function acceptTask(instruction: string): AcceptedTask {
  const text = instruction.replace(/\s+/g, ' ').trim();
  const tableGoal = parseProductTableInstruction(text);
  const askedText = namedSuccessText(text);
  if (tableGoal || asksForTable(text)) {
    return {
      instruction: text,
      askedKind: 'table',
      askedTableFields: tableFieldsFromInstruction(text),
      askedMinRows: tableGoal?.minRows ?? 1,
      ...(askedText ? { askedText } : {}),
    };
  }
  if (/\b(report|研究报告|调研报告)\b/.test(text) || /(?:写|输出|生成|交).{0,8}报告/.test(text)) {
    return { instruction: text, askedKind: 'report', ...(askedText ? { askedText } : {}) };
  }
  if (/\bdraft\b/i.test(text) || /草稿/.test(text)) {
    return { instruction: text, askedKind: 'draft', ...(askedText ? { askedText } : {}) };
  }
  if (asksForFile(text)) {
    return {
      instruction: text,
      askedKind: 'file',
      askedSideEffect: 'download',
      ...(askedText ? { askedText } : {}),
    };
  }
  const askedSideEffect = asksForWrittenContent(text) ? undefined : askedSideEffectFrom(text);
  return {
    instruction: text,
    askedKind: 'summary',
    ...(askedText ? { askedText } : {}),
    ...(askedSideEffect ? { askedSideEffect } : {}),
  };
}

export function recordStep(steps: ActionAttempt[], step: ActionAttempt): ActionAttempt[] {
  const next = steps.slice();
  const index = next.findIndex(item => item.id === step.id);
  if (index === -1) next.push(step);
  else next[index] = step;
  return next;
}

export function produceResult(input: ProduceResultInput): TaskResult | null {
  const asked = input.asked;
  const fromArtifacts = resultFromArtifacts(asked, input.artifacts ?? []);
  if (fromArtifacts && resultIsPresentAndMatches(asked, fromArtifacts)) return fromArtifacts;

  if (asked.askedKind === 'table') {
    const tableFromSummary = tableResultFromText(input.summary);
    if (tableFromSummary && resultIsPresentAndMatches(asked, tableFromSummary)) return tableFromSummary;
    return fromArtifacts ?? null;
  }

  const seenSuccess = visibleBody(input.pageSuccessText);
  if (seenSuccess) {
    const body =
      asked.askedText && (seenSuccess.includes(asked.askedText) || asked.askedText.includes(seenSuccess))
        ? asked.askedText
        : seenSuccess;
    const result: TaskResult = { kind: 'summary', body };
    if (resultIsPresentAndMatches(asked, result)) return result;
  }

  const summary = writtenKindBody(asked.askedKind, input.summary);
  if (asked.askedText && summary.includes(asked.askedText)) {
    const result: TaskResult = { kind: 'summary', body: asked.askedText };
    if (resultIsPresentAndMatches(asked, result)) return result;
  }
  if (summary && resultIsPresentAndMatches(asked, { kind: asked.askedKind, body: summary })) {
    return { kind: asked.askedKind, body: summary };
  }

  if (fromArtifacts) return fromArtifacts;

  const outcome = visibleBody(input.observedOutcome);
  if (outcome) {
    const result: TaskResult = {
      kind: asked.askedKind === 'file' ? 'file' : 'summary',
      body: outcome,
    };
    if (resultIsPresentAndMatches(asked, result)) return result;
  }

  const opened = hostFromUrl(input.observedUrl);
  if (opened) {
    const result: TaskResult = { kind: 'summary', body: `已打开 ${opened}` };
    if (resultIsPresentAndMatches(asked, result)) return result;
  }
  return null;
}

export function resultIsPresentAndMatches(asked: AcceptedTask, result: TaskResult | null | undefined): boolean {
  const body = result?.body?.replace(/\r\n?/g, '\n').trim() ?? '';
  if (!result || !body) return false;
  if (isPlaceholderDelivery(body) || isAcknowledgementOnly(body) || BARE_STATUS.test(body)) return false;
  if (/^User instruction$/i.test(body) || /^Direction changed$/i.test(body)) return false;
  if (/^页面(地址|状态|结果)已/.test(body) || /^Control loop candidate complete$/i.test(body)) return false;
  if (isNavigationChrome(body) && !navigationChromeMatchesAsked(asked, body)) return false;

  if (asked.askedKind === 'table') {
    if (!looksLikeTable(body)) return false;
    const rows = tableDataRowCount(body);
    if (rows < (asked.askedMinRows ?? 1)) return false;
    const fields = asked.askedTableFields ?? [];
    if (fields.length > 0 && !headerHasFields(body, fields)) return false;
    return true;
  }

  if (asked.askedText) {
    return body.includes(asked.askedText);
  }

  if (asked.askedKind === 'file') {
    if (body === '下载已完成') return true;
    return looksLikeFilename(body);
  }

  if (asked.askedKind === 'report' || asked.askedKind === 'draft') {
    return result.kind === asked.askedKind && isBasicSubstantiveAnswer(body, asked.instruction);
  }

  if (asked.askedSideEffect && navigationChromeMatchesAsked(asked, body)) return true;

  return isBasicSubstantiveAnswer(body, asked.instruction);
}

/**
 * Body that may be written to `TaskRound.result` after URL redaction.
 * Returns that body as a `TaskResult`, or null if it is a cut of `produced.body`
 * or a table with fewer data rows than `produceResult` made.
 */
export function matchingStoredResult(
  asked: AcceptedTask,
  produced: TaskResult,
  persistedBody: string,
): TaskResult | null {
  const stored: TaskResult = { ...produced, body: persistedBody };
  if (!resultIsPresentAndMatches(asked, stored)) return null;
  if (persistedBody.length < produced.body.length && produced.body.startsWith(persistedBody)) return null;
  if (asked.askedKind === 'table' && tableDataRowCount(persistedBody) < tableDataRowCount(produced.body)) {
    return null;
  }
  return stored;
}

function asksForTable(instruction: string): boolean {
  return (
    (/\bcsv\b/i.test(instruction) || /表格|\btable\b/i.test(instruction)) &&
    /提取|导出|抽取|extract|export|列出/i.test(instruction)
  );
}

function asksForFile(instruction: string): boolean {
  return (
    /下载(?:这个|该|一下)?(?:文件|附件|pdf|csv)/i.test(instruction) ||
    /\bdownload\s+(this\s+)?(file|pdf|csv|attachment)\b/i.test(instruction)
  );
}

function asksForWrittenContent(instruction: string): boolean {
  return (
    /告诉我|写出|写下|总结|概括|主题|提取|导出|摘录|引用|讲什么|有关|复制|拷贝/.test(instruction) ||
    /\btell me\b|\bsummari[sz]e\b|\bextract\b|\bquote\b|what.{0,24}\babout\b/i.test(instruction)
  );
}

function askedSideEffectFrom(instruction: string): AskedSideEffect | undefined {
  if (
    /关掉(这个)?(页|标签|标签页|tab)?/i.test(instruction) ||
    /关闭(这个)?(页|标签|标签页|窗口)/.test(instruction) ||
    /close\s+(this\s+)?(tab|page|window)/i.test(instruction)
  ) {
    return 'close_tab';
  }
  if (/暂停|停一下|停下|停止播放/.test(instruction) || /\bpause\b/i.test(instruction)) return 'media_pause';
  if (
    (/播放/.test(instruction) || /\bplay\b/i.test(instruction)) &&
    !/(?:打开|前往|访问|\bopen\b)/i.test(instruction)
  ) {
    return 'media_play';
  }
  if (/(?:打开|前往|访问)/.test(instruction) || /\bopen\s+/i.test(instruction)) return 'open';
  return undefined;
}

function looksLikeFilename(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  const token = trimmed.replace(/[),.;]+$/g, '');
  if (!token) return false;
  const base =
    token
      .split(/[/\\?#]/)
      .filter(Boolean)
      .pop() ?? '';
  const match = /^(.+)\.([A-Za-z0-9]{2,4})$/.exec(base);
  if (!match) return false;
  const ext = match[2].toLowerCase();
  if (FILENAME_EXTENSIONS.has(ext)) return true;
  return false;
}

const FILENAME_EXTENSIONS = new Set([
  'pdf',
  'csv',
  'tsv',
  'txt',
  'zip',
  'gz',
  '7z',
  'rar',
  'tar',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'mp4',
  'mp3',
  'wav',
  'mov',
  'webm',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'json',
  'xml',
  'html',
  'htm',
  'md',
  'bin',
  'exe',
  'dmg',
  'pkg',
  'apk',
  'ipa',
  'log',
  'srt',
]);

function isNavigationChrome(body: string): boolean {
  if (/^已打开 [^\s「][^\s「]*$/.test(body)) return true;
  return (
    body === '目标标签已关闭' ||
    body === '视频已暂停' ||
    body === '视频正在播放' ||
    body === '下载已完成' ||
    body === '下载已开始'
  );
}

function navigationChromeMatchesAsked(asked: AcceptedTask, body: string): boolean {
  switch (asked.askedSideEffect) {
    case 'open':
      return /^已打开 [^\s「][^\s「]*$/.test(body);
    case 'close_tab':
      return body === '目标标签已关闭';
    case 'media_pause':
      return body === '视频已暂停';
    case 'media_play':
      return body === '视频正在播放';
    case 'download':
      return body === '下载已完成';
    default:
      return false;
  }
}

function namedSuccessText(instruction: string): string | undefined {
  const form = parseFormFillSubmitInstruction(instruction);
  if (form?.successText) return form.successText.replace(/\s+/g, ' ').trim();
  const match =
    instruction.match(/\bsuccess\s+is\s+["'“]?([^"'”.;\n]+)/i) ??
    instruction.match(/看到\s*["'“「]?([^"'”」.;。\n]{2,80}?)(?=\s*["'”」]?\s*后)/);
  const text = match?.[1]?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function tableFieldsFromInstruction(instruction: string): string[] | undefined {
  const english = /\bwith\s+([a-z][a-z0-9 _-]*(?:\s*,\s*[a-z][a-z0-9 _-]*)+(?:\s*,?\s+and\s+[a-z][a-z0-9 _-]*)?)/i.exec(
    instruction,
  )?.[1];
  if (!english) return undefined;
  const fields = english
    .split(/\s*(?:,|\band\b)\s*/i)
    .map(field => field.trim().toLowerCase())
    .filter(Boolean);
  return fields.length > 0 ? fields : undefined;
}

function resultFromArtifacts(asked: AcceptedTask, artifacts: TaskArtifact[]): TaskResult | null {
  for (const artifact of artifacts) {
    const body = artifactToResultText(artifact);
    if (!body) continue;
    const kind: TaskResultKind =
      artifact.type === 'table' || artifact.type === 'recordset'
        ? 'table'
        : artifact.type === 'file'
          ? 'file'
          : asked.askedKind === 'report' || asked.askedKind === 'draft'
            ? asked.askedKind
            : 'summary';
    const result: TaskResult = { kind, body };
    if (resultIsPresentAndMatches(asked, result)) return result;
  }
  return null;
}

function tableResultFromText(summary: string | undefined): TaskResult | null {
  const body = preserveWrittenNewlines(summary);
  if (!looksLikeTable(body)) return null;
  return { kind: 'table', body };
}

/** Keep paragraph breaks in report/draft/summary bodies. Collapse only status chrome. */
function writtenKindBody(kind: TaskResultKind, value: string | undefined): string {
  if (kind === 'report' || kind === 'draft' || kind === 'summary') return preserveWrittenNewlines(value);
  return visibleBody(value);
}

function preserveWrittenNewlines(value: string | undefined): string {
  return (value ?? '').replace(/\r\n?/g, '\n').trim();
}

/** Form success text the user named, not a long page quote used as proof. */
export function namedTakeawayText(expected: string, required = true): string | undefined {
  if (!required) return undefined;
  const text = expected.replace(/\s+/g, ' ').trim();
  if (text.length < 2 || text.length > 80) return undefined;
  if (!/(?:success|saved|submitted|成功|已保存|已提交)/i.test(text)) return undefined;
  return text;
}

function visibleBody(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function hostFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const host = new URL(value).hostname.replace(/^www\./, '');
    return host || undefined;
  } catch {
    return undefined;
  }
}

function looksLikeTable(body: string): boolean {
  return csvOrMarkdownBlockSpans(body).length > 0;
}

function tableDataRowCount(body: string): number {
  return csvOrMarkdownDataRowCount(body);
}

function headerHasFields(body: string, fields: string[]): boolean {
  const header = firstCsvOrMarkdownHeaderLine(body);
  if (!header) return false;
  const cells = structuredTableCells(header).map(cell => cell.trim().toLowerCase());
  return fields.every(field => cells.includes(field.toLowerCase()));
}
