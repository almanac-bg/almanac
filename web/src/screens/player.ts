// Another player's profile, by their tag (/players/tag): how they look, the seal they wear, their ranks by chapter and
// the longest streak they've had (play/profile.go: no lifetime totals); and how you stand with them — ask to be
// friends, or answer their asking.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  errorText,
  h,
  signal,
  title,
  friendRequests,
  user,
  avatar,
  record,
  chapterName,
  seal,
  worn,
  illustration,
  formatNumber,
  categories,
} = {} as Kit;

/** A chapter's rank (play.ChapterRank): level 0 is none. */
interface Rank {
  chapter: string;
  level: number;
  name: string;
  quarter: number;
}

interface Profile {
  name: string;
  tag: string;
  me?: boolean;
  avatar: string;
  since: number;
  seal?: Rank;
  ranks: Rank[];
  /** The longest streak they've had. */
  best: number;
  friend?: "yes" | "asked" | "asks";
  request?: number;
  record?: { won: number; lost: number; drawn: number };
}

// „г.“ kept with its year, never alone on a line.
const month = (ms: number) =>
  new Intl.DateTimeFormat("bg", { month: "long", year: "numeric" }).format(new Date(ms)).replace(/\s(?=г\.)/, " ");

export function playerProfile(kit: Kit, [tag]: string[]): Child {
  ({
    api,
    errorText,
    h,
    signal,
    title,
    friendRequests,
    user,
    avatar,
    record,
    chapterName,
    seal,
    worn,
    illustration,
    formatNumber,
    categories,
  } = kit);
  title(`@${tag}`);
  const profile = signal<Profile | null>(null);
  const error = signal("");
  const load = () =>
    api<Profile>("GET", `/api/players/${tag}`).then(
      (p) => {
        profile.set(p);
        title(p.name);
      },
      (err) => error.set(errorText(err)),
    );
  load();
  return h("section", { class: "screen player" }, (): Child => {
    const p = profile();
    if (error() && !p) {
      return [
        h("h1", null, "Няма такъв профил"),
        h("p", { class: "lead" }, error()),
        h("a", { class: "btn primary", href: "/friends" }, "Към Приятели"),
      ];
    }
    if (!p) return h("p", { class: "muted" }, "…");
    return [
      head(p),
      p.me
        ? h("p", { class: "muted" }, "Така те виждат другите. ", h("a", { href: "/me" }, "Към твоя профил"))
        : actions(p, load),
      numbers(p),
      ranks(p),
    ];
  });
}

/** Their avatar with the seal they wear on its corner, their name and tag, and since when they play. */
function head(p: Profile): Child {
  return h(
    "div",
    { class: "me-head" },
    h("span", { class: "me-avatar" }, avatar(p.avatar, { size: "l", name: p.name }), worn(p.seal, 48)),
    h(
      "div",
      { class: "me-who" },
      h("h1", null, p.name),
      h("span", { class: "me-tag" }, `@${p.tag}`),
      h("span", { class: "muted small" }, `Играе от ${month(p.since)}`),
    ),
  );
}

/** How the viewer stands with them: as friends, the duels between the two so far; else ask to be friends, or answer
 * their asking: outlined buttons, beside the page's one action. */
function actions(p: Profile, reload: () => Promise<unknown>): Child {
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
  const button = (label: string, cls: string, fn: () => Promise<unknown>) =>
    h("button", { class: `btn inline ${cls}`, type: "button", disabled: busy, onclick: () => act(fn) }, label);

  let body: Child;
  if (p.friend === "yes") {
    const r = p.record ?? { won: 0, lost: 0, drawn: 0 };
    const played = r.won + r.lost + r.drawn;
    body = [
      h(
        "p",
        { class: "player-relation" },
        "Приятели сте.",
        played ? h("span", { class: "muted" }, ` Дуели помежду ви: ${record(r.won, r.lost, r.drawn)}.`) : null,
      ),
    ];
  } else if (p.friend === "asks") {
    body = [
      h("p", { class: "player-relation" }, `${p.name} иска да сте приятели.`),
      button("Приеми", "", async () => {
        await api("POST", `/api/friends/requests/${p.request}/accept`, {});
        friendRequests.update((n) => Math.max(0, n - 1));
        await reload();
      }),
      button("Откажи", "", async () => {
        await api("DELETE", `/api/friends/requests/${p.request}`);
        friendRequests.update((n) => Math.max(0, n - 1));
        await reload();
      }),
    ];
  } else if (p.friend === "asked") {
    body = [
      h("p", { class: "player-relation muted" }, "Поканата за приятелство чака отговор."),
      button("Отмени поканата", "", async () => {
        await api("DELETE", `/api/friends/requests/${p.request}`);
        await reload();
      }),
    ];
  } else if (!user.peek()) {
    // Nobody yet on this device: a request is a player's, never a guest made for the asking (a guest with no game
    // finished is told so by the server).
    body = [
      h("p", { class: "player-relation muted" }, "За да добавяш приятели, първо изиграй една игра или влез с имейл."),
      h("a", { class: "btn inline primary", href: "/" }, "Към днешния брой"),
      h("a", { class: "btn inline", href: "/settings" }, "Влез"),
    ];
  } else {
    body = [
      h("p", { class: "player-relation muted" }, "Приятелите виждат резултатите си всеки ден."),
      button("Добави приятел", "primary", async () => {
        const r = await api<{ friends?: boolean; name?: string }>("POST", "/api/friends/requests", { to: p.tag });
        await reload();
        if (!r.friends) note.set({ text: `Поканата до ${p.name} е изпратена.` });
      }),
    ];
  }
  return h("section", { class: "card player-actions" }, body, () => {
    const n = note();
    return n && h("p", { class: n.bad ? "bad" : "muted", role: n.bad ? "alert" : "status" }, n.text);
  });
}

/** Their longest streak, as Профил says the player's own. */
function numbers(p: Profile): Child {
  if (!p.best) return null;
  return h(
    "div",
    { class: "streak-chip me-longest" },
    illustration("flame", "streak-flame"),
    h("b", { class: "status-n" }, formatNumber(p.best)),
    h(
      "span",
      { class: "status-text" },
      h("span", { class: "status-label" }, p.best === 1 ? "ден" : "дни"),
      h("span", { class: "streak-note" }, "най-дълга серия"),
    ),
  );
}

/** Their seals, a chapter's each in the bank's order, the one worn ringed; before any, „Още няма печат.“ */
function ranks(p: Profile): Child {
  const had = categories
    .map((c) => p.ranks.find((r) => r.chapter === c.id))
    .filter((r): r is Rank => !!r && r.level > 0);
  return h(
    "section",
    { class: "sect me-seals" },
    h("div", { class: "sect-head" }, h("h2", null, "Печати")),
    had.length
      ? h(
          "ul",
          { class: "seal-list" },
          had.map((r) =>
            h(
              "li",
              null,
              h(
                "span",
                { class: p.seal?.chapter === r.chapter ? "rk worn" : "rk" },
                seal(r.chapter, r.level, 40),
                h("span", { class: "rk-words" }, h("b", null, chapterName(r.chapter)), h("span", null, r.name)),
              ),
            ),
          ),
        )
      : h("p", { class: "seal-worn" }, "Още няма печат."),
  );
}
