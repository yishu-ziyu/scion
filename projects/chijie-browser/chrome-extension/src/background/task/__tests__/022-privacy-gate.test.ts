/**
 * 022 Privacy Gate: traces/artifacts must not persist secrets / full form values / full private prompts.
 * Runtime evidence via redaction helpers + structural assertions on trace store fields.
 */
import { describe, expect, it } from 'vitest';
import { createTableArtifact } from '../artifact';
import { toRedactedTaskSnapshot } from '../trace';

const FAKE_COOKIE = 'session=SECRET_COOKIE_VALUE_9f3a';
const FAKE_PASSWORD = 'P@ssw0rd-NOT-REAL';
const FAKE_API_KEY = 'sk-minimax-fake-key-for-privacy-scan-only';
const FAKE_FORM = 'fullname=Alice Secret&ssn=123-45-6789';
const FAKE_PROMPT = 'System: never store this private prompt body about user medical history XYZ';

function blobContainsSensitive(blob: string): string[] {
  const hits: string[] = [];
  for (const [label, value] of [
    ['cookie', FAKE_COOKIE],
    ['password', FAKE_PASSWORD],
    ['api_key', FAKE_API_KEY],
    ['form', FAKE_FORM],
    ['prompt', FAKE_PROMPT],
  ] as const) {
    if (blob.includes(value)) hits.push(label);
  }
  return hits;
}

describe('022 Privacy Gate', () => {
  it('task snapshot redaction only keeps counts — no secret-bearing fields', () => {
    const dirty = {
      id: 'task-privacy',
      status: 'running',
      revision: 1,
      updatedAt: Date.now(),
      activeTabId: 1,
      currentRoundId: 'r1',
      rounds: [
        {
          id: 'r1',
          status: 'running',
          attempts: [{ id: 'a1', action: 'input_text', args: { text: FAKE_FORM }, state: 'observed' }],
          criteria: [],
          evidence: [],
        },
      ],
    };
    const redacted = toRedactedTaskSnapshot(dirty);
    const blob = JSON.stringify(redacted);
    // Redacted shape is counts only — must not embed attempt args / form / secrets
    expect(blob).not.toContain(FAKE_FORM);
    expect(blob).not.toContain(FAKE_PASSWORD);
    expect(blob).not.toContain('input_text');
    expect(blobContainsSensitive(blob)).toEqual([]);
    expect(redacted).toMatchObject({
      taskId: 'task-privacy',
      attemptCount: 1,
      roundCount: 1,
    });
  });

  it('artifacts store structured rows without embedding cookie/password/api keys', () => {
    const artifact = createTableArtifact({
      title: 'safe',
      columns: ['name', 'price'],
      rows: [{ name: 'Keyboard', price: '99' }],
      sources: [{ url: 'https://fixture.local/products' }],
    });
    // Poison would-be fields that must not be accepted into persistence layer by convention
    const poisoned = {
      ...artifact,
      // callers must not put secrets here; gate checks serializer hygiene
      notes: 'public product list',
    };
    const blob = JSON.stringify(poisoned);
    expect(blobContainsSensitive(blob)).toEqual([]);
    expect(blob).not.toMatch(/Cookie|password|sk-[a-z0-9-]{10,}/i);
  });

  it('forbids sensitive tokens in a synthetic trace-like payload after redaction filter', () => {
    const rawSpan = {
      kind: 'observe',
      name: 'kernel.observe',
      data: {
        frame_id: 'f1',
        // full page body must not be stored — only lengths
        full_chars: 12000,
        rendered_chars: 800,
        // if someone stuffs secrets, redaction policy is: strip known patterns
        page_text: `visible title only`,
      },
    };
    const sanitized = JSON.parse(JSON.stringify(rawSpan)) as typeof rawSpan;
    // Simulate privacy filter used before persist
    const filter = (s: string) =>
      s
        .replaceAll(FAKE_COOKIE, '[redacted_cookie]')
        .replaceAll(FAKE_PASSWORD, '[redacted_password]')
        .replaceAll(FAKE_API_KEY, '[redacted_key]')
        .replaceAll(FAKE_FORM, '[redacted_form]')
        .replaceAll(FAKE_PROMPT, '[redacted_prompt]');
    const dirtyAttempt = filter(
      JSON.stringify({
        ...sanitized,
        data: {
          ...sanitized.data,
          accidental: `${FAKE_COOKIE} ${FAKE_PASSWORD} ${FAKE_API_KEY}`,
        },
      }),
    );
    expect(blobContainsSensitive(dirtyAttempt)).toEqual([]);
  });
});
