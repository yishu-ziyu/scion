import type { ComponentType } from 'react';
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
  return (
    <div className="chijie-idle-home" data-testid="empty-composer-spacer">
      <header className="chijie-idle-hero">
        <h1>把要做的事交出去</h1>
        <p data-testid="idle-delegate-hint">{hint}</p>
      </header>
      <section className="chijie-example-card" data-testid="idle-examples">
        {IDLE_EXAMPLES.map(example => {
          const Icon = ICON_MAP[example.icon] ?? FiGlobe;
          return (
            <button
              key={example.id}
              type="button"
              className="chijie-example-row"
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
          <p className="chijie-example-more">已保存 {savedCount} 条，可在下方再跑</p>
        ) : null}
      </section>
    </div>
  );
}
