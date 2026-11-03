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
    // Pinned to the screen's foot: fixed or sticky, and shown at all. A bar hidden on a wide screen (a room's,
    // `lg:hidden`) keeps its sticky position in the computed style, and measures as a box at the top of the screen:
    // taken for pinned, every click that focused something scrolled the page down by it.
    const pinnedNow = () => {
      const style = getComputedStyle(bar);
      return (style.position === 'fixed' || style.position === 'sticky') && bar.getClientRects().length > 0;
    };
    const measure = () => {
      const style = getComputedStyle(bar);
      // Not pinned (`cramped:static`, a wide screen's own layout, hidden): nothing to keep clear of.
      const room = pinnedNow() ? bar.offsetHeight + (Number.parseFloat(style.bottom) || 0) : 0;
      html.style.setProperty('--bottom-bar', `${Math.ceil(room)}px`);
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(bar);
    window.addEventListener('resize', measure);
    // WebKit scrolls a focused field into view without the scroll padding (Safari's Tab put „Отговор Г“ under the
    // bar all the same): after the browser's own scroll, whatever is still under the bar is scrolled clear of it.
    let frame = 0;
    const keepClear = (event: FocusEvent) => {
      const field = event.target;
      // Not the bar's own, and not what holds the bar: a tap on the page's plain text focuses <main> (it takes the
      // focus after a move: tabindex -1), and keeping all of <main> clear of the bar scrolled to the page's end — on a
      // phone, a tap anywhere in a room took it down to the start button.
      if (!(field instanceof HTMLElement) || bar.contains(field) || field.contains(bar)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!pinnedNow()) return;
        const box = field.getBoundingClientRect();
        const edge = bar.getBoundingClientRect();
        // Only what the bar covers: a field below a bar that sits where the page puts it is in view as it is.
        if (box.top >= edge.bottom) return;
        // …and only what fits above it: something taller can't be brought clear by scrolling, only lost.
        if (box.height > edge.top - 16) return;
        const over = box.bottom - (edge.top - 16);
        if (over > 0) window.scrollBy({ top: over, behavior: 'instant' });
      });
    };
    document.addEventListener('focusin', keepClear);
    return () => {
      resized.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', keepClear);
      window.removeEventListener('resize', measure);
      html.style.removeProperty('--bottom-bar');
    };
  }, []);
  return ref;
}
