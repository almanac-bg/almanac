import { m as motionM, useReducedMotion } from 'motion/react';
import { type ComponentType, createElement } from 'react';

/** What moves an element: under reduced motion nothing starts anywhere but where it ends. */
const MOVES = new Set([
  'x',
  'y',
  'z',
  'translateX',
  'translateY',
  'translateZ',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'rotateX',
  'rotateY',
  'rotateZ',
  'skew',
  'skewX',
  'skewY',
]);

/** An `initial` without its movement: a fade still fades in, a slide starts where it ends. */
function still(initial: unknown): unknown {
  if (!initial || typeof initial !== 'object' || Array.isArray(initial)) return initial;
  return Object.fromEntries(Object.entries(initial).filter(([key]) => !MOVES.has(key)));
}

// biome-ignore lint/suspicious/noExplicitAny: each element's own props, passed through as they come
const made = new Map<string, ComponentType<any>>();

/**
 * motion's `m` (the light components LazyMotion fills in), for every element the app animates. With reduced motion
 * (MotionConfig "user"), motion plays no movement, but it still paints an element's `initial` for its first frame: a
 * question came in 24 px low for that frame and snapped up, so a thumb aimed at an answer could land on the one above
 * (layout.spec, UX-10). Here, under reduced motion, `initial` leaves the movement out; everyone else sees the entrances.
 */
export const m = new Proxy(motionM, {
  get(target, key) {
    const Element = Reflect.get(target, key);
    if (typeof key !== 'string' || typeof Element !== 'object') return Element;
    let Still = made.get(key);
    if (!Still) {
      // biome-ignore lint/suspicious/noExplicitAny: the element's own props
      Still = function Still(props: any) {
        const reduce = useReducedMotion();
        return createElement(Element, reduce && props.initial ? { ...props, initial: still(props.initial) } : props);
      };
      made.set(key, Still);
    }
    return Still;
  },
}) as typeof motionM;
