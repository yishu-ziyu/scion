/**
 * Browser Kernel (product/022).
 * Thin façade over BrowserContext + ExecutorHooks.dispatchAction.
 * Does NOT re-implement browser control.
 */
import type { Action } from '../../agent/actions/builder';
import type BrowserContext from '../context';
import type { AgentContext } from '../../agent/types';
import type { ExecutorHooks } from '../../task/contracts';
import { bindIndexedActionToFrame } from '../../task/action-frame';
import { createLogger } from '../../log';
import { buildObservationFrame } from './observation';
import { computeObservationDiff } from './diff';
import { normalizeVisiblePageText } from './visible-text';
import type {
  BrowserKernel,
  ExtractionRequest,
  ExtractionResult,
  KernelActionResult,
  ObservationDiff,
  ObservationFrame,
  ObserveOptions,
  WaitCondition,
} from './types';

const logger = createLogger('BrowserKernel');

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

  async function observe(options?: ObserveOptions): Promise<ObservationFrame> {
    const useVision = options?.useVision ?? deps.defaultUseVision ?? deps.agentContext?.options.useVision ?? false;
    const includeAttributes =
      options?.includeAttributes ??
      deps.defaultIncludeAttributes ??
      deps.agentContext?.options.includeAttributes ??
      null;

    const browserState = await deps.browserContext.getState(useVision);
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
          documentHeight: Math.max(
            document.documentElement?.scrollHeight || 0,
            document.body?.scrollHeight || 0,
          ),
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
    const action = deps.resolveAction(actionName);
    if (!action) {
      return { error: `unknown action ${actionName}` };
    }
    const rawArgs = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
    const revision = frameRevision ?? last?.pageRevision ?? null;
    const boundArgs = bindIndexedActionToFrame(rawArgs, revision);
    try {
      const result = await deps.hooks.dispatchAction(roundId, action, boundArgs);
      if (deps.agentContext) {
        deps.agentContext.actionResults.push(result.actionResult);
      }
      return {
        error: result.actionResult?.error ?? null,
        isDone: Boolean(result.actionResult?.isDone),
        summary: result.actionResult?.extractedContent ?? null,
        pageRevision: result.pageRevision ?? revision ?? undefined,
      };
    } catch (error) {
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
    let lastFrame = last ?? (await observe());
    while (Date.now() <= deadline) {
      lastFrame = await observe();
      if (matchesCondition(lastFrame, condition)) return lastFrame;
      await sleep(200);
    }
    return lastFrame;
  }

  return {
    observe,
    act,
    extract,
    waitFor,
    lastFrame: () => last,
    diff: (from, to) => computeObservationDiff(from, to),
  };
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
