import type { InteractiveElementDigest, ObservationFrame } from '../../browser/kernel';

export type QueuedActionTarget =
  | {
      kind: 'cdp';
      tabId: number;
      backendNodeId: number;
      cdpFrameId: string;
      cdpTargetId: string;
    }
  | {
      kind: 'id';
      tabId: number;
      tagName: string;
      id: string;
    }
  | {
      kind: 'semantic';
      tabId: number;
      tagName: string;
      type: string;
      name: string;
      label: string;
      placeholder: string;
    };

function text(value: string | undefined): string {
  return value?.trim() ?? '';
}

function tabId(frame: ObservationFrame, element: InteractiveElementDigest): number {
  return element.tabId ?? frame.tab.id;
}

/** Capture identity for an indexed action without retaining field values or page text. */
export function captureQueuedActionTarget(
  frame: ObservationFrame | null,
  args: Record<string, unknown>,
): QueuedActionTarget | null {
  if (!frame || typeof args.index !== 'number' || !Number.isFinite(args.index)) return null;
  const element = frame.interactiveElements.find(candidate => candidate.index === args.index);
  if (!element) return null;
  const elementTabId = tabId(frame, element);

  if (typeof element.backendNodeId === 'number' && element.backendNodeId > 0) {
    return {
      kind: 'cdp',
      tabId: elementTabId,
      backendNodeId: element.backendNodeId,
      cdpFrameId: text(element.cdpFrameId),
      cdpTargetId: text(element.cdpTargetId),
    };
  }

  const id = text(element.id);
  const tagName = text(element.tagName).toLowerCase();
  if (id) return { kind: 'id', tabId: elementTabId, tagName, id };

  const name = text(element.name);
  const label = text(element.label);
  const placeholder = text(element.placeholder);
  if (!name && !label && !placeholder) return null;
  return {
    kind: 'semantic',
    tabId: elementTabId,
    tagName,
    type: text(element.type).toLowerCase(),
    name,
    label,
    placeholder,
  };
}

/** Resolve the same target in a later observation. Ambiguous or replaced targets return null. */
export function resolveQueuedActionIndex(target: QueuedActionTarget, frame: ObservationFrame | null): number | null {
  if (!frame) return null;
  const matches = frame.interactiveElements.filter(element => {
    if (tabId(frame, element) !== target.tabId) return false;
    if (target.kind === 'cdp') {
      return (
        element.backendNodeId === target.backendNodeId &&
        text(element.cdpFrameId) === target.cdpFrameId &&
        text(element.cdpTargetId) === target.cdpTargetId
      );
    }
    const tagName = text(element.tagName).toLowerCase();
    if (target.kind === 'id') return tagName === target.tagName && text(element.id) === target.id;
    return (
      tagName === target.tagName &&
      text(element.type).toLowerCase() === target.type &&
      text(element.name) === target.name &&
      text(element.label) === target.label &&
      text(element.placeholder) === target.placeholder
    );
  });
  return matches.length === 1 ? matches[0].index : null;
}
