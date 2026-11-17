// Errors in the player's browser go to the server, which logs them and tells whoever runs the game: with the version
// the page was loaded with, so that a page of one gone by (it loads itself anew: fresh.ts) isn't taken for a fault of
// the game's now.

import { version } from "./boot.ts";

let sent = 0;

function report(message: string, where: string, stack: string) {
  if (++sent > 10) return; // a loop of errors reports itself once, not forever
  if (typeof fetch === "undefined" || typeof location === "undefined") return;
  fetch("/api/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, where, stack: stack.slice(0, 2000), page: location.pathname, version }),
    keepalive: true,
  }).catch(() => {});
}

/** Reports a problem the page caught itself (the player is told something went wrong), so it's seen on the server. */
export function reportProblem(message: string, stack = ""): void {
  report(message, "caught", stack);
}

export function reportErrors(): void {
  addEventListener("error", (e) =>
    report(String(e.message), `${e.filename}:${e.lineno}:${e.colno}`, e.error?.stack ?? ""),
  );
  addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    // A request that failed has already said so to the player; it isn't a fault of the page.
    if (r?.name === "ApiError" || r instanceof DOMException) return;
    report(String(r?.message ?? r), "promise", String(r?.stack ?? ""));
  });
}
