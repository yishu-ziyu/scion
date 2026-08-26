/**
 * Decide whether a control turn may finish, must read the page, or must retry.
 * Default observe already carries visible wording; hasPageBody is true when that
 * wording is usable, or after an explicit read_page_text (021 / 005).
 */
import { isPlaceholderDelivery } from '../../task/result-text';

export { judgeBilibiliWatchComplete as judgeVisibleVideoOpenComplete } from '../../browser/sites/bilibili-first-video';

export const READ_PAGE_BEFORE_RESULT = 'Visible page wording is empty. Read the page text before writing the result.';

export const WRITE_RESULT_NOT_ACK =
  'That output was an acknowledgement or empty, not a checkable result. Write the result from the page text in observation and set done true. Do not promise to read later.';

export const JUDGE_PAGE_THEN_WRITE =
  "You can see the page. Judge whether the user's sentence is already done from visible wording. If yes, write the user-facing result and set done true. If not, take one action. Do not acknowledge.";

export const ANSWER_OR_ATTACH =
  'No page is attached. If you can answer without the page, write the answer in observation and set done true. If you need the page, emit a page action (observe, go_to_url, open_tab, find_tab, search_google). Do not invent page facts.';

export type ControlDeliveryResolution =
  | { kind: 'complete' }
  | { kind: 'act' }
  | { kind: 'read_page'; observation: string }
  | { kind: 'retry'; feedback: string }
  | { kind: 'missing_action' };

function resolveUnattachedDelivery(input: {
  done: boolean;
  observation: string;
  hasAction: boolean;
}): ControlDeliveryResolution {
  if (input.hasAction) return { kind: 'act' };
  if (input.done && !isPlaceholderDelivery(input.observation)) return { kind: 'complete' };
  if (input.observation.trim().length >= 8 && !isPlaceholderDelivery(input.observation)) {
    return { kind: 'complete' };
  }
  return { kind: 'retry', feedback: ANSWER_OR_ATTACH };
}

export function resolveControlDelivery(input: {
  done: boolean;
  observation: string;
  hasAction: boolean;
  hasPageBody: boolean;
  /** False on the first decide before any debugger attach. Defaults true. */
  pageAttached?: boolean;
}): ControlDeliveryResolution {
  if (input.pageAttached === false) return resolveUnattachedDelivery(input);
  if (input.done) {
    if (isPlaceholderDelivery(input.observation)) {
      if (!input.hasPageBody) return { kind: 'read_page', observation: READ_PAGE_BEFORE_RESULT };
      return { kind: 'retry', feedback: WRITE_RESULT_NOT_ACK };
    }
    return { kind: 'complete' };
  }
  if (input.hasAction) return { kind: 'act' };
  if (!input.hasPageBody) return { kind: 'read_page', observation: READ_PAGE_BEFORE_RESULT };
  // 005: a written non-ack observation is the result. The done bit is protocol, not the result.
  if (input.observation.trim().length >= 8 && !isPlaceholderDelivery(input.observation)) {
    return { kind: 'complete' };
  }
  return { kind: 'retry', feedback: JUDGE_PAGE_THEN_WRITE };
}
