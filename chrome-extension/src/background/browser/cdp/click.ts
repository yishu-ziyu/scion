/**
 * Click a node by tabId + frameId + backendNodeId via chrome.debugger.
 * Prefer element.click() on the node's own debugger target so iframe
 * box-model coordinates are never applied to the parent viewport.
 */
import { attach, getTargets, sendCommand, type DebuggerTarget } from './session';
import type { CdpElementHandle } from './types';

export function cdpHandleFromDomNode(node: {
  tabId?: number;
  cdpFrameId?: string;
  backendNodeId?: number;
  cdpTargetId?: string;
  viewportCoordinates?: { center?: { x?: number; y?: number } };
}): CdpElementHandle | null {
  if (typeof node.backendNodeId !== 'number' || node.backendNodeId <= 0) return null;
  if (!node.cdpFrameId) return null;
  if (typeof node.tabId !== 'number') return null;
  const center = node.viewportCoordinates?.center;
  return {
    tabId: node.tabId,
    frameId: node.cdpFrameId,
    backendNodeId: node.backendNodeId,
    targetId: node.cdpTargetId,
    x: typeof center?.x === 'number' ? center.x : undefined,
    y: typeof center?.y === 'number' ? center.y : undefined,
  };
}

export function debuggerTargetForHandle(handle: CdpElementHandle): number | DebuggerTarget {
  return handle.targetId ? { targetId: handle.targetId } : handle.tabId;
}

export async function resolveDebuggerTarget(handle: CdpElementHandle): Promise<number | DebuggerTarget> {
  if (handle.targetId) return { targetId: handle.targetId };
  if (handle.frameId && handle.frameId !== 'main') {
    try {
      const targets = await getTargets();
      const iframe = targets.find(
        item =>
          item.tabId === handle.tabId &&
          item.type === 'iframe' &&
          (item.id === handle.frameId || item.id === handle.targetId),
      );
      if (iframe?.id) return { targetId: iframe.id };
    } catch {
      // stay on the tab target
    }
  }
  return handle.tabId;
}

function quadCenter(content: number[]): { x: number; y: number } | null {
  if (content.length < 8) return null;
  return {
    x: (content[0]! + content[2]! + content[4]! + content[6]!) / 4,
    y: (content[1]! + content[3]! + content[5]! + content[7]!) / 4,
  };
}

async function resolveClickPoint(
  handle: CdpElementHandle,
  target: number | DebuggerTarget,
): Promise<{ x: number; y: number }> {
  if (typeof handle.x === 'number' && typeof handle.y === 'number') {
    return { x: handle.x, y: handle.y };
  }
  try {
    await sendCommand(target, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: handle.backendNodeId });
  } catch {
    // box model can still work if the node is already in view
  }
  const box = (await sendCommand(target, 'DOM.getBoxModel', { backendNodeId: handle.backendNodeId })) as
    | { model?: { content?: number[] } }
    | undefined;
  const point = quadCenter(box?.model?.content ?? []);
  if (!point) {
    throw new Error(`No box model for backendNodeId ${handle.backendNodeId}`);
  }
  return point;
}

async function clickViaDomFunction(handle: CdpElementHandle, target: number | DebuggerTarget): Promise<boolean> {
  const resolved = (await sendCommand(target, 'DOM.resolveNode', { backendNodeId: handle.backendNodeId })) as
    | { object?: { objectId?: string } }
    | undefined;
  const objectId = resolved?.object?.objectId;
  if (!objectId) return false;
  await sendCommand(target, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { if (this && this.click) { this.click(); return true; } return false; }',
  });
  return true;
}

function mouseEvent(type: 'mousePressed' | 'mouseReleased', x: number, y: number): { [key: string]: unknown } {
  return {
    type,
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  };
}

export async function clickCdpElement(handle: CdpElementHandle): Promise<void> {
  const target = await resolveDebuggerTarget(handle);
  await attach(target);
  try {
    if (await clickViaDomFunction(handle, target)) return;
  } catch {
    // fall through to mouse events on the same target
  }
  const { x, y } = await resolveClickPoint(handle, target);
  await sendCommand(target, 'Input.dispatchMouseEvent', mouseEvent('mousePressed', x, y));
  await sendCommand(target, 'Input.dispatchMouseEvent', mouseEvent('mouseReleased', x, y));
}
