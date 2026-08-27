import { collectPageContext, PAGE_CONTEXT_COLLECT } from './page-context';

/**
 * Content script: page-operating affordance (design/005 P3).
 * Background sends CHIJIE_PAGE_OPERATING { active, text?, follow? }.
 * No tool names, digests, or failure codes in the bar copy.
 */

const BAR_ID = 'chijie-page-operating-bar';
const STYLE_ID = 'chijie-page-operating-style';
const MSG_TYPE = 'CHIJIE_PAGE_OPERATING';
const FOLLOW_TYPE = 'CHIJIE_PAGE_OPERATING_FOLLOW';
const TAKEOVER_TYPE = 'CHIJIE_PAGE_OPERATING_TAKEOVER';

const DEFAULT_TEXT = '持节正在操作这个页面';
const DEFAULT_FOLLOW = '跟随';
const DEFAULT_TAKEOVER = '接管';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${BAR_ID} {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(520px, calc(100vw - 32px));
  padding: 8px 10px 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(22, 35, 31, 0.12);
  background: #ffffff;
  color: #1a1a1a;
  font: 500 13px/1.35 system-ui, "Noto Sans SC", "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  user-select: none;
}
#${BAR_ID} [data-role="actions"] {
  display: inline-flex;
  gap: 4px;
}
#${BAR_ID} button {
  display: inline-flex;
  min-width: 40px;
  min-height: 40px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #1a1a1a;
  font: inherit;
  cursor: pointer;
}
#${BAR_ID} button[aria-pressed="true"] {
  background: #e8f3ef;
}
@media (prefers-reduced-motion: reduce) {
  #${BAR_ID} { transition: none; }
}
`;
  (document.head || document.documentElement).appendChild(style);
}

function requestFollow(follow: boolean): void {
  try {
    void chrome.runtime.sendMessage({ type: FOLLOW_TYPE, follow });
  } catch {
    // Extension context gone.
  }
}

function requestTakeover(): void {
  try {
    void chrome.runtime.sendMessage({ type: TAKEOVER_TYPE });
  } catch {
    // Extension context gone.
  }
}

function showBar(input: { text: string; follow: boolean; followLabel: string; takeoverLabel: string }): void {
  ensureStyle();
  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    const label = document.createElement('span');
    label.dataset.role = 'label';
    const actions = document.createElement('span');
    actions.dataset.role = 'actions';
    const follow = document.createElement('button');
    follow.type = 'button';
    follow.dataset.role = 'follow';
    follow.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      requestFollow(follow.getAttribute('aria-pressed') !== 'true');
    });
    const takeover = document.createElement('button');
    takeover.type = 'button';
    takeover.dataset.role = 'takeover';
    takeover.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      requestTakeover();
    });
    actions.append(follow, takeover);
    bar.append(label, actions);
    (document.body || document.documentElement).appendChild(bar);
  }
  const label = bar.querySelector('[data-role="label"]');
  if (label) label.textContent = input.text.trim() || DEFAULT_TEXT;
  const follow = bar.querySelector('[data-role="follow"]');
  if (follow instanceof HTMLButtonElement) {
    follow.textContent = input.followLabel || DEFAULT_FOLLOW;
    follow.setAttribute('aria-pressed', input.follow ? 'true' : 'false');
    follow.setAttribute('aria-label', input.followLabel || DEFAULT_FOLLOW);
  }
  const takeover = bar.querySelector('[data-role="takeover"]');
  if (takeover instanceof HTMLButtonElement) {
    takeover.textContent = input.takeoverLabel || DEFAULT_TAKEOVER;
    takeover.setAttribute('aria-label', input.takeoverLabel || DEFAULT_TAKEOVER);
  }
}

function hideBar(): void {
  document.getElementById(BAR_ID)?.remove();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== MSG_TYPE) return false;
  try {
    if (message.active) {
      showBar({
        text: typeof message.text === 'string' ? message.text : DEFAULT_TEXT,
        follow: Boolean(message.follow),
        followLabel: typeof message.followLabel === 'string' ? message.followLabel : DEFAULT_FOLLOW,
        takeoverLabel: typeof message.takeoverLabel === 'string' ? message.takeoverLabel : DEFAULT_TAKEOVER,
      });
    } else {
      hideBar();
    }
    sendResponse?.({ ok: true });
  } catch {
    sendResponse?.({ ok: false });
  }
  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== PAGE_CONTEXT_COLLECT) return false;
  try {
    const maxPayloadChars = typeof message.maxPayloadChars === 'number' ? message.maxPayloadChars : undefined;
    sendResponse(collectPageContext(document, maxPayloadChars));
  } catch {
    sendResponse(null);
  }
  return false;
});
