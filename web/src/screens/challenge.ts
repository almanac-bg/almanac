// Предизвикателство (play/challenges.go): a player's game of ten, sent to friends and as a link for anyone. Made two
// ways: on Дуел, „Предизвикай“ (/challenge): a topic (or all of them), its ten played, then sent (sendChallenge: the
// friends picked, and the link to share); or a friend challenged at once (/challenge/<id>, „Предизвикай“ on Приятели,
// „Предизвикай отново“ on a friend's result): ten drawn for the two, played now, the friend told once they are.
//
// Its link (/c/<code>) is for whoever opens it to play the same questions as a duel against it, a guest as well as
// anyone: first who sent it and how they did, and „Започни“ (the count only after that tap); then the game; then the
// two side by side (screens/outcome.ts), with the way to add the one who sent it as a friend and to send the
// challenge on. One who has a game of it (played, or sent to them) is at their duel; the one who sent it sees who has
// taken it. Past its time it says so, and offers the day's ten; so does one drawn for a friend who hasn't played it
// yet (held: nobody else may know its answers first). A link from the old challenges (six letters) is gone the same
// way.

import { challengeButton, challengeText } from "../game/results.ts";
import { getReady, playRun, starting, startScreen } from "../game/run.ts";
import type { State } from "../game/types.ts";
import { loadDuelResult } from "../kit.ts";
import { ApiError, api, errorText } from "../lib/api.ts";
import { type Child, h, lifetime, signal, slot } from "../lib/dom.ts";
import { byTap, go, goBack, hold, redirect, release, rename, title } from "../lib/router.ts";
import { listWords, withName } from "../lib/words.ts";
import { bulgaria, categories, player, topics, user } from "../state.ts";
import { back, failure, formatNumber, type Look, topicMark, who } from "../ui.ts";
import { afterDuel } from "./duel.ts";
import { nameFirst } from "./name.ts";

interface Challenge {
  code: string;
  by: { name: string; tag: string };
  look?: Look;
  rights: number;
  total: number;
  topic?: string;
  expiresAt: number;
  over?: boolean;
  own?: boolean;
  /** Drawn for a pair: nobody else takes it before the friend it was drawn for has played it. */
  held?: boolean;
  duel?: number;
  /** To the one who sent it: their game it was sent with. */
  run?: number;
  takers?: {
    name: string;
    tag: string;
    look?: Look;
    state: "won" | "lost" | "draw" | "play" | "wait";
    rights: number;
  }[];
}

interface Friend {
  id: number;
  name: string;
}

const topicName = (id?: string) => (id ? topics.find((t) => t.id === id)?.name : undefined);

/** Whether the screen is still shown: a reply come once it's gone does nothing (it would open a page over another,
 * or rename its entry). */
function shown(): () => boolean {
  const life = lifetime();
  return () => !life.aborted;
}

/** A challenge's link: who sent it and how they did, the viewer's game of it, or (to the one who sent it) who took it. */
export function challenge([code = ""]: string[]) {
  title("Предизвикателство");
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const here = shown();
  api<Challenge>("GET", `/api/challenges/${code}`).then(
    (c) => {
      if (!here()) return;
      // The viewer's own game of it (one they took, or one sent to them): there, not here again, as this page was
      // come to (a game half-played, come to by a link from outside, waits there for „Продължи“).
      if (c.duel) return redirect(`/duel/${c.duel}`);
      if (c.own) return screen.show(() => own(c));
      if (c.over) return screen.show(() => gone("Времето за това предизвикателство изтече"));
      if (c.held)
        return screen.show(() =>
          gone("Още не е твой ред", `${c.by.name} го прати първо на приятел. Щом приятелят го изиграе, ще можеш и ти.`),
        );
      screen.show(() => asked(c, screen, here));
    },
    (err) =>
      screen.show(() =>
        (err as ApiError).code === "no_challenge" || (err as ApiError).code === "not_found"
          ? gone("Това предизвикателство вече го няма")
          : h("p", { class: "bad", role: "alert" }, errorText(err)),
      ),
  );
  return h("div", null, screen);
}

/** A challenge past its time, gone, or not the viewer's to take yet (held for a friend): the day's ten instead. */
function gone(heading: string, lead = "Десетте въпроса за днес са едни и същи за всички: изиграй ги и сравни."): Child {
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Предизвикателство"),
      h("h1", null, heading),
      h("p", { class: "lead" }, lead),
    ),
    h("a", { class: "btn primary big", href: "/" }, "Към въпросите на деня"),
  );
}

/** Who challenges, and how they did: the same ten, a tap away. The game has an entry of its own from its count on
 * (router.ts, hold): a link opened from a chat is the tab's first page, and back, mid-game, asks first; „Откажи“ (or a
 * game that didn't start) gives it back. */
function asked(c: Challenge, screen: ReturnType<typeof slot>, here: () => boolean, failed = ""): Child {
  const topic = topicName(c.topic);
  const again = (why = "") => {
    release();
    screen.show(() => asked(c, screen, here, why));
  };
  // The one who sent it sees who took it: a name of the player's own first, if they still have the one drawn for them
  // (name.ts); then the count, the game's entry held from it.
  const start = () =>
    nameFirst().then(
      (on) => on && here() && count(),
      (err) => here() && screen.show(() => asked(c, screen, here, errorText(err))),
    );
  const count = () => {
    hold();
    screen.show(() =>
      getReady(
        "Предизвикателство",
        async () => {
          screen.show(starting);
          try {
            await player();
            loadDuelResult().catch(() => {}); // the result's screen, on its way while the player plays
            const r = await api<{ duel: number; state?: State }>("POST", `/api/challenges/${c.code}/play`, {});
            if (!here()) return;
            if (!r.state) return go(`/duel/${r.duel}`, true);
            // A reload comes back to this duel; the entry keeps its place in the history, and the page it came from
            // (the game's end gives that address to the page under it).
            rename(`/duel/${r.duel}`);
            screen.show(() => playRun(r.state as State, (end) => afterDuel(r.duel, end.id), c.by.name));
          } catch (err) {
            if (here()) again(errorText(err));
          }
        },
        () => again(),
      ),
    );
  };
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Предизвикателство"),
      h("h1", null, `${c.by.name} те предизвиква`),
      h(
        "p",
        { class: "lead" },
        `${c.by.name} позна ${c.rights} от ${c.total}${topic ? ` по „${topic}“` : ""}. Изиграй същите десет въпроса и ще видите кой знае повече. Около три минути.`,
      ),
    ),
    h("button", { class: "btn primary big", type: "button", onclick: start }, "Започни"),
    failed ? h("p", { class: "bad", role: "alert" }, failed) : null,
  );
}

const stateWords = { won: "Победа", lost: "Загуба", draw: "Равенство", play: "Играе", wait: "Изигра" };

/** The one who sent it: who has taken it so far, and the link to send again. */
function own(c: Challenge): Child {
  const topic = topicName(c.topic);
  const takers = c.takers ?? [];
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, "Твоето предизвикателство"),
      h("h1", null, `${c.rights} от ${c.total}${topic ? ` по „${topic}“` : ""}`),
      h(
        "p",
        { class: "lead" },
        takers.length
          ? takers.length === 1
            ? "Изигра го един човек."
            : `Изиграха го ${formatNumber(takers.length)} души.`
          : "Още никой не го е изиграл.",
      ),
    ),
    // Sent again, its time to be taken starts again.
    c.run ? challengeButton("Прати го пак", c.run, () => challengeText(c.rights, topic), true) : null,
    c.over ? h("p", { class: "muted" }, "Времето му изтече. Прати го пак и ще има още три дни.") : null,
    takers.length
      ? h(
          "ul",
          { class: "duel-list" },
          takers.map((t) =>
            h(
              "li",
              { class: "duel-row" },
              who(t.name, t.look ?? {}, null, t.name, t.tag),
              h(
                "span",
                { class: "duel-row-end" },
                h("strong", { class: "duel-state" }, stateWords[t.state]),
                t.state === "play" || t.state === "wait"
                  ? null
                  : h("span", { class: "muted" }, `${t.rights} от ${c.total}`),
              ),
            ),
          ),
        )
      : null,
  );
}

/** Making a challenge (/challenge): a topic, or all of them, a tap from its ten; at their end, the challenge is sent
 * (sendChallenge). */
export function newChallenge() {
  title("Ново предизвикателство");
  const all = [
    { id: "all", name: "Всички теми" },
    ...categories,
    ...(bulgaria.open ? [{ id: bulgaria.id, name: bulgaria.name }] : []),
  ];
  return h(
    "section",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      back("/duel", "Дуел"),
      h("h1", null, "Ново предизвикателство"),
      h(
        "p",
        { class: "lead" },
        "Избери тема и изиграй десет въпроса. После ги прати на приятели или на когото искаш: кой знае повече?",
      ),
    ),
    h(
      "ul",
      { class: "chips challenge-topics" },
      all.map((c) =>
        h(
          "li",
          null,
          h("a", { class: "chip", href: `/play/${c.id}?challenge` }, topicMark(c.id === "all" ? "" : c.id), c.name),
        ),
      ),
    ),
  );
}

/** „Мария“, „Мария и Бо“, „Мария, Бо и Ци“. */
/** A game played to be sent (`s`, of a topic or all of them): the gold way sends it to the friends picked (each a
 * tap), told in the game; the link for anyone else beside it. With no friends yet, the link is the gold way. */
export function sendChallenge(s: State, topic?: string): { main: Child; also: Child[] } {
  const text = () => challengeText(s.rights, topic);
  const friends = signal<Friend[] | null>(null);
  api<{ friends: Friend[] }>("GET", "/api/friends").then(
    (r) => friends.set(r.friends),
    () => friends.set([]),
  );
  const picked = signal<number[]>([]);
  // Whom it reached, and whom not (who has it waiting already, or too many of the player's).
  const sent = signal<{ to: string[]; not: string[] } | null>(null);
  const busy = signal(false);
  const error = signal("");
  const toggle = (id: number) => picked.update((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const send = async () => {
    error.set("");
    busy.set(true);
    try {
      const to = picked.peek();
      const r = await api<{ sent: number[] }>("POST", "/api/challenges", { run: s.id, to });
      const of = (ids: number[]) => (friends.peek() ?? []).filter((f) => ids.includes(f.id)).map((f) => f.name);
      sent.set({ to: of(r.sent), not: of(to.filter((id) => !r.sent.includes(id))) });
    } catch (err) {
      error.set(errorText(err));
    } finally {
      busy.set(false);
    }
  };
  const main = () => {
    const list = friends();
    if (!list) return h("p", { class: "muted" }, "…");
    if (!list.length) return challengeButton("Прати", s.id, text, true);
    const done = sent();
    if (done)
      return [
        h(
          "p",
          { class: "send-done", role: "status" },
          done.to.length ? `Изпратено на ${listWords(done.to)}. Ще ти кажем как е минало.` : null,
          done.to.length && done.not.length ? " " : null,
          done.not.length
            ? `Не е изпратено на ${listWords(done.not)}: там вече чакат три твои предизвикателства.`
            : null,
        ),
        h("a", { class: "btn primary big", href: "/duel" }, "Към дуелите"),
      ];
    return h(
      "div",
      { class: "send" },
      h("p", { class: "kicker", id: "send-to" }, "Кого предизвикваш?"),
      h(
        "ul",
        { class: "chips", "aria-labelledby": "send-to" },
        list.map((f) =>
          h(
            "li",
            null,
            h(
              "button",
              {
                class: "chip",
                type: "button",
                "aria-pressed": () => String(picked().includes(f.id)),
                onclick: () => toggle(f.id),
              },
              f.name,
            ),
          ),
        ),
      ),
      h(
        "button",
        {
          class: "btn primary big",
          type: "button",
          disabled: () => !picked().length || busy(),
          onclick: send,
        },
        "Прати",
      ),
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    );
  };
  return { main, also: [() => (friends()?.length ? challengeButton("Сподели връзката", s.id, text) : null)] };
}

/** „Дуел със Заек“, or just „Дуел“ without a name. */
const duelWith = (name?: string) => (name ? `Дуел ${withName(name)}` : "Дуел");

/** Challenges a friend at once (/challenge/<id>): opened by a tap, the count-in first, with „Откажи“ (back where the
 * tap was) — nothing is made until it runs out or „Започни сега“ — then ten are drawn for the two and the player's
 * game plays at once; the friend hears of it once it's played. A tap by mistake costs nothing. Come to otherwise (a
 * reload, back or forward, a link), nothing starts by itself: „Започни“ first. */
export function challengeFriend([idText]: string[]) {
  title("Предизвикателство");
  const id = Number(idText);
  const screen = slot(() => h("p", { class: "muted" }, "…"));
  const tap = byTap();
  const here = shown();
  const fail = (err: unknown) => {
    if (here()) screen.show(() => failure(err, undefined, ["/duel", "Към дуелите"]));
  };
  (async () => {
    const friends = user.peek() ? (await api<{ friends: Friend[] }>("GET", "/api/friends")).friends : [];
    if (!here()) return;
    const name = friends.find((f) => f.id === id)?.name;
    // Not a friend (or not one any more): said at once, with the way to friends, before any count.
    if (!name)
      return screen.show(() =>
        failure(
          new ApiError(
            "not_friends",
            "Така можеш да предизвикаш само приятел, а с този играч още не сте приятели.",
            404,
          ),
          undefined,
          ["/friends", "Към приятелите"],
        ),
      );
    loadDuelResult().catch(() => {}); // the result's screen, on its way while the player plays
    // The friend sees who challenged them: a name of the player's own first, if they still have the one drawn for them
    // (name.ts).
    const ready = async () => {
      if (!(await nameFirst()) || !here()) return;
      hold();
      screen.show(() =>
        getReady(
          duelWith(name),
          async () => {
            try {
              await player();
              const r = await api<{ duel: number; state: State }>("POST", `/api/friends/${id}/challenge`, {});
              if (!here()) return;
              rename(`/duel/${r.duel}`); // a reload comes back to this challenge, not a new one
              screen.show(() => playRun(r.state, (end) => afterDuel(r.duel, end.id), name));
            } catch (err) {
              fail(err);
            }
          },
          () => goBack("/duel"),
        ),
      );
    };
    if (tap) return ready();
    screen.show(() =>
      startScreen(duelWith(name), `Десет въпроса. Играеш сега, а ${name} има три дни за своя ред.`, null, () =>
        ready().catch(fail),
      ),
    );
  })().catch(fail);
  return h("div", null, screen);
}
