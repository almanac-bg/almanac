// A room as its host sees it when they lead it from a big screen („Само водя“: a TV in a pub, a projector, a laptop on
// the table) and don't play: the code to come in by, with its link as a QR code; each question large, with its clock
// and how many have answered; the answer with how the room answered it (what each option got, who knew it), its fact
// and the first five; the podium. And the pace: „Напред“ (the answer now, or the next question), „Задръж“ (each answer
// stays up until „Напред“, to talk it over: on from the start), „Приключи“, from the screen or from the keys, so that a
// presentation clicker runs it from across the room (→, PageDown, Space or Enter: „Напред“; H: „Задръж“; F: the whole
// screen). On a big screen nothing scrolls: the header and the places' bar step aside, and the controls stay at the
// foot. The players' phones are as in any room; and there may be none: everyone answers aloud. Part of room.ts's file,
// loaded with it; its style (host.css) loads the first time it shows.

import type { Child } from "../lib/dom.ts";
import {
  about,
  answered,
  api,
  ask,
  asRoom,
  avatar,
  choose,
  computed,
  countdown,
  door,
  errorText,
  fact,
  formatNumber,
  h,
  head,
  hostCss,
  joins,
  knew,
  lead,
  onCleanup,
  picture,
  play,
  players,
  type RoomView,
  schemeSwitch,
  signal,
  spaced,
  standings,
  stillAnswering,
  timer,
  untracked,
  upNext,
  winners,
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

/** A key's mark on a button (shown on a computer only: app.css). */
const key = (k: string) => h("kbd", { class: "key-hint", "aria-hidden": "true" }, k);

/** Whether a key press is the host's to take: not with a modifier, not held down, not in a field. */
function ours(e: KeyboardEvent): boolean {
  const t = e.target as Element | null;
  return !(e.metaKey || e.ctrlKey || e.altKey || e.repeat || t?.closest("input, textarea, select, [contenteditable]"));
}

/** Space and Enter press what has the focus, as ever (a button, a link, a choice): the host's keys take them only
 * when nothing does. */
const focused = (e: KeyboardEvent) =>
  (e.key === " " || e.key === "Enter") &&
  !!(e.target as Element | null)?.closest("button, a, summary, [role=radio], [role=tab], [tabindex]");

/** A host's key, on every phase's screen: listened to while it shows. */
function onKey(handle: (e: KeyboardEvent) => boolean): void {
  const listener = (e: KeyboardEvent) => {
    if (ours(e) && handle(e)) e.preventDefault();
  };
  document.addEventListener("keydown", listener);
  onCleanup(() => document.removeEventListener("keydown", listener));
}

/** The whole screen for the room (F, or its button; Esc leaves it, as the browser has it), where the browser can. */
function wholeScreen(): Child {
  if (!document.fullscreenEnabled) return null;
  const on = signal(!!document.fullscreenElement);
  const change = () => on.set(!!document.fullscreenElement);
  document.addEventListener("fullscreenchange", change);
  onCleanup(() => document.removeEventListener("fullscreenchange", change));
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  };
  onKey((e) => {
    if (e.code !== "KeyF") return false;
    toggle();
    return true;
  });
  return h(
    "button",
    { class: "btn host-full", type: "button", onclick: unfocused(toggle) },
    () => (on() ? "Излез от цял екран" : "Цял екран"),
    key("F"),
  );
}

/** A click with the mouse leaves no focus behind: a clicker's Space after it is „Напред“, not this button again. */
function unfocused(act: () => void): (e: MouseEvent) => void {
  return (e) => {
    if (e.detail > 0) (e.currentTarget as HTMLElement).blur();
    act();
  };
}

/** Over the lobby and the end: the way back to Начало (the header steps aside while a room is led), how the game
 * looks (a lit room reads Day better), and the whole screen. */
function tools(): Child {
  return h(
    "div",
    { class: "host-tools" },
    h(
      "a",
      { class: "back", href: "/", "data-back": "" },
      h("span", { class: "i i-left back-i", "aria-hidden": "true" }),
      "Начало",
    ),
    h("div", { class: "host-tools-end" }, schemeSwitch(), wholeScreen()),
  );
}

/** The players, and the host's hands on them (another name, sent out, back in; the lock) folded under one button:
 * the room reads the big screen too, and a „Махни“ under every name is no one's business but the host's. */
function roster(view: () => RoomView, code: string, error: (s: string) => void): Child {
  const manage = signal(false);
  return h(
    "section",
    { class: "card host-players" },
    h(
      "div",
      { class: "host-players-head" },
      h("h2", { class: "section-title" }, () => `Играчи (${view().players.length})`),
      () =>
        view().players.length || view().out?.length
          ? h(
              "button",
              {
                class: "btn inline",
                type: "button",
                "aria-expanded": manage,
                onclick: unfocused(() => manage.set(!manage.peek())),
              },
              () => (manage() ? "Готово" : "Управлявай играчите"),
            )
          : null,
    ),
    () =>
      view().players.length
        ? null
        : h(
            "p",
            { class: "muted" },
            "Още никой не е влязъл. Може да играете и без телефони: всички отговарят на глас, а „Напред“ показва отговора.",
          ),
    players(view, code, error, manage),
    () => (manage() ? door(view, code, error) : null),
  );
}

function lobby(view: () => RoomView, code: string): Child {
  const error = signal("");
  joins(view);
  return h(
    "div",
    { class: "screen host host-lobby" },
    tools(),
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
    roster(view, code, error.set),
    h(
      "div",
      { class: "host-start" },
      h("button", { class: "btn primary big", onclick: unfocused(() => lead(code, "start", error.set)) }, "Започни"),
      choose(view, code),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

function question(view: () => RoomView, code: string, first: RoomView): Child {
  const q = first.question;
  if (!q) return null;
  if (first.n === 0) play("go");
  const left = countdown(q.leftMs);
  // The answers to choose from, as the phones mark them, to be looked at (a number's pad isn't one).
  const shown = q.view.type === "number" ? null : ask(q.view, () => {}, signal(true), undefined, true);
  return h(
    "article",
    { class: "question host host-ask" },
    h("div", { class: "host-top" }, head(first), timer(q.leftMs, q.limitMs, left, signal(false))),
    h(
      "div",
      { class: "host-stage" },
      h("h1", { class: "ask" }, q.view.text),
      picture(q.view),
      () => {
        const v = view();
        if (v.n === first.n && v.question) shown?.update?.(v.question.view); // the next clue, as it comes
        return null;
      },
      shown?.node ?? null,
    ),
    foot(view, code, () => {
      const line = stillAnswering(view());
      return line ? h("p", { class: "status", role: "status" }, line) : null;
    }),
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
    { class: "question host host-reveal" },
    h("div", { class: "host-top" }, head(first)),
    h(
      "div",
      { class: "host-stage host-row host-answer" },
      h(
        "div",
        { class: "stack" },
        h("h1", { class: "ask" }, q.view.text),
        picture(q.view),
        answered(q.view, asRoom(q), null),
        knew(first),
        r.answer.fact ? fact(r.answer.fact) : null,
      ),
      standings(view, true, before, 5),
    ),
    foot(view, code, () =>
      held()
        ? h("p", { class: "status" }, last ? "Класирането — с „Напред“." : "Следващият въпрос — с „Напред“.")
        : untracked(() =>
            upNext(view().question?.nextMs ?? 0, last ? "Към класирането…" : `Въпрос ${first.n + 2} след малко…`),
          ),
    ),
  );
}

/** The foot of a question's screen, always in sight: where the game stands, and the host's pace. */
function foot(view: () => RoomView, code: string, line: () => Child): Child {
  return h("footer", { class: "host-foot" }, h("div", { class: "host-line" }, line), controls(view, code));
}

/** The host's pace: „Напред“, „Задръж“ (pressed while held) and „Приключи“ (asked twice: it ends the game for all),
 * and their keys; the whole screen beside them. */
function controls(view: () => RoomView, code: string): Child {
  const error = signal("");
  const sure = signal(false);
  let t = 0;
  onCleanup(() => clearTimeout(t));
  const next = () => lead(code, "next", error.set);
  const hold = async () => {
    try {
      await api("POST", `/api/rooms/${code}/hold`, { on: !view().held });
    } catch (err) {
      error.set(errorText(err));
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
  // While „Да, приключи“ waits, a key is no answer to it: only Esc, which takes it back.
  onKey((e) => {
    if (sure.peek()) {
      if (e.key !== "Escape") return false;
      clearTimeout(t);
      sure.set(false);
      return true;
    }
    if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key) && !focused(e)) {
      next();
      return true;
    }
    if (e.code === "KeyH") {
      hold();
      return true;
    }
    return false;
  });
  return [
    h(
      "div",
      { class: "host-controls" },
      h("button", { class: "btn primary", type: "button", onclick: unfocused(next) }, "Напред", key("→")),
      h(
        "button",
        { class: "btn", type: "button", "aria-pressed": () => !!view().held, onclick: unfocused(hold) },
        "Задръж",
        key("H"),
      ),
      h("button", { class: () => (sure() ? "btn danger" : "btn"), type: "button", onclick: unfocused(finish) }, () =>
        sure() ? "Да, приключи" : "Приключи",
      ),
      wholeScreen(),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  ];
}

function end(view: () => RoomView, code: string): Child {
  const error = signal("");
  play("end");
  return h(
    "div",
    { class: "screen host host-end" },
    tools(),
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, () => `Стая ${spaced(code)} · ${about(view())}`),
      h("h1", null, () => winners(view().players.filter((p) => p.place === 1))),
    ),
    // The podium, and beside it everyone's place (on a big screen: host.css).
    () =>
      view().players.length ? h("div", { class: "host-row host-result" }, podium(view), standings(view, false)) : null,
    h(
      "div",
      { class: "host-start" },
      h(
        "button",
        { class: "btn primary big", onclick: unfocused(() => lead(code, "start", error.set)) },
        "Започни нова игра",
      ),
      choose(view, code),
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    roster(view, code, error.set),
  );
}

/** The first three on their steps, as many as there are: the second on the left, the first in the middle, the third
 * on the right; one alone stands on the first. */
function podium(view: () => RoomView): Child {
  return () => {
    const top = view().players.slice(0, 3);
    if (!top.length) return null;
    const order = top.length === 1 ? [0] : top.length === 2 ? [1, 0] : [1, 0, 2];
    return h(
      "ol",
      { class: `podium steps-${order.length}` },
      order.map((i) => {
        const p = top[i];
        if (!p) return null;
        return h(
          "li",
          { class: `p${i + 1}` },
          avatar(p.avatar, { size: "l", name: p.name }),
          h("span", { class: "podium-name" }, p.name),
          h("span", null, `${formatNumber(p.points)} т.`),
          h("span", { class: "place" }, String(p.place ?? i + 1)),
        );
      }),
    );
  };
}
