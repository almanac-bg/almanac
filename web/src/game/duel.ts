// Finding an opponent for a duel: someone asking now, or a recording of a real game.

import { ApiError } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";
import { go } from "../lib/router.ts";
import { player } from "../state.ts";

export function findDuel(label = "Намери съперник"): Child {
  const state = signal<"idle" | "searching">("idle");
  const error = signal("");
  let stop: AbortController | null = null;
  const search = async () => {
    error.set("");
    state.set("searching");
    stop = new AbortController();
    try {
      await player();
      const res = await fetch("/api/duel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: stop.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new ApiError(data.error, data.message, res.status);
      go(`/r/${data.code}`);
    } catch (err) {
      state.set("idle");
      if ((err as DOMException).name !== "AbortError") {
        error.set(err instanceof ApiError ? err.message : "Няма връзка със сървъра. Опитай пак.");
      }
    }
  };
  return h("div", { class: "stack" }, () =>
    state() === "searching"
      ? [
          h("p", { class: "status", role: "status" }, "Търсим съперник…"),
          h("button", { class: "link", onclick: () => stop?.abort() }, "Отказ"),
        ]
      : [
          h("button", { class: "btn primary", onclick: search }, label),
          error() && h("p", { class: "bad", role: "alert" }, error()),
        ],
  );
}
