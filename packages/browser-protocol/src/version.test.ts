import { describe, expect, it } from 'vitest';
import {
  BROWSER_PROTOCOL_VERSION,
  checkProtocolVersion,
  isCurrentProtocolMessage,
  LEGACY_PROTOCOL_REQUIRES_ADAPTER,
  UNSUPPORTED_PROTOCOL_VERSION,
} from './version';
import { parseObservation, adaptLegacyObservation, type LegacyObservationFrame } from './legacy';
import { BrowserActionSchema } from './action';
import type { BrowserObservation } from './observation';

const minimalObservation: BrowserObservation = {
  protocolVersion: '2',
  observationId: 'obs-v',
  observedAt: 1700000000000,
  page: { kind: 'page', tabId: 1, url: 'https://example.com', title: 't', pageRevision: 'r1' },
  pageRevision: 'r1',
  interactiveElements: [],
  signals: [],
};

const legacyFrame: LegacyObservationFrame = {
  frameId: 'f1',
  observedAt: 1700000000000,
  tab: { id: 1, url: 'https://example.com', title: 't' },
  pageRevision: 'r1',
  interactiveElements: [{ index: 0, tagName: 'button', text: 'go', backendNodeId: 7 }],
};

describe('protocol version gate', () => {
  it('exports the current version', () => {
    expect(BROWSER_PROTOCOL_VERSION).toBe(2);
  });

  it('accepts v2 as string or number', () => {
    expect(checkProtocolVersion('2').ok).toBe(true);
    expect(checkProtocolVersion(2).ok).toBe(true);
  });

  it('rejects v999 as UNSUPPORTED_PROTOCOL_VERSION', () => {
    const result = checkProtocolVersion('999');
    expect(result).toEqual({ ok: false, code: UNSUPPORTED_PROTOCOL_VERSION, found: '999' });
  });

  it('routes v1 only through the Legacy Adapter', () => {
    const gate = checkProtocolVersion('1');
    expect(gate).toEqual({ ok: false, code: LEGACY_PROTOCOL_REQUIRES_ADAPTER, found: '1' });

    // parseObservation refuses v1 even when the payload is otherwise valid.
    const v1Doc = { ...minimalObservation, protocolVersion: '1' };
    const refused = parseObservation(v1Doc);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe(LEGACY_PROTOCOL_REQUIRES_ADAPTER);

    // The adapter is the only door.
    expect(adaptLegacyObservation(legacyFrame).protocolVersion).toBe('2');
  });

  it('rejects missing or malformed versions', () => {
    expect(checkProtocolVersion(undefined).ok).toBe(false);
    expect(checkProtocolVersion('v2').ok).toBe(false);
    expect(checkProtocolVersion(null).ok).toBe(false);
  });
});

describe('parseObservation', () => {
  it('parses a current-version observation', () => {
    const result = parseObservation(minimalObservation);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.observation.observationId).toBe('obs-v');
  });

  it('rejects observations missing required target identity', () => {
    const bad = {
      ...minimalObservation,
      interactiveElements: [{ kind: 'element', identity: { index: 2 }, pageRevision: 'r1' }],
    };
    const result = parseObservation(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_OBSERVATION');
  });

  it('rejects observations missing the page target', () => {
    const { protocolVersion, observationId, observedAt, pageRevision, interactiveElements, signals } =
      minimalObservation;
    expect(
      parseObservation({ protocolVersion, observationId, observedAt, pageRevision, interactiveElements, signals }).ok,
    ).toBe(false);
  });

  it('tolerates unknown optional fields without crashing', () => {
    const withExtras = {
      ...minimalObservation,
      futureField: { nested: [1, 2, 3] },
      anotherNew: 'ignored',
    };
    const result = parseObservation(withExtras);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.observation).not.toHaveProperty('futureField');
  });

  it('isCurrentProtocolMessage flags only v2 documents', () => {
    expect(isCurrentProtocolMessage(minimalObservation)).toBe(true);
    expect(isCurrentProtocolMessage({ protocolVersion: '3' })).toBe(false);
    expect(isCurrentProtocolMessage(null)).toBe(false);
    expect(isCurrentProtocolMessage('nonsense')).toBe(false);
  });
});

describe('version snapshots', () => {
  it('locks the serialized observation and action shapes', () => {
    expect(JSON.parse(JSON.stringify(minimalObservation))).toMatchSnapshot('observation-shape');
    const action = BrowserActionSchema.parse({
      protocolVersion: '2',
      actionId: 'snap-1',
      kind: 'click',
      effect: 'reversible_write',
      requestedAt: 1700000000000,
      target: { kind: 'element', identity: { backendNodeId: 1 }, pageRevision: 'r1' },
      input: {},
    });
    expect(JSON.parse(JSON.stringify(action))).toMatchSnapshot('action-shape');
  });
});
