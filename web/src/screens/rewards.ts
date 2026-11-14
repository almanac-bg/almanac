// Награди: what playing earns — the achievements nearest to done, then every one by tier as a grid of medals, each a
// tap from how it's earned, how far along it is and what it gives. What they give is worn in Гардероб.

import { picture } from "../art/picture.ts";
import { type Child, h, type Signal, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { user } from "../state.ts";
import { type AchievementInfo, badge, meter, profileNav, rewardWords, tiers, tierWords, unlockWords } from "../ui.ts";
import { loadProgress, nearest, type Progress } from "./progress.ts";

export function rewards() {
  title("Награди");
  return h(
    "section",
    { class: "screen" },
    () => (user() ? profileNav() : null),
    h("h1", null, "Награди"),
    howItWorks(),
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

/** Every achievement, made to scan: the three nearest to done first, in full; then each tier as a grid of medals,
 * the earned ones first and bright, where a tap opens a medal's card (how it's earned, how far along, what it
 * gives) under its row. */
function achievements(p: Progress): Child {
  const earned = p.achievements.filter((a) => a.at).length;
  const open = signal("");
  const near = nearest(p.achievements, 3);
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, `Постижения · ${earned} от ${p.achievements.length}`),
    near.length
      ? h(
          "section",
          { class: "tier" },
          h("h3", { class: "tier-head" }, "Най-близо"),
          h(
            "ul",
            { class: "achievements" },
            near.map((a) => h("li", { class: `achievement locked t-${a.tier}` }, card(a))),
          ),
        )
      : null,
    tiers.map((tier) => {
      const list = p.achievements.filter((a) => a.tier === tier);
      if (!list.length) return null;
      const hidden = list.filter((a) => !a.at && a.hidden);
      return h(
        "section",
        { class: `tier t-${tier}` },
        h(
          "h3",
          { class: "tier-head" },
          tierWords[tier].group,
          h("span", { class: "muted" }, ` · ${list.filter((a) => a.at).length} от ${list.length}`),
        ),
        p.tierUnlocks[tier]?.length
          ? h(
              "p",
              { class: "tier-reward" },
              `Първото ${tierWords[tier].one} постижение отключва ${p.tierUnlocks[tier]?.map(unlockWords).join(" и ")}.`,
            )
          : null,
        h(
          "ul",
          { class: "medals" },
          // The earned first; the hidden ones not found yet, together in one.
          [...list.filter((a) => a.at), ...list.filter((a) => !a.at && !a.hidden)].map((a) =>
            medal(a, a.id, open, a.name, card(a)),
          ),
          hidden[0]
            ? medal(
                hidden[0],
                `secret-${tier}`,
                open,
                hidden.length === 1 ? "Скрито" : `${hidden.length} скрити`,
                secret(hidden),
              )
            : null,
        ),
      );
    }),
  );
}

/** A medal in a tier's grid, and its card once tapped: the card takes the whole width of the row after it (the
 * grid fills the rest of the row with the medals that follow). */
function medal(a: AchievementInfo, id: string, open: Signal<string>, name: string, body: Child): Child {
  const got = !!a.at;
  const progress = !a.at && !a.hidden && (a.goal ?? 1) > 1 ? `${a.progress ?? 0}/${a.goal}` : "";
  return [
    h(
      "li",
      { class: got ? "medal" : "medal locked" },
      h(
        "button",
        {
          class: "medal-btn",
          type: "button",
          "aria-expanded": () => open() === id,
          onclick: () => open.set(open.peek() === id ? "" : id),
        },
        badge(a, got),
        h("span", { class: "medal-name" }, name, got ? h("span", { class: "sr" }, ", спечелено") : null),
        progress ? h("span", { class: "medal-progress num" }, progress) : null,
      ),
    ),
    () =>
      open() === id ? h("li", { class: got ? "achievement medal-card" : "achievement medal-card locked" }, body) : null,
  ];
}

/** An achievement in full: its medal, how it's earned, how far along it is (or the day it was earned), and what it
 * gives. */
function card(a: AchievementInfo): Child {
  return [
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
      h("span", { class: "achievement-reward" }, rewardMark(a), `${a.at ? "Донесе" : "Награда"}: ${rewardWords(a)}`),
    ),
  ];
}

/** The picture beside an achievement's reward: the avatar it gives, if it gives one. */
function rewardMark(a: AchievementInfo): Child {
  const shape = a.rewards?.find((u) => u.kind === "avatar")?.id;
  return shape ? h("span", { class: "reward-mark tone-gold", "aria-hidden": "true" }, picture(shape)) : null;
}

/** How it all fits together, in a few lines: what earns XP, what the rating is for, what unlocks what. */
export function howItWorks(): Child {
  return h(
    "details",
    { class: "more how" },
    h("summary", null, "Как се печели"),
    h(
      "ul",
      { class: "how-list" },
      h(
        "li",
        null,
        h("b", null, "XP и нива. "),
        "XP носят верните отговори (и по малко всеки опит), всяка цел за деня, всяко постижение и първите три места в седмицата на лигата. XP вдига нивото, а нивата отключват титли, рамки, фонове и короната.",
      ),
      h(
        "li",
        null,
        h("b", null, "Рейтинг и дивизии. "),
        "Дуелите и Роял местят рейтинга. Нова дивизия отключва титла, рамка или фон.",
      ),
      h(
        "li",
        null,
        h("b", null, "Лиги. "),
        "Всяка седмица се състезаваш по XP в група до 20 души от своята лига. Първите се качват, последните слизат: от Странджа до Рила. Първо място във високите лиги отключва рамка, а в Рила и титла.",
      ),
      h(
        "li",
        null,
        h("b", null, "Постижения. "),
        "Всяко носи XP според рядкостта си, а някои и аватар, титла или рамка.",
      ),
      h(
        "li",
        null,
        h("b", null, "Цели за деня. "),
        "Три на ден, за XP. Изпълниш ли и трите, печелиш резервен ден: ако пропуснеш ден, серията ти остава.",
      ),
      h(
        "li",
        null,
        h("b", null, "Майсторство. "),
        "Колкото по-добре знаеш една тема, толкова по-високо стигаш в нея: „Майстор“ и „Светило“ са титли.",
      ),
    ),
  );
}

/** The hidden achievements of a tier not found yet: how many, and nothing more. */
function secret(list: Progress["achievements"]): Child {
  const first = list[0];
  if (!first) return null;
  return [
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
        `Награда: +${first.xp ?? 0} XP и още нещо — ще разбереш`,
      ),
    ),
  ];
}
