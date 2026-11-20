// Another player's profile, by their tag (/players/tag): how they look, their division, their numbers, how well they
// know each topic; and how you stand with them — ask to be friends, or answer their asking.

import type { Mastery } from "../game/mastery.ts";
import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Standing } from "../ui.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let { masteryCard, api, errorText, h, signal, title, friendRequests, user, avatar, record, standingCard, stat } =
  {} as Kit;

interface Profile {
  name: string;
  tag: string;
  me?: boolean;
  avatar: string;
  since: number;
  standing: Standing;
  streak: number;
  days: number;
  games: number;
  answers: number;
  right: number;
  duels: number;
  won: number;
  mastery: Mastery[];
  friend?: "yes" | "asked" | "asks";
  request?: number;
  record?: { won: number; lost: number; drawn: number };
}

const percent = (right: number, of: number) => (of ? Math.round((100 * right) / of) : 0);
// „г.“ kept with its year, never alone on a line.
const month = (ms: number) =>
  new Intl.DateTimeFormat("bg", { month: "long", year: "numeric" }).format(new Date(ms)).replace(/\s(?=г\.)/, " ");

export function playerProfile(kit: Kit, [tag]: string[]): Child {
  ({ masteryCard, api, errorText, h, signal, title, friendRequests, user, avatar, record, standingCard, stat } = kit);
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
  return h("section", { class: "screen" }, (): Child => {
    const p = profile();
    if (error() && !p) {
      return [
        h("h1", null, "Няма такъв профил"),
        h("p", { class: "lead" }, error()),
        h("a", { class: "btn primary", href: "/ranks" }, "Към класациите"),
      ];
    }
    if (!p) return h("p", { class: "muted" }, "…");
    return [
      head(p),
      p.me
        ? h("p", { class: "muted" }, "Така те виждат другите. ", h("a", { href: "/me" }, "Към профила ти"))
        : actions(p, load),
      p.standing.rated ? standingCard(p.standing) : null,
      numbers(p),
      // Only the topics they've played: the rest would only say they haven't.
      p.mastery.some((m) => m.answers)
        ? masteryCard(
            p.mastery.filter((m) => m.answers),
            !p.me,
          )
        : null,
    ];
  });
}

/** Their avatar, name and tag, and since when they play. */
function head(p: Profile): Child {
  return h(
    "div",
    { class: "me-head" },
    avatar(p.avatar, { size: "l", name: p.name }),
    h(
      "div",
      { class: "me-head-text" },
      h("h1", null, p.name),
      h("span", { class: "me-tag" }, `@${p.tag}`),
      h("span", { class: "muted small" }, `Играе от ${month(p.since)}`),
    ),
  );
}

/** How the viewer stands with them: as friends, the duels between the two so far; else ask to be friends, or answer
 * their asking. The one thing to do is the gold button; accepting is rose, as everywhere. */
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
      button("Приеми", "rose", async () => {
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
      h("a", { class: "btn inline primary", href: "/" }, "Към играта"),
      h("a", { class: "btn inline", href: "/settings" }, "Влез"),
    ];
  } else {
    body = [
      h("p", { class: "player-relation muted" }, "Като приятели виждате резултатите си за деня."),
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

/** Their numbers: the streak, how much and how well they've played, their duels. */
function numbers(p: Profile): Child {
  if (!p.games) return h("p", { class: "muted" }, "Още няма изиграни игри.");
  return h(
    "div",
    { class: "stats" },
    stat(String(p.streak), p.streak === 1 ? "ден поред" : "дни поред", "gold"),
    stat(`${percent(p.right, p.answers)}%`, "верни отговори", "mint"),
    p.duels > 0
      ? stat(`${p.won}/${p.duels}`, "спечелени дуела", "rose")
      : stat(String(p.days), p.days === 1 ? "изигран ден" : "изиграни дни"),
    stat(String(p.games), p.games === 1 ? "изиграна игра" : "изиграни игри"),
  );
}
