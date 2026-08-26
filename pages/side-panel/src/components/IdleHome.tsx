import { useEffect, useState, type ComponentType } from 'react';
import { FiCheck, FiGlobe, FiList } from 'react-icons/fi';
import type { ActivityIconKey } from '../presentation/activity-stream';
import { IDLE_EXAMPLES } from '../presentation/idle-examples';

const ICON_MAP: Partial<Record<ActivityIconKey, ComponentType<{ className?: string }>>> = {
  globe: FiGlobe,
  list: FiList,
  check: FiCheck,
};

interface IdleHomeProps {
  hint: string;
  onPick: (prompt: string) => void;
  savedCount?: number;
}

export function IdleHome({ hint, onPick, savedCount = 0 }: IdleHomeProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`chijie-idle-home t-stagger${shown ? ' is-shown' : ''}`} data-testid="empty-composer-spacer">
      <header className="chijie-idle-hero">
        <h1 className="t-stagger-line t-stagger-line--1">把要做的事交出去</h1>
        <p className="t-stagger-line t-stagger-line--2" data-testid="idle-delegate-hint">
          {hint}
        </p>
      </header>
      <section className="chijie-example-card" data-testid="idle-examples">
        {IDLE_EXAMPLES.map((example, index) => {
          const Icon = ICON_MAP[example.icon] ?? FiGlobe;
          return (
            <button
              key={example.id}
              type="button"
              className={`chijie-example-row t-stagger-line t-stagger-line--${index + 3}`}
              data-testid={`idle-example-${example.id}`}
              onClick={() => onPick(example.prompt)}>
              <span className="chijie-example-icon" aria-hidden>
                <Icon />
              </span>
              <span className="chijie-example-copy">
                <strong>{example.title}</strong>
                <span>{example.prompt}</span>
              </span>
            </button>
          );
        })}
        {savedCount > 0 ? (
          <p className="chijie-example-more t-stagger-line t-stagger-line--6">已保存 {savedCount} 条，可在下方再跑</p>
        ) : null}
      </section>
    </div>
  );
}
