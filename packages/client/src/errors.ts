import { clientConfig } from './config';

const MAX_REPORTS = 5;
const sent = new Set<string>();

/** Sends a crash to the server log: each distinct error once, at most a handful per page load. */
export function reportError(kind: 'render' | 'error' | 'rejection', error: unknown, extra?: string) {
  const err = error instanceof Error ? error : new Error(String(error));
  const key = `${kind}:${err.message}`;
  if (sent.size >= MAX_REPORTS || sent.has(key)) return;
  sent.add(key);
  const stack = [err.stack, extra].filter(Boolean).join('\n');
  void fetch(`${clientConfig().baseUrl}/api/client-errors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind,
      message: err.message.slice(0, 500),
      stack: stack.slice(0, 4000) || undefined,
      url: location.pathname,
    }),
    keepalive: true,
  }).catch(() => {});
}
