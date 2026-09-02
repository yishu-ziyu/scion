/**
 * LegacyActionAdapter (C2).
 *
 * Bridges the v2 protocol `BrowserAction` onto the pre-protocol ActionBuilder
 * actions: BrowserAction -> find legacy action by name -> convert input ->
 * execute -> convert ActionResult into an ActionReceipt.
 *
 * This is a NEW bridge; it is not wired into the production call path (the
 * old path keeps running). It is the only runtime-side module that knows the
 * legacy action shape — nothing else under browser/runtime imports the old
 * actions.
 *
 * Completion discipline: an ActionResult's `isDone` is deliberately dropped.
 * The ActionReceipt this adapter produces carries no completion semantics;
 * whether a task is done is decided above the protocol, never here.
 */
import {
  legacyErrorToBrowserError,
  makeBrowserError,
  type ActionReceipt,
  type BrowserAction,
  type BrowserActionKind,
} from '@chijie/browser-protocol';

/**
 * Structural shape of a legacy `Action` (see agent/actions/builder.ts). The
 * real class satisfies it; keeping it structural lets the adapter be tested
 * with a fake executor and avoids importing the 60KB builder module graph.
 */
export interface LegacyActionLike {
  name(): string;
  call(input: unknown): Promise<LegacyActionResultLike>;
}

/** Minimal structural view of the legacy `ActionResult`. */
export interface LegacyActionResultLike {
  isDone: boolean;
  success: boolean;
  extractedContent: string | null;
  error: string | null;
}

/** A collection of legacy actions the adapter can look up by name. */
export interface LegacyActionRunner {
  find(name: string): LegacyActionLike | undefined;
}

/** Runner backed by an array of legacy actions (what buildDefaultActions returns). */
export function runnerFromActions(actions: readonly LegacyActionLike[]): LegacyActionRunner {
  return {
    find: name => actions.find(action => action.name() === name),
  };
}

/** Explicit marker for actions this bridge does not (yet) map. */
export const UNSUPPORTED_ACTION = 'UNSUPPORTED_ACTION' as const;

/**
 * BrowserAction kind -> legacy action name. Kinds absent here (and the ones
 * with no faithful legacy equivalent) are reported as UNSUPPORTED_ACTION.
 */
const KIND_TO_LEGACY_NAME: Partial<Record<BrowserActionKind, string>> = {
  navigate: 'go_to_url',
  click: 'click_element',
  input_text: 'input_text',
  select_option: 'select_dropdown_option',
  send_keys: 'send_keys',
  open_tab: 'open_tab',
  switch_tab: 'switch_tab',
  close_tab: 'close_tab',
  go_back: 'go_back',
  media_control: 'control_media',
};

/** Convert a BrowserAction into the legacy action's input object. */
function toLegacyInput(action: BrowserAction): Record<string, unknown> {
  const target = action.target;
  const index = target && target.kind === 'element' ? target.index : undefined;
  const query = target && target.kind === 'element' ? (target.text ?? target.label ?? target.placeholder) : undefined;

  switch (action.kind) {
    case 'navigate':
      return { url: action.input.url };
    case 'click':
      // Legacy click_element needs index or query; prefer index, fall back to text.
      return index !== undefined ? { index } : { query: query ?? '' };
    case 'input_text':
      return index !== undefined ? { index, text: action.input.text } : { query: query ?? '', text: action.input.text };
    case 'select_option':
      return index !== undefined
        ? { index, text: action.input.optionText }
        : { query: query ?? '', text: action.input.optionText };
    case 'send_keys':
      return { keys: action.input.keys };
    case 'open_tab':
      return { url: action.input.url };
    case 'switch_tab':
      return { tab_id: action.input.tabId };
    case 'close_tab':
      return { tab_id: action.input.tabId };
    case 'go_back':
      return {};
    case 'media_control':
      return { command: action.input.command };
    default:
      return {};
  }
}

function beforeRevisionOf(action: BrowserAction): string {
  return action.target?.pageRevision ?? 'rev-unknown';
}

/**
 * ponytail — known coverage.
 * Mapped (production-path main actions): navigate→go_to_url, click→click_element,
 * input_text→input_text, select_option→select_dropdown_option, send_keys→send_keys,
 * open_tab→open_tab, switch_tab→switch_tab, close_tab→close_tab, go_back→go_back,
 * media_control→control_media.
 * NOT mapped (returned as UNSUPPORTED_ACTION): scroll (legacy splits it into
 * scroll_to_percent/top/bottom/text with no direction+amount equivalent), wait
 * (legacy wait takes seconds, protocol wait takes a condition+timeout — lossy).
 * Legacy-only actions with no protocol BrowserAction equivalent (done, observe,
 * extract_content, cache_content, record_evidence, research actions, find_tab,
 * inspect_open_tabs, get_dropdown_options, save_screenshot, read_page_text,
 * previous_page/next_page) are intentionally out of scope: this adapter maps
 * the protocol's action set downward, not the legacy set upward.
 * Upgrade path: when the runtime executor replaces this bridge, resolve real
 * CDP identities (backendNodeId/frameId) instead of index/query, and add
 * faithful scroll/wait mappings or extend the protocol kinds to match.
 */
export class LegacyActionAdapter {
  constructor(
    private readonly runner: LegacyActionRunner,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** True when this adapter can translate the given action kind. */
  supports(kind: BrowserActionKind): boolean {
    return kind in KIND_TO_LEGACY_NAME;
  }

  async execute(action: BrowserAction): Promise<ActionReceipt> {
    const legacyName = KIND_TO_LEGACY_NAME[action.kind];
    if (!legacyName) {
      return this.unsupported(action, `no legacy action mapped for kind '${action.kind}'`);
    }
    const legacy = this.runner.find(legacyName);
    if (!legacy) {
      return this.unsupported(action, `legacy action '${legacyName}' is not available`);
    }

    const input = toLegacyInput(action);
    let result: LegacyActionResultLike;
    try {
      result = await legacy.call(input);
    } catch (error) {
      // Legacy actions throw InvalidInputError / runtime errors; surface as a
      // mapped BrowserError, never let it ride through unstructured.
      const message = error instanceof Error ? error.message : String(error);
      return this.receipt(action, 'blocked', legacyErrorToBrowserError(message));
    }

    if (result.error) {
      return this.receipt(action, 'blocked', legacyErrorToBrowserError(result.error));
    }

    const evidence =
      result.extractedContent !== null
        ? [
            {
              kind: 'text' as const,
              ref: `legacy://${action.actionId}`,
              capturedAt: this.now(),
            },
          ]
        : [];
    const status = result.success ? 'applied' : 'no_effect';
    return {
      actionId: action.actionId,
      status,
      beforeRevision: beforeRevisionOf(action),
      afterRevision: beforeRevisionOf(action),
      evidence,
    };
  }

  private unsupported(action: BrowserAction, detail: string): ActionReceipt {
    return this.receipt(
      action,
      'blocked',
      makeBrowserError('INTERNAL_ERROR', `${UNSUPPORTED_ACTION}: ${detail} (action kind '${action.kind}')`, {
        retryable: false,
      }),
    );
  }

  private receipt(
    action: BrowserAction,
    status: ActionReceipt['status'],
    error: ReturnType<typeof makeBrowserError>,
  ): ActionReceipt {
    return {
      actionId: action.actionId,
      status,
      beforeRevision: beforeRevisionOf(action),
      evidence: [],
      error,
    };
  }
}
