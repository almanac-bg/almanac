// Приятели, one of the three places (DESIGN.md, Places), one page with no tabs (owner, 2026-11-22: both in sight at
// once): who asks to be friends; the duels open („Чакащи дуели“: a friend's waiting for you first, yours waiting for
// them), first while there are any, for a duel to play stays first here until it's played; the friends, each with
// their day, the duels between you and „Дуел“ (the one way to start one here), and the one way to make more (by
// потребителско име or email, one's own said under it); and the last ten duels played („Завършени дуели“, compact rows). Each duel holds all

// there is of it (screens/duelcards.ts). A duel named in the address (`?duel=<id>`: one just played, or an old link
// to it: screens/duel.ts) is first in its group. The day's board is on Днес's result (today.ts, dayBoard).

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Look } from "../ui.ts";
import type { Accepted, Duels, DuelView } from "./duel.ts";
import { duelGroup } from "./duelcards.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  acceptedLine,
  api,
  lastOf,
  setIfNew,
  errorText,
  formatNumber,
  h,
  onCleanup,
  nameWords,
  emailWords,
  signal,
  when,
  title,
  sawFriends,
  news,
  loadFeel,
  startDuel,
  go,
  player,
  user,
  failure,
  profileHref,
  record,
  withWord,
  who,
  inSight,
  playerRow,
} = {} as Kit;

interface Friend {
  id: number;
  name: string;
  tag: string;
  avatar?: string;
  won: number;
  lost: number;
  drawn: number;
  /** Three duels the player sent wait for them: no new one until they play one (play.Friend.Full). */
  full?: boolean;
}

/** A friend request: from someone (to you), or to someone or an email address (from you). */
interface Request {
  id: number;
  name?: string;
  tag?: string;
  /** Who asks, as they show to others (play.Look). */
  look?: Look;
  email?: string;
}

interface Friends {
  friends: Friend[];
  requests: { in: Request[]; out: Request[] };
  /** A friend said yes to the player's request: told once (play/lines.go). */
  accepted?: Accepted | null;
}

export function friends(kit: Kit): Child {
  ({
    acceptedLine,
    api,
    lastOf,
    setIfNew,
    errorText,
    formatNumber,
    h,
    onCleanup,
    nameWords,
    emailWords,
    signal,
    when,
    title,
    sawFriends,
    news,
    loadFeel,
    startDuel,
    go,
    player,
    user,
    failure,
    profileHref,
    record,
    withWord,
    who,
    inSight,
    playerRow,
  } = kit);
  title("Приятели");
  // Opened: what has come here is seen, on every device, and the dot on Приятели goes.
  if (user.peek()) sawFriends();
  // The place's name is the page's heading, for a screen reader: its sections are headed in sight.
  return h("section", { class: "screen" }, h("h1", { class: "sr" }, "Приятели"), page(kit));
}

/** The page: who asks to be friends, the duels open, the friends (each with their day and the duels between you, a
 * duel a tap away; while changing the list, removing them), the one field to add more and the requests that wait for
 * an answer, then the duels played. */
function page(kit: Kit): Child {
  const asked = new URLSearchParams(location.search);
  // The duel named in the address (just played, or an old link to its page): first in its group, where its result
  // lands once (duelcards.ts), with what its game brought under it, asked for once (game/news.ts: it marks the game
  // as told). One that isn't among those listed (older than the last ten) is asked for by itself.
  const named = Number(asked.get("duel")) || 0;
  // Come back to (or come to from a duel's game, which asked for them as it ended: screens/duel.ts), the page as it
  // was last shown, at once, the duel named first in its group, and anew in place where it has changed (api.ts,
  // lastOf).
  const data = signal<Friends | null>(lastOf<Friends>("/api/friends") ?? null);
  const duels = signal<Duels | null>(lastOf<Duels>("/api/duels") ?? null);
  const had = duels.peek();
  const top = signal<DuelView | null>(
    (named && had && [...had.yours, ...had.theirs, ...had.played].find((o) => o.id === named)) || null,
  );
  const landing = top.peek();
  let brought: Child = landing?.runId && landing.state !== "yours" ? news(landing.runId) : null;
  // Brought into sight once this visit, as the page opens (duelcards.ts).
  const sight = { done: false };
  const error = signal("");
  // Where the error is said: by the list (most of what fails), or by the requests sent, whose „Отмени“ is below it.
  const errorAt = signal<"list" | "sent">("list");
  // The list that couldn't load (with nothing of it shown yet): the failure, and the way to try again.
  const failed = signal<unknown>(null);
  const editing = signal(false);
  // A friend's yes, told once over the friends: kept as it was said while the list is asked again.
  const yes = signal<Child>(null);

  const load = async () => {
    if (!user.peek()) return;
    try {
      const [f, d] = await Promise.all([
        api<Friends>("GET", "/api/friends"),
        api<Duels>("GET", "/api/duels"),
        // The landing's moment needs the game's feel; without it the card is whole, only still.
        named && !top.peek() ? loadFeel().catch(() => null) : null,
      ]);
      if (named) {
        const first =
          [...d.yours, ...d.theirs, ...d.played].find((o) => o.id === named) ??
          top.peek() ??
          (await api<{ duel: DuelView }>("GET", `/api/duels/${named}`).then(
            (r) => r.duel,
            () => null,
          ));
        if (first?.runId && first.state !== "yours" && !brought) brought = news(first.runId);
        top.set(first);
      }
      failed.set(null);
      // Drawn anew only when something changed: a look every quarter minute that found the same would otherwise
      // rebuild the lists under the pointer (a tooltip showing, a row hovered, gone).
      setIfNew(data, f);
      setIfNew(duels, d);
      if (f.accepted && !yes.peek()) yes.set(acceptedLine(f.accepted));
    } catch (err) {
      // A look again that failed, with the list on the screen, waits for the next one quietly.
      if (!data.peek()) failed.set(err);
    }
  };
  load();
  // Friend requests and duels come and go (someone asks, or takes it back; a friend plays): look again while the
  // screen is open.
  const every = setInterval(() => {
    if (!document.hidden) load();
  }, 15_000);
  onCleanup(() => clearInterval(every));

  const act = async (fn: () => Promise<unknown>, at: "list" | "sent" = "list") => {
    error.set("");
    errorAt.set(at);
    try {
      await fn();
    } catch (err) {
      error.set(errorText(err));
    }
  };
  // A friend removed, once the player says so on a sheet over the page: at once, the duels open between them ending
  // with it (play.Unfriend).
  const remove = (f: Friend) => {
    const yes = () => {
      box.close();
      act(async () => {
        await api("DELETE", `/api/friends/${f.id}`);
        await load();
      });
    };
    const box = h(
      "dialog",
      { class: "sheet", "aria-labelledby": "remove-title" },
      h(
        "div",
        { class: "card sheet-panel stack" },
        h("h2", { id: "remove-title" }, `Премахваш ли ${f.name} от приятелите си?`),
        h("p", { class: "muted" }, "Незавършените дуели между вас свършват."),
        h("button", { class: "btn danger big", type: "button", onclick: yes }, "Премахни"),
        h("button", { class: "link tap sheet-skip", type: "button", onclick: () => box.close() }, "Отказ"),
      ),
    ) as HTMLDialogElement;
    // A tap beside the sheet puts it away, as Esc does; put away, it goes (the router closes it with the screen).
    box.addEventListener("click", (e) => {
      if (e.target === box) box.close();
    });
    box.addEventListener("close", () => box.remove());
    document.body.append(box);
    box.showModal();
  };
  const accept = (r: Request) =>
    act(async () => {
      await api("POST", `/api/friends/requests/${r.id}/accept`, {});
      await load();
    });
  const drop = (r: Request, at: "list" | "sent" = "list") =>
    act(async () => {
      await api("DELETE", `/api/friends/requests/${r.id}`);
      await load();
    }, at);
  // A duel with a friend: started (theirs to play once the player has), and played on its page.
  const challenge = (f: Friend) =>
    act(async () => {
      const d = await startDuel(f.id);
      if (d) go(`/duel/${d.id}`);
    });
  // Made once: what it says after a request stays while the list around it is drawn again.
  const adder = addFriend(load);

  // A group of duels, drawn once the duels are in (duelcards.ts).
  const group = (which: "open" | "played") => () => {
    const d = duels();
    return d ? duelGroup(kit, which, d, top(), brought, sight) : null;
  };

  return [invitations(), group("open"), friendsList(), adding(), group("played")];

  /** Who asks to be friends, at the page's top: each as every row of players has them (their avatar and name, a way
   * to their profile), what they ask on a line of its own under the name, and the two answers. */
  function invitations(): Child {
    return () =>
      (data()?.requests.in ?? []).map((r) =>
        h(
          "div",
          { class: "invitation" },
          h(
            "div",
            { class: "invitation-who" },
            who(r.name ?? "", r.look ?? {}, null, r.name ?? "", r.tag ?? ""),
            h("p", { class: "invitation-line" }, "Иска да сте приятели."),
          ),
          h(
            "div",
            { class: "invitation-actions" },
            h("button", { class: "btn inline", type: "button", onclick: () => accept(r) }, "Приеми"),
            h("button", { class: "link tap", type: "button", onclick: () => drop(r) }, "Откажи"),
          ),
        ),
      );
  }

  function friendsList(): Child {
    return h(
      "section",
      { class: "sect friends" },
      h(
        "div",
        { class: "sect-head" },
        h("h2", null, () => {
          const n = data()?.friends.length ?? 0;
          return n ? `Приятели (${formatNumber(n)})` : "Приятели";
        }),
        () => {
          const n = data()?.friends.length ?? 0;
          return n
            ? h(
                "span",
                { class: "sect-note" },
                h(
                  "button",
                  { class: "link muted tap", type: "button", onclick: () => editing.update((e) => !e) },
                  () => (editing() ? "Готово" : "Премахни приятел"),
                ),
              )
            : null;
        },
      ),
      yes,
      () => {
        const d = data();
        if (!d && failed()) return failure(failed(), () => void load(), null);
        if (!d) {
          // Not a player yet: friends are added once they are.
          return user()
            ? null
            : [
                h(
                  "p",
                  { class: "muted friends-none" },
                  "Добави приятели, за да играете дуели и да виждате всеки ден как сте изиграли днешния брой.",
                ),
                h(
                  "button",
                  {
                    class: "btn",
                    type: "button",
                    onclick: () =>
                      act(async () => {
                        await player();
                        await load();
                      }),
                  },
                  "Добави приятел",
                ),
              ];
        }
        const shown = d.friends;
        return shown.length
          ? h(
              "ol",
              { class: "rows friend-list" },
              shown.map((f) =>
                row(
                  f,
                  () => remove(f),
                  () => challenge(f),
                  editing,
                  d.friends.some((o) => o.id !== f.id && o.name === f.name),
                ),
              ),
            )
          : h(
              "p",
              { class: "muted friends-none" },
              "Още нямаш приятели тук. С приятел можете да играете дуели: едни и същи десет въпроса, всеки ги играе, когато може. И всеки ден ще виждате как сте изиграли днешния брой. Добави приятел по потребителско име или имейл.",
            );
      },
      // Outside the parts drawn again on each look (every 15 s): drawn again, its field would lose the focus mid-word.
      () => error() && errorAt() === "list" && h("p", { class: "bad", role: "alert" }, error()),
    );
  }

  /** Adding a friend, a section of its own headed as every other („Добави приятел“), and under it the requests sent
   * that wait for an answer („Изпратени покани (2)“), each with „Отмени“. */
  function adding(): Child {
    return when(data, () => [
      h(
        "section",
        { class: "sect friends-add" },
        h("div", { class: "sect-head" }, h("h2", null, "Добави приятел")),
        adder,
      ),
      () => {
        const out = data()?.requests.out ?? [];
        return out.length
          ? h(
              "section",
              { class: "sect waiting-for" },
              h("div", { class: "sect-head" }, h("h2", null, `Изпратени покани (${formatNumber(out.length)})`)),
              h(
                "ul",
                { class: "rows waiting" },
                out.map((r) =>
                  h(
                    "li",
                    null,
                    r.email
                      ? h("span", null, emailWords(r.email))
                      : h("a", { href: profileHref(r.tag ?? "") }, nameWords(r.name ?? "")),
                    h("button", { class: "link muted tap", type: "button", onclick: () => drop(r, "sent") }, "Отмени"),
                  ),
                ),
              ),
            )
          : null;
      },
      () => error() && errorAt() === "sent" && h("p", { class: "bad", role: "alert" }, error()),
    ]);
  }
}

/** Asking someone to be friends: by their tag (@tag) or their email, on a line, „Добави“ beside it; under it, the
 * player's own tag, for a friend to add them by. */
function addFriend(reload: () => Promise<void>): Child {
  const to = signal("");
  const busy = signal(false);
  const note = signal<{ text: string; bad?: boolean } | null>(null);
  let field: HTMLInputElement | undefined;
  return h(
    "form",
    {
      class: "add-friend",
      onsubmit: async (e: SubmitEvent) => {
        e.preventDefault();
        const who = to.peek().trim();
        // Said the game's way, not in the browser's bubble.
        if (!who) {
          note.set({ text: "Въведи потребителско име или имейл.", bad: true });
          field?.focus();
          return;
        }
        busy.set(true);
        note.set(null);
        try {
          const r = await api<{ friends?: boolean; name?: string }>("POST", "/api/friends/requests", { to: who });
          const byEmail = who.includes("@") && !who.startsWith("@");
          note.set({
            text: r.friends
              ? `Вече сте приятели ${withWord(r.name ?? "")}.`
              : byEmail
                ? "Поканата е изпратена. Ако има играч с този имейл, ще я види в играта."
                : `Поканата до ${r.name} е изпратена.`,
          });
          to.set("");
          await reload();
        } catch (err) {
          note.set({ text: errorText(err), bad: true });
        } finally {
          busy.set(false);
        }
      },
    },
    h(
      "span",
      { class: "add-friend-row join" },
      h("input", {
        name: "to",
        "aria-label": "Потребителско име или имейл на приятел",
        placeholder: "потребителско име или имейл",
        autocomplete: "off",
        autocapitalize: "none",
        spellcheck: false,
        maxlength: 254,
        value: to,
        oninput: (e: Event) => {
          to.set((e.target as HTMLInputElement).value);
          note.set(null);
        },
        ref: (el) => {
          field = el as HTMLInputElement;
        },
      }),
      h("button", { class: "btn inline", disabled: busy }, "Добави"),
    ),
    // One's own, for a friend to add: the one way in is a name or an email, and asked „как те намирам?“, the answer
    // was two pages away (Профил, Настройки).
    () => {
      const tag = user()?.tag;
      return tag
        ? h("p", { class: "muted own-tag" }, ["Твоето потребителско име е ", h("b", null, `@${tag}`), "."])
        : null;
    },
    () => {
      const n = note();
      return n && h("p", { class: n.bad ? "bad" : "muted", role: n.bad ? "alert" : "status", ref: inSight }, n.text);
    },
  );
}

/** A friend: their name (with their @username only where another friend has the same name: `same`); under it the
 * duels between the two in words, the one count kept between two players („Дуели помежду ви: печелиш 3, губиш 1“;
 * „Още нямате дуели“ before the first: owner, 2026-11-22, the words the new duel picker had; how they did today is
 * the day's board's); while three duels the player sent wait for them (`full`), a line that says so, and „Дуел“ off
 * until they play one; and „Дуел“, a button, at its end (while changing the list, „Премахни“ instead). */
function row(f: Friend, remove: () => void, challenge: () => void, editing: () => boolean, same = false): Child {
  const played = f.won + f.lost + f.drawn;
  return playerRow(
    "friend",
    f,
    f.tag,
    [nameWords(f.name), h("span", { class: same ? "friend-tag same" : "friend-tag" }, ` @${f.tag}`)],
    [
      h(
        "span",
        { class: "friend-record" },
        played ? ["Дуели помежду ви: ", h("b", null, record(f.won, f.lost, f.drawn))] : "Още нямате дуели",
      ),
      f.full ? h("span", { class: "friend-full" }, "Три дуела чакат. Нов — щом изиграе някой.") : null,
    ],
    null,
    () =>
      editing()
        ? h("button", { class: "link muted tap friend-act", type: "button", onclick: remove }, "Премахни")
        : h(
            "button",
            {
              class: "btn inline friend-act",
              type: "button",
              disabled: !!f.full,
              "aria-label": `Дуел ${withWord(f.name)}`,
              onclick: challenge,
            },
            "Дуел",
          ),
  );
}
