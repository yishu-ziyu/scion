/**
 * Content script: page-operating affordance (design/005 P3).
 * Background sends CHIJIE_PAGE_OPERATING { active, text? }.
 * No tool names, digests, or failure codes in the bar copy.
 */

const BAR_ID = 'chijie-page-operating-bar';
const STYLE_ID = 'chijie-page-operating-style';
const MSG_TYPE = 'CHIJIE_PAGE_OPERATING';

const DEFAULT_TEXT = '正在替你操作此页';

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
  max-width: min(420px, calc(100vw - 32px));
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(22, 35, 31, 0.12);
  background: rgba(22, 35, 31, 0.88);
  color: #f5f7f5;
  font: 500 13px/1.35 system-ui, "Noto Sans SC", "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  user-select: none;
}
@media (prefers-reduced-motion: reduce) {
  #${BAR_ID} { transition: none; }
}
`;
  (document.head || document.documentElement).appendChild(style);
}

function showBar(text: string): void {
  ensureStyle();
  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).appendChild(bar);
  }
  bar.textContent = text.trim() || DEFAULT_TEXT;
}

function hideBar(): void {
  document.getElementById(BAR_ID)?.remove();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== MSG_TYPE) return false;
  try {
    if (message.active) {
      showBar(typeof message.text === 'string' ? message.text : DEFAULT_TEXT);
    } else {
      hideBar();
    }
    sendResponse?.({ ok: true });
  } catch {
    sendResponse?.({ ok: false });
  }
  return false;
});
