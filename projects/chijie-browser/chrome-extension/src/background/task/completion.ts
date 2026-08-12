import type { CompletionCriterion, CompletionEvidence } from '@extension/storage/lib/task';
import type { ProbeObservation } from './contracts';

export interface CompletionCheckInput {
  now: number;
  currentRoundId: string;
  criteria: CompletionCriterion[];
  observations: ProbeObservation[];
}

export interface CompletionCheckResult {
  passed: boolean;
  evidence: CompletionEvidence[];
}

export function checkCompletion(input: CompletionCheckInput): CompletionCheckResult {
  if (input.criteria.length === 0) return { passed: false, evidence: [] };

  const evidence = input.criteria.map(criterion => {
    const observation = latestObservation(input.observations, criterion);
    const reason = rejectionReason(input, criterion, observation);
    return {
      criterionId: criterion.id,
      roundId: observation?.roundId ?? input.currentRoundId,
      targetRefId: observation?.targetRefId ?? criterion.targetRefId,
      observedAt: observation?.observedAt ?? input.now,
      source: observation?.source ?? 'page',
      value: observation?.value ?? false,
      passed: reason === undefined,
      ...(reason ? { reason } : {}),
    } satisfies CompletionEvidence;
  });

  return {
    passed: input.criteria.every((criterion, index) => !criterion.required || evidence[index]?.passed === true),
    evidence,
  };
}

function latestObservation(
  observations: ProbeObservation[],
  criterion: CompletionCriterion,
): ProbeObservation | undefined {
  const candidates = observations.filter(item => item.criterionId === criterion.id);
  const bound = candidates.filter(
    item =>
      item.roundId === criterion.roundId &&
      item.targetRefId === criterion.targetRefId &&
      (criterion.kind !== 'user_confirmed' || item.source === 'user'),
  );
  return latest(bound.length > 0 ? bound : candidates);
}

function latest(observations: ProbeObservation[]): ProbeObservation | undefined {
  return observations.reduce<ProbeObservation | undefined>(
    (current, item) => (!current || item.observedAt >= current.observedAt ? item : current),
    undefined,
  );
}

function rejectionReason(
  input: CompletionCheckInput,
  criterion: CompletionCriterion,
  observation: ProbeObservation | undefined,
): CompletionEvidence['reason'] | undefined {
  if (criterion.roundId !== input.currentRoundId) return 'wrong_round';
  if (!observation) return 'mismatch';
  if (observation.roundId !== input.currentRoundId) return 'wrong_round';
  if (observation.targetRefId !== criterion.targetRefId) return 'wrong_target';
  if (criterion.pageRevision && observation.pageRevision !== criterion.pageRevision) return 'wrong_target';
  if (observation.observedAt < criterion.notBefore) return 'stale';
  // Deadline starts from notBefore (advanced to executingAt on external commits),
  // not frozenAt. Otherwise any long verification wait would time out.
  // even when the post-commit observation is fresh.
  const deadline = criterion.notBefore + criterion.timeoutMs;
  if (input.now > deadline || observation.observedAt > deadline) {
    return 'timed_out';
  }
  if (baselineSatisfies(criterion)) return 'already_true_at_baseline';
  if (criterion.kind === 'user_confirmed' && observation.source !== 'user') return 'mismatch';
  return matches(criterion, observation.value) ? undefined : 'mismatch';
}

function baselineSatisfies(criterion: CompletionCriterion): boolean {
  if (criterion.kind === 'user_confirmed') return false;
  return matches(criterion, criterion.baseline);
}

function matches(criterion: CompletionCriterion, value: boolean | string): boolean {
  switch (criterion.kind) {
    case 'url':
      return typeof value === 'string' && matchesHttpUrl(criterion.operator, criterion.expected, value);
    case 'page_text':
      return typeof value === 'boolean' && value === (criterion.operator === 'present');
    case 'element_state':
    case 'media_state':
    case 'tab_state':
    case 'download_state':
      return value === criterion.expected;
    case 'user_confirmed':
      return value === true;
  }
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function normalizedPath(pathname: string): string {
  if (pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function normalizedSearch(url: URL): string | null {
  const raw = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  if (!raw) return '';
  if (/%(?![0-9a-f]{2})/i.test(raw)) return null;
  const pairs = raw.split('&').map(pair => {
    const separator = pair.indexOf('=');
    const rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
    const rawValue = separator >= 0 ? pair.slice(separator + 1) : '';
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, '%20'));
      const value = decodeURIComponent(rawValue.replace(/\+/g, '%20'));
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    } catch {
      return null;
    }
  });
  return pairs.every((pair): pair is string => pair !== null) ? pairs.join('&') : null;
}

export interface RedactedHttpUrlIdentity {
  normalizedUrl: string;
  /** Present only when the source URL has a non-empty, valid query. */
  queryIdentityDigest?: string;
}

let queryIdentityKeyPromise: Promise<CryptoKey> | undefined;
const QUERY_IDENTITY_KEY_STORAGE = 'task-query-identity-hmac-key-v1';

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], pair => Number.parseInt(pair, 16));
}

async function queryIdentitySecret(): Promise<Uint8Array> {
  const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  if (!storage) {
    const scope = globalThis as typeof globalThis & { __chijieQueryIdentitySecret?: Uint8Array };
    if (!scope.__chijieQueryIdentitySecret) {
      scope.__chijieQueryIdentitySecret = crypto.getRandomValues(new Uint8Array(32));
    }
    return scope.__chijieQueryIdentitySecret;
  }
  const stored = (await storage.get(QUERY_IDENTITY_KEY_STORAGE))[QUERY_IDENTITY_KEY_STORAGE];
  if (typeof stored === 'string') {
    const decoded = hexToBytes(stored);
    if (decoded) return decoded;
  }
  const generated = crypto.getRandomValues(new Uint8Array(32));
  await storage.set({ [QUERY_IDENTITY_KEY_STORAGE]: bytesToHex(generated) });
  return generated;
}

function queryIdentityKey(): Promise<CryptoKey> {
  if (!queryIdentityKeyPromise) {
    queryIdentityKeyPromise = queryIdentitySecret().then(secret =>
      crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    );
  }
  return queryIdentityKeyPromise;
}

async function hmacQueryIdentity(search: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await queryIdentityKey(), new TextEncoder().encode(search));
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Build durable URL provenance without persisting raw query values. Query
 * pair order is intentionally significant and malformed percent encoding is
 * rejected instead of being repaired implicitly.
 */
export async function redactedHttpUrlIdentity(value: string): Promise<RedactedHttpUrlIdentity | null> {
  const url = parseHttpUrl(value);
  if (!url) return null;
  const search = normalizedSearch(url);
  if (search === null) return null;
  const normalizedUrl = (url.origin + url.pathname).replace(/\/+$/, '') || url.origin;
  return {
    normalizedUrl,
    ...(search ? { queryIdentityDigest: await hmacQueryIdentity(search) } : {}),
  };
}

const QUERY_IDENTITY_PARAM = '__chijie_query_identity';

export function encodeRedactedHttpUrlIdentity(identity: RedactedHttpUrlIdentity): string {
  return identity.queryIdentityDigest
    ? `${identity.normalizedUrl}?${QUERY_IDENTITY_PARAM}=${identity.queryIdentityDigest}`
    : identity.normalizedUrl;
}

export async function durableHttpCompletionUrl(value: string): Promise<string | null> {
  const existing = parseHttpUrl(value);
  if (existing) {
    const match = new RegExp(`^\\?${QUERY_IDENTITY_PARAM}=([a-f0-9]{64})$`, 'i').exec(existing.search);
    if (match) {
      const normalizedUrl = (existing.origin + existing.pathname).replace(/\/+$/, '') || existing.origin;
      return `${normalizedUrl}?${QUERY_IDENTITY_PARAM}=${match[1]!.toLowerCase()}`;
    }
  }
  const identity = await redactedHttpUrlIdentity(value);
  return identity ? encodeRedactedHttpUrlIdentity(identity) : null;
}

/** URL-aware match: origin is exact and path prefixes stop at segment boundaries. */
export function matchesHttpUrl(
  operator: 'equals' | 'starts_with',
  expectedValue: string,
  observedValue: string,
): boolean {
  const expected = parseHttpUrl(expectedValue);
  const observed = parseHttpUrl(observedValue);
  if (!expected || !observed || expected.origin !== observed.origin) return false;
  const expectedPath = normalizedPath(expected.pathname);
  const observedPath = normalizedPath(observed.pathname);
  const expectedSearch = normalizedSearch(expected);
  const observedSearch = normalizedSearch(observed);
  if (expectedSearch === null || observedSearch === null) return false;
  if (operator === 'equals') return expectedPath === observedPath && expectedSearch === observedSearch;
  if (expectedSearch && expectedSearch !== observedSearch) return false;
  if (expectedPath === '/') return true;
  return observedPath === expectedPath || observedPath.startsWith(expectedPath + '/');
}
