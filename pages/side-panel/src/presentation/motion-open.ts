import { useEffect, useRef, useState } from 'react';

export function readMotionMs(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Keep a surface mounted through `.is-closing` so the close scale can play. */
export function useDismissPhase(open: boolean, closeMsToken = '--dropdown-close-dur', fallback = 150) {
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setClosing(false);
      const id = window.requestAnimationFrame(() => setEntered(true));
      return () => window.cancelAnimationFrame(id);
    }
    setEntered(false);
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setClosing(true);
    const ms = prefersReducedMotion() ? 0 : readMotionMs(closeMsToken, fallback);
    const id = window.setTimeout(() => setClosing(false), ms);
    return () => window.clearTimeout(id);
  }, [closeMsToken, fallback, open]);

  return {
    mounted: open || closing,
    isOpen: open && entered,
    isClosing: closing && !open,
  };
}

export function dropdownClassName(phase: { isOpen: boolean; isClosing: boolean }): string {
  if (phase.isOpen) return 't-dropdown is-open';
  if (phase.isClosing) return 't-dropdown is-closing';
  return 't-dropdown';
}
