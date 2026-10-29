/**
 * Error reports to Sentry, when the server turns them on (it puts the project's DSN in the page). The SDK loads only
 * then, after the page is up, and sends through our own server (/api/monitoring): the browser never contacts Sentry,
 * and no IP address or personal data goes with a report — only the account number.
 */
import { scrubPaths } from '@quiz/shared';

type Sentry = typeof import('./sentry');

let sentry: Sentry | null = null;
let userId: number | null = null;

/** Reports keep only the path of a link, without names or codes (scrubPaths). */
const scrub = (url: unknown) => (typeof url === 'string' ? scrubPaths(url) : url);

/** Noise nothing can be done about: other origins' scripts, browser quirks, a connection that dropped. */
const IGNORED = ['Script error.', /ResizeObserver loop/, /^NetworkError/, /Failed to fetch/, /Load failed/];

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;

export function startMonitoring() {
  const dsn = meta('sentry-dsn');
  if (!dsn) return;
  const load = () =>
    void import('./sentry').then((Sentry) => {
      Sentry.init({
        dsn,
        tunnel: '/api/monitoring',
        release: meta('app-release'),
        environment: 'production',
        // Nothing about the person or their requests: no cookies, headers, bodies or query strings.
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
        // Errors only: no performance tracing or session replays, and no "session" on every page load (release
        // health: a record of visits by account, and it used up the day's cap on browser reports).
        tracesSampleRate: 0,
        integrations: (defaults) => defaults.filter((integration) => integration.name !== 'BrowserSession'),
        beforeSend(event) {
          if (event.request) event.request = { url: scrub(event.request.url) as string | undefined };
          return event;
        },
        beforeBreadcrumb(crumb) {
          if (crumb.data)
            for (const key of ['url', 'from', 'to']) if (key in crumb.data) crumb.data[key] = scrub(crumb.data[key]);
          // A click's trail names the element by its label („Премахни <name>“): players' names stay out of reports.
          if (crumb.category?.startsWith('ui.') && crumb.message)
            crumb.message = crumb.message.replace(/\[(aria-label|title|alt|name)="[^"]*"\]/g, '');
          return crumb;
        },
        ignoreErrors: IGNORED,
        denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-(web-)?extension:\/\//],
      });
      if (userId !== null) Sentry.setUser({ id: String(userId) });
      sentry = Sentry;
    });
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 5000 });
  else setTimeout(load, 2000);
}

/**
 * A crash, reported once. To Sentry while it runs: it hears the window's errors itself, and a render crash the error
 * boundary caught is handed to it. Otherwise (no DSN, or the SDK hasn't loaded yet) to the server log.
 */
export function reportCrash(kind: 'render' | 'error' | 'rejection', error: unknown, extra?: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (IGNORED.some((p) => (typeof p === 'string' ? message === p : p.test(message)))) return;
  if (sentry) {
    if (kind === 'render') sentry.captureException(error);
    return;
  }
  toServerLog(kind, error, extra);
}

const sent = new Set<string>();

/** To the server's log (/api/client-errors): each distinct error once, at most a handful per page load. */
function toServerLog(kind: 'render' | 'error' | 'rejection', error: unknown, extra?: string) {
  const err = error instanceof Error ? error : new Error(String(error));
  const key = `${kind}:${err.message}`;
  if (sent.size >= 5 || sent.has(key)) return;
  sent.add(key);
  const stack = [err.stack, extra].filter(Boolean).join('\n');
  void fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind,
      message: err.message.slice(0, 500),
      stack: stack.slice(0, 4000) || undefined,
      url: scrub(location.pathname),
    }),
    keepalive: true,
  }).catch(() => {});
}

/** Reports name the account (its number only), so one player's repeated trouble shows up as one. */
export function identify(id: number | null) {
  userId = id;
  sentry?.setUser(id === null ? null : { id: String(id) });
}
