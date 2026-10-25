import { reportError } from './monitoring';

/** Wraps a timer or event callback so a bug in it is reported instead of crashing the process (and every live match). */
export function guarded<A extends unknown[]>(label: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    try {
      fn(...args);
    } catch (err) {
      void reportError(err, label);
    }
  };
}
