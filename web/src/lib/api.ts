// Talking to the server: JSON in, JSON out, and errors a player can read.
//
// Every answer is heard as well as read (hearing): the server's version on it (a deploy since the page loaded: fresh.ts),
// its clock (serverNow), and a session that has ended. What goes wrong is said to the player in Bulgarian, whatever it
// was (errorText): the server's own words for an error it gave, the line's for no line, and a plain line for anything
// else, which is a fault of the page's and reported as one. A call that may be sent again (the server takes it twice
// as once) is tried again while the line or the server is down for a moment (tries, deliver).

import { reportProblem } from "./errors.ts";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

const offline = "Няма връзка със сървъра. Провери интернета си и опитай пак.";
const ours = "Нещо се обърка при нас. Опитай пак.";

/** What hears every answer of the server's, as it comes (fresh.ts: its version, a session ended): the answer, and the
 * error's code if it's one. */
export const hearing: ((res: Response, code: string) => void)[] = [];

export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (body === undefined && method !== "GET") body = {};
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("offline", offline);
  }
  clock(res);
  const data = await res.json().catch(() => undefined);
  const code: string = res.ok ? "" : (data?.error ?? "server");
  for (const hear of hearing) hear(res, code);
  if (!res.ok) throw new ApiError(code, data?.message ?? ours, res.status);
  // Every answer of the API's is JSON: one that isn't came from something else on the way (or the API broke its word).
  if (data === undefined) {
    reportProblem(`${method} ${path}: ${res.status} without JSON`);
    throw new ApiError("server", ours);
  }
  return data as T;
}

/** What the player is told of an error: an ApiError's own words; for anything else (a fault of the page's: an answer
 * not as the page expects it, say), a plain line, and the fault reported, so that it's seen. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  // The browser's own no (a permission refused, a share sheet closed) isn't a fault of the page's.
  if (typeof DOMException === "undefined" || !(err instanceof DOMException)) {
    const e = err as { name?: string; message?: string; stack?: string } | null;
    reportProblem(`${e?.name ?? "Error"}: ${e?.message ?? String(err)}`, e?.stack ?? "");
  }
  return "Нещо се обърка. Опитай пак.";
}

/** Whether trying again can help with what went wrong: no line, or the server for a moment (not a „no“ of its own). */
export function passing(err: unknown): boolean {
  const status = (err as { status?: number })?.status ?? 0;
  return status === 0 || status >= 500;
}

/** A step of a game sent again, a few times, while it doesn't get through (passing); the server takes a step sent
 * twice as once. `pause` is the wait before the first retry (longer each time). */
export async function tries<T>(call: () => Promise<T>, pause = 800): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await call();
    } catch (err) {
      if (n >= 3 || !passing(err)) throw err;
    }
    await new Promise((on) => setTimeout(on, pause * n));
  }
}

/** Sends an answer in a live game (Роял, a live duel, a room): again, the same, while it doesn't get through (no
 * line, the server restarting: no answer, or a 5xx) and open() says its question still takes it. The server takes a
 * second send of an answer it has as the first (a room's says it's too late: not_now). Resolves once it's taken, with
 * the error that ended it if it wasn't. `pause` is the first wait between sends (twice as long each time, to 4 s). */
export async function deliver(path: string, body: unknown, open: () => boolean, pause = 500): Promise<ApiError | null> {
  for (let wait = pause; ; wait = Math.min(2 * wait, 8 * pause)) {
    try {
      await api("POST", path, body);
      return null;
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("server", errorText(err));
      if ((e.status > 0 && e.status < 500) || !open()) return e;
    }
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** The server's clock less this one's, from the last answer's Date (to the second: a difference under two seconds is
 * taken as none). */
let skew = 0;

function clock(res: Response): void {
  const date = Date.parse(res.headers.get("Date") ?? "");
  if (Number.isNaN(date)) return;
  const off = date + 500 - Date.now(); // the server's second, half gone on average
  skew = Math.abs(off) < 2000 ? 0 : off;
}

/** Now, by the server's clock (as of its last answer): what a day is, in a phone whose clock is off. */
export const serverNow = (): number => Date.now() + skew;

/** Counts one of something for the admin page (server: /api/tally; play/measure.go): the day shared, the reminder's
 * ask answered. Sent and forgotten: it goes even as the page is left, and a count lost is no matter. */
export function tally(key: string): void {
  fetch("/api/tally", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}
