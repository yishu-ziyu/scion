import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { prefersReducedMotion, readMotionMs } from '../presentation/motion-open';

export function PanelReveal({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(prefersReducedMotion);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setOpen(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={`t-panel-slide${className ? ` ${className}` : ''}`}
      data-open={open ? 'true' : 'false'}
      data-testid={testId}>
      {children}
    </div>
  );
}

export function MatrixLoader({ variant = 'scan' }: { variant?: 'scan' | 'pulse' }) {
  const cycle = readMotionMs('--matrix-cycle', 1200);
  return (
    <div className="t-matrix" data-variant={variant} aria-hidden="true">
      {Array.from({ length: 16 }, (_, idx) => {
        const col = idx % 4;
        const delay =
          variant === 'pulse'
            ? [5, 6, 9, 10].includes(idx)
              ? 0
              : Math.round(cycle * 0.16)
            : Math.round(col * (cycle / 10));
        return <i key={idx} style={{ ['--d']: String(delay) } as CSSProperties} />;
      })}
    </div>
  );
}

export function MotionTextSwap({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  const elRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(text);

  useEffect(() => {
    const el = elRef.current;
    if (!el || shown.current === text) return;
    if (prefersReducedMotion()) {
      shown.current = text;
      el.textContent = text;
      return;
    }
    const dur = readMotionMs('--text-swap-dur', 150);
    el.classList.add('is-exit');
    const id = window.setTimeout(() => {
      shown.current = text;
      el.textContent = text;
      el.classList.remove('is-exit');
      el.classList.add('is-enter-start');
      void el.offsetHeight;
      el.classList.remove('is-enter-start');
    }, dur);
    return () => window.clearTimeout(id);
  }, [text]);

  return (
    <span ref={elRef} className={`t-text-swap${className ? ` ${className}` : ''}`} data-testid={testId}>
      {shown.current}
    </span>
  );
}

export function HeaderTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="t-tt-wrap">
      {children}
      <span className="t-tt" role="tooltip">
        {label}
      </span>
    </span>
  );
}
