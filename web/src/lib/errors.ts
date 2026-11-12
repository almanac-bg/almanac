// Errors in the player's browser go to the server, which logs them and tells whoever runs the game.

let sent = 0;

function report(message: string, where: string, stack: string) {
  if (++sent > 10) return; // a loop of errors reports itself once, not forever
  fetch("/api/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, where, stack: stack.slice(0, 2000), page: location.pathname }),
    keepalive: true,
  }).catch(() => {});
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
