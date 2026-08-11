import { ActionResult, type AgentContext } from '@src/background/agent/types';
import { t } from '@extension/i18n';
import {
  clickElementActionSchema,
  doneActionSchema,
  goBackActionSchema,
  goToUrlActionSchema,
  inputTextActionSchema,
  openTabActionSchema,
  searchGoogleActionSchema,
  switchTabActionSchema,
  type ActionSchema,
  sendKeysActionSchema,
  scrollToTextActionSchema,
  cacheContentActionSchema,
  recordEvidenceActionSchema,
  inspectEvidenceSpaceActionSchema,
  recordResearchDecisionActionSchema,
  recordResearchDeliveryActionSchema,
  readPageTextActionSchema,
  inspectOpenTabsActionSchema,
  selectDropdownOptionActionSchema,
  getDropdownOptionsActionSchema,
  closeTabActionSchema,
  waitActionSchema,
  previousPageActionSchema,
  scrollToPercentActionSchema,
  nextPageActionSchema,
  scrollToTopActionSchema,
  scrollToBottomActionSchema,
  controlMediaActionSchema,
  saveScreenshotActionSchema,
} from './schemas';
import {
  addEvidenceRecords,
  evidenceSpaceProgress,
  evidenceBasisAppearsInPage,
  getEvidenceSpace,
  isSearchResultsEvidenceSource,
  isPrivateDashboardEvidenceSource,
  isDiscussionOnlyProductSource,
  recordResearchDecision,
  recordResearchDelivery,
  type EvidenceRecordDraft,
} from '@extension/storage/lib/task/evidence-space';
import { z } from 'zod';
import { createLogger } from '@src/background/log';
import { ExecutionState, Actors } from '../event/types';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { wrapUntrustedContent } from '../messages/utils';
import { downloadJpegToDownloads, sanitizeScreenshotFilename } from './save-screenshot';

const logger = createLogger('Action');

type EvidenceRecordActionInput = {
  record_type: EvidenceRecordDraft['recordType'];
  source: string;
  source_title: string;
  user_problem?: string;
  raw_basis: string;
  observation: string;
  inference: string;
  confidence: EvidenceRecordDraft['confidence'];
  related_product?: string;
  living_reader_capability?: string;
  priority: EvidenceRecordDraft['priority'];
  stance: EvidenceRecordDraft['stance'];
  dedupe_key: string;
};

type ResearchDecisionActionInput = {
  capabilities: Array<{
    title: string;
    user_moment: string;
    behavior_change: string;
    why_now: string;
    why_others_later: string;
    implementation_distance: string;
    mvp: string;
    success_metric: string;
    user_evidence_ids: string[];
    product_evidence_ids: string[];
    repository_evidence_ids: string[];
  }>;
  deferred: string[];
  contradictions: string[];
};

export function resolveEvidenceProductIdentity(params: {
  pageUrl: string;
  pageTitle: string;
  proposed?: string;
}): string | undefined {
  const proposed = params.proposed?.trim();
  const proposedIsLivingReader = /\bLiving\s+Reader\b|鲜活阅读器/i.test(proposed ?? '');
  if (proposed && !proposedIsLivingReader) return proposed;
  if (/living-reader/i.test(params.pageUrl)) return proposed || 'Living Reader';

  const titleIdentity = params.pageTitle
    .split(/\s+(?:\||—|–|-)\s+/)[0]
    ?.trim();
  if (titleIdentity && titleIdentity.length <= 80 && !/^(?:home|homepage|welcome|sign in|log in)$/i.test(titleIdentity)) {
    return titleIdentity;
  }

  try {
    const label = new URL(params.pageUrl).hostname.replace(/^www\./, '').split('.')[0];
    if (label) return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    // Leave identity unresolved; the record will be rejected below.
  }
  return undefined;
}

function evidenceWords(value: string): Set<string> {
  const stop = new Set(['this', 'that', 'with', 'from', 'into', 'using', 'user', 'users', 'product', 'research']);
  const words = value.toLowerCase().match(/[a-z0-9]{3,}|[\u3400-\u9fff]{2,}/g) ?? [];
  return new Set(
    words
      .map(word => (word.length > 4 ? word.replace(/(?:es|s)$/i, '') : word))
      .filter(word => !stop.has(word)),
  );
}

export function resolveProductEvidenceBasis(params: {
  rawBasis: string;
  observation: string;
  pageText: string;
  pageTitle?: string;
}): string | null {
  if (evidenceBasisAppearsInPage(params.rawBasis, params.pageText)) return params.rawBasis;
  const queryWords = evidenceWords(`${params.rawBasis} ${params.observation}`);
  if (queryWords.size < 3) return null;
  let best: { text: string; score: number } | null = null;
  for (const rawLine of params.pageText.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 20 || line.length > 500) continue;
    const lineWords = evidenceWords(line);
    const common = [...queryWords].filter(word => lineWords.has(word)).length;
    if (common < 3) continue;
    const queryCoverage = common / queryWords.size;
    const lineCoverage = common / Math.max(1, lineWords.size);
    if (queryCoverage < 0.18 || lineCoverage < 0.18) continue;
    const score = queryCoverage + lineCoverage;
    if (!best || score > best.score) best = { text: line, score };
  }
  if (best) return best.text;

  // Cross-language product audits commonly describe an English landing page
  // in Chinese. Preserve an exact source sentence by matching the public page
  // title to its body; do not apply this fallback to user discussions.
  const titleWords = evidenceWords(params.pageTitle ?? '');
  if (titleWords.size < 2) return null;
  for (const rawLine of params.pageText.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 20 || line.length > 300) continue;
    const lineWords = evidenceWords(line);
    const common = [...titleWords].filter(word => lineWords.has(word)).length;
    if (common >= 2) return line;
  }
  return null;
}

export function resolveUserDiscussionEvidenceBasis(params: {
  rawBasis: string;
  observation: string;
  userProblem?: string;
  pageText: string;
}): string | null {
  if (evidenceBasisAppearsInPage(params.rawBasis, params.pageText)) return params.rawBasis;
  const queryWords = evidenceWords(`${params.rawBasis} ${params.observation} ${params.userProblem ?? ''}`);
  if (queryWords.size < 4) return null;
  let best: { text: string; score: number } | null = null;
  for (const rawLine of params.pageText.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 24 || line.length > 700) continue;
    const lineWords = evidenceWords(line);
    const common = [...queryWords].filter(word => lineWords.has(word)).length;
    if (common < 4) continue;
    const queryCoverage = common / queryWords.size;
    const lineCoverage = common / Math.max(1, lineWords.size);
    if (queryCoverage < 0.25 || lineCoverage < 0.25) continue;
    const score = queryCoverage + lineCoverage;
    if (!best || score > best.score) best = { text: line, score };
  }
  return best?.text ?? null;
}

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/**
 * An action is a function that takes an input and returns an ActionResult
 */
export class Action {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly handler: (input: any) => Promise<ActionResult>,
    public readonly schema: ActionSchema,
    // Whether this action has an index argument
    public readonly hasIndex: boolean = false,
  ) {}

  parse(input: unknown): unknown {
    const schema = this.schema.schema;
    const normalizedInput = this.schema.normalizeInput ? this.schema.normalizeInput(input) : input;

    // check if the schema is schema: z.object({}), if so, ignore the input
    const isEmptySchema =
      schema instanceof z.ZodObject &&
      Object.keys((schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape || {}).length === 0;

    if (isEmptySchema) {
      return {};
    }

    const parsedArgs = this.schema.schema.safeParse(normalizedInput);
    if (!parsedArgs.success) {
      const errorMessage = parsedArgs.error.message;
      throw new InvalidInputError(errorMessage);
    }
    return parsedArgs.data;
  }

  async executeParsed(input: unknown): Promise<ActionResult> {
    return await this.handler(input);
  }

  async call(input: unknown): Promise<ActionResult> {
    return await this.executeParsed(this.parse(input));
  }

  name() {
    return this.schema.name;
  }

  /**
   * Returns the prompt for the action
   * @returns {string} The prompt for the action
   */
  prompt() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schemaShape = (this.schema.schema as z.ZodObject<any>).shape || {};
    const schemaProperties = Object.entries(schemaShape).map(([key, value]) => {
      const zodValue = value as z.ZodTypeAny;
      return `'${key}': {'type': '${zodValue.description}', ${zodValue.isOptional() ? "'optional': true" : "'required': true"}}`;
    });

    const schemaStr =
      schemaProperties.length > 0 ? `{${this.name()}: {${schemaProperties.join(', ')}}}` : `{${this.name()}: {}}`;

    const lines = [this.schema.description];
    if (this.schema.whenToUse) lines.push(`When to use: ${this.schema.whenToUse}`);
    if (this.schema.whenNotToUse) lines.push(`Do NOT use when: ${this.schema.whenNotToUse}`);
    if (this.schema.examples?.length) lines.push(`Examples: ${this.schema.examples.join(' | ')}`);
    if (this.schema.returns) lines.push(`Returns: ${this.schema.returns}`);
    if (this.schema.costHint) lines.push(`Cost hint: ${this.schema.costHint}`);
    return `${lines.join('\n')}:\n${schemaStr}`;
  }

  /**
   * Get the index argument from the input if this action has an index
   * @param input The input to extract the index from
   * @returns The index value if found, null otherwise
   */
  getIndexArg(input: unknown): number | null {
    if (!this.hasIndex) {
      return null;
    }
    if (input && typeof input === 'object' && 'index' in input) {
      return (input as { index: number }).index;
    }
    return null;
  }

  /**
   * Set the index argument in the input if this action has an index
   * @param input The input to update the index in
   * @param newIndex The new index value to set
   * @returns Whether the index was set successfully
   */
  setIndexArg(input: unknown, newIndex: number): boolean {
    if (!this.hasIndex) {
      return false;
    }
    if (input && typeof input === 'object') {
      (input as { index: number }).index = newIndex;
      return true;
    }
    return false;
  }
}

// TODO: can not make every action optional, don't know why
export function buildDynamicActionSchema(actions: Action[]): z.ZodType {
  let schema = z.object({});
  for (const action of actions) {
    // create a schema for the action, it could be action.schema.schema or null
    // but don't use default: null as it causes issues with Google Generative AI
    const actionSchema = action.schema.schema;
    schema = schema.extend({
      [action.name()]: actionSchema.nullable().optional().describe(action.schema.description),
    });
  }
  return schema;
}

export class ActionBuilder {
  private readonly context: AgentContext;
  private readonly extractorLLM: BaseChatModel;

  constructor(context: AgentContext, extractorLLM: BaseChatModel) {
    this.context = context;
    this.extractorLLM = extractorLLM;
  }

  buildDefaultActions() {
    const actions = [];

    const done = new Action(async (input: z.infer<typeof doneActionSchema.schema>) => {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, doneActionSchema.name);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, input.text);
      return new ActionResult({
        isDone: true,
        extractedContent: input.text,
      });
    }, doneActionSchema);
    actions.push(done);

    const searchGoogle = new Action(async (input: z.infer<typeof searchGoogleActionSchema.schema>) => {
      const context = this.context;
      const intent = input.intent || t('act_searchGoogle_start', [input.query]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      await context.browserContext.navigateTo(`https://www.google.com/search?q=${input.query}`);

      const msg2 = t('act_searchGoogle_ok', [input.query]);
      context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, searchGoogleActionSchema);
    actions.push(searchGoogle);

    const goToUrl = new Action(async (input: z.infer<typeof goToUrlActionSchema.schema>) => {
      const intent = input.intent || t('act_goToUrl_start', [input.url]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      await this.context.browserContext.navigateTo(input.url);
      const msg2 = t('act_goToUrl_ok', [input.url]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, goToUrlActionSchema);
    actions.push(goToUrl);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const goBack = new Action(async (input: z.infer<typeof goBackActionSchema.schema>) => {
      const intent = input.intent || t('act_goBack_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      await page.goBack();
      const msg2 = t('act_goBack_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg2);
      return new ActionResult({
        extractedContent: msg2,
        includeInMemory: true,
      });
    }, goBackActionSchema);
    actions.push(goBack);

    const wait = new Action(async (input: z.infer<typeof waitActionSchema.schema>) => {
      const seconds = input.seconds || 3;
      const intent = input.intent || t('act_wait_start', [seconds.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      const msg = t('act_wait_ok', [seconds.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, waitActionSchema);
    actions.push(wait);

    // Element Interaction Actions
    const clickElement = new Action(
      async (input: z.infer<typeof clickElementActionSchema.schema>) => {
        const intent = input.intent || t('act_click_start', [input.index.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const elementNode = page.getDomElementByIndex(input.index);
        if (!elementNode) {
          throw new Error(t('act_errors_elementNotExist', [input.index.toString()]));
        }

        // Check if element is a file uploader
        if (page.isFileUploader(elementNode)) {
          const msg = t('act_click_fileUploader', [input.index.toString()]);
          logger.info(msg);
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        }

        try {
          const initialTabIds = await this.context.browserContext.getAllTabIds();
          await page.clickElementNode(this.context.options.useVision, elementNode);
          let msg = t('act_click_ok', [input.index.toString(), elementNode.getAllTextTillNextClickableElement(2)]);
          logger.info(msg);

          // TODO: could be optimized by chrome extension tab api
          const currentTabIds = await this.context.browserContext.getAllTabIds();
          if (currentTabIds.size > initialTabIds.size) {
            const newTabMsg = t('act_click_newTabOpened');
            msg += ` - ${newTabMsg}`;
            logger.info(newTabMsg);
            // find the tab id that is not in the initial tab ids
            const newTabId = Array.from(currentTabIds).find(id => !initialTabIds.has(id));
            if (newTabId) {
              await this.context.browserContext.switchTab(newTabId);
            }
          }
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        } catch (error) {
          const msg = t('act_errors_elementNoLongerAvailable', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
          throw error;
        }
      },
      clickElementActionSchema,
      true,
    );
    actions.push(clickElement);

    const inputText = new Action(
      async (input: z.infer<typeof inputTextActionSchema.schema>) => {
        const intent = input.intent || t('act_inputText_start', [input.index.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          throw new Error(t('act_errors_elementNotExist', [input.index.toString()]));
        }

        await page.inputTextElementNode(this.context.options.useVision, elementNode, input.text);
        const inputMessage = `Entered text into element ${input.index}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, inputMessage);
        return new ActionResult({ extractedContent: inputMessage, includeInMemory: true });
      },
      inputTextActionSchema,
      true,
    );
    actions.push(inputText);

    // Tab Management Actions
    const switchTab = new Action(async (input: z.infer<typeof switchTabActionSchema.schema>) => {
      const page = await this.context.browserContext.getCurrentPage();
      const tabId = input.tab_id ?? page.tabId;
      const intent = input.intent || t('act_switchTab_start', [tabId.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      try {
        await this.context.browserContext.switchTab(tabId);
        const msg = t('act_switchTab_ok', [tabId.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ success: true, extractedContent: msg, includeInMemory: true });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const msg = `switch_tab failed for tab ${tabId}: ${detail}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
    }, switchTabActionSchema);
    actions.push(switchTab);

    const openTab = new Action(async (input: z.infer<typeof openTabActionSchema.schema>) => {
      const intent = input.intent || t('act_openTab_start', [input.url]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      await this.context.browserContext.openTab(input.url);
      const msg = t('act_openTab_ok', [input.url]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, openTabActionSchema);
    actions.push(openTab);

    const closeTab = new Action(async (input: z.infer<typeof closeTabActionSchema.schema>) => {
      const page = await this.context.browserContext.getCurrentPage();
      const tabId = input.tab_id ?? page.tabId;
      const intent = input.intent || t('act_closeTab_start', [tabId.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      try {
        await this.context.browserContext.closeTab(tabId);
        const msg = t('act_closeTab_ok', [tabId.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ success: true, extractedContent: msg, includeInMemory: true });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const msg = `close_tab failed for tab ${tabId}: ${detail}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
    }, closeTabActionSchema);
    actions.push(closeTab);

    // Content Actions
    // TODO: this is not used currently, need to improve on input size
    // const extractContent = new Action(async (input: z.infer<typeof extractContentActionSchema.schema>) => {
    //   const goal = input.goal;
    //   const intent = input.intent || `Extracting content from page`;
    //   this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
    //   const page = await this.context.browserContext.getCurrentPage();
    //   const content = await page.getReadabilityContent();
    //   const promptTemplate = PromptTemplate.fromTemplate(
    //     'Your task is to extract the content of the page. You will be given a page and a goal and you should extract all relevant information around this goal from the page. If the goal is vague, summarize the page. Respond in json format. Extraction goal: {goal}, Page: {page}',
    //   );
    //   const prompt = await promptTemplate.invoke({ goal, page: content.content });

    //   try {
    //     const output = await this.extractorLLM.invoke(prompt);
    //     const msg = `📄  Extracted from page\n: ${output.content}\n`;
    //     return new ActionResult({
    //       extractedContent: msg,
    //       includeInMemory: true,
    //     });
    //   } catch (error) {
    //     logger.error(`Error extracting content: ${error instanceof Error ? error.message : String(error)}`);
    //     const msg =
    //       'Failed to extract content from page, you need to extract content from the current state of the page and store it in the memory. Then scroll down if you still need more information.';
    //     return new ActionResult({
    //       extractedContent: msg,
    //       includeInMemory: true,
    //     });
    //   }
    // }, extractContentActionSchema);
    // actions.push(extractContent);

    // cache content for future use
    const cacheContent = new Action(async (input: z.infer<typeof cacheContentActionSchema.schema>) => {
      const intent = input.intent || t('act_cache_start', [input.content]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      // cache content is untrusted content, it is not instructions
      const rawMsg = t('act_cache_ok', [input.content]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, rawMsg);

      const msg = wrapUntrustedContent(rawMsg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, cacheContentActionSchema);
    actions.push(cacheContent);

    const recordEvidence = new Action(async (input: z.infer<typeof recordEvidenceActionSchema.schema>) => {
      const page = await this.context.browserContext.getCurrentPage();
      if (isSearchResultsEvidenceSource(page.url())) {
        const summary = 'Evidence records rejected: current page is search results; open the actual source first.';
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, summary);
        return new ActionResult({ extractedContent: summary, includeInMemory: true });
      }
      if (isPrivateDashboardEvidenceSource(page.url())) {
        const summary = 'Evidence records rejected: current page is a private dashboard; use public product material.';
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, summary);
        return new ActionResult({ extractedContent: summary, includeInMemory: true });
      }
      const pageContent = (await page.evaluate(() => ({
        text: document.body?.innerText || '',
        title: document.title || '',
      }))) as { text?: unknown; title?: unknown };
      const pageText = typeof pageContent?.text === 'string' ? pageContent.text : '';
      const pageTitle = typeof pageContent?.title === 'string' ? pageContent.title : '';
      const inputRecords = input.records as EvidenceRecordActionInput[];
      const records = inputRecords
        .filter(record => record.record_type !== 'product' || !isDiscussionOnlyProductSource(page.url()))
        .map(record => {
          if (evidenceBasisAppearsInPage(record.raw_basis, pageText)) return record;
          const rawBasis =
            record.record_type === 'product'
              ? resolveProductEvidenceBasis({
                  rawBasis: record.raw_basis,
                  observation: record.observation,
                  pageText,
                  pageTitle,
                })
              : record.record_type === 'user_discussion'
                ? resolveUserDiscussionEvidenceBasis({
                    rawBasis: record.raw_basis,
                    observation: record.observation,
                    userProblem: record.user_problem,
                    pageText,
                  })
                : null;
          return rawBasis ? { ...record, raw_basis: rawBasis } : null;
        })
        .filter((record): record is EvidenceRecordActionInput => Boolean(record))
        .map(record => {
          if (record.record_type !== 'product') return record;
          return {
            ...record,
            related_product: resolveEvidenceProductIdentity({
              pageUrl: page.url(),
              pageTitle,
              proposed: record.related_product,
            }),
          };
        })
        .filter(record => record.record_type !== 'product' || Boolean(record.related_product)) as EvidenceRecordActionInput[];
      const basisMismatchCount = inputRecords.length - records.length;
      const drafts: EvidenceRecordDraft[] = records.map(record => ({
        recordType: record.record_type,
        // The browser observation is authoritative. Model-proposed URL variants
        // (home page, redirect, tracking URL) must not break source binding.
        source: page.url(),
        sourceTitle: record.source_title,
        userProblem: record.user_problem,
        rawBasis: record.raw_basis,
        observation: record.observation,
        inference: record.inference,
        confidence: record.confidence,
        relatedProduct: record.related_product,
        livingReaderCapability: record.living_reader_capability,
        priority: record.priority,
        stance: record.stance,
        dedupeKey: record.dedupe_key,
      }));
      const result = await addEvidenceRecords({
        taskId: this.context.taskId,
        observedSource: page.url(),
        drafts,
      });
      const progress = evidenceSpaceProgress(result.space);
      const rejectedByReason = (reason: (typeof result.rejected)[number]['reason']) =>
        result.rejected.filter(item => item.reason === reason).length;
      const summary = [
        `Evidence records: added=${result.added.length}`,
        `duplicates=${result.duplicateKeys.length}`,
        `rejected=${result.rejected.length + basisMismatchCount}`,
        `basis_not_visible=${basisMismatchCount}`,
        `invalid_record=${rejectedByReason('invalid_record')}`,
        `invalid_source=${rejectedByReason('invalid_source')}`,
        `source_not_observed=${rejectedByReason('source_not_observed')}`,
        `user_discussions=${progress.userDiscussions}/80`,
        `products=${progress.products}/30`,
      ].join('; ');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, summary);
      return new ActionResult({ extractedContent: summary, includeInMemory: true });
    }, recordEvidenceActionSchema);
    actions.push(recordEvidence);

    const inspectEvidenceSpace = new Action(
      async (input: z.infer<typeof inspectEvidenceSpaceActionSchema.schema>) => {
      const space = await getEvidenceSpace(this.context.taskId);
      const progress = evidenceSpaceProgress(space);
      const query = String(input.query ?? '').trim().toLowerCase();
      const filtered = (space?.records ?? []).filter(record => {
        if (input.record_type && record.recordType !== input.record_type) return false;
        if (!query) return true;
        return [
          record.sourceTitle,
          record.userProblem,
          record.observation,
          record.inference,
          record.relatedProduct,
          record.livingReaderCapability,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
      const offset = Number(input.offset) || 0;
      const limit = Number(input.limit) || 20;
      const page = filtered.slice(offset, offset + limit).map(record => ({
        id: record.id,
        type: record.recordType,
        source: record.source,
        title: record.sourceTitle,
        observation: record.observation,
        inference: record.inference,
        stance: record.stance,
        relatedProduct: record.relatedProduct,
        livingReaderCapability: record.livingReaderCapability,
      }));
      const summary = [
        `Evidence progress: total=${progress.total}`,
        `user_discussions=${progress.userDiscussions}/80`,
        `products=${progress.products}/30`,
        `repository=${progress.repository}`,
        `browser_context=${progress.browserContext}`,
        `matches=${filtered.length}`,
        `offset=${offset}`,
        `next_offset=${offset + page.length < filtered.length ? offset + page.length : 'none'}`,
        `records=${JSON.stringify(page)}`,
      ].join('; ');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, summary);
      return new ActionResult({ extractedContent: summary, includeInMemory: true });
      },
      inspectEvidenceSpaceActionSchema,
    );
    actions.push(inspectEvidenceSpace);

    const recordDecision = new Action(
      async (input: ResearchDecisionActionInput) => {
        const result = await recordResearchDecision({
          taskId: this.context.taskId,
          draft: {
            capabilities: input.capabilities.map(capability => ({
              title: capability.title,
              userMoment: capability.user_moment,
              behaviorChange: capability.behavior_change,
              whyNow: capability.why_now,
              whyOthersLater: capability.why_others_later,
              implementationDistance: capability.implementation_distance,
              mvp: capability.mvp,
              successMetric: capability.success_metric,
              userEvidenceIds: capability.user_evidence_ids,
              productEvidenceIds: capability.product_evidence_ids,
              repositoryEvidenceIds: capability.repository_evidence_ids,
            })),
            deferred: input.deferred,
            contradictions: input.contradictions,
          },
        });
        const summary = result.accepted
          ? 'Research decision accepted: exactly 3 capabilities with complete 2+1+1 evidence coverage.'
          : `Research decision rejected: ${result.reasons.join(' | ')}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, summary);
        return new ActionResult({ extractedContent: summary, includeInMemory: true });
      },
      recordResearchDecisionActionSchema,
    );
    actions.push(recordDecision);

    const recordDelivery = new Action(
      async (input: { kind: 'research_table' | 'decision_document'; row_count?: number }) => {
        const page = await this.context.browserContext.getCurrentPage();
        const observedText = await page.evaluate(() => document.body?.innerText || '');
        const result = await recordResearchDelivery({
          taskId: this.context.taskId,
          kind: input.kind,
          url: page.url(),
          title: await page.title(),
          observedText: typeof observedText === 'string' ? observedText : '',
          rowCount: input.row_count,
        });
        const summary = result.accepted
          ? `Research delivery verified: ${input.kind} at ${page.url()}`
          : `Research delivery rejected: ${result.reasons.join(' | ')}`;
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, summary);
        return new ActionResult({ extractedContent: summary, includeInMemory: true });
      },
      recordResearchDeliveryActionSchema,
    );
    actions.push(recordDelivery);

    const readPageText = new Action(async (input: z.infer<typeof readPageTextActionSchema.schema>) => {
      const page = await this.context.browserContext.getCurrentPage();
      const maxChars = Number(input.max_chars) || 20_000;
      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      const text = typeof bodyText === 'string' ? bodyText.replace(/\s+\n/g, '\n').trim().slice(0, maxChars) : '';
      const summary = wrapUntrustedContent(
        [`URL: ${page.url()}`, `Title: ${await page.title()}`, `Visible page text:\n${text || '[empty]'}`].join('\n'),
      );
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Read ${text.length} page characters`);
      return new ActionResult({ extractedContent: summary, includeInMemory: true });
    }, readPageTextActionSchema);
    actions.push(readPageText);

    const inspectOpenTabs = new Action(async () => {
      const tabs = (await this.context.browserContext.getTabInfos()).slice(0, 30);
      const summary = tabs.length
        ? tabs.map(tab => `tab_id=${tab.id}; title=${tab.title.slice(0, 160)}; url=${tab.url}`).join('\n')
        : 'No allowed browser tabs found.';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `Inspected ${tabs.length} open tabs`);
      return new ActionResult({ extractedContent: summary, includeInMemory: true });
    }, inspectOpenTabsActionSchema);
    actions.push(inspectOpenTabs);

    // Scroll to percent
    const scrollToPercent = new Action(async (input: z.infer<typeof scrollToPercentActionSchema.schema>) => {
      const intent = input.intent || t('act_scrollToPercent_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        logger.info('Scrolling element to percent', { elementIndex: input.index });
        await page.scrollToPercent(input.yPercent, elementNode);
      } else {
        await page.scrollToPercent(input.yPercent);
      }
      const msg = t('act_scrollToPercent_ok', [input.yPercent.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToPercentActionSchema);
    actions.push(scrollToPercent);

    // Scroll to top
    const scrollToTop = new Action(async (input: z.infer<typeof scrollToTopActionSchema.schema>) => {
      const intent = input.intent || t('act_scrollToTop_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();
      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPercent(0, elementNode);
      } else {
        await page.scrollToPercent(0);
      }
      const msg = t('act_scrollToTop_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToTopActionSchema);
    actions.push(scrollToTop);

    // Scroll to bottom
    const scrollToBottom = new Action(async (input: z.infer<typeof scrollToBottomActionSchema.schema>) => {
      const intent = input.intent || t('act_scrollToBottom_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();
      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }
        await page.scrollToPercent(100, elementNode);
      } else {
        await page.scrollToPercent(100);
      }
      const msg = t('act_scrollToBottom_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, scrollToBottomActionSchema);
    actions.push(scrollToBottom);

    // Scroll to previous page
    const previousPage = new Action(async (input: z.infer<typeof previousPageActionSchema.schema>) => {
      const intent = input.intent || t('act_previousPage_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        // Check if element is already at top of its scrollable area
        try {
          const [elementScrollTop] = await page.getElementScrollInfo(elementNode);
          if (elementScrollTop === 0) {
            const msg = t('act_errors_alreadyAtTop', [input.index.toString()]);
            this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
            return new ActionResult({ extractedContent: msg, includeInMemory: true });
          }
        } catch (error) {
          // If we can't get scroll info, let the scrollToPreviousPage method handle it
          logger.warning(
            `Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        await page.scrollToPreviousPage(elementNode);
      } else {
        // Check if page is already at top
        const [initialScrollY] = await page.getScrollInfo();
        if (initialScrollY === 0) {
          const msg = t('act_errors_pageAlreadyAtTop');
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }

        await page.scrollToPreviousPage();
      }
      const msg = t('act_previousPage_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, previousPageActionSchema);
    actions.push(previousPage);

    // Scroll to next page
    const nextPage = new Action(async (input: z.infer<typeof nextPageActionSchema.schema>) => {
      const intent = input.intent || t('act_nextPage_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      const page = await this.context.browserContext.getCurrentPage();

      if (input.index) {
        const state = await page.getCachedState();
        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({ error: errorMsg, includeInMemory: true });
        }

        // Check if element is already at bottom of its scrollable area
        try {
          const [elementScrollTop, elementClientHeight, elementScrollHeight] =
            await page.getElementScrollInfo(elementNode);
          if (elementScrollTop + elementClientHeight >= elementScrollHeight) {
            const msg = t('act_errors_alreadyAtBottom', [input.index.toString()]);
            this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
            return new ActionResult({ extractedContent: msg, includeInMemory: true });
          }
        } catch (error) {
          // If we can't get scroll info, let the scrollToNextPage method handle it
          logger.warning(
            `Could not get element scroll info: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        await page.scrollToNextPage(elementNode);
      } else {
        // Check if page is already at bottom
        const [initialScrollY, initialVisualViewportHeight, initialScrollHeight] = await page.getScrollInfo();
        if (initialScrollY + initialVisualViewportHeight >= initialScrollHeight) {
          const msg = t('act_errors_pageAlreadyAtBottom');
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({ extractedContent: msg, includeInMemory: true });
        }

        await page.scrollToNextPage();
      }
      const msg = t('act_nextPage_ok');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
      return new ActionResult({ extractedContent: msg, includeInMemory: true });
    }, nextPageActionSchema);
    actions.push(nextPage);

    // Scroll to text
    const scrollToText = new Action(async (input: z.infer<typeof scrollToTextActionSchema.schema>) => {
      const intent = input.intent || t('act_scrollToText_start', [input.text, input.nth.toString()]);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      try {
        const scrolled = await page.scrollToText(input.text, input.nth);
        const msg = scrolled
          ? t('act_scrollToText_ok', [input.text, input.nth.toString()])
          : t('act_scrollToText_notFound', [input.text, input.nth.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({ extractedContent: msg, includeInMemory: true });
      } catch (error) {
        const msg = t('act_scrollToText_failed', [error instanceof Error ? error.message : String(error)]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
    }, scrollToTextActionSchema);
    actions.push(scrollToText);

    // Keyboard Actions
    const sendKeys = new Action(async (input: z.infer<typeof sendKeysActionSchema.schema>) => {
      const intent = input.intent || 'Sending keyboard input';
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

      const page = await this.context.browserContext.getCurrentPage();
      await page.sendKeys(input.keys);
      const keyKind = /^enter$/i.test(input.keys) ? 'Enter' : 'keyboard input';
      const keyMessage = `Sent ${keyKind}`;
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, keyMessage);
      return new ActionResult({ extractedContent: keyMessage, includeInMemory: true });
    }, sendKeysActionSchema);
    actions.push(sendKeys);

    const controlMedia = new Action(async (input: z.infer<typeof controlMediaActionSchema.schema>) => {
      const page = await this.context.browserContext.getCurrentPage();
      const result = await page.controlMedia(input.command, input.target_digest);
      if (result.kind !== 'bound') {
        return new ActionResult({
          error: result.kind === 'ambiguous' ? 'media_target_ambiguous' : 'media_target_missing',
        });
      }
      return new ActionResult({ success: true, extractedContent: `Media ${input.command} requested` });
    }, controlMediaActionSchema);
    actions.push(controlMedia);

    const saveScreenshot = new Action(async (input: z.infer<typeof saveScreenshotActionSchema.schema>) => {
      const intent = input.intent || t('act_saveScreenshot_start');
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
      try {
        const page = await this.context.browserContext.getCurrentPage();
        let host = 'page';
        try {
          host = new URL(page.url()).hostname;
        } catch {
          // ignore URL parse failures
        }
        const filename = sanitizeScreenshotFilename(input.filename, host);
        const base64 = await page.takeScreenshot(false);
        if (!base64) {
          throw new Error('screenshot_empty');
        }
        const { downloadId, filename: savedAs } = await downloadJpegToDownloads({
          base64,
          filename,
        });
        const msg = t('act_saveScreenshot_ok', [savedAs, String(downloadId)]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return new ActionResult({
          success: true,
          extractedContent: msg,
          includeInMemory: true,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const msg = t('act_saveScreenshot_failed', [detail]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, msg);
        return new ActionResult({ error: msg, includeInMemory: true });
      }
    }, saveScreenshotActionSchema);
    actions.push(saveScreenshot);

    // Get all options from a native dropdown
    const getDropdownOptions = new Action(
      async (input: z.infer<typeof getDropdownOptionsActionSchema.schema>) => {
        const intent = input.intent || t('act_getDropdownOptions_start', [input.index.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        try {
          // Use the existing getDropdownOptions method
          const options = await page.getDropdownOptions(input.index);

          if (options && options.length > 0) {
            // Format options for display
            const formattedOptions: string[] = options.map(opt => {
              // Encoding ensures AI uses the exact string in select_dropdown_option
              const encodedText = JSON.stringify(opt.text);
              return `${opt.index}: text=${encodedText}`;
            });

            let msg = formattedOptions.join('\n');
            msg += '\n' + t('act_getDropdownOptions_useExactText');
            this.context.emitEvent(
              Actors.NAVIGATOR,
              ExecutionState.ACT_OK,
              t('act_getDropdownOptions_ok', [options.length.toString()]),
            );
            return new ActionResult({
              extractedContent: msg,
              includeInMemory: true,
            });
          }

          // This code should not be reached as getDropdownOptions throws an error when no options found
          // But keeping as fallback
          const msg = t('act_getDropdownOptions_noOptions');
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({
            extractedContent: msg,
            includeInMemory: true,
          });
        } catch (error) {
          const errorMsg = t('act_getDropdownOptions_failed', [error instanceof Error ? error.message : String(error)]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }
      },
      getDropdownOptionsActionSchema,
      true,
    );
    actions.push(getDropdownOptions);

    // Select dropdown option for interactive element index by the text of the option you want to select'
    const selectDropdownOption = new Action(
      async (input: z.infer<typeof selectDropdownOptionActionSchema.schema>) => {
        const intent = input.intent || t('act_selectDropdownOption_start', [input.text, input.index.toString()]);
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);

        const page = await this.context.browserContext.getCurrentPage();
        const state = await page.getState();

        const elementNode = state?.selectorMap.get(input.index);
        if (!elementNode) {
          const errorMsg = t('act_errors_elementNotExist', [input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        // Validate that we're working with a select element
        if (!elementNode.tagName || elementNode.tagName.toLowerCase() !== 'select') {
          const errorMsg = t('act_selectDropdownOption_notSelect', [
            input.index.toString(),
            elementNode.tagName || 'unknown',
          ]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }

        logger.debug('Selecting dropdown option', { elementIndex: input.index });

        try {
          const result = await page.selectDropdownOption(input.index, input.text);
          const msg = t('act_selectDropdownOption_ok', [input.text, input.index.toString()]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
          return new ActionResult({
            extractedContent: result,
            includeInMemory: true,
          });
        } catch (error) {
          const errorMsg = t('act_selectDropdownOption_failed', [
            error instanceof Error ? error.message : String(error),
          ]);
          this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMsg);
          return new ActionResult({
            error: errorMsg,
            includeInMemory: true,
          });
        }
      },
      selectDropdownOptionActionSchema,
      true,
    );
    actions.push(selectDropdownOption);

    return actions;
  }
}
