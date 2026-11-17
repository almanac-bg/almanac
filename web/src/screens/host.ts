// A room as its host sees it when they lead it from a big screen („Само водя“: a class's board, a pub's TV) and
// don't play: the code to come in by, with its link as a QR code; each question large, with its clock and how many
// have answered; the answer with its fact and the first five; the podium. And the pace: „Напред“ (the answer now, or
// the next question), „Задръж“ (each answer stays up until „Напред“, to talk it over), „Край“. The players' phones
// are as in any room. Part of room.ts's file, loaded with it; its style (host.css) loads the first time it shows.

import type { ApiError } from "../lib/api.ts";
import type { Child } from "../lib/dom.ts";
import {
  about,
  answered,
  api,
  ask,
  avatar,
  choose,
  computed,
  countdown,
  fact,
  formatNumber,
  h,
  head,
  hostCss,
  joins,
  lead,
  nextSteps,
  onCleanup,
  picture,
  play,
  players,
  type RoomView,
  signal,
  spaced,
  standings,
  timer,
  untracked,
  upNext,
} from "./room.ts";

/** The host's screen for the room's phase now. */
export function hosting(view: () => RoomView, code: string, v: RoomView, places: Map<number, number>): Child {
  style();
  switch (v.phase) {
    case "lobby":
      return lobby(view, code);
    case "question":
      return question(view, code, v);
    case "reveal":
      return reveal(view, code, v, places);
    case "end":
      return end(view, code);
  }
}

/** Loads host.css, once. */
function style(): void {
  if (!hostCss || document.querySelector("link[data-host]")) return;
  document.head.append(h("link", { rel: "stylesheet", href: `/${hostCss}`, "data-host": "" }));
}

function lobby(view: () => RoomView, code: string): Child {
  const error = signal("");
  joins(view);
  return h(
    "div",
    { class: "screen host" },
    h(
      "div",
      { class: "host-row" },
      h(
        "div",
        { class: "intro" },
        h("p", { class: "kicker" }, () => about(view())),
        h("h1", null, "Стая ", h("span", { class: "code-big" }, spaced(code))),
        h("p", { class: "host-join" }, `Отворете ${location.host}/r/${code} или насочете камерата към кода.`),
      ),
      h("img", {
        class: "host-qr",
        src: `/api/rooms/${code}/qr`,
        alt: `QR код на връзката към стая ${spaced(code)}`,
        width: 320,
        height: 320,
      }),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", { class: "section-title" }, () => `Играчи (${view().players.length})`),
      () => (view().players.length ? null : h("p", { class: "muted" }, "Още никой не е влязъл.")),
      players(view, code, error.set),
    ),
    h("button", { class: "btn primary big", onclick: () => lead(code, "start", error.set) }, "Започни"),
    choose(view, code),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** How many have answered, of those in the room. */
function answeredLine(v: RoomView): Child {
  const done = v.players.filter((p) => p.answered).length;
  return h(
    "p",
    { class: "status", role: "status" },
    `Отговориха ${done} от ${v.players.filter((p) => p.online || p.answered).length}`,
  );
}

function question(view: () => RoomView, code: string, first: RoomView): Child {
  const q = first.question;
  if (!q) return null;
  if (first.n === 0) play("go");
  const left = countdown(q.leftMs);
  // The answers to choose from, as the phones have them (a number's pad isn't one).
  const shown = q.view.type === "number" ? null : ask(q.view, () => {}, signal(true));
  return h(
    "article",
    { class: "question host" },
    head(first),
    timer(q.leftMs, q.limitMs, left, signal(false)),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view, true),
    () => {
      const v = view();
      if (v.n === first.n && v.question) shown?.update?.(v.question.view); // the next clue, as it comes
      return null;
    },
    shown?.node ?? null,
    () => answeredLine(view()),
    controls(view, code),
  );
}

function reveal(view: () => RoomView, code: string, first: RoomView, places: Map<number, number>): Child {
  const q = first.question;
  const r = q?.reveal;
  if (!q || !r) return null;
  play("right");
  const before = new Map(places);
  first.players.forEach((p, i) => {
    places.set(p.key, i + 1);
  });
  const last = first.n + 1 >= first.total;
  const held = computed(() => !!view().held); // only a change of it draws the line again
  return h(
    "article",
    { class: "question host" },
    head(first),
    h(
      "div",
      { class: "host-row" },
      h(
        "div",
        { class: "stack" },
        h("h1", { class: "ask" }, q.view.text),
        picture(q.view, true),
        answered(q.view, r.answer, null),
        r.answer.fact ? fact(r.answer.fact) : null,
      ),
      standings(view, true, before, undefined, 5),
    ),
    () =>
      held()
        ? h("p", { class: "status" }, last ? "Класирането — с „Напред“." : "Следващият въпрос — с „Напред“.")
        : untracked(() =>
            upNext(view().question?.nextMs ?? 0, last ? "Към класирането…" : `Въпрос ${first.n + 2} след малко…`),
          ),
    controls(view, code),
  );
}

/** The host's pace: „Напред“, „Задръж“ (pressed while held) and „Край“ (asked twice: it ends the game for all). */
function controls(view: () => RoomView, code: string): Child {
  const error = signal("");
  const sure = signal(false);
  let t = 0;
  onCleanup(() => clearTimeout(t));
  const hold = async () => {
    try {
      await api("POST", `/api/rooms/${code}/hold`, { on: !view().held });
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  const finish = () => {
    clearTimeout(t);
    if (!sure.peek()) {
      sure.set(true);
      t = window.setTimeout(() => sure.set(false), 4000);
      return;
    }
    sure.set(false);
    lead(code, "finish", error.set);
  };
  return [
    h(
      "div",
      { class: "host-controls" },
      h("button", { class: "btn primary", type: "button", onclick: () => lead(code, "next", error.set) }, "Напред"),
      h("button", { class: "btn", type: "button", "aria-pressed": () => !!view().held, onclick: hold }, "Задръж"),
      h("button", { class: () => (sure() ? "btn danger" : "btn"), type: "button", onclick: finish }, () =>
        sure() ? "Да, край" : "Край",
      ),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  ];
}

function end(view: () => RoomView, code: string): Child {
  const error = signal("");
  play("end");
  return h(
    "div",
    { class: "screen host" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, () => `Стая ${spaced(code)} · ${about(view())}`),
      h("h1", null, () => {
        const [best, next] = view().players;
        if (best && next?.place === 1) return `${best.name} и ${next.name} делят първото място`;
        return best ? `${best.name} печели` : "Край";
      }),
    ),
    podium(view),
    standings(view, false),
    nextSteps(
      h("button", { class: "btn primary big", onclick: () => lead(code, "start", error.set) }, "Нова игра"),
      [],
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    choose(view, code),
    h(
      "details",
      { class: "more" },
      h("summary", null, () => `Играчи (${view().players.length})`),
      players(view, code, error.set),
    ),
  );
}

/** The first three on their steps: the second on the left, the first in the middle, the third on the right. */
function podium(view: () => RoomView): Child {
  return () => {
    const top = view().players.slice(0, 3);
    if (!top.length) return null;
    return h(
      "ol",
      { class: "podium" },
      [1, 0, 2].map((i) => {
        const p = top[i];
        if (!p) return h("li", { "aria-hidden": "true" });
        return h(
          "li",
          { class: `p${i + 1}` },
          avatar(p.avatar, { size: "l", name: p.name }),
          h("span", { class: "podium-name" }, p.name),
          h("span", null, `${formatNumber(p.points)} т.`),
          h("span", { class: "place" }, String(i + 1)),
        );
      }),
    );
  };
}
