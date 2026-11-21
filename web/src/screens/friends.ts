// Приятели, one of the three places, in its budget's order (DESIGN.md, Places): the friends (who asks to be friends,
// each friend with their day, the duels between you and a duel a tap away, and the one way to make more: by
// потребителско име or email); and the duels (a friend's waiting for you, yours waiting for them, those played:
// screens/duel.ts) and a new one. The day's board is Днес's (screens/board.ts).

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Look } from "../ui.ts";
import type { Accepted, Duels } from "./duel.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  acceptedLine,
  api,
  errorText,
  h,
  onCleanup,
  nameWords,
  emailWords,
  signal,
  when,
  title,
  sawFriends,
  duelLists,
  startDuel,
  go,
  player,
  user,
  failure,
  profileHref,
  record,
  rightsOf,
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
  /** The seal they wear on their avatar (play.Seal). */
  seal?: { chapter: string; level: number };
  today?: { rights: number; of: number };
  won: number;
  lost: number;
  drawn: number;
}

/** A friend request: from someone (to you), or to someone or an email address (from you). */
interface Request {
  id: number;
  name?: string;
  tag?: string;
  /** Who asks, as they show to others: their seal on their avatar (play.Look). */
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
    errorText,
    h,
    onCleanup,
    nameWords,
    emailWords,
    signal,
    when,
    title,
    sawFriends,
    duelLists,
    startDuel,
    go,
    player,
    user,
    failure,
    profileHref,
    record,
    rightsOf,
    withWord,
    who,
    inSight,
    playerRow,
  } = kit);
  title("Приятели");
  // Opened: what has come here is seen, on every device, and the dot on Приятели goes.
  if (user.peek()) sawFriends();
  // Whether the player has finished the day: a duel against a recording needs no friend, only the day played.
  const played = signal(false);
  if (user.peek())
    api<{ run?: { done: boolean } | null }>("GET", "/api/day").then(
      (d) => played.set(!!d.run?.done),
      () => {},
    );
  return h("section", { class: "screen friends-page spread" }, h("h1", null, "Приятели"), friendsCard(played));
}

/** The friends: who asks to be friends, each friend with their day and the duels between you (and, while changing
 * the list, removing them), the one field to add more, and the requests that wait for an answer. */
function friendsCard(played: () => boolean): Child {
  const data = signal<Friends | null>(null);
  const duels = signal<Duels | null>(null);
  const error = signal("");
  // The list that couldn't load (with nothing of it shown yet): the failure, and the way to try again.
  const failed = signal<unknown>(null);
  const editing = signal(false);
  // A friend's yes, told once over the friends: kept as it was said while the list is asked again.
  const yes = signal<Child>(null);

  const load = async () => {
    if (!user.peek()) return;
    try {
      const [f, d] = await Promise.all([api<Friends>("GET", "/api/friends"), api<Duels>("GET", "/api/duels")]);
      failed.set(null);
      data.set(f);
      duels.set(d);
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

  const act = async (fn: () => Promise<unknown>) => {
    error.set("");
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
  const drop = (r: Request) =>
    act(async () => {
      await api("DELETE", `/api/friends/requests/${r.id}`);
      await load();
    });
  // A duel with a friend: started (theirs to play once the player has), and played on its page.
  const challenge = (f: Friend) =>
    act(async () => {
      const d = await startDuel({ friend: f.id });
      if (d) go(`/duel/${d.id}`);
    });
  // Made once: what it says after a request stays while the list around it is drawn again.
  const adder = addFriend(load);

  return [
    friendsList(),
    // The duels: theirs to play first; a new one a tap away once there are friends to play, or the day is played (a
    // recording of a real game is there to play without a friend).
    () => {
      const d = duels();
      const any = d && d.yours.length + d.theirs.length + d.played.length > 0;
      if (!d || (!any && !data()?.friends.length && !played())) return null;
      return h(
        "section",
        { class: "sect duels page-2" },
        h("div", { class: "sect-head" }, h("h2", null, "Дуели")),
        h("p", { class: "sect-lead" }, "Едни и същи десет въпроса. Всеки ги играе, когато може."),
        any ? duelLists(d) : null,
        h("a", { class: "btn", href: "/duel/new" }, "Нов дуел"),
        h("p", { class: "small sect-foot" }, "С приятел или срещу запис на истинска игра."),
      );
    },
  ];

  function friendsList(): Child {
    return h(
      "section",
      { class: "sect friends page-1" },
      // Its heading for a screen reader only: right under the page's own „Приятели“ it would say it twice.
      h("div", { class: "sect-head friends-head" }, h("h2", { class: "sr" }, "Приятели"), () => {
        const n = data()?.friends.length ?? 0;
        return n
          ? h(
              "span",
              { class: "sect-note" },
              h("button", { class: "link muted", type: "button", onclick: () => editing.update((e) => !e) }, () =>
                editing() ? "Готово" : "Премахни приятел",
              ),
            )
          : null;
      }),
      yes,
      () =>
        (data()?.requests.in ?? []).map((r) =>
          h(
            "div",
            { class: "invitation" },
            // Who asks as every row of players has them (their avatar, name and seal, a way to their profile), and
            // what they ask on a line of its own under the name.
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
              h("button", { class: "link", type: "button", onclick: () => drop(r) }, "Откажи"),
            ),
          ),
        ),
      () => {
        const d = data();
        if (!d && failed()) return failure(failed(), () => void load(), null);
        if (!d) {
          // Not a player yet: friends are added once they are.
          return user()
            ? null
            : [
                h("p", { class: "muted friends-none" }, "Добави приятели и ще виждате резултатите си всеки ден."),
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
              "Още нямаш приятели тук. Добави ги по потребителско име или имейл.",
            );
      },
      // Outside the parts drawn again on each look (every 15 s): drawn again, its field would lose the focus mid-word.
      when(data, () => adder),
      () => {
        const out = data()?.requests.out ?? [];
        return out.length
          ? h(
              "div",
              { class: "waiting-for" },
              h("p", { class: "kicker" }, "Изпратени покани"),
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
                    h("button", { class: "link muted", type: "button", onclick: () => drop(r) }, "Отмени"),
                  ),
                ),
              ),
            )
          : null;
      },
      () => error() && h("p", { class: "bad", role: "alert" }, error()),
    );
  }
}

/** Asking someone to be friends: by their tag (@tag) or their email, on a line, „Добави“ beside it. */
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
    () => {
      const n = note();
      return n && h("p", { class: n.bad ? "bad" : "muted", role: n.bad ? "alert" : "status", ref: inSight }, n.text);
    },
  );
}

/** A friend: their name (with their @username only where another friend has the same name: `same`), their day and the
 * duels between you under it, and a duel a tap away (while changing the list, removing them instead). */
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
        null,
        f.today ? ["днес ", rightsOf(f.today.rights, f.today.of)] : h("span", { class: "muted" }, "днес още не"),
      ),
      // The pair's record: the one count kept between two players.
      played
        ? h(
            "span",
            { class: "record", title: `Дуели помежду ви: ${record(f.won, f.lost, f.drawn)}` },
            `дуели\u00a0${f.won}:${f.lost}`,
          )
        : null,
    ],
    null,
    () =>
      editing()
        ? h("button", { class: "link muted friend-act", type: "button", onclick: remove }, "Премахни")
        : h(
            "button",
            {
              class: "link friend-act",
              type: "button",
              "aria-label": `Дуел ${withWord(f.name)}`,
              onclick: challenge,
            },
            "Дуел",
          ),
  );
}
