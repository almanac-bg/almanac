import { animate } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/** Re-renders every `intervalMs` and returns the current time. */
export function useNow(intervalMs = 250, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

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
