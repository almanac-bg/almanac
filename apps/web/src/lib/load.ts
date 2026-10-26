import { ApiError, useStore } from '@quiz/client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface LoadFailure {
  message: string;
  /** HTTP status; 0 = the server couldn't be reached. */
  status: number;
}

const failure = (err: unknown): LoadFailure =>
  err instanceof ApiError
    ? { message: err.message, status: err.status }
    : { message: 'Нещо се обърка. Опитай пак.', status: -1 };

/**
 * Data for a page or card that keeps a failed load as an error, instead of a spinner that never ends.
 * - `key`: what the data is for (e.g. the board). A new key drops the old data and loads afresh.
 * - `refresh`: change it to reload in the background, keeping what's on screen (e.g. the friends list changed).
 * A failed load retries by itself once the realtime connection is back (the drop that broke the socket usually broke
 * the request too); `retry()` tries again on demand.
 */
export function useLoad<T>(load: () => Promise<T>, key = '', refresh: unknown = null) {
  const [state, setState] = useState<{ key: string; data: T | null; error: LoadFailure | null }>({
    key,
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const connected = useStore((s) => s.connected);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refresh` and `attempt` are reload triggers, not inputs
  useEffect(() => {
    let alive = true;
    loadRef.current().then(
      (data) => alive && setState({ key, data, error: null }),
      (err) => alive && setState((s) => ({ key, data: s.key === key ? s.data : null, error: failure(err) })),
    );
    return () => {
      alive = false;
    };
  }, [key, refresh, attempt]);

  const current = state.key === key;
  const data = current ? state.data : null;
  const error = current ? state.error : null;

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
    setAttempt((n) => n + 1);
  }, []);

  const setData = useCallback((next: T) => setState({ key, data: next, error: null }), [key]);

  // Back online after a failed load: try again without being asked. (Only on the change, so a server error doesn't loop.)
  const failed = !!error;
  // biome-ignore lint/correctness/useExhaustiveDependencies: on reconnect only; re-running on `failed` would loop
  useEffect(() => {
    if (connected && failed) retry();
  }, [connected]);

  return { data, error, retry, setData };
}
