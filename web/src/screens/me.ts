// Профил: who you are in the game — your avatar, name, tag and title, your level and stats — and the way to your
// rewards, friends and settings.

import { levelCard } from "../game/news.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import { avatar, badge } from "../ui.ts";
import { standingCard } from "./duel.ts";
import { loadProgress, type Progress } from "./progress.ts";
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
          head(progress),
          () => {
            const p = progress();
            return p ? levelCard(p.level, p.xp, p.from, p.to) : null;
          },
          () => {
            const p = progress();
            return p ? standingCard(p.standing) : null;
          },
          stats(),
          () => {
            const p = progress();
            if (!p) return null;
            const earned = p.achievements.filter((a) => a.at);
            return h(
              "a",
              { class: "card link-card", href: "/rewards" },
              h(
                "span",
                { class: "link-card-text" },
                h("strong", null, "Награди"),
                h("span", { class: "muted" }, `Постижения: ${earned.length} от ${p.achievements.length}`),
              ),
              h(
                "span",
                { class: "badges-peek", "aria-hidden": "true" },
                earned.slice(-4).map((a) => badge(a, true, "s")),
              ),
            );
          },
          h(
            "nav",
            { class: "menu", "aria-label": "Профил" },
            h("a", { href: "/almanac" }, "Моят Алманах"),
            h("a", { href: "/friends" }, "Приятели"),
            h("a", { href: "/settings" }, "Настройки"),
          ),
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
      () => (user()?.tag ? h("span", { class: "me-tag" }, `@${user()?.tag}`) : null),
      () => {
        const p = progress();
        const t = p?.achievements.find((a) => a.id === p.title);
        return t ? h("span", { class: `me-title t-${t.tier}` }, t.name) : null;
      },
    ),
  );
}

/** A sentence as a clause after a colon: its first letter small. */
