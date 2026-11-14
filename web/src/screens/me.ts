// Профил: who you are in the game — your avatar, name, tag and title, your level, division, season and stats — with
// its own places a tap away at the top (Награди, Гардероб, Алманах) and the settings beside your name.

import { levelCard } from "../game/news.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import { avatar, profileHref, profileNav } from "../ui.ts";
import { standingCard } from "./duel.ts";
import { loadProgress, type Progress } from "./progress.ts";
import { seasonCard } from "./season.ts";
import { stats } from "./stats.ts";

export function me() {
  title("Профил");
  return h(
    "section",
    { class: "screen" },
    when(
      () => user(),
      () => {
        const progress = signal<Progress | null>(null);
        loadProgress().then(progress.set, () => {});
        return [
          profileNav(),
          head(progress),
          () => {
            const p = progress();
            return p ? levelCard(p.level, p.xp, p.from, p.to) : null;
          },
          () => {
            const p = progress();
            return p ? standingCard(p.standing) : null;
          },
          seasonCard(),
          stats(),
          () =>
            user()?.tag
              ? h("a", { class: "link muted", href: profileHref(user()?.tag ?? "") }, "Как те виждат другите")
              : null,
        ];
      },
      () => [
        h("h1", null, "Профил"),
        h("p", { class: "lead" }, "Още нямаш профил. Той се прави сам, щом започнеш да играеш, или тук, с имейл."),
        h("a", { class: "btn primary big", href: "/settings" }, "Влез с имейл"),
      ],
    ),
  );
}

/** Who you are: your avatar (with its level), your name, the title you wear and your tag; and the settings. */
function head(progress: () => Progress | null): Child {
  return h(
    "div",
    { class: "me-head" },
    () => {
      const p = progress();
      return avatar(p?.avatar, {
        size: "l",
        level: p?.level,
        name: user.peek()?.name,
        frame: p?.frame,
        backdrop: p?.backdrop,
      });
    },
    h(
      "div",
      { class: "me-head-text" },
      h("h1", null, () => user()?.name ?? "Профил"),
      () => {
        const p = progress();
        const t = p?.title ? p.titles.find((a) => a.id === p.title) : undefined;
        return t ? h("span", { class: `me-title t-${t.tier}` }, t.name) : null;
      },
      () => (user()?.tag ? h("span", { class: "me-tag" }, `@${user()?.tag}`) : null),
    ),
    h(
      "a",
      { class: "icon-btn", href: "/settings", "aria-label": "Настройки", title: "Настройки" },
      h("span", { class: "i i-tune icon-btn-i", "aria-hidden": "true" }),
    ),
  );
}
