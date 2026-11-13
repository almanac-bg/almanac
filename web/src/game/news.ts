// What a game earned, said once, at its end: the level (and whether it went up), and any achievement that came
// with it, which may be worn as a title at once.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { play } from "../lib/sound.ts";
import { type AchievementInfo, badge, meter, tierWords } from "../ui.ts";

interface News {
  achievements: AchievementInfo[];
  level: number;
  xp: number;
  from: number;
  to: number;
  levelUp?: boolean;
}

/** The level, a step up and new achievements, asked for once the game is kept (after `delay`: a duel is kept a
 * moment after it ends). */
export function news(delay = 0): Child {
  const data = signal<News | null>(null);
  const t = setTimeout(
    () =>
      api<News>("POST", "/api/me/news", {}).then(
        (n) => {
          data.set(n);
          if (n.levelUp) play("level");
          if (n.achievements.length) setTimeout(() => play("achievement"), n.levelUp ? 700 : 0);
        },
        () => {},
      ),
    delay,
  );
  onCleanup(() => clearTimeout(t));
  return () => {
    const n = data();
    if (!n) return null;
    return [levelCard(n.level, n.xp, n.from, n.to, n.levelUp), n.achievements.map(unlocked)];
  };
}

/** The level: its number, how far into it, and the XP left to the next. */
export function levelCard(level: number, xp: number, from: number, to: number, up = false): Child {
  const share = to > from ? Math.round((100 * (xp - from)) / (to - from)) : 0;
  return h(
    "section",
    { class: up ? "card level-card up" : "card level-card" },
    h(
      "div",
      { class: "level-head" },
      up ? h("p", { class: "kicker" }, "Ново ниво") : null,
      h("span", { class: "level-n" }, `Ниво ${level}`),
      h("span", { class: "muted" }, `още ${to - xp} XP до ниво ${level + 1}`),
    ),
    meter(share, `${share}% от ниво ${level}`),
  );
}

function unlocked(a: AchievementInfo): Child {
  const worn = signal(false);
  const error = signal("");
  return h(
    "section",
    { class: `card unlock t-${a.tier}` },
    badge(a, true, "l"),
    h(
      "div",
      { class: "unlock-text" },
      h("p", { class: "kicker" }, `Ново ${tierWords[a.tier].one} постижение`),
      h("strong", null, a.name),
      h("span", { class: "muted" }, a.about),
      () =>
        worn()
          ? h("span", { class: "muted", role: "status" }, "Сега е твоята титла.")
          : h(
              "button",
              {
                class: "link",
                type: "button",
                onclick: async () => {
                  try {
                    await api("PATCH", "/api/me/look", { title: a.id });
                    worn.set(true);
                  } catch (err) {
                    error.set((err as ApiError).message);
                  }
                },
              },
              "Сложи като титла",
            ),
      () => error() && h("span", { class: "bad" }, error()),
    ),
  );
}
