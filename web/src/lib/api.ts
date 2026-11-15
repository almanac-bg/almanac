// Talking to the server: JSON in, JSON out, and errors a player can read.

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
    throw new ApiError("offline", "Няма връзка със сървъра. Провери интернета си и опитай пак.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? "server", data?.message ?? "Нещо се обърка при нас. Опитай пак.", res.status);
  }
  return data as T;
}

/** Sends an answer in a live game (Роял, a live duel): again, the same, while it doesn't get through (no line, the
 * server restarting: no answer, or a 5xx) and open() says its question still takes it. The server takes a second send
 * of an answer it has as the first. Resolves once it's taken, with the error that ended it if it wasn't. */
export async function deliver(path: string, body: unknown, open: () => boolean): Promise<ApiError | null> {
  for (let wait = 500; ; wait = Math.min(2 * wait, 4000)) {
    try {
      await api("POST", path, body);
      return null;
    } catch (err) {
      const e = err as ApiError;
      if ((e.status > 0 && e.status < 500) || !open()) return e;
    }
    await new Promise((r) => setTimeout(r, wait));
  }
}

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
