import { animate } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/** Smoothly animates a displayed number towards `value`. */
export function useCountUp(value: number, duration = 0.8) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const controls = animate(from.current, value, {
      duration,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, duration]);
  return display;
}

/**
 * A row that may be wider than its box: whether it scrolls at all (so it should take keyboard focus) and whether more
 * of it is hidden past the right edge (so it should fade out there).
 */
export function useSideScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [state, setState] = useState({ scrolls: false, more: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const scrolls = el.scrollWidth > el.clientWidth + 1;
      const more = scrolls && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setState((s) => (s.scrolls === scrolls && s.more === more ? s : { scrolls, more }));
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', check);
    };
  }, []);
  return { ref, ...state };
}
