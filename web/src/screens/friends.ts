// Приятели, one of the three places (DESIGN.md, Places): two tabs at its top, of one weight, as the day's board has
// them. „Приятели“: who asks to be friends, each friend with their day, the duels between you and a duel a tap away,
// and the one way to make more (by потребителско име or email). „Дуели“: a friend's waiting for you, yours waiting for
// them, the last ten played, each a card that holds all there is of its duel (screens/duelcards.ts), and a new one;
// it carries a dot while one waits for the player, and opens first then („Приятели“ has a dot while someone asks to
// be friends). The tab chosen is in the address (`?tab=duels`): back and a reload keep it; a duel named there too
// (`&duel=<id>`: one just played, or an old link to it: screens/duel.ts) is first under „Дуели“. The day's board is on
// Днес's result (today.ts, dayBoard).

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Look } from "../ui.ts";
import type { Accepted, Duels, DuelView } from "./duel.ts";
import { duelCards } from "./duelcards.ts";

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
  segmented,
  tabDot,
  rename,
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

/** Приятели's two tabs. */
type Tab = "friends" | "duels";

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
    segmented,
    tabDot,
    rename,
  } = kit);
  title("Приятели");
  // Opened: what has come here is seen, on every device, and the dot on Приятели goes.
  if (user.peek()) sawFriends();
  // The page's heading is the tabs': its own is a screen reader's only, so that nothing is headed twice.
  return h("section", { class: "screen friends-page" }, h("h1", { class: "sr" }, "Приятели"), tabs(kit));
}

/** The two tabs and what the chosen one shows. Приятели: who asks to be friends, each friend with their day and the
 * duels between you (and, while changing the list, removing them), the one field to add more, and the requests that
 * wait for an answer. Дуели: the player's duels, and a new one. */
function tabs(kit: Kit): Child {
  // The tab chosen, kept in the address; none chosen: Дуели while a duel waits for the player as the page opens (a
  // duel that comes later lights the tab's dot, and never moves the page under the player), else Приятели.
  const asked = new URLSearchParams(location.search);
  const at = asked.get("tab");
  const chosen = signal<Tab | null>(at === "duels" || at === "friends" ? at : null);
  // The duel named in the address (just played, or an old link to its page): first under „Дуели“, where its result
  // lands once (duelcards.ts), with what its game brought under it, asked for once (game/news.ts: it marks the game
  // as told). One that isn't among those listed (older than the last ten) is asked for by itself.
  const named = Number(asked.get("duel")) || 0;
  const top = signal<DuelView | null>(null);
  let brought: Child = null;
  const opens = signal<Tab | null>(user.peek() ? null : "friends");
  const tab = () => chosen() ?? opens();
  const choose = (to: Tab) => {
    chosen.set(to);
    rename(`/friends?tab=${to}`);
  };
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
      const [f, d] = await Promise.all([
        api<Friends>("GET", "/api/friends"),
        api<Duels>("GET", "/api/duels"),
        // The landing's moment needs the game's feel; without it the card is whole, only still.
        named && !duels.peek() ? loadFeel().catch(() => null) : null,
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
      if (JSON.stringify(f) !== JSON.stringify(data.peek())) data.set(f);
      if (JSON.stringify(d) !== JSON.stringify(duels.peek())) duels.set(d);
      if (!opens.peek()) opens.set(d.yours.length ? "duels" : "friends");
      if (f.accepted && !yes.peek()) yes.set(acceptedLine(f.accepted));
    } catch (err) {
      // A look again that failed, with the list on the screen, waits for the next one quietly.
      if (!data.peek()) failed.set(err);
      if (!opens.peek()) opens.set("friends");
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
    segmented<Tab | null>(
      "Приятели и дуели",
      [
        // Someone asks to be friends while the duels are open (a duel waits too): a dot here, or it would go unseen.
        ["friends", ["Приятели", () => (data()?.requests.in.length ? tabDot("покана за приятелство") : null)]],
        ["duels", ["Дуели", () => (duels()?.yours.length ? tabDot("твой ред") : null)]],
      ],
      tab,
      (to) => to && choose(to),
    ),
    () => (tab() === "duels" ? duelsList() : tab() === "friends" ? friendsList() : null),
  ];

  /** The duels: theirs to play first, and a new one a tap away (with a friend, or against a recording of a real
   * game: /duel/new says what each needs). */
  function duelsList(): Child {
    return h(
      "section",
      { class: "sect duels" },
      h("h2", { class: "sr" }, "Дуели"),
      h("p", { class: "sect-lead" }, "Едни и същи десет въпроса. Всеки ги играе, когато може."),
      () => {
        const d = duels();
        return d ? duelCards(kit, d, top(), brought) : failed() ? failure(failed(), () => void load(), null) : null;
      },
      h("a", { class: "btn", href: "/duel/new" }, "Нов дуел"),
      h("p", { class: "small sect-foot" }, "С приятел или срещу запис на истинска игра."),
    );
  }

  function friendsList(): Child {
    return h(
      "section",
      { class: "sect friends" },
      // Its heading for a screen reader only: the tab over it says it.
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

/** One thing about a friend on the line under their name: an icon, then the number alone („7/10“, „3:1“), in figures
 * of one width so the rows line up; what it is in whole words (`words`) as its tooltip on a big screen and for a
 * screen reader. `none`: nothing to count yet, quieter. */
const stat = (icon: string, figure: string, words: string, none = false): Child =>
  h(
    "span",
    { class: none ? "friend-stat none" : "friend-stat", role: "img", title: words, "aria-label": words },
    h("span", { class: `i i-${icon}`, "aria-hidden": "true" }),
    figure,
  );

/** A friend: their name (with their @username only where another friend has the same name: `same`); under it the
 * day's issue (the calendar, „7/10“; „—“ while it isn't played) and the duels between the two (the crossed swords,
 * „3:1“, the viewer's wins first: the one count kept between two players; left out before the first duel), each said
 * whole by its tooltip; and a duel a tap away (while changing the list, removing them instead). */
function row(f: Friend, remove: () => void, challenge: () => void, editing: () => boolean, same = false): Child {
  const played = f.won + f.lost + f.drawn;
  return playerRow(
    "friend",
    f,
    f.tag,
    [nameWords(f.name), h("span", { class: same ? "friend-tag same" : "friend-tag" }, ` @${f.tag}`)],
    [
      f.today
        ? stat("today", `${f.today.rights}/${f.today.of}`, `Днешният брой: ${f.today.rights} от ${f.today.of}`)
        : stat("today", "—", "Днешният брой: още не е изигран", true),
      played ? stat("duel", `${f.won}:${f.lost}`, `Дуели помежду ви: ${record(f.won, f.lost, f.drawn)}`) : null,
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
