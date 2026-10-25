/** Wraps a timer or event callback so a bug in it is logged instead of crashing the process (and every live match). */
export function guarded<A extends unknown[]>(label: string, fn: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    try {
      fn(...args);
    } catch (err) {
      console.error(`💥 ${label}:`, err);
    }
  };
}
