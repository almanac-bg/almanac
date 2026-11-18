// Talking to the server: JSON in, JSON out, and errors a player can read.
//
// Every answer is heard as well as read (hearing): the server's version on it (a deploy since the page loaded: fresh.ts),
// its clock (serverNow), and a session that has ended. What goes wrong is said to the player in Bulgarian, whatever it
// was (errorText): the server's own words for an error it gave, the line's for no line (or an answer cut off on its
// way, as a page left or reloaded cuts what it was reading), and a plain line for anything else, which is a fault of
// the page's and reported as one. A call that may be sent again (the server takes it twice
// as once) is tried again while the line or the server is down for a moment (tries): a game's step, an answer
// (game/answering.ts).
//
// The last answer to each GET is kept for a while (last), so that a place opened again draws at once what it showed
// before while it asks again (fresh); what the player changes (any other call) forgets all of it. A screen opening
// waits for the GETs it sends (asking: lib/router.ts), but not for one whose kept answer it draws meanwhile.

import { boot } from "./boot.ts";
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

/** What hears each GET as it's sent (router.ts, waitFor: a screen opening waits for what it asks for), but one that a
 * screen draws its kept answer for meanwhile (fresh). */
export const asking: ((answer: Promise<unknown>) => void)[] = [];

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const answer = call<T>(method, path, body);
  if (method === "GET") for (const hear of asking) hear(answer);
  return answer;
}

async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (body === undefined && method !== "GET") body = {};
  // Something the player changes (a game, a setting, a friend) may change what was kept: none of it is drawn again,
  // nor an answer asked for meanwhile.
  const writes = method !== "GET";
  if (writes) forget();
  const since = changes;
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
  // The body read whole, or null: cut off on its way (the line dropped; the page stopped or left, as a reload does,
  // which ends what it was still reading). That is the line's, not a fault of anyone's.
  const text = await res.text().catch(() => null);
  let data: { error?: string; message?: string } | undefined;
  try {
    data = text === null ? undefined : JSON.parse(text);
  } catch {
    // not JSON: said below
  }
  const code: string = res.ok ? "" : (data?.error ?? "server");
  for (const hear of hearing) hear(res, code);
  if (writes) forget();
  if (!res.ok) throw new ApiError(code, data?.message ?? ours, res.status);
  if (text === null) throw new ApiError("offline", offline);
  // Every answer of the API's is JSON: one that came whole and isn't came from something else on the way (a proxy's
  // page, a captive portal) or the API broke its word. What it was tells which.
  if (data === undefined) {
    const type = res.headers.get("Content-Type") || "no type";
    reportProblem(`${method} ${path}: ${res.status} without JSON (${type}, ${text.length} characters)`);
    throw new ApiError("server", ours);
  }
  if (!writes && since === changes) keep(path, data);
  return data as T;
}

// ---- Kept answers: a place opened again draws at once what it showed last, while it asks the server again. ----

/** The last answer to each GET of this page's, by its path (with its query): its value, its JSON as it came (before
 * a screen had it), and when. */
const kept = new Map<string, { data: unknown; text: string; at: number }>();

/** How many changes the player has sent (writes): an answer asked for before one isn't kept. */
let changes = 0;

/** How many answers are kept (the oldest goes first), and for how long one is drawn before what's new: a place opened
 * after that waits for the server, as on its first visit. */
const keptMost = 40;
const keptFor = 30 * 60_000;

/** Keeps an answer to GET `path`: one the server gave, or one that came another way (Начало's day, in the page). */
export function keep(path: string, data: unknown): void {
  const text = JSON.stringify(data);
  const was = kept.get(path);
  kept.delete(path);
  // The same answer again keeps its value: drawn already, it isn't drawn again (fresh).
  kept.set(path, was?.text === text ? { ...was, at: Date.now() } : { data, text, at: Date.now() });
  if (kept.size > keptMost) kept.delete(kept.keys().next().value as string);
}

/** The last answer to GET `path` on this page (within half an hour, and since the player last changed anything: a
 * game, a setting, a friend), for a screen to draw at once while it asks again (fresh); else undefined. */
export function last<T>(path: string): T | undefined {
  const k = kept.get(path);
  return k && Date.now() - k.at < keptFor ? (k.data as T) : undefined;
}

/** GET `path` for a screen that drew its last answer (last) meanwhile: the answer, or the very value drawn when it's
 * the same (so that a signal set to it doesn't change, and nothing is drawn again). Asked with an answer kept, it
 * holds no screen up (asking): that screen is drawn already. */
export function fresh<T>(path: string): Promise<T> {
  const was = last(path);
  if (was === undefined) return api<T>("GET", path);
  return call<T>("GET", path).then((data) => (last<T>(path) === was ? (was as T) : data));
}

/** Forgets every answer kept (a change the player made, another player signed in, or out). */
export function forget(): void {
  changes++;
  kept.clear();
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

/** Sends a step of a game again, the same, while it doesn't get through (no line, the server for a moment: passing),
 * up to `max` times in all, and only while `open()` says it still can go (a live answer: while its question is open);
 * the server takes a step sent twice as once. Resolves with the reply; else throws what ended it. `pause` is the first
 * wait between sends (twice as long each time, to eight times as long). */
export async function tries<T>(
  call: () => Promise<T>,
  { open = () => true, pause = 800, max = 3 }: { open?: () => boolean; pause?: number; max?: number } = {},
): Promise<T> {
  for (let n = 1, wait = pause; ; n++, wait = Math.min(2 * wait, 8 * pause)) {
    try {
      return await call();
    } catch (err) {
      if (n >= max || !passing(err) || !open()) throw err;
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

/** Sets the clock first from the page itself, before any answer has come: the server's time as it drew the page
 * (lib/boot.ts), held against when the page's first byte came. Начало's day comes in the page (server/pages.go), and
 * a question it shows has its time by the server's clock. */
function pageClock(now: number | undefined): void {
  if (!now || typeof performance === "undefined") return;
  const page = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!page || page.responseStart <= 0) return;
  const off = now - (performance.timeOrigin + page.responseStart);
  skew = Math.abs(off) < 2000 ? 0 : off;
}
pageClock(boot.now);

/** Now, by the server's clock (as of its last answer): what a day is, in a phone whose clock is off. */
export const serverNow = (): number => Date.now() + skew;

/** Counts one of something for the admin page (server: /api/tally; play/measure.go): the day shared (`day`: which),
 * the reminder's ask answered. Sent and forgotten: it goes even as the page is left, and a count lost is no matter. */
export function tally(key: string, day?: string): void {
  fetch("/api/tally", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, day }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}
