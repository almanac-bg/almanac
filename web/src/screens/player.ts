// Another player's profile, by their tag (/players/tag), laid out as Профил is (screens/me.ts: one column, on a big
// screen too): the same head (their avatar with the seal they wear on its corner, their name and tag, and since when
// they play), how you stand with them where Профил has the streak (friends and a duel a tap away, ask to be friends,
// or answer their asking), and the same „Печати“ (ui.ts: profileHead, sealsSection). Nothing that's only theirs
// (play/profile.go: no streak, no lifetime totals), and nothing that's only one's own (Смени, Настройки).

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { ChapterRank } from "../ui.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  api,
  errorText,
  h,
  nameWords,
  signal,
  title,
  checkNews,
  user,
  avatar,
  record,
  go,
  startDuel,
  withWord,
  profileHead,
  sealsSection,
} = {} as Kit;

interface Profile {
  name: string;
  tag: string;
  me?: boolean;
  avatar: string;
  since: number;
  seal?: { chapter: string; level: number };
  ranks: ChapterRank[];
  friend?: "yes" | "asked" | "asks";
  request?: number;
  record?: { won: number; lost: number; drawn: number };
  // Theirs, to call them to a duel: told only to a friend.
  id?: number;
}

// „г.“ kept with its year, never alone on a line.
const month = (ms: number) =>
  new Intl.DateTimeFormat("bg", { month: "long", year: "numeric" }).format(new Date(ms)).replace(/\s(?=г\.)/, " ");

export function playerProfile(kit: Kit, [tag]: string[]): Child {
  ({
    api,
    errorText,
    h,
    nameWords,
    signal,
    title,
    checkNews,
    user,
    avatar,
    record,
    go,
    startDuel,
    withWord,
    profileHead,
    sealsSection,
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
        h("span", { class: "me-avatar" }, avatar(p.avatar, { size: "l", name: p.name, seal: p.seal })),
        nameWords(p.name),
        p.tag,
        h("span", { class: "muted" }, `Играе от ${month(p.since)}`),
      ),
      relation(p, load),
      sealsSection(p.ranks, h("p", { class: "seal-worn" }, "Още няма печат.")),
    );
  });
}

/** How the viewer stands with them, where Профил has the streak: as friends, the duels between the two so far and a
 * duel a tap away; else ask to be friends, or answer their asking. One's own page, as others see it: the way back to
 * Профил. */
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
      { class: `btn inline ${cls}`, type: "button", disabled: busy, "aria-label": aria, onclick: () => act(fn) },
      label,
    );

  let body: Child;
  if (p.me) {
    body = h(
      "p",
      { class: "player-relation muted" },
      "Така те виждат другите. ",
      h("a", { href: "/me" }, "Към твоя профил"),
    );
  } else if (p.friend === "yes") {
    const r = p.record ?? { won: 0, lost: 0, drawn: 0 };
    const played = r.won + r.lost + r.drawn;
    const id = p.id;
    body = [
      h(
        "p",
        { class: "player-relation" },
        "Приятели сте.",
        played ? h("span", { class: "muted" }, ` Дуели помежду ви: ${record(r.won, r.lost, r.drawn)}.`) : null,
      ),
      id
        ? button(
            "Дуел",
            "primary",
            async () => {
              const d = await startDuel({ friend: id });
              if (d) go(`/duel/${d.id}`);
            },
            `Дуел ${withWord(p.name)}`,
          )
        : null,
    ];
  } else if (p.friend === "asks") {
    body = [
      h("p", { class: "player-relation" }, `${p.name} иска да сте приятели.`),
      button("Приеми", "", async () => {
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
      h("a", { class: "btn inline", href: "/signin" }, "Влез"),
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
  return h("section", { class: "player-actions" }, body, () => {
    const n = note();
    return n && h("p", { class: n.bad ? "bad" : "muted", role: n.bad ? "alert" : "status" }, n.text);
  });
}
