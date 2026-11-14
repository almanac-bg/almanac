// Награди: what playing earns — the achievements by tier, each with how it's earned, how far along it is and what it
// gives. What they give is worn in Гардероб.

import { picture } from "../art/picture.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import { badge, meter, profileNav, shapeNames, tiers, tierWords } from "../ui.ts";
import { loadProgress, type Progress } from "./progress.ts";

export function rewards() {
  title("Награди");
  return h(
    "section",
    { class: "screen" },
    () => (user() ? profileNav() : null),
    h("h1", null, "Награди"),
    when(
      () => user(),
      () => {
        const progress = signal<Progress | null>(null);
        loadProgress().then(progress.set, () => {});
        return () => {
          const p = progress();
          return p ? achievements(p) : null;
        };
      },
      () =>
        h(
          "p",
          { class: "lead" },
          "Постиженията, титлите и аватарите идват с играта. Изиграй първите си въпроси и ще ги видиш тук.",
        ),
    ),
  );
}

const day = (ms: number) => new Intl.DateTimeFormat("bg", { day: "numeric", month: "long" }).format(new Date(ms));

/** Every achievement, by tier: the earned ones bright, with the day; each with how it's earned. */
function achievements(p: Progress): Child {
  const earned = p.achievements.filter((a) => a.at).length;
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, `Постижения · ${earned} от ${p.achievements.length}`),
    tiers.map((tier) => {
      const list = p.achievements.filter((a) => a.tier === tier);
      if (!list.length) return null;
      return h(
        "section",
        { class: `tier t-${tier}` },
        h(
          "h3",
          { class: "tier-head" },
          tierWords[tier].group,
          h("span", { class: "muted" }, ` · ${list.filter((a) => a.at).length} от ${list.length}`),
        ),
        h(
          "ul",
          { class: "achievements" },
          // The earned first; the hidden ones not found yet, together in one.
          [...list.filter((a) => a.at), ...list.filter((a) => !a.at && !a.hidden)].map((a) =>
            h(
              "li",
              { class: a.at ? "achievement" : "achievement locked" },
              badge(a, !!a.at),
              h(
                "div",
                { class: "achievement-text" },
                h("span", { class: "achievement-name" }, a.name),
                h("span", { class: "achievement-about" }, a.about),
                !a.at && (a.goal ?? 1) > 1
                  ? h(
                      "span",
                      { class: "achievement-progress" },
                      meter(Math.round((100 * (a.progress ?? 0)) / (a.goal ?? 1)), `${a.progress ?? 0} от ${a.goal}`),
                      h("span", { class: "num" }, `${a.progress ?? 0} / ${a.goal}`),
                    )
                  : null,
                a.at ? h("span", { class: "achievement-when" }, `Спечелено на ${day(a.at)}`) : null,
                h(
                  "span",
                  { class: "achievement-reward" },
                  h("span", { class: "reward-mark tone-gold", "aria-hidden": "true" }, picture(a.icon)),
                  `Награда: аватар „${shapeNames[a.icon] ?? a.icon}“${a.title ? ` и титла „${a.title.name}“` : ""}`,
                ),
              ),
            ),
          ),
          secret(list.filter((a) => !a.at && a.hidden)),
        ),
      );
    }),
  );
}

/** The hidden achievements of a tier not found yet: how many, and nothing more. */
function secret(list: Progress["achievements"]): Child {
  const first = list[0];
  if (!first) return null;
  return h(
    "li",
    { class: "achievement locked" },
    badge(first, false),
    h(
      "div",
      { class: "achievement-text" },
      h(
        "span",
        { class: "achievement-name" },
        list.length === 1 ? "Скрито постижение" : `${list.length} скрити постижения`,
      ),
      h("span", { class: "achievement-about" }, "Откриваш ги, докато играеш."),
      h(
        "span",
        { class: "achievement-reward" },
        h("span", { class: "reward-mark secret", "aria-hidden": "true" }),
        "Награда: ще разбереш",
      ),
    ),
  );
}
