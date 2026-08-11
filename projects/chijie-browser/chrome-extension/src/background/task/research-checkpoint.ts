import { isSearchResultsEvidenceSource, type EvidenceSpaceProgress } from '@extension/storage/lib/task';

export interface ResearchQuotas {
  userDiscussions: number;
  products: number;
}

const RESEARCH_NAVIGATION_ACTIONS = new Set([
  'click_element',
  'go_to_url',
  'search_google',
  'open_tab',
  'switch_tab',
  'close_tab',
  'go_back',
]);

const MAX_QUOTA = 1_000;
const BASE_WORK_CYCLES = 12;
const RECOVERABLE_RESEARCH_FAILURES = new Set([
  'max_steps',
  'no_progress',
  'no_action',
  'action_failed',
  'observe_failed',
  'evidence_required',
  'source_required',
]);
const RECOVERABLE_RESEARCH_DECISION_FAILURES = new Set([
  'max_steps',
  'no_progress',
  'no_action',
  'action_failed',
  'evidence_required',
  'json_parse_failed',
  'unknown_action',
]);

function boundedCount(value: string | undefined): number {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 && count <= MAX_QUOTA ? count : 0;
}

/** Extract only explicit research quotas; ordinary browsing tasks must not enter research cycling. */
export function extractResearchQuotas(instruction: string): ResearchQuotas | null {
  const text = instruction.replace(/\s+/g, ' ').trim();
  const userMatch = text.match(
    /(?:至少|at\s+least)\D{0,24}(\d{1,4})\D{0,24}(?:用户讨论|讨论或案例|讨论|user discussions?|cases?)/i,
  );
  const productMatch = text.match(/(?:至少|at\s+least)\D{0,24}(\d{1,4})\D{0,20}(?:竞品|产品|products?|competitors?)/i);
  const userDiscussions = boundedCount(userMatch?.[1]);
  const products = boundedCount(productMatch?.[1]);
  if (!userDiscussions && !products) return null;
  return { userDiscussions, products };
}

export function researchQuotaMissing(quotas: ResearchQuotas, progress: EvidenceSpaceProgress): ResearchQuotas {
  return {
    userDiscussions: Math.max(0, quotas.userDiscussions - progress.userDiscussions),
    products: Math.max(0, quotas.products - progress.products),
  };
}

export function researchQuotasMet(quotas: ResearchQuotas, progress: EvidenceSpaceProgress): boolean {
  const missing = researchQuotaMissing(quotas, progress);
  return missing.userDiscussions === 0 && missing.products === 0;
}

export function researchContinuationQuery(
  quotas: ResearchQuotas,
  progress: EvidenceSpaceProgress,
): string | null {
  const missing = researchQuotaMissing(quotas, progress);
  if (missing.userDiscussions === 0 && missing.products === 0) return null;
  const userRatio = quotas.userDiscussions > 0 ? progress.userDiscussions / quotas.userDiscussions : 1;
  const productRatio = quotas.products > 0 ? progress.products / quotas.products : 1;
  if (missing.products > 0 && (missing.userDiscussions === 0 || productRatio <= userRatio)) {
    const queries = [
      'NotebookLM Readwise LiquidText MarginNote official product',
      'Elicit Consensus SciSpace Scholarcy official product',
      'Hypothesis Glasp Heptabase Obsidian Canvas official product',
      'Brilliant PhET Labster Wolfram Alpha official product',
      'Flourish Observable Kumu TimelineJS official product',
      'Napkin AI Gamma Websim generative UI official product',
      'ChatPDF AskYourPDF Humata AI PDF official product',
      'Readwise Reader Matter Omnivore Instapaper official product',
      'Heptabase Scrintal Muse visual knowledge official product',
      'Obsidian Roam Research Logseq Capacities official product',
      'Elicit Consensus SciSpace Scholarcy official product',
      'Hypothesis Glasp Diigo social annotation official product',
      'Brilliant PhET Labster ExploreLearning official product',
      'Flourish Observable Kumu TimelineJS official product',
      'Adobe Acrobat AI Assistant UPDF PDFgear official product',
      'AskYourPDF Humata Consensus official product',
      'Scholarcy Connected Papers Litmaps official product',
      'ResearchRabbit Semantic Scholar Scite official product',
      'RemNote Anki Quizlet active recall official product',
      'PhET Labster Wolfram Alpha simulation official product',
      'Observable TimelineJS Datawrapper visualization official product',
      'Miro Whimsical Lucidchart concept map official product',
      'Perplexity Glean NotebookLM research assistant official product',
      'Zotero Paperpile Mendeley reference manager official product',
      'Explainpaper Unriddle Lateral AI PDF official product',
      'Speechify NaturalReader ElevenLabs Reader official product',
      'Readwise Reader Matter Instapaper official product',
      'Roam Research Logseq Capacities official product',
      'Websim Claude Artifacts v0 generative UI official product',
      'Arc Browser SigmaOS Dia browser official product',
    ];
    return queries[progress.products % queries.length];
  }
  const queries = [
    'site:reddit.com PDF reader AI user complaint',
    'site:news.ycombinator.com PDF reading tool discussion',
    'site:github.com/issues AI PDF reader citation problem',
    'complex book reading visualization user discussion',
  ];
  return queries[progress.userDiscussions % queries.length];
}

export function requiresStructuredResearchDecision(instruction: string): boolean {
  return /\bLiving\s+Reader\b|鲜活阅读器/i.test(instruction);
}

export function maxResearchWorkCycles(quotas: ResearchQuotas): number {
  const requestedRecords = quotas.userDiscussions + quotas.products;
  return Math.min(MAX_QUOTA, Math.max(BASE_WORK_CYCLES, requestedRecords * 2 + 16));
}

export function isRecoverableResearchFailure(category: string | undefined): boolean {
  return Boolean(category && RECOVERABLE_RESEARCH_FAILURES.has(category));
}

/** Failures worth one bounded correction cycle once collection is complete and only the decision gate remains. */
export function isRecoverableResearchDecisionFailure(category: string | undefined): boolean {
  return Boolean(category && RECOVERABLE_RESEARCH_DECISION_FAILURES.has(category));
}

export function renderResearchCheckpoint(quotas: ResearchQuotas, progress: EvidenceSpaceProgress): string {
  const missing = researchQuotaMissing(quotas, progress);
  const parts = [
    `Durable evidence progress: user_discussions=${progress.userDiscussions}/${quotas.userDiscussions}`,
    `products=${progress.products}/${quotas.products}`,
    `missing_user_discussions=${missing.userDiscussions}`,
    `missing_products=${missing.products}`,
    'Continue from the durable evidence space. Do not recount duplicates or search snippets.',
  ];
  if (progress.repository > 0 && (missing.userDiscussions > 0 || missing.products > 0)) {
    parts.push(
      'The Living Reader repository audit is already recorded. Do not reopen repository files until both external quotas are met; next open an unread user discussion or an unrecorded product.',
    );
  }
  return parts.join('; ');
}

export function isSearchResultsUrl(value: string): boolean {
  return isSearchResultsEvidenceSource(value);
}

export function shouldRequireEvidenceBeforeNavigation(input: {
  actionName: string;
  currentUrl: string;
  sourceRecorded: boolean;
  pageUnavailable: boolean;
  hasSubstantiveText: boolean;
}): boolean {
  return (
    RESEARCH_NAVIGATION_ACTIONS.has(input.actionName) &&
    !input.sourceRecorded &&
    !input.pageUnavailable &&
    input.hasSubstantiveText &&
    !isSearchResultsUrl(input.currentUrl)
  );
}

export function shouldGoBackFromUnavailableResearchPage(input: {
  pageUnavailable: boolean;
  actionName?: string;
  done: boolean;
}): boolean {
  if (!input.pageUnavailable) return false;
  return input.done || !input.actionName || input.actionName === 'record_evidence' || input.actionName === 'wait';
}

export function shouldLeavePrivateResearchDashboard(input: {
  url: string;
  bodyText: string;
  actionName?: string;
  done: boolean;
}): boolean {
  let isPrivateDashboard = false;
  try {
    const url = new URL(input.url);
    isPrivateDashboard = url.hostname === 'notebook.google.com' && /^\/?$/.test(url.pathname);
  } catch {
    return false;
  }
  if (!isPrivateDashboard) return false;
  return input.done || !input.actionName || input.actionName === 'record_evidence' || input.actionName === 'wait';
}
