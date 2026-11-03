import { ApiError, errorMessage } from '@almanac/client';
import { useCallback, useEffect, useState } from 'react';

/**
 * Data a screen loads (the web's useLoad): loaded again when `key` changes, and on demand (pull to refresh, „Опитай
 * пак“). The last data stays on screen while the next loads; an answer that comes after a newer request is dropped.
 * `status`: the server's, when it said no (a 404 is a page that isn't there, not one to try again). `set`: what a change
 * answered with, shown at once (the next load brings it as the server has it).
 */
export function useLoad<T>(fetch: () => Promise<T>, key: unknown = null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `round` say when to load again
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setStatus(null);
    fetch().then(
      (value) => {
        if (!current) return;
        setData(value);
        setLoading(false);
      },
      (err: unknown) => {
        if (!current) return;
        setError(errorMessage(err));
        setStatus(err instanceof ApiError ? err.status : null);
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [key, round]);
  const reload = useCallback(() => setRound((r) => r + 1), []);
  return { data, error, status, loading, reload, set: setData };
}
