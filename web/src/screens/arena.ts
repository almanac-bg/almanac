// Арена: three to five players, matched at random, live on the same questions; the most points win. Here a player
// waits for the others; the game itself is a room (room.ts) at /arena/<code>.

import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { player } from "../state.ts";

interface Queue {
  waiting: number;
  min: number;
  max: number;
  /** How long until those waiting play, if no more come (none: not enough of them yet). */
  startsMs?: number;
}

export function arena() {
  title("Арена");
  const queue = signal<Queue | null>(null);
  const trouble = signal<"" | "reconnecting" | "replaced" | "gone">("");
  const left = signal(0);

  let es: EventSource | null = null;
  player()
    .then(() => {
      es = new EventSource("/api/arena/events");
      es.onmessage = (e) => {
        trouble.set("");
        const q: Queue = JSON.parse(e.data);
        queue.set(q);
        left.set(q.startsMs ? Math.ceil(q.startsMs / 1000) : 0);
      };
      es.addEventListener("matched", (e) => {
        es?.close();
        go(`/arena/${JSON.parse((e as MessageEvent).data).code}`, true);
      });
      es.addEventListener("replaced", () => {
        es?.close();
        trouble.set("replaced");
      });
      es.addEventListener("closed", () => {
        es?.close();
        trouble.set("gone");
      });
      es.onerror = () => trouble.set(es?.readyState === EventSource.CLOSED ? "gone" : "reconnecting");
    })
    .catch(() => trouble.set("gone"));
  const tick = setInterval(() => left.update((n) => Math.max(0, n - 1)), 1000);
  onCleanup(() => {
    es?.close();
    clearInterval(tick);
  });

  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("h1", null, "Арена"),
      h(
        "p",
        { class: "lead" },
        "От трима до петима играчи, на живо, на едни и същи въпроси. Който събере най-много точки, печели.",
      ),
    ),
    () => {
      switch (trouble()) {
        case "replaced":
          return h("p", { class: "status", role: "status" }, "Чакаш за арена в друг прозорец.");
        case "gone":
          return h(
            "div",
            { class: "stack" },
            h("p", { role: "alert" }, "Връзката прекъсна."),
            h("button", { class: "btn primary", onclick: () => location.reload() }, "Опитай пак"),
          );
        default:
          return waiting(queue, left, trouble() === "reconnecting");
      }
    },
    h("a", { class: "btn", href: "/" }, "Откажи"),
  );
}

function waiting(queue: () => Queue | null, left: () => number, reconnecting: boolean): Child {
  return h(
    "section",
    { class: "card stack arena-wait", "aria-live": "polite" },
    h("h2", { class: "section-title" }, "Търсим играчи…"),
    () => {
      const q = queue();
      if (!q) return h("p", { class: "muted" }, "…");
      return h(
        "div",
        { class: "stack" },
        h(
          "ol",
          { class: "arena-slots", "aria-label": `Чакащи: ${q.waiting} от ${q.max}` },
          Array.from({ length: q.max }, (_, i) =>
            h("li", {
              class: [i < q.waiting && "taken", i >= q.min && "extra"].filter(Boolean).join(" ") || undefined,
            }),
          ),
        ),
        h("p", { class: "place-line" }, h("span", { class: "num" }, String(q.waiting)), ` от ${q.max} играчи`),
        () =>
          left()
            ? h("p", { class: "status" }, `Започваме след ${left()} с, ако не дойдат още.`)
            : h("p", { class: "status" }, `Нужни са поне ${q.min} играчи. Играта започва сама.`),
      );
    },
    reconnecting ? h("p", { class: "status", role: "status" }, "Връзката прекъсна. Свързваме се отново…") : null,
  );
}
