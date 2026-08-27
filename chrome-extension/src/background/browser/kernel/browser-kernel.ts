/**
 * Browser Kernel (product/022).
 * Thin façade over BrowserContext + ExecutorHooks.dispatchAction.
 * Does NOT re-implement browser control.
 */
import type { Action } from '../../agent/actions/builder';
import { modelActionRejection } from '../../agent/actions/model-action-safety';
import type BrowserContext from '../context';
import type { AgentContext } from '../../agent/types';
import type { ExecutorHooks } from '../../task/contracts';
import { bindIndexedActionToFrame } from '../../task/action-frame';
import { createLogger } from '../../log';
import { buildObservationFrame } from './observation';
import { computeObservationDiff } from './diff';
import { normalizeVisiblePageText } from './visible-text';
import {
  PAGE_CHANGING_ACTIONS,
  type BrowserKernel,
  type ExtractionRequest,
  type ExtractionResult,
  type KernelActionResult,
  type ObservationDiff,
  type ObservationFrame,
  type ObserveOptions,
  type WaitCondition,
} from './types';

/** Poll for a new snapshot after clicks/navigations. readyState complete is not enough for SPA updates. */
const REVISION_CHANGE_TIMEOUT_MS = 4_000;

const logger = createLogger('BrowserKernel');

/**
 * Page.observeActionTarget throws these before the action executes when a
 * model-selected element disappeared between observation and dispatch. The
 * control loop must re-observe instead of treating that normal DOM race as an
 * extension runtime error or a successful action.
 */
function isStaleActionTargetError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === 'Action target is missing' || error.message === 'Action target is no longer available')
  );
}

export interface BrowserKernelDeps {
  browserContext: BrowserContext;
  /** Optional AgentContext for includeAttributes / useVision defaults. */
  agentContext?: AgentContext;
  hooks: Pick<ExecutorHooks, 'dispatchAction'>;
  /** Resolve action instances by name (from ActionBuilder registry). */
  resolveAction: (name: string) => Action | undefined;
  defaultUseVision?: boolean;
  defaultIncludeAttributes?: string[] | null;
}

export function createBrowserKernel(deps: BrowserKernelDeps): BrowserKernel {
  let last: ObservationFrame | null = null;
  // Assigned once after helpers close over it; prefer-const cannot apply.
  // eslint-disable-next-line prefer-const -- waitForPageChangeIfNeeded reads kernel.waitFor
  let kernel!: BrowserKernel;

  async function observe(options?: ObserveOptions): Promise<ObservationFrame> {
    const useVision = options?.useVision ?? deps.defaultUseVision ?? deps.agentContext?.options.useVision ?? false;
    const includeAttributes =
      options?.includeAttributes ??
      deps.defaultIncludeAttributes ??
      deps.agentContext?.options.includeAttributes ??
      null;

    const browserState = await deps.browserContext.getState(useVision, false, {
      waitForLoad: options?.waitForLoad,
    });
    const rawElementsText = browserState.elementTree.clickableElementsToString(includeAttributes);

    let media: ObservationFrame['media'] = { kind: 'none' };
    let viewport: ObservationFrame['viewport'];
    let visibleText = '';
    try {
      const page = await deps.browserContext.getCurrentPage();
      try {
        const mediaObs = await page.observeMedia();
        if (mediaObs.kind === 'bound') {
          media = {
            kind: 'bound',
            state: mediaObs.state,
            targetDigest: mediaObs.targetDigest,
          };
        } else if (mediaObs.kind === 'ambiguous') {
          media = { kind: 'ambiguous', candidateCount: mediaObs.candidateCount };
        }
      } catch {
        // media optional
      }
      try {
        const vp = await page.evaluate(() => ({
          scrollY: window.scrollY || window.pageYOffset || 0,
          viewportHeight: window.innerHeight || 0,
          documentHeight: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0),
        }));
        if (vp && typeof vp === 'object') {
          viewport = vp as ObservationFrame['viewport'];
        }
      } catch {
        // viewport optional
      }
      try {
        const raw = await page.evaluate(() => document.body?.innerText || '');
        visibleText = normalizeVisiblePageText(raw);
      } catch {
        // wording optional; empty visible text still recorded on the frame
      }
    } catch {
      // page attach optional
    }

    const frame = await buildObservationFrame({
      browserState,
      elementsText: rawElementsText,
      visibleText,
      media,
      viewport,
      enrichment: options?.enrichment,
      includeAttributes,
      query: options?.query,
    });
    last = frame;
    return frame;
  }

  async function act(
    roundId: string,
    actionName: string,
    args: unknown,
    frameRevision?: string,
  ): Promise<KernelActionResult> {
    const rejection = modelActionRejection(actionName, args);
    if (rejection) return { error: rejection };

    const action = deps.resolveAction(actionName);
    if (!action) {
      return { error: `unknown action ${actionName}` };
    }
    const rawArgs = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const revision = frameRevision ?? last?.pageRevision ?? null;
    const boundArgs = bindIndexedActionToFrame(rawArgs, revision);
    try {
      const result = await deps.hooks.dispatchAction(roundId, action, boundArgs);
      deps.agentContext?.actionResults.push(result.actionResult);
      const outcome: KernelActionResult = {
        error: result.actionResult?.error ?? null,
        isDone: Boolean(result.actionResult?.isDone),
        summary: result.actionResult?.extractedContent ?? null,
        pageRevision: result.pageRevision ?? revision ?? undefined,
      };
      await waitForPageChangeIfNeeded(actionName, outcome, revision);
      return outcome;
    } catch (error) {
      if (isStaleActionTargetError(error)) {
        logger.debug('kernel.act action target became stale; re-observe before retrying');
        return { error: 'action_target_stale' };
      }
      logger.error('kernel.act dispatch failed', error);
      const message =
        error instanceof Error
          ? error.name === 'StaleTaskRoundError'
            ? 'stale_task_round'
            : error.message || error.name
          : String(error);
      return { error: message };
    }
  }

  async function extract<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>> {
    try {
      let html = request.html;
      if (html === undefined) {
        const page = await deps.browserContext.getCurrentPage();
        html = await page.getContent();
      }
      if (!request.parser) {
        return { ok: true, data: html as unknown as T };
      }
      const data = request.parser(html);
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function waitFor(condition: WaitCondition, timeoutMs: number): Promise<ObservationFrame> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let lastFrame = last ?? (await observe({ waitForLoad: false }));
    while (Date.now() <= deadline) {
      lastFrame = await observe({ waitForLoad: false });
      if (matchesCondition(lastFrame, condition)) return lastFrame;
      await sleep(200);
    }
    return lastFrame;
  }

  async function waitForPageChangeIfNeeded(
    actionName: string,
    outcome: KernelActionResult,
    fromRevision: string | null,
  ): Promise<void> {
    if (outcome.error || !fromRevision || !PAGE_CHANGING_ACTIONS.has(actionName)) return;
    try {
      const frame = await kernel.waitFor({ kind: 'revision_changed', fromRevision }, REVISION_CHANGE_TIMEOUT_MS);
      if (frame.pageRevision) outcome.pageRevision = frame.pageRevision;
    } catch {
      // Dispatch already succeeded; the next observe retries the snapshot.
    }
  }

  kernel = {
    observe,
    act,
    extract,
    waitFor,
    lastFrame: () => last,
    diff: (from, to) => computeObservationDiff(from, to),
  };
  return kernel;
}

function matchesCondition(frame: ObservationFrame, condition: WaitCondition): boolean {
  switch (condition.kind) {
    case 'url_includes':
      return frame.tab.url.includes(condition.value);
    case 'url_starts_with':
      return frame.tab.url.startsWith(condition.value);
    case 'title_includes':
      return frame.tab.title.includes(condition.value);
    case 'text_includes':
      return frame.text.includes(condition.value) || Boolean(frame.visibleText?.includes(condition.value));
    case 'revision_changed':
      return frame.pageRevision !== condition.fromRevision;
    default:
      return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type { BrowserKernel, ObservationFrame, ObservationDiff };
