import { type RefObject, useLayoutEffect } from 'react';

/**
 * A heading kept on one line (`white-space: nowrap`) steps its font down until it fits its box, never below `min` px:
 * the size a stylesheet gives it is a guess at its width, and a reader's letter spacing (WCAG 1.4.12) or a font that
 * loads late makes it wider. Refitted when its column changes width and once the fonts are in.
 */
export function useFitWidth(ref: RefObject<HTMLElement | null>, min = 16) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      let size = Number.parseFloat(getComputedStyle(el).fontSize);
      while (size > min && el.scrollWidth > el.clientWidth + 0.5) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    // In the next frame, not in the observer's callback: a change there resizes again in the same frame.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(el.parentElement ?? el);
    let live = true;
    document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ref, min]);
}
