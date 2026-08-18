/**
 * Chrome DevTools Protocol node handle.
 * frameId is CDP Page.FrameId (string), not chrome.webNavigation's numeric id.
 * targetId is set when the node lives on an iframe debugger target.
 */
export type CdpElementHandle = {
  tabId: number;
  frameId: string;
  backendNodeId: number;
  targetId?: string;
  x?: number;
  y?: number;
};

export type DebuggerTarget = { tabId: number; targetId?: undefined } | { targetId: string; tabId?: undefined };

export type DebuggerTargetInfo = {
  id: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  tabId?: number;
};

export type CdpDomNode = {
  nodeId?: number;
  backendNodeId?: number;
  nodeName?: string;
  nodeType?: number;
  localName?: string;
  nodeValue?: string;
  attributes?: string[];
  children?: CdpDomNode[];
  shadowRoots?: CdpDomNode[];
  contentDocument?: CdpDomNode;
  frameId?: string;
};

export type CdpInteractiveNode = {
  handle: CdpElementHandle;
  tagName: string;
  text?: string;
  role?: string;
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  label?: string;
  inShadow?: boolean;
  inIframe?: boolean;
};
