/** Document Picture-in-Picture for the side-panel chat. Opener must be this document. */

export const APP_CONTAINER_ID = 'app-container';
export const PIP_PARKED_ID = 'chijie-pip-parked';
export const PIP_DEFAULT_SIZE = { width: 360, height: 640 } as const;
export const PIP_FILL_CSS = `html,body,#${APP_CONTAINER_ID}{height:100%;margin:0;}body{overflow:hidden;background:var(--chijie-background);color:var(--chijie-foreground);}`;

export type DocumentPipApi = {
  readonly window: Window | null;
  requestWindow: (options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }) => Promise<Window>;
};

export type StyleSheetLike = {
  href?: string | null;
  cssRules?: ArrayLike<{ cssText: string }> | null;
};

export type PipStyleCopy = { tag: 'style'; cssText: string } | { tag: 'link'; href: string };

export type ChatPipOpenInput = {
  node: Element;
  home: ParentNode;
  parkedText: string;
};

export type ChatPipOpenResult = { ok: true } | { ok: false; reason: 'unsupported' | 'in_flight' | 'failed' };

export type ChatPipController = {
  supported: boolean;
  isOpen: () => boolean;
  open: (input: ChatPipOpenInput) => Promise<ChatPipOpenResult>;
  close: () => void;
};

let activeChatRoot: ParentNode | null = null;

export function setActiveChatRoot(root: ParentNode | null): void {
  activeChatRoot = root;
}

export function getDocumentPip(host: Window): DocumentPipApi | null {
  const pip = Reflect.get(host, 'documentPictureInPicture') as DocumentPipApi | undefined;
  if (!pip || typeof pip.requestWindow !== 'function') return null;
  return pip;
}

export function pipWindowOptions(host?: { innerWidth?: number; innerHeight?: number }): {
  width: number;
  height: number;
  preferInitialWindowPlacement: true;
} {
  return {
    width: clampInt(host?.innerWidth, PIP_DEFAULT_SIZE.width, 280, 420),
    height: clampInt(host?.innerHeight, PIP_DEFAULT_SIZE.height, 400, 780),
    preferInitialWindowPlacement: true,
  };
}

export function collectStyleCopies(styleSheets: ArrayLike<StyleSheetLike>): PipStyleCopy[] {
  const copies: PipStyleCopy[] = [];
  for (const sheet of Array.from(styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) throw new Error('no cssRules');
      copies.push({
        tag: 'style',
        cssText: Array.from(rules)
          .map(rule => rule.cssText)
          .join('\n'),
      });
    } catch {
      if (sheet.href) copies.push({ tag: 'link', href: sheet.href });
    }
  }
  copies.push({ tag: 'style', cssText: PIP_FILL_CSS });
  return copies;
}

export function applyStyleCopies(
  toDoc: { createElement: Document['createElement']; head: { appendChild: (node: Node) => void } },
  copies: PipStyleCopy[],
): void {
  for (const copy of copies) {
    if (copy.tag === 'style') {
      const style = toDoc.createElement('style');
      style.textContent = copy.cssText;
      toDoc.head.appendChild(style);
      continue;
    }
    const link = toDoc.createElement('link') as HTMLLinkElement;
    link.rel = 'stylesheet';
    link.href = copy.href;
    toDoc.head.appendChild(link);
  }
}

export function applyPipDocument(fromDoc: Document, toDoc: Document): void {
  toDoc.documentElement.lang = fromDoc.documentElement.lang || 'zh-CN';
  toDoc.documentElement.className = fromDoc.documentElement.className;
  toDoc.body.className = fromDoc.body.className;
  applyStyleCopies(toDoc, collectStyleCopies(fromDoc.styleSheets));
}

export function setOpenerParked(doc: Document, text: string, parked: boolean): void {
  if (parked) doc.body.dataset.chatPip = 'open';
  else delete doc.body.dataset.chatPip;

  if (!parked) return;

  let el = doc.getElementById(PIP_PARKED_ID);
  if (!el) {
    el = doc.createElement('p');
    el.id = PIP_PARKED_ID;
    el.className = 'chijie-pip-parked';
    el.setAttribute('role', 'status');
    doc.body.insertBefore(el, doc.body.firstChild);
  }
  el.textContent = text;
}

export function restoreMovedNode(node: Element, home: ParentNode): void {
  try {
    if (node.parentNode !== home) home.appendChild(node);
  } catch {
    /* opener document is unloading; PiP cannot outlive it */
  }
}

export function queryChatComposer(): HTMLTextAreaElement | null {
  for (const root of chatSearchRoots()) {
    const found = root.querySelector('.chijie-composer textarea');
    if (found?.tagName === 'TEXTAREA') return found as HTMLTextAreaElement;
  }
  return null;
}

export function focusChatComposer(): HTMLTextAreaElement | null {
  const composer = queryChatComposer();
  composer?.focus();
  composer?.scrollIntoView({ block: 'nearest' });
  return composer;
}

export function createChatPipController(
  host: Window,
  hooks: { onOpen?: () => void; onClose?: () => void } = {},
): ChatPipController {
  const api = getDocumentPip(host);
  let pipWindow: Window | null = null;
  let opening = false;
  let home: ParentNode | null = null;
  let node: Element | null = null;

  const restore = () => {
    const moved = node;
    const dest = home;
    node = null;
    home = null;
    pipWindow = null;
    setActiveChatRoot(null);
    if (moved && dest) restoreMovedNode(moved, dest);
    try {
      setOpenerParked(host.document, '', false);
    } catch {
      /* opener is going away */
    }
    hooks.onClose?.();
  };

  return {
    supported: api !== null,
    isOpen: () => Boolean(pipWindow && !pipWindow.closed),
    async open(input) {
      if (!api) return { ok: false, reason: 'unsupported' };
      if (opening) return { ok: false, reason: 'in_flight' };
      opening = true;
      try {
        const next = await api.requestWindow(pipWindowOptions(host));
        applyPipDocument(host.document, next.document);
        setOpenerParked(host.document, input.parkedText, true);
        home = input.home;
        node = input.node;
        pipWindow = next;
        next.document.body.appendChild(input.node);
        setActiveChatRoot(input.node);
        next.addEventListener('pagehide', restore, { once: true });
        hooks.onOpen?.();
        return { ok: true };
      } catch {
        pipWindow = null;
        node = null;
        home = null;
        setActiveChatRoot(null);
        try {
          setOpenerParked(host.document, '', false);
        } catch {
          /* opener is going away */
        }
        return { ok: false, reason: 'failed' };
      } finally {
        opening = false;
      }
    },
    close() {
      pipWindow?.close();
    },
  };
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : fallback;
  return Math.min(max, Math.max(min, n));
}

function chatSearchRoots(): Array<Pick<ParentNode, 'querySelector'>> {
  const roots: Array<Pick<ParentNode, 'querySelector'>> = [];
  if (activeChatRoot) roots.push(activeChatRoot);
  if (typeof document === 'undefined' || !document?.querySelector) return roots;
  const app = document.getElementById(APP_CONTAINER_ID);
  if (app) roots.push(app);
  roots.push(document);
  return roots;
}
