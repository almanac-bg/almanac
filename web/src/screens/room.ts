// A room: the lobby, then each question for everyone at once, its answer with the scores, and the final standings.
// The server sends the room as this player sees it after every change; the line, should it drop, is opened again
// (lib/stream.ts). Each question is answered as in every game (game/answering.ts).
//
// It loads on its own, the first time a room opens, and is handed the app's pieces (kit.ts): it imports only types.

import type { Answer, Crowd, Reveal, Reviewed, View } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { ApiError } from "../lib/api.ts";
import type { Child } from "../lib/dom.ts";
import type { Tier, VerdictKind } from "../ui.ts";
import { hosting } from "./host.ts";
import type { Mix } from "./rooms.ts";

// The app's pieces, set as the screen opens (room); host.ts takes them from here.
export let {
  loading,
  answered,
  answering,
  api,
  ask,
  avatar,
  boardRow,
  categories,
  changeGame,
  computed,
  countdown,
  crowdLine,
  effect,
  errorText,
  fact,
  guardLeaving,
  holdWhile,
  formatNumber,
  hostCss,
  h,
  keepAwake,
  lifetime,
  listWords,
  mixes,
  news,
  nextSteps,
  onCleanup,
  onScreen,
  picture,
  place,
  play,
  playAnswer,
  player,
  playingWhile,
  questionHead,
  reviewParts,
  schemeSwitch,
  shareButton,
  signal,
  stream,
  timer,
  title,
  untracked,
  upNext,
  user,
  verdict,
} = {} as Kit;

export interface RoomView {
  code: string;
  phase: "lobby" | "question" | "reveal" | "end";
  host: string;
  isHost: boolean;
  canLead: boolean;
  category: string;
  /** Questions a game, and how hard. */
  length: number;
  mix: Mix;
  n: number;
  total: number;
  players: Player[];
  /** Once the game is over: its questions with this player's answers. */
  review?: Reviewed[];
  question?: {
    category: string;
    view: View;
    limitMs: number;
    leftMs: number;
    nextMs?: number;
    given?: Answer;
    reveal?: {
      answer: Reveal;
      points: number;
      speed?: number;
      inRow?: number;
      right: boolean;
      exact?: boolean;
      missed?: boolean;
    };
    /** How the room answered it, once the answer shows (room.go: Split): its own crowd, and who got it right, the
     * quickest first, by their keys. */
    split?: { crowd?: Crowd; right: number[] };
  };
  /** Once the game is over: what this player's game earned for every answer right (in their points). */
  allRight?: number;
  /** The host leads from a big screen, and doesn't play (host.ts). */
  lead?: boolean;
  /** Each answer stays up until who leads moves on („Задръж“). */
  held?: boolean;
  /** Nobody new comes in: the host has locked the room (door). */
  locked?: boolean;
  /** Once the game is over and kept: this player's game as a run, whose news tells what it earned. */
  run?: number;
  /** The secret in the room's link (/r/<code>#<key>): with it, someone new comes in during a game too. */
  key?: string;
  /** To the host: those sent out, to bring back („Върни“). */
  out?: Player[];
  /** The host has asked this player for another name („Смени името“). */
  askName?: boolean;
}

export interface Player {
  /** Tells players apart in the room (names may repeat). */
  key: number;
  name: string;
  points: number;
  rights: number;
  online: boolean;
  answered: boolean;
  me?: boolean;
  /** Where they stand: by points, then by the time the answers took; those level on both share it. */
  place?: number;
  gained?: number;
  right?: boolean;
  avatar?: string;
  title?: string;
  titleTier?: Tier;
  level?: number;
}

export const topicName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Всички теми";
export const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;
/** What the room plays: its topic, how many questions and how hard. */
export const about = (v: RoomView) =>
  `${topicName(v.category)} · ${v.length} въпроса · ${mixes.find(([m]) => m === v.mix)?.[1] ?? ""}`;

export function room(kit: Kit, [code = ""]: string[]) {
  ({
    loading,
    answered,
    answering,
    api,
    ask,
    avatar,
    boardRow,
    categories,
    changeGame,
    computed,
    countdown,
    crowdLine,
    effect,
    errorText,
    fact,
    guardLeaving,
    holdWhile,
    formatNumber,
    hostCss,
    h,
    keepAwake,
    lifetime,
    listWords,
    mixes,
    news,
    nextSteps,
    onCleanup,
    onScreen,
    picture,
    place,
    play,
    playAnswer,
    player,
    playingWhile,
    questionHead,
    reviewParts,
    schemeSwitch,
    shareButton,
    signal,
    stream,
    timer,
    title,
    untracked,
    upNext,
    user,
    verdict,
  } = kit);
  title("Стая");
  const view = signal<RoomView | null>(null);
  const trouble = signal<"" | "reconnecting" | "gone" | "full" | "removed" | "locked" | "busy" | "started" | "moved">(
    "",
  );
  // The room's key, from its link (after #): it takes someone new into a game under way.
  const roomKey = location.hash.slice(1);
  // A player still with the name drawn for them chooses one first, for this room alone (the name it starts from): a
  // room of twenty can't tell twenty animals apart, and a name given here stays in the room (never their name on the
  // boards or their profile).
  const naming = signal<string | null>(null);
  // The host has asked this player for another name: asked again here, outside a game.
  const asked = computed(() => {
    const v = view();
    return !!v?.askName && (v.phase === "lobby" || v.phase === "end");
  });
  const inRoom = computed(() => trouble() === "" || trouble() === "reconnecting");
  // Where each player stood at the last answer: how far they've moved since is the room's rank change.
  const places = new Map<number, number>();

  // The screen is gone (another page): what was on its way doesn't join the room or open its stream after it.
  const life = lifetime();
  const connect = () => {
    if (life.aborted) return;
    // The room is gone, the host sent this player out, or this player opened it on another screen: the server says
    // so, and the line isn't opened again. A line that only dropped is (lib/stream.ts), however it dropped.
    const ends = (why: "gone" | "removed" | "moved") => () => {
      line.close();
      trouble.set(why);
    };
    const line = stream(`/api/rooms/${code}/events`, {
      life,
      on: {
        message: (data) => {
          trouble.set("");
          view.set(JSON.parse(data));
        },
        closed: ends("gone"),
        removed: ends("removed"),
        moved: ends("moved"),
      },
      down: (down) => {
        if (down) trouble.set("reconnecting");
      },
    });
  };
  // Why the room won't have this player, by the server's word for it.
  const refused = (err: unknown) => {
    const why = { full: "full", removed: "removed", locked: "locked", too_many: "busy", started: "started" } as const;
    trouble.set(why[(err as ApiError).code as keyof typeof why] ?? "gone");
  };
  // In the room (again: the look as it is now; the name it had there, or the one chosen for it in this tab), then its
  // stream.
  const enter = (name = named(code) ?? "") => {
    if (life.aborted) return;
    api("POST", `/api/rooms/${code}/join`, name ? { name, key: roomKey } : { key: roomKey }).then(connect, (err) => {
      // The name this tab had is the one the host asked to change: in without it, and asked for another there.
      if (name && (err as ApiError).code === "name_again") {
        named(code, "");
        return enter("");
      }
      refused(err);
    });
  };
  // A wrong code is said at once, before a name is asked or a player made for it.
  api("GET", `/api/rooms/${code}${roomKey ? `?key=${encodeURIComponent(roomKey)}` : ""}`)
    .then(() => player())
    .then((u) => (u.drawn && named(code) === null ? naming.set(u.name) : enter()))
    .catch(refused);

  // Each phase (and each question) is drawn once; what changes inside it follows the view.
  const key = computed(() => {
    const v = view();
    return v ? `${v.phase}:${v.n}` : "";
  });
  playingWhile(() => {
    const phase = view()?.phase;
    return phase === "question" || phase === "reveal";
  });
  // The screen stays on through a game's questions; a big screen led from, all the time it shows the room.
  const leading = computed(() => !!(view()?.lead && view()?.isHost));
  keepAwake(() => {
    const phase = view()?.phase;
    return phase === "question" || phase === "reveal" || leading();
  });
  // Leaving a game under way costs its questions: it goes on without the player (who may come back to it by the
  // code). Every way out asks first, back too (the room opened from a chat has an entry of its own meanwhile:
  // holdWhile); a host leading from a big screen plays nothing, and isn't asked.
  const costs = () => {
    const v = view();
    return !!v && (v.phase === "question" || v.phase === "reveal") && !(v.lead && v.isHost);
  };
  holdWhile(costs);
  const leaveAsk = guardLeaving(
    "Излизаш от стаята? Играта продължава без теб, а въпросите остават без отговор.",
    costs,
  );
  effect(() => document.documentElement.classList.toggle("hosting", leading()));
  onCleanup(() => document.documentElement.classList.remove("hosting"));
  return h(
    "div",
    { class: "screen" },
    leaveAsk,
    () =>
      trouble() === "full"
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Стаята е пълна"),
            h("p", { class: "lead" }, "В една стая играят до 50 души."),
          )
        : null,
    () =>
      trouble() === "gone"
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Няма такава стая"),
            h("p", { class: "lead" }, "Може кодът да е грешен или стаята да е затворена."),
            h("a", { class: "btn primary big", href: "/room" }, "Опитай друг код"),
          )
        : null,
    () =>
      trouble() === "removed"
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Водещият те махна от стаята"),
            h("p", { class: "lead" }, "Ако водещият те върне, ще можеш да влезеш пак."),
            nextSteps(h("a", { class: "btn primary", href: "/" }, "Към Начало"), [
              h("button", { class: "btn", type: "button", onclick: () => location.reload() }, "Влез пак"),
            ]),
          )
        : null,
    () =>
      trouble() === "locked"
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Стаята е заключена"),
            h("p", { class: "lead" }, "Нови играчи не могат да влязат. Помоли водещия да я отключи и опитай пак."),
            h("button", { class: "btn primary big", type: "button", onclick: () => location.reload() }, "Опитай пак"),
          )
        : null,
    () =>
      trouble() === "started"
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Играта вече започна"),
            h(
              "p",
              { class: "lead" },
              "По време на игра нови играчи влизат с връзката към стаята. Помоли за нея или опитай пак след края на играта.",
            ),
            h("button", { class: "btn primary big", type: "button", onclick: () => location.reload() }, "Опитай пак"),
          )
        : null,
    () =>
      trouble() === "moved"
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Стаята е отворена на друг екран"),
            h("p", { class: "lead" }, "Играеш от другия екран. Можеш да продължиш и тук."),
            h("button", { class: "btn primary big", type: "button", onclick: () => location.reload() }, "Продължи тук"),
          )
        : null,
    () =>
      trouble() === "busy"
        ? h(
            "div",
            { class: "stack" },
            h("h1", null, "Твърде много опити"),
            h("p", { class: "lead" }, "Опитай пак малко по-късно."),
            h("a", { class: "btn primary", href: "/" }, "Към Начало"),
          )
        : null,
    () =>
      trouble() === "reconnecting"
        ? h("p", { class: "status reconnecting", role: "status" }, "Връзката прекъсна. Свързваме се отново…")
        : null,
    () => {
      const drawn = naming();
      return drawn !== null
        ? nameStep(
            code,
            (name) => api("POST", `/api/rooms/${code}/join`, { name, key: roomKey }),
            drawn,
            () => {
              naming.set(null);
              connect();
            },
            refused,
          )
        : null;
    },
    // Asked for another name, over the room's screen (kept as it is underneath): the name it has now to start from.
    () =>
      asked() && inRoom()
        ? nameStep(
            code,
            (name) => api("POST", `/api/rooms/${code}/join`, { name, key: roomKey }),
            untracked(view)?.players.find((p) => p.me)?.name ?? "",
            () => {},
            refused,
            true,
          )
        : null,
    h("div", { class: "room-phase", hidden: asked }, () => {
      const k = key();
      if (trouble() !== "" && trouble() !== "reconnecting") return null;
      if (!k) return naming() !== null ? null : loading("title", "card");
      const v = untracked(view) as RoomView;
      // A new game („Нова игра“ goes from the end straight to its first question).
      if (v.phase === "lobby" || (v.phase === "question" && v.n === 0)) places.clear();
      if (v.lead && v.isHost) return hosting(view as () => RoomView, code, v, places);
      switch (v.phase) {
        case "lobby":
          return lobby(view as () => RoomView, code);
        case "question":
          scrollTo(0, 0); // each question opens at the top, wherever the standings were scrolled to
          return question(view as () => RoomView, code, v);
        case "reveal":
          return reveal(view as () => RoomView, v, places);
        case "end":
          return end(view as () => RoomView, code);
      }
    }),
  );
}

/** The name the player chose for this room in this tab (`now`: chosen now), "" if they were asked for none (a host who
 * only leads: rooms.ts marks the room named), or null if not asked yet: a reload doesn't ask again, and comes back
 * under it (a locked room tried again, a room the server lost over a restart). */
function named(code: string, now?: string): string | null {
  try {
    if (now !== undefined) {
      sessionStorage.setItem(`named:${code}`, "1");
      sessionStorage.setItem(`room-name:${code}`, now);
    }
    return sessionStorage.getItem(`named:${code}`) === "1" ? (sessionStorage.getItem(`room-name:${code}`) ?? "") : null;
  } catch {
    return now ?? null;
  }
}

/** One field before the room: the name the others in it will see, the drawn one in it to keep or change. It's the
 * room's alone (roomJoin on the server): not the player's name anywhere else, so a real name given there never
 * reaches the boards. The field says so, and asks for no more than a first name; and the browser isn't asked to fill
 * in a full one (`autocomplete` off). `join` comes in under it; a name the server won't take is said here, anything
 * else is the room's (`refused`). `again`: the host has asked for another name (room.go: AskName). */
function nameStep(
  code: string,
  join: (name: string) => Promise<unknown>,
  drawn: string,
  done: () => void,
  refused: (err: unknown) => void,
  again = false,
): Child {
  const name = signal(drawn);
  const error = signal("");
  const busy = signal(false);
  return h(
    "form",
    {
      class: "stack",
      onsubmit: async (e: SubmitEvent) => {
        e.preventDefault();
        error.set("");
        busy.set(true);
        try {
          await join(name.peek());
          named(code, name.peek());
          done();
        } catch (err) {
          if (["bad_name", "reserved_name", "name_again"].includes((err as ApiError).code)) {
            return error.set(errorText(err));
          }
          named(code, name.peek()); // the room's refusal (locked, full): tried again, under this name
          refused(err);
        } finally {
          busy.set(false);
        }
      },
    },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, `Стая ${spaced(code)}`),
      h("h1", null, again ? "Водещият помоли за друго име" : "С какво име влизаш?"),
    ),
    h(
      "label",
      { class: "field" },
      h("span", null, "Име в стаята"),
      h("input", {
        name: "room-name",
        autocomplete: "off",
        autocapitalize: "words",
        "aria-describedby": "room-name-how",
        minlength: 2,
        maxlength: 30,
        required: true,
        value: name,
        onfocus: (e: FocusEvent) => (e.target as HTMLInputElement).select(),
        oninput: (e: Event) => name.set((e.target as HTMLInputElement).value),
      }),
      h(
        "small",
        { class: "muted", id: "room-name-how" },
        "Вижда се само в тази стая. Стига малкото име или прякор, без фамилия.",
      ),
    ),
    h("button", { class: "btn primary big", disabled: busy }, again ? "Готово" : "Влез"),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** The host's way to change what the room plays next (rooms.ts: changeGame). */
export function choose(view: () => RoomView, code: string): Child {
  const v = untracked(view);
  return changeGame({ category: v.category, length: v.length, mix: v.mix }, async (g) => {
    try {
      await api("POST", `/api/rooms/${code}/settings`, g);
      return "";
    } catch (err) {
      return errorText(err);
    }
  });
}

/** What who leads the room does: starts a game, moves it on, ends it. Each path is written whole, as the server has it
 * (routes_test.go holds the client's paths to the server's). */
export async function lead(code: string, action: "start" | "next" | "finish", error: (s: string) => void) {
  const path = {
    start: `/api/rooms/${code}/start`,
    next: `/api/rooms/${code}/next`,
    finish: `/api/rooms/${code}/finish`,
  }[action];
  try {
    await api("POST", path);
  } catch (err) {
    error(errorText(err));
  }
}

function waiting(view: () => RoomView, what: string): Child {
  return () => {
    const v = view();
    // A host who only leads (a big screen) is „водещият“, not a name the players don't know.
    return v.canLead ? null : h("p", { class: "status" }, `Чакаме ${v.lead ? "водещия" : v.host} да ${what}.`);
  };
}

function lobby(view: () => RoomView, code: string): Child {
  const error = signal("");
  joins(view);
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, () => about(view())),
      h("h1", null, "Стая ", h("span", { class: "code-big" }, spaced(code))),
      h("p", { class: "lead" }, "Дай кода на другите или им прати връзката."),
    ),
    shareButton("Прати връзката", () => "Ела да играем заедно в АЛМАНАХ:", link(untracked(view), code), false),
    h(
      "section",
      { class: "card" },
      h("h2", { class: "section-title" }, () => `Играчи (${view().players.length})`),
      players(view, code, error.set),
      door(view, code, error.set),
    ),
    () =>
      view().canLead
        ? h("button", { class: "btn primary big", onclick: () => lead(code, "start", error.set) }, "Започни")
        : null,
    waiting(view, "започне"),
    untracked(view).isHost ? choose(view, code) : null,
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
  );
}

/** The room's link: its code, and its key, which takes someone new into a game under way too. */
export const link = (v: RoomView, code: string) => `${location.origin}/r/${code}${v.key ? `#${v.key}` : ""}`;

/** The host's lock on the room: locked, nobody new comes in (once everyone is there), and whoever is in it comes back
 * as ever. Open, it says when it's time: once others have come in, or that a room led locks itself as it starts.
 * Nothing for anyone else. */
export function door(view: () => RoomView, code: string, error: (s: string) => void): Child {
  if (!untracked(view).isHost) return null;
  const locked = computed(() => !!view().locked);
  const line = computed(() => {
    const v = view();
    if (v.locked) return "Стаята е заключена: нови играчи не могат да влязат.";
    if (v.lead && v.phase === "lobby") return "Всеки с кода може да влезе. Щом започнеш, стаята ще се заключи сама.";
    return v.players.filter((p) => !p.me).length > 0
      ? "Всички ли са вътре? Заключи стаята и никой нов няма да влезе."
      : "Всеки с кода може да влезе.";
  });
  const toggle = async () => {
    try {
      await api("POST", `/api/rooms/${code}/lock`, { on: !untracked(locked) });
    } catch (err) {
      error(errorText(err));
    }
  };
  return h(
    "div",
    { class: "door" },
    h("span", { role: "status" }, line),
    h("button", { class: "btn inline", type: "button", onclick: toggle }, () =>
      locked() ? "Отключи" : "Заключи стаята",
    ),
  );
}

/** The players as chips. The host has two things on each of the others: „Смени името“ (the player is asked for
 * another, theirs drawn meanwhile) and „Махни“, asked twice; and those sent out, each with „Върни“, a slip undone.
 * `manage`: whether the host's hands show now (a big screen keeps them folded: host.ts). */
export function players(
  view: () => RoomView,
  code: string,
  error: (s: string) => void,
  manage: () => boolean = () => true,
): Child {
  const sure = signal(-1); // the key of the one „Махни“ was tapped on once
  let t = 0;
  onCleanup(() => clearTimeout(t));
  const act = async (what: "remove" | "rename" | "return", p: Player) => {
    const path = {
      remove: `/api/rooms/${code}/remove`,
      rename: `/api/rooms/${code}/rename`,
      return: `/api/rooms/${code}/return`,
    }[what];
    try {
      await api("POST", path, { key: p.key });
    } catch (err) {
      error(errorText(err));
    }
  };
  const remove = (p: Player) => {
    clearTimeout(t);
    if (sure.peek() !== p.key) {
      sure.set(p.key);
      t = window.setTimeout(() => sure.set(-1), 4000);
      return;
    }
    sure.set(-1);
    act("remove", p);
  };
  return [
    h("ul", { class: "players" }, () => {
      const v = view();
      // A new name is asked for between games, not in the middle of one.
      const naming = v.phase === "lobby" || v.phase === "end";
      const hands = v.isHost && manage();
      return v.players.map((p) =>
        h(
          "li",
          { class: [!p.online && "away", p.me && "me"].filter(Boolean).join(" ") || undefined },
          h(
            "span",
            { class: "player-who" },
            avatar(p.avatar, { size: "s", name: p.name }),
            h("span", { class: "player-name" }, p.name, p.me ? " (ти)" : "", p.online ? "" : " — извън стаята"),
          ),
          hands && !p.me
            ? h(
                "span",
                { class: "player-acts" },
                naming
                  ? h(
                      "button",
                      {
                        type: "button",
                        class: "link remove",
                        "aria-label": `Поискай друго име от ${p.name}`,
                        onclick: () => act("rename", p),
                      },
                      "Смени името",
                    )
                  : null,
                h(
                  "button",
                  {
                    type: "button",
                    class: () => (sure() === p.key ? "link remove bad" : "link remove"),
                    "aria-label": () => `${sure() === p.key ? "Да, махни" : "Махни"} ${p.name}`,
                    onclick: () => remove(p),
                  },
                  () => (sure() === p.key ? "Да, махни" : "Махни"),
                ),
              )
            : null,
        ),
      );
    }),
    () => {
      const out = view().out ?? [];
      if (!out.length || !manage()) return null;
      return h(
        "div",
        { class: "players-out" },
        h("p", { class: "muted" }, "Махнати от стаята:"),
        h(
          "ul",
          { class: "players" },
          out.map((p) =>
            h(
              "li",
              { class: "away out" },
              avatar(p.avatar, { size: "s", name: p.name }),
              h("span", { class: "player-name" }, p.name),
              h(
                "button",
                {
                  type: "button",
                  class: "link remove",
                  "aria-label": `Върни ${p.name} в стаята`,
                  onclick: () => act("return", p),
                },
                "Върни",
              ),
            ),
          ),
        ),
      );
    },
  ];
}

/** A sound as someone comes into the room. */
export function joins(view: () => RoomView): void {
  let seen = untracked(view).players.length;
  effect(() => {
    const n = view().players.length;
    if (n > seen) play("them");
    seen = n;
  });
}

/** Which question, and its topic. */
export function head(v: RoomView): Child {
  return questionHead(v.n, v.total, topicName(v.question?.category ?? ""));
}

function question(view: () => RoomView, code: string, first: RoomView): Child {
  const q = first.question;
  if (!q) return null;
  if (first.n === 0) play("go"); // the game starts
  // The player's time runs from when this screen shows it, its pictures in (onScreen).
  return h(
    "article",
    { class: "question" },
    head(first),
    onScreen(
      q.view,
      () => asking(view, code, first),
      () => api("POST", `/api/rooms/${code}/seen`, { n: first.n }),
    ),
  );
}

/** The question itself, once it's on the screen: its clock, the question, its options, and who has answered. */
function asking(view: () => RoomView, code: string, first: RoomView): Child {
  // Its time left as the server last said, from when this screen shows it.
  const now = untracked(view);
  const q = (now.n === first.n && now.phase === "question" ? now.question : null) ?? first.question;
  if (!q) return null;
  // Answered as in every game (game/answering.ts): sent again while it doesn't get through (the line dropped, the
  // server restarting) and the question is open, the room taking it once; in once the server says so, by its reply or
  // by the room's view, should the reply be lost.
  const life = lifetime();
  const ans = answering({
    view: q.view,
    leftMs: q.leftMs,
    post: (answer) => api("POST", `/api/rooms/${code}/answer`, { n: first.n, answer }),
    open: () => !life.aborted && view().phase === "question" && view().n === first.n,
    inView: () => view().n === first.n && !!view().question?.given,
  });
  // More of the question shows as its time runs (the next clue), and the clock goes by the server's.
  effect(() => {
    const v = view();
    if (v.n === first.n && v.question && v.phase === "question") ans.follow(v.question.view, v.question.leftMs);
  });
  return [
    timer(q.leftMs, q.limitMs, ans.left, ans.stopped),
    ans.heading,
    picture(q.view, true),
    ans.asked.node,
    () =>
      h("p", { class: "status", role: "status" }, ans.taken() ? "Отговорът ти е приет. " : "", stillAnswering(view())),
    ans.said,
  ];
}

function reveal(view: () => RoomView, first: RoomView, places: Map<number, number>): Child {
  const q = first.question;
  const r = q?.reveal;
  if (!q || !r) return null;
  const last = first.n + 1 >= first.total;
  const held = computed(() => !!view().held); // only a change of it draws the line again
  const kind: VerdictKind = r.missed
    ? "time"
    : r.exact
      ? "exact"
      : r.right
        ? "right"
        : r.points > 0
          ? "partial"
          : "wrong";
  playAnswer(kind, r.inRow);
  // The rank change since the last answer.
  const before = new Map(places);
  first.players.forEach((p, i) => {
    places.set(p.key, i + 1);
  });
  return h(
    "article",
    { class: "question" },
    head(first),
    h("h1", { class: "ask" }, q.view.text),
    picture(q.view, true),
    answered(q.view, asRoom(q), q.given ?? null),
    verdict(kind, r.points, r.missed ? "Времето изтече." : undefined, r.speed, r.inRow),
    knew(first),
    crowdLine(q.view.type, r.answer.crowd, r.right),
    // Held, the answer stays up until who leads moves on: time to read its fact here too, not only on the big screen.
    () => (held() ? fact(r.answer.fact) : null),
    () =>
      held()
        ? h("p", { class: "status" }, "Водещият ще продължи.")
        : untracked(() =>
            upNext(view().question?.nextMs ?? 0, last ? "Към класирането…" : `Въпрос ${first.n + 2} след малко…`),
          ),
    standings(view, true, before),
  );
}

/** How many have answered the question showing, of those in the room for it; and, once only a few are left (and this
 * player isn't one of them), who they are: „Отговориха 6 от 8. Чакаме Ани и Боби.“ Nothing with nobody in the room
 * (a room led with no phones). */
export function stillAnswering(v: RoomView): string {
  const playing = v.players.filter((p) => p.online || p.answered);
  if (!playing.length) return "";
  const done = playing.filter((p) => p.answered).length;
  const left = playing.filter((p) => !p.answered);
  const names = done > 0 && left.length <= 3 && !left.some((p) => p.me) ? left.map((p) => p.name) : [];
  return `Отговориха ${done} от ${playing.length}.${names.length ? ` Чакаме ${listWords(names)}.` : ""}`;
}

/** The answer as the room shows it: on each option how many in the room gave it (its own crowd, counted, not shared),
 * the bars as long as their share; with nobody in the room, how everyone ever answered, as anywhere. The sentence on
 * everyone (crowdLine) still counts everyone. */
export function asRoom(q: NonNullable<RoomView["question"]>): Reveal {
  const r = q.reveal?.answer as Reveal;
  const crowd = q.split?.crowd;
  return crowd ? { ...r, crowd: { ...crowd, counts: true } } : r;
}

/** Who in the room knew the answer showing, the quickest first: „Познаха 5 от 8: Ани, Боби и още 3.“, „Само Ани
 * позна.“, „Всички познаха.“, „Никой не позна.“ This player is „ти“. Nothing for a room of one, whose verdict says
 * it. */
export function knew(v: RoomView): Child {
  const s = v.question?.split;
  const had = s?.crowd?.answers ?? 0;
  if (!s || had < 2) return null;
  const names = s.right.map((k) => {
    const p = v.players.find((x) => x.key === k);
    return p?.me ? "ти" : (p?.name ?? "");
  });
  const n = names.length;
  const text =
    n === 0
      ? "Никой не позна."
      : n === had
        ? "Всички познаха."
        : n === 1
          ? `Само ${names[0]} позна.`
          : `Познаха ${n} от ${had}: ${n <= 3 ? listWords(names) : `${names.slice(0, 2).join(", ")} и още ${n - 2}`}.`;
  return h("p", { class: "room-knew" }, text);
}

/** The players by points (the first `top`); after an answer, what it brought each of them and how far they moved; at
 * the end, how many each got right („6/10 ·“). Nothing while nobody plays (a room led, everyone answering aloud). */
export function standings(view: () => RoomView, gains: boolean, before?: Map<number, number>, top = 50): Child {
  return () => {
    const v = view();
    if (!v.players.length) return null;
    return h(
      "section",
      { class: "board" },
      h("h2", null, "Класиране"),
      h(
        "ol",
        null,
        v.players.slice(0, top).map((p, i) => {
          const row = boardRow(
            p.place ?? i + 1,
            p.name,
            gains && p.gained
              ? [h("small", { class: "sub" }, `+${formatNumber(p.gained)} · `), formatNumber(p.points)]
              : v.phase === "end"
                ? [h("small", { class: "sub" }, `${p.rights}/${v.total} · `), formatNumber(p.points)]
                : formatNumber(p.points),
            { me: p.me, look: p },
          );
          if (!p.online) row.classList.add("away");
          if (before?.size) {
            row.classList.add("moves");
            row.append(move(before.get(p.key), i + 1));
          }
          return row;
        }),
      ),
    );
  };
}

/** Places moved since the last answer: up, down, or none. */
function move(was: number | undefined, now: number): HTMLElement {
  const d = was === undefined ? 0 : was - now;
  if (d === 0) return h("span", { class: "delta", "aria-label": "без промяна" }, "–");
  return h(
    "span",
    { class: d > 0 ? "delta up" : "delta down", "aria-label": d > 0 ? `нагоре с ${d}` : `надолу с ${-d}` },
    h("span", { class: "i delta-sign", "aria-hidden": "true" }),
    String(Math.abs(d)),
  );
}

function end(view: () => RoomView, code: string): Child {
  const error = signal("");
  // The room's winner hears it; everyone else, just the end.
  const first = untracked(view);
  play(first.players.length > 1 && first.players[0]?.me ? "win" : "end");
  const questions = reviewParts(async () => view().review ?? []);
  const ran = computed(() => view().run ?? 0);
  // The others to add as friends (not friends yet, nor asked), and whether the day's ten still wait for this player.
  const people = signal<{ add: number[]; day: boolean } | null>(null);
  const sent = signal<Record<number, string>>({});
  api<{ add: number[]; day: boolean }>("GET", `/api/rooms/${code}/people`).then(people.set, () => {});
  const befriend = async (key: number) => {
    try {
      const r = await api<{ friends?: boolean }>("POST", `/api/rooms/${code}/people`, { key });
      sent.update((s) => ({ ...s, [key]: r.friends ? "Вече сте приятели." : "Поканата е изпратена." }));
    } catch (err) {
      error.set(errorText(err));
    }
  };
  const add =
    (p: Player): Child =>
    () =>
      sent()[p.key]
        ? h("span", { class: "muted" }, sent()[p.key])
        : people()?.add.includes(p.key)
          ? h(
              "button",
              {
                class: "link",
                type: "button",
                "aria-label": `Добави ${p.name} в приятели`,
                onclick: () => befriend(p.key),
              },
              "Добави",
            )
          : null;
  return h(
    "div",
    { class: "screen" },
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, () => `Стая ${spaced(code)} · ${topicName(view().category)}`),
      h("h1", null, () => {
        const top = view().players.filter((p) => p.place === 1);
        if (top.length > 1)
          return `${top
            .slice(0, -1)
            .map((p) => p.name)
            .join(", ")} и ${top.at(-1)?.name} делят първото място`;
        return top[0] ? `${top[0].name} печели` : "Край";
      }),
      // How many this player got right, whatever their place: and the place, among others.
      () => {
        const v = view();
        const me = v.players.find((p) => p.me);
        if (!me) return null;
        const among = v.players.length > 1 && me.place ? ` и си на ${place(me.place, v.players.length)}` : "";
        return h("p", { class: "lead" }, `Позна ${me.rights} от ${v.total}${among}.`);
      },
    ),
    () =>
      view().allRight
        ? h("p", { class: "points-bonus" }, `Всички верни: +${formatNumber(view().allRight ?? 0)} т.`)
        : null,
    // Who leads starts the next game (the gold button); everyone else waits for it. The questions to go over, beside:
    // under the result, over the standings, which may be long.
    nextSteps(
      () =>
        view().canLead
          ? h(
              "button",
              { class: "btn primary big", onclick: () => lead(code, "start", error.set) },
              "Започни нова игра",
            )
          : waiting(view, "започне нова игра"),
      [
        questions.button,
        () => (people()?.day === false ? h("a", { class: "btn", href: "/" }, "Към въпросите на деня") : null),
      ],
    ),
    () => error() && h("p", { class: "bad", role: "alert" }, error()),
    standings(view, false),
    // The others to add as friends, folded: a room of thirty isn't thirty buttons.
    () =>
      people()?.add.length
        ? h(
            "details",
            { class: "more" },
            h("summary", null, "Добави в приятели"),
            h("ul", { class: "players" }, () =>
              view()
                .players.filter((p) => people()?.add.includes(p.key))
                .map((p) =>
                  h("li", null, avatar(p.avatar, { size: "s", name: p.name }), h("span", null, p.name), add(p)),
                ),
            ),
          )
        : null,
    // The host may change what the next game plays, keeping the code and the players.
    first.isHost ? choose(view, code) : null,
    // What the game earned, once it's kept (a moment after its end), as any game tells it.
    () => {
      const run = ran();
      return run ? news(run) : null;
    },
    // The host can send someone out before the next game.
    first.isHost
      ? h(
          "details",
          { class: "more" },
          h("summary", null, () => `Играчи (${view().players.length})`),
          players(view, code, error.set),
          door(view, code, error.set),
        )
      : null,
    questions.list,
  );
}
