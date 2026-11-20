// Профил: who you are in the game — your avatar, name and tag; your streak, numbers, mastery and latest games (the
// rating's division is the duels', on their screens) — with Алманах a tap away at the top, Настройки beside your name,
// in words, and the avatar's choice (/avatar) a tap on the avatar. A hub: each thing once, the whole of it a tap away.
// A guest is asked to keep their game, from the first one, and the way in for a profile from elsewhere is apart from
// it.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { Stats } from "./stats.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  h,
  signal,
  when,
  go,
  title,
  user,
  notice,
  avatar,
  failure,
  profileHref,
  profileNav,
  haveProfile,
  keepGame,
  loadStats,
  stats,
} = {} as Kit;

export function me(kit: Kit) {
  ({
    h,
    signal,
    when,
    go,
    title,
    user,
    notice,
    avatar,
    failure,
    profileHref,
    profileNav,
    haveProfile,
    keepGame,
    loadStats,
    stats,
  } = kit);
  title("Профил");
  // A game just kept, or a profile signed in to, here (keepGame, haveProfile): said once, at the top.
  const said = notice.peek();
  notice.set("");
  return h(
    "section",
    { class: "screen" },
    when(
      () => user(),
      () => {
        const load = loadStats();
        const data = signal<Stats | null>(null);
        // Профил that couldn't load (no line): said, with the way to try again (the whole page, afresh).
        const failed = signal<unknown>(null);
        load.then(data.set, failed.set);
        return [
          profileNav(),
          said ? h("p", { class: "muted", role: "status" }, said) : null,
          head(data),
          // A name still the one drawn: said so, with the way to change it.
          () =>
            user()?.drawn
              ? h(
                  "p",
                  { class: "me-drawn muted" },
                  "Това име е избрано наслуки. ",
                  h("a", { class: "link", href: "/settings#name" }, "Смени го"),
                )
              : null,
          () => (failed() && !data() ? failure(failed(), () => go("/me", true)) : null),
          // A guest keeps their game with an email; one who has a profile elsewhere signs in to it, apart, in a smaller
          // line. Either way, Профил again, as the profile has it.
          () =>
            user()?.email
              ? null
              : [keepGame(() => go("/me", true)), haveProfile(() => go("/me", true), "Имаш профил? Влез")],
          stats(load),
          () =>
            user()?.tag
              ? h("a", { class: "link muted tap", href: profileHref(user()?.tag ?? "") }, "Как те виждат другите")
              : null,
        ];
      },
      () => [
        h("h1", null, "Профил"),
        h("p", { class: "lead" }, "Още нямаш профил. Създава се сам с първата ти игра. Или тук, с имейл."),
        h("a", { class: "btn primary big", href: "/settings" }, "Влез с имейл"),
      ],
    ),
  );
}

/** The player's avatar as Профил's head shows it, kept on this device by whose it is. */
interface Look {
  id: number;
  avatar: string;
}

const lookKey = "almanac.look";

/** The avatar last seen on this device for this player (null for none, or another player's). */
function lastLook(id: number): Look | null {
  try {
    const l = JSON.parse(localStorage.getItem(lookKey) ?? "null") as Look | null;
    return l?.id === id && typeof l.avatar === "string" ? l : null;
  } catch {
    return null; // no storage here, or nothing worth reading
  }
}

function keepLook(l: Look): void {
  try {
    localStorage.setItem(lookKey, JSON.stringify(l));
  } catch {
    // not kept: a plain disc while the next Профил loads
  }
}

/** Who you are: your avatar (a tap from choosing another), your name and your tag; and Настройки, in words as well as
 * its picture, at every width. */
function head(data: () => Stats | null): Child {
  // The avatar as the stats have it; until they come (or if they can't), as it was last seen on this device: never
  // one drawn from the name, which reads as someone else's profile; and with none seen yet, a plain disc.
  const look = (): Look | null => {
    const s = data();
    const id = user.peek()?.id;
    if (!s?.avatar) return id ? lastLook(id) : null;
    const l: Look = { id: id ?? 0, avatar: s.avatar };
    if (id) keepLook(l);
    return l;
  };
  return h(
    "div",
    { class: "me-head" },
    h("a", { class: "me-avatar", href: "/avatar", "aria-label": "Смени аватара" }, () => {
      const l = look();
      return l
        ? avatar(l.avatar, { size: "l", name: user.peek()?.name })
        : h("span", { class: "avatar l avatar-unknown", "aria-hidden": "true" });
    }),
    h(
      "div",
      { class: "me-head-text" },
      h("h1", null, () => user()?.name ?? "Профил"),
      () => (user()?.tag ? h("span", { class: "me-tag" }, `@${user()?.tag}`) : null),
      h("a", { class: "link me-avatar-link", href: "/avatar" }, "Смени аватара"),
    ),
    h(
      "a",
      { class: "btn me-settings", href: "/settings" },
      h("span", { class: "i i-tune", "aria-hidden": "true" }),
      "Настройки",
    ),
  );
}
