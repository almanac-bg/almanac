import { useLayoutEffect, useRef } from 'react';

/**
 * A page's own bar pinned to the foot of the screen (the set editor's save, the results' next step, a room's start):
 * while it's pinned, the page keeps that much room at the bottom when it scrolls a focused field into view — the bar's
 * height and how far above the screen's foot it sits (above the phone's tab bar, say). Without it, a field typed in
 * scrolled to just behind the bar (WCAG 2.4.11: the 31 October review, A11Y-1). styles.css reads `--bottom-bar`.
 */
export function useBottomBar<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const html = document.documentElement;
    const measure = () => {
      const style = getComputedStyle(bar);
      // Not pinned (`cramped:static`, a wide screen's own layout): nothing to keep clear of.
      const pinned = style.position === 'fixed' || style.position === 'sticky';
      const room = pinned ? bar.offsetHeight + (Number.parseFloat(style.bottom) || 0) : 0;
      html.style.setProperty('--bottom-bar', `${Math.ceil(room)}px`);
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(bar);
    window.addEventListener('resize', measure);
    return () => {
      resized.disconnect();
      window.removeEventListener('resize', measure);
      html.style.removeProperty('--bottom-bar');
    };
  }, []);
  return ref;
}
