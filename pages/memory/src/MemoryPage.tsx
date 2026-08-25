import { useCallback, useEffect, useState } from 'react';
import { t } from '@extension/i18n';
import { userMemoryStore, type UserMemoryFact } from '@extension/storage';

const STRUCTURE_USER_MEMORY_TYPE = 'structure_user_memory';

function structureErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'empty':
      return t('memory_error_empty');
    case 'no_model':
      return t('memory_error_no_model');
    case 'no_facts':
      return t('memory_error_no_facts');
    case 'secret_not_stored':
      return t('memory_error_secret');
    default:
      return t('memory_error_llm');
  }
}

export default function MemoryPage() {
  const [sourceText, setSourceText] = useState('');
  const [facts, setFacts] = useState<UserMemoryFact[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const state = await userMemoryStore.getState();
    setSourceText(state.sourceText);
    setFacts(state.facts);
  }, []);

  useEffect(() => {
    document.title = t('memory_page_title');
    void refresh();
    return userMemoryStore.subscribe(() => {
      void refresh();
    });
  }, [refresh]);

  const persistSource = async (next: string) => {
    setSourceText(next);
    await userMemoryStore.setSourceText(next);
  };

  const structure = async () => {
    setBusy(true);
    setError('');
    try {
      await userMemoryStore.setSourceText(sourceText);
      const result = (await chrome.runtime.sendMessage({
        type: STRUCTURE_USER_MEMORY_TYPE,
        sourceText,
      })) as { ok?: boolean; error?: string };
      if (!result?.ok) {
        setError(structureErrorMessage(result?.error));
        return;
      }
      await refresh();
    } catch {
      setError(t('memory_error_llm'));
    } finally {
      setBusy(false);
    }
  };

  const updateFact = async (id: string, patch: Partial<Pick<UserMemoryFact, 'kind' | 'value'>>) => {
    const current = facts.find(fact => fact.id === id);
    if (!current) return;
    const next = { ...current, ...patch };
    setFacts(facts.map(fact => (fact.id === id ? next : fact)));
    try {
      await userMemoryStore.upsertFact({
        id,
        kind: next.kind,
        value: next.value,
        sourceText: next.sourceText,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'secret_not_stored') {
        setError(t('memory_error_secret'));
        await refresh();
        return;
      }
      throw error;
    }
  };

  const addRow = async () => {
    await userMemoryStore.upsertFact({ kind: '', value: '' });
    await refresh();
  };

  const removeRow = async (id: string) => {
    await userMemoryStore.removeFact(id);
    await refresh();
  };

  return (
    <main className="chijie-memory-shell">
      <div className="chijie-memory-column">
        <h1 className="chijie-memory-title">{t('memory_page_title')}</h1>
        <p className="chijie-memory-lead">{t('memory_page_lead')}</p>

        <section className="chijie-memory-section">
          <label className="chijie-memory-label" htmlFor="memory-source">
            {t('memory_source_label')}
          </label>
          <textarea
            id="memory-source"
            className="chijie-memory-note"
            value={sourceText}
            placeholder={t('memory_source_placeholder')}
            onChange={event => setSourceText(event.target.value)}
            onBlur={event => void persistSource(event.target.value)}
          />
          <div className="chijie-memory-actions">
            <button type="button" className="chijie-memory-btn" onClick={() => void structure()} disabled={busy}>
              {busy ? t('memory_structuring') : t('memory_structure')}
            </button>
          </div>
          {error ? (
            <p className="chijie-memory-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <section className="chijie-memory-section" aria-labelledby="memory-facts-heading">
          <h2 id="memory-facts-heading" className="chijie-memory-label">
            {t('memory_facts_heading')}
          </h2>
          {facts.length === 0 ? (
            <p className="chijie-memory-empty" role="status">
              {t('memory_empty')}
            </p>
          ) : (
            facts.map(fact => (
              <div className="chijie-memory-row" key={fact.id}>
                <label className="chijie-memory-label">
                  {t('memory_kind_label')}
                  <input
                    className="chijie-memory-input"
                    value={fact.kind}
                    onChange={event =>
                      setFacts(facts.map(item => (item.id === fact.id ? { ...item, kind: event.target.value } : item)))
                    }
                    onBlur={event => void updateFact(fact.id, { kind: event.target.value })}
                  />
                </label>
                <label className="chijie-memory-label">
                  {t('memory_value_label')}
                  <input
                    className="chijie-memory-input"
                    value={fact.value}
                    onChange={event =>
                      setFacts(facts.map(item => (item.id === fact.id ? { ...item, value: event.target.value } : item)))
                    }
                    onBlur={event => void updateFact(fact.id, { value: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="chijie-memory-btn chijie-memory-btn-secondary"
                  onClick={() => void removeRow(fact.id)}>
                  {t('memory_delete')}
                </button>
              </div>
            ))
          )}
          <div className="chijie-memory-actions">
            <button
              type="button"
              className="chijie-memory-btn chijie-memory-btn-secondary"
              onClick={() => void addRow()}>
              {t('memory_add_row')}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
