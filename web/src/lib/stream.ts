// A live game's stream from the server (Server-Sent Events): a live duel's, Роял's. The browser opens a
// stream that dropped again by itself, after the wait the server named in it (retry:); but one whose answer isn't a
// stream (a proxy's error page while the server is away, a portal's sign-in page, a 401) it gives up on for good
// (CLOSED), and so would the screen. Here that one is opened anew, after a wait that grows (1, 2, 4 … 30 s, each a
// random part shorter, so that a crowd of screens doesn't come back in one instant), for as long as the screen lasts
// (its lifetime) and until its game says it's over (close). The line is down from the first error until the next
// word of the server's.

export interface Stream {
  /** Ends the stream for good: the server said the game is over for this screen. */
  close(): void;
  /** Opens it anew now (Роял: another player signed in, whom the server sees otherwise). */
  reopen(): void;
}

export interface StreamOptions {
  /** The screen's life (lib/dom.ts, lifetime): the stream ends with it, and nothing opens it after. */
  life: AbortSignal;
  /** What each of the server's events does, by name ("message": those without one), with its data. */
  on: Record<string, (data: string) => void>;
  /** Hears the line go down (true: an error; the browser, or this, opening it again) and come back (false). */
  down?: (down: boolean) => void;
}

/** The longest wait before a stream given up on is opened again, and the first. */
const most = 30_000;
const first = 1_000;

/** How long to wait before opening again a stream given up on `n` times in a row: twice as long each time, to
 * `most`, less a random part of up to half (jitter). */
export function backoff(n: number, random = Math.random): number {
  const full = Math.min(most, first * 2 ** Math.max(0, n - 1));
  return Math.round(full * (1 - random() / 2));
}

export function stream(url: string, { life, on, down }: StreamOptions): Stream {
  let es: EventSource | null = null;
  let over = false;
  let failures = 0;
  let wait = 0;
  let isDown = false;
  const line = (d: boolean) => {
    if (d === isDown) return;
    isDown = d;
    down?.(d);
  };
  const shut = () => {
    clearTimeout(wait);
    es?.close();
    es = null;
  };
  const open = () => {
    shut();
    if (over || life.aborted) return;
    const s = new EventSource(url);
    es = s;
    s.onopen = () => {
      failures = 0;
    };
    for (const [event, fn] of Object.entries(on)) {
      s.addEventListener(event, (e) => {
        if (es !== s) return;
        failures = 0;
        line(false);
        fn((e as MessageEvent).data);
      });
    }
    s.onerror = () => {
      if (es !== s || over) return;
      line(true);
      // Still CONNECTING: the browser opens it again by itself, after the server's retry:. CLOSED: given up on.
      if (s.readyState !== EventSource.CLOSED) return;
      s.close();
      failures++;
      wait = window.setTimeout(open, backoff(failures));
    };
  };
  const close = () => {
    over = true;
    shut();
  };
  life.addEventListener("abort", close, { once: true });
  open();
  return { close, reopen: open };
}
