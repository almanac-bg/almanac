/**
 * Error reports to Sentry, when the server turns them on (it puts the project's DSN in the page). The SDK loads only
 * then, after the page is up, and sends through our own server (/api/monitoring): the browser never contacts Sentry,
 * and no IP address or personal data goes with a report — only the account number.
 */
type Sentry = typeof import('@sentry/browser');

let sentry: Sentry | null = null;
let userId: number | null = null;

/** Links can carry secrets (password-reset and unsubscribe tokens): reports keep only the path. */
const withoutQuery = (url: unknown) => (typeof url === 'string' ? url.split(/[?#]/)[0] : url);

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;

export function startMonitoring() {
  const dsn = meta('sentry-dsn');
  if (!dsn) return;
  const load = () =>
    void import('@sentry/browser').then((Sentry) => {
      Sentry.init({
        dsn,
        tunnel: '/api/monitoring',
        release: meta('app-release'),
        environment: 'production',
        // Nothing about the person or their requests: no cookies, headers, bodies or query strings.
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
        // Errors only: no performance tracing or session replays.
        tracesSampleRate: 0,
        beforeSend(event) {
          if (event.request) event.request = { url: withoutQuery(event.request.url) as string | undefined };
          return event;
        },
        beforeBreadcrumb(crumb) {
          if (crumb.data)
            for (const key of ['url', 'from', 'to'])
              if (key in crumb.data) crumb.data[key] = withoutQuery(crumb.data[key]);
          return crumb;
        },
        // Noise nothing can be done about: other origins' scripts, browser quirks, extensions.
        ignoreErrors: ['Script error.', /ResizeObserver loop/, /^NetworkError/, /Failed to fetch/, /Load failed/],
        denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-(web-)?extension:\/\//],
      });
      if (userId !== null) Sentry.setUser({ id: String(userId) });
      sentry = Sentry;
    });
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 5000 });
  else setTimeout(load, 2000);
}

/** Errors the SDK can't see on its own (React render crashes caught by the error boundary). */
export function captureError(error: unknown) {
  sentry?.captureException(error);
}

/** Reports name the account (its number only), so one player's repeated trouble shows up as one. */
export function identify(id: number | null) {
  userId = id;
  sentry?.setUser(id === null ? null : { id: String(id) });
}
