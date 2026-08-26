import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_CONTAINER_ID,
  PIP_DEFAULT_SIZE,
  PIP_FILL_CSS,
  PIP_PARKED_ID,
  applyStyleCopies,
  collectStyleCopies,
  createChatPipController,
  focusChatComposer,
  getDocumentPip,
  pipWindowOptions,
  queryChatComposer,
  restoreMovedNode,
  setActiveChatRoot,
  setOpenerParked,
} from '../document-pip';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../document-pip.ts'), 'utf8');
const buttonSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../components/PictureInPictureButton.tsx'),
  'utf8',
);

afterEach(() => {
  setActiveChatRoot(null);
});

function detach(node: FakeEl) {
  const previous = node.parentNode;
  if (!previous) return;
  const index = previous.children.indexOf(node);
  if (index >= 0) previous.children.splice(index, 1);
  node.parentNode = null;
}

function createFakeDocument() {
  const byId = new Map<string, FakeEl>();
  const createElement = (tag: string): FakeEl => {
    const attrs: Record<string, string> = {};
    const el: FakeEl = {
      tagName: tag.toUpperCase(),
      textContent: '',
      rel: '',
      href: '',
      className: '',
      hidden: false,
      parentNode: null,
      get id() {
        return attrs.id ?? '';
      },
      set id(value: string) {
        attrs.id = value;
        byId.set(value, el);
      },
      setAttribute(name: string, value: string) {
        attrs[name] = value;
        if (name === 'id') el.id = value;
      },
    };
    return el;
  };

  const makeParent = () => {
    const parent: FakeParent = {
      children: [],
      get firstChild() {
        return parent.children[0] ?? null;
      },
      appendChild(node: FakeEl) {
        detach(node);
        parent.children.push(node);
        node.parentNode = parent;
        return node;
      },
      insertBefore(node: FakeEl, ref: FakeEl | null) {
        detach(node);
        const at = ref ? parent.children.indexOf(ref) : 0;
        parent.children.splice(at < 0 ? 0 : at, 0, node);
        node.parentNode = parent;
        return node;
      },
    };
    return parent;
  };

  const body = Object.assign(makeParent(), { className: '', dataset: {} as Record<string, string> });
  const head = makeParent();
  return {
    documentElement: { lang: 'zh-CN', className: '' },
    body,
    head,
    styleSheets: [] as Array<{ href?: string | null; cssRules?: Array<{ cssText: string }> | null }>,
    createElement,
    getElementById: (id: string) => byId.get(id) ?? null,
  };
}

type FakeEl = {
  tagName: string;
  textContent: string;
  rel: string;
  href: string;
  className: string;
  hidden: boolean;
  parentNode: FakeParent | null;
  id: string;
  setAttribute: (name: string, value: string) => void;
};

type FakeParent = {
  children: FakeEl[];
  firstChild: FakeEl | null;
  appendChild: (node: FakeEl) => FakeEl;
  insertBefore: (node: FakeEl, ref: FakeEl | null) => FakeEl;
};

describe('document picture-in-picture helper', () => {
  it('does not float the chat with chrome.windows.create', () => {
    expect(source).toContain('requestWindow');
    expect(source).toContain('documentPictureInPicture');
    expect(source).not.toContain('chrome.windows');
    expect(buttonSource).toContain('createChatPipController');
    expect(buttonSource).not.toContain('chrome.windows');
    expect(buttonSource).toContain('APP_CONTAINER_ID');
  });

  it('returns null when Document PiP is missing', () => {
    expect(getDocumentPip({} as Window)).toBeNull();
    expect(getDocumentPip({ documentPictureInPicture: {} } as unknown as Window)).toBeNull();
  });

  it('sizes the window from the side panel, clamped for a compact chat', () => {
    expect(pipWindowOptions()).toEqual({
      width: PIP_DEFAULT_SIZE.width,
      height: PIP_DEFAULT_SIZE.height,
      preferInitialWindowPlacement: true,
    });
    expect(pipWindowOptions({ innerWidth: 390, innerHeight: 720 })).toEqual({
      width: 390,
      height: 720,
      preferInitialWindowPlacement: true,
    });
    expect(pipWindowOptions({ innerWidth: 120, innerHeight: 900 }).width).toBe(280);
    expect(pipWindowOptions({ innerWidth: 800, innerHeight: 900 }).width).toBe(420);
  });

  it('copies readable cssRules and falls back to stylesheet href', () => {
    const copies = collectStyleCopies([
      { cssRules: [{ cssText: '.a{color:red}' }, { cssText: '.b{margin:0}' }] },
      { href: 'https://example.test/app.css', cssRules: null },
      {
        href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk',
        get cssRules(): ArrayLike<{ cssText: string }> {
          throw new Error('cross-origin');
        },
      },
    ]);
    expect(copies[0]).toEqual({ tag: 'style', cssText: '.a{color:red}\n.b{margin:0}' });
    expect(copies[1]).toEqual({ tag: 'link', href: 'https://example.test/app.css' });
    expect(copies[2]).toEqual({
      tag: 'link',
      href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk',
    });
    expect(copies.at(-1)).toEqual({ tag: 'style', cssText: PIP_FILL_CSS });
  });

  it('applies style copies onto the PiP document head', () => {
    const pipDoc = createFakeDocument();
    applyStyleCopies(pipDoc as unknown as Document, [
      { tag: 'style', cssText: '.x{}' },
      { tag: 'link', href: 'chrome-extension://id/assets/index.css' },
    ]);
    expect(pipDoc.head.children).toHaveLength(2);
    expect(pipDoc.head.children[0]?.tagName).toBe('STYLE');
    expect(pipDoc.head.children[0]?.textContent).toBe('.x{}');
    expect(pipDoc.head.children[1]?.tagName).toBe('LINK');
    expect(pipDoc.head.children[1]?.href).toBe('chrome-extension://id/assets/index.css');
    expect(pipDoc.head.children[1]?.rel).toBe('stylesheet');
  });

  it('parks a status line on the opener while the chat is moved', () => {
    const doc = createFakeDocument();
    const app = doc.createElement('div');
    app.id = APP_CONTAINER_ID;
    doc.body.appendChild(app);
    setOpenerParked(doc as unknown as Document, '聊天已浮出。', true);
    expect(doc.body.dataset.chatPip).toBe('open');
    const parked = doc.getElementById(PIP_PARKED_ID);
    expect(parked?.textContent).toBe('聊天已浮出。');
    expect(parked?.className).toBe('chijie-pip-parked');
    expect(doc.body.children[0]).toBe(parked);
    setOpenerParked(doc as unknown as Document, '', false);
    expect(doc.body.dataset.chatPip).toBeUndefined();
  });

  it('moves the chat node into the PiP window and back on pagehide', async () => {
    const openerDoc = createFakeDocument();
    const pipDoc = createFakeDocument();
    const node = openerDoc.createElement('div');
    node.id = APP_CONTAINER_ID;
    openerDoc.body.appendChild(node);
    const pagehide: Array<() => void> = [];
    const pipWindow = {
      closed: false,
      document: pipDoc,
      addEventListener(_type: string, handler: () => void) {
        pagehide.push(handler);
      },
      close() {
        this.closed = true;
        pagehide.splice(0).forEach(handler => handler());
      },
    };
    const requestWindow = vi.fn(async () => pipWindow);
    const host = {
      innerWidth: 360,
      innerHeight: 640,
      document: openerDoc,
      documentPictureInPicture: { requestWindow, window: null },
    };
    const events: string[] = [];
    const controller = createChatPipController(host as unknown as Window, {
      onOpen: () => events.push('open'),
      onClose: () => events.push('close'),
    });

    expect(controller.supported).toBe(true);
    const opened = await controller.open({
      node: node as unknown as Element,
      home: openerDoc.body as unknown as ParentNode,
      parkedText: '聊天已浮出。换标签也还在；关掉侧栏会一起关掉。',
    });
    expect(opened).toEqual({ ok: true });
    expect(requestWindow).toHaveBeenCalledWith({
      width: 360,
      height: 640,
      preferInitialWindowPlacement: true,
    });
    expect(pipDoc.body.children).toContain(node);
    expect(openerDoc.body.children).not.toContain(node);
    expect(openerDoc.body.dataset.chatPip).toBe('open');
    expect(events).toEqual(['open']);

    controller.close();
    expect(pipWindow.closed).toBe(true);
    expect(openerDoc.body.children).toContain(node);
    expect(pipDoc.body.children).not.toContain(node);
    expect(openerDoc.body.dataset.chatPip).toBeUndefined();
    expect(events).toEqual(['open', 'close']);
  });

  it('rejects a second open while requestWindow is in flight', async () => {
    let release: (value: unknown) => void = () => undefined;
    const requestWindow = vi.fn(
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
    );
    const host = {
      document: createFakeDocument(),
      documentPictureInPicture: { requestWindow, window: null },
    };
    const controller = createChatPipController(host as unknown as Window);
    const node = host.document.createElement('div');
    const first = controller.open({
      node: node as unknown as Element,
      home: host.document.body as unknown as ParentNode,
      parkedText: 'parked',
    });
    await expect(
      controller.open({
        node: node as unknown as Element,
        home: host.document.body as unknown as ParentNode,
        parkedText: 'parked',
      }),
    ).resolves.toEqual({ ok: false, reason: 'in_flight' });
    release({
      closed: false,
      document: createFakeDocument(),
      addEventListener() {
        return undefined;
      },
      close() {
        return undefined;
      },
    });
    await first;
  });

  it('finds the composer in the moved chat root, not only the opener document', () => {
    const textarea = { tagName: 'TEXTAREA', focus: vi.fn(), scrollIntoView: vi.fn() } as unknown as HTMLTextAreaElement;
    const pipRoot = {
      querySelector(selector: string) {
        return selector === '.chijie-composer textarea' ? textarea : null;
      },
    };
    setActiveChatRoot(pipRoot as unknown as ParentNode);
    expect(queryChatComposer()).toBe(textarea);
    expect(focusChatComposer()).toBe(textarea);
  });

  it('restores a node only when it left home', () => {
    const home = {
      children: [] as unknown[],
      appendChild: vi.fn(function append(this: { children: unknown[] }, n: unknown) {
        this.children.push(n);
        return n;
      }),
    };
    const node = { parentNode: home };
    restoreMovedNode(node as unknown as Element, home as unknown as ParentNode);
    expect(home.appendChild).not.toHaveBeenCalled();
    node.parentNode = { appendChild: vi.fn() } as unknown as typeof home;
    restoreMovedNode(node as unknown as Element, home as unknown as ParentNode);
    expect(home.appendChild).toHaveBeenCalledWith(node);
  });
});
