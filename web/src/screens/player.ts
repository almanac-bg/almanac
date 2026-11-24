// Another player's profile, by their tag (/players/tag), laid out as Профил is (screens/me.ts: one column, on a big
// screen too): the same head (their avatar, their name and tag, and their streak as it is now under them, never an
// ended one's), a card of how you stand with
// them under it (friends: the duels between you and „Дуел“; or the request either way), and the same „Печати“ (ui.ts:
// profileHead, sealsSection). Nothing that's only theirs (play/profile.go: no week's forgiving), and nothing that's
// only one's own (Смени, Настройки). One's own, opened by its tag, is Профил: the page goes there (ui.ts, profileHref,
// links there already).

import { api, errorText } from "../lib/api.ts";
import { type Child, h, lifetime, signal } from "../lib/dom.ts";
import { go, title } from "../lib/router.ts";
import { withWord } from "../lib/words.ts";
import { checkNews, user } from "../state.ts";
import { avatar, type ChapterRank, isOwnTag, nameWords, profileHead, sealsSection } from "../ui.ts";
import { startDuel } from "./duel.ts";

interface Profile {
  name: string;
  tag: string;
  me?: boolean;
  avatar: string;
  ranks: ChapterRank[];
  // The streak as it is now (none: none runs).
  streak?: number;
  friend?: "yes" | "asked" | "asks";
  request?: number;
  record?: { won: number; lost: number; drawn: number };
  // Theirs, to call them to a duel: told only to a friend.
  id?: number;
}

export function playerProfile([tag]: string[]): Child {
  // One's own: Профил, the page with what's one's own on it.
  if (isOwnTag(tag ?? "")) {
    go("/me", true);
    return null;
  }
  title(`@${tag}`);
  const profile = signal<Profile | null>(null);
  const error = signal("");
  // The page gone, a profile still on its way does nothing: never Профил in place of the page gone to meanwhile.
  const life = lifetime();
  const load = () =>
    api<Profile>("GET", `/api/players/${tag}`).then(
      (p) => {
        if (life.aborted) return;
        // One's own by another spelling of it (the server's word): Профил too.
        if (p.me) return go("/me", true);
        profile.set(p);
        title(p.name);
      },
      (err) => error.set(errorText(err)),
    );
  load();
  return h("section", { class: "screen me" }, (): Child => {
    const p = profile();
    if (error() && !p) {
      return [
        h("h1", null, "Няма такъв профил"),
        h("p", { class: "lead" }, error()),
        h("a", { class: "btn primary", href: "/friends" }, "Към Приятели"),
      ];
    }
    if (!p) return h("p", { class: "muted" }, "…");
    return h(
      "div",
      { class: "me-intro" },
      profileHead(
        h("span", { class: "me-avatar" }, avatar(p.avatar, { size: "l", name: p.name })),
        nameWords(p.name),
        p.tag,
        () => p.streak,
      ),
      relation(p, load),
      sealsSection(p.ranks, h("p", { class: "seals-none" }, "Още няма печат.")),
    );
  });
}

/** One count of the duels between two, as the card says it: a heavy numeral, its word under it. */
function tally(n: number, one: string, many: string): Child {
  return h(
    "span",
    { class: "player-stat" },
    h("b", { class: "player-n" }, String(n)),
    h("span", { class: "player-stat-word" }, n === 1 ? one : many),
  );
}

/** How the viewer stands with them, a card under the head: a kicker that names it („Приятели“, or the request); as
 * friends, the duels between the two (wins and losses as numerals, draws where there are any, or that there are none
 * yet) and „Дуел“, the card's one action; else ask to be friends, or answer their asking. */
function relation(p: Profile, reload: () => Promise<unknown>): Child {
  const busy = signal(false);
  const note = signal<{ text: string; bad?: boolean } | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    busy.set(true);
    note.set(null);
    try {
      await fn();
    } catch (err) {
      note.set({ text: errorText(err), bad: true });
    } finally {
      busy.set(false);
    }
  };
  const button = (label: string, cls: string, fn: () => Promise<unknown>, aria?: string) =>
    h(
      "button",
      { class: `btn ${cls}`, type: "button", disabled: busy, "aria-label": aria, onclick: () => act(fn) },
      label,
    );
  const line = (text: string) => h("p", { class: "player-relation" }, text);

  let kicker: string;
  let body: Child;
  let actions: Child;
  if (p.friend === "yes") {
    const r = p.record ?? { won: 0, lost: 0, drawn: 0 };
    const id = p.id;
    kicker = "Приятели";
    body =
      r.won + r.lost + r.drawn
        ? h(
            "p",
            { class: "player-record" },
            tally(r.won, "твоя победа", "твои победи"),
            tally(r.lost, "твоя загуба", "твои загуби"),
            r.drawn ? tally(r.drawn, "равенство", "равенства") : null,
          )
        : line("Още нямате дуели.");
    actions = id
      ? button(
          "Дуел",
          "primary",
          async () => {
            const d = await startDuel(id);
            if (d) go(`/duel/${d.id}`);
          },
          `Дуел ${withWord(p.name)}`,
        )
      : null;
  } else if (p.friend === "asks") {
    kicker = "Покана за приятелство";
    body = line(`${p.name} иска да сте приятели.`);
    actions = [
      button("Приеми", "primary", async () => {
        await api("POST", `/api/friends/requests/${p.request}/accept`, {});
        checkNews();
        await reload();
      }),
      button("Откажи", "", async () => {
        await api("DELETE", `/api/friends/requests/${p.request}`);
        checkNews();
        await reload();
      }),
    ];
  } else if (p.friend === "asked") {
    kicker = "Покана за приятелство";
    body = line(`Чака отговор от ${p.name}.`);
    actions = button("Отмени поканата", "", async () => {
      await api("DELETE", `/api/friends/requests/${p.request}`);
      await reload();
    });
  } else if (!user.peek()) {
    // Nobody yet on this device: a request is a player's, never a guest made for the asking (a guest with no game
    // finished is told so by the server).
    kicker = "Приятели";
    body = line("За да добавяш приятели, първо изиграй една игра или влез с имейл.");
    actions = [
      h("a", { class: "btn primary", href: "/" }, "Към днешния брой"),
      h("a", { class: "btn", href: "/signin" }, "Влез"),
    ];
  } else {
    kicker = "Не сте приятели";
    body = line("Приятелите виждат резултатите си всеки ден.");
    actions = button("Добави приятел", "primary", async () => {
      const r = await api<{ friends?: boolean; name?: string }>("POST", "/api/friends/requests", { to: p.tag });
      await reload();
      if (!r.friends) note.set({ text: `Поканата до ${p.name} е изпратена.` });
    });
  }
  return h(
    "section",
    { class: "player-actions" },
    h("h2", { class: "kicker" }, kicker),
    body,
    actions ? h("div", { class: "player-buttons" }, actions) : null,
    () => {
      const n = note();
      return n && h("p", { class: n.bad ? "bad" : "muted", role: n.bad ? "alert" : "status" }, n.text);
    },
  );
}
