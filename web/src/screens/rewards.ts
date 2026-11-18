// Награди: what playing earns — the three achievements nearest to done and the ones earned, then the rest by tier
// behind one tap, each in full: how it's earned, how far along it is and what it gives. What they give is worn in
// Гардероб. It follows the unfolding (play/unfold.go): the server leaves out the achievements of a system the player
// hasn't met and says no XP before XP is open, and „Как се печели“ speaks only of what they've met.

import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { AchievementInfo, Open } from "../ui.ts";
import type { Progress } from "./progress.ts";

// The app's pieces, set as the screen opens: it loads on its own, the first time it's opened (kit.ts), and imports
// only types.
let {
  illustration: picture,
  h,
  signal,
  when,
  title,
  listWords,
  user,
  badge,
  meaning,
  meter,
  profileNav,
  rewardWords,
  tiers,
  tierWords,
  unlockWords,
  loadProgress,
  nearest,
} = {} as Kit;

export function rewards(kit: Kit) {
  ({
    illustration: picture,
    h,
    signal,
    when,
    title,
    listWords,
    user,
    badge,
    meaning,
    meter,
    profileNav,
    rewardWords,
    tiers,
    tierWords,
    unlockWords,
    loadProgress,
    nearest,
  } = kit);
  title("Награди");
  return h(
    "section",
    { class: "screen" },
    () => (user() ? profileNav() : null),
    // Профил's switch names the place: the heading is for screen readers then.
    h("h1", { class: () => (user() ? "sr" : "") }, "Награди"),
    when(
      () => user(),
      () => {
        const progress = signal<Progress | null>(null);
        loadProgress().then(progress.set, () => {});
        return () => {
          const p = progress();
          return p ? [howItWorks(p.open), achievements(p)] : null;
        };
      },
      () => [
        howItWorks(),
        h(
          "p",
          { class: "lead" },
          "Постиженията, титлите и аватарите идват с играта. Изиграй първите си въпроси и ще ги видиш тук.",
        ),
      ],
    ),
  );
}

const day = (ms: number) => new Intl.DateTimeFormat("bg", { day: "numeric", month: "long" }).format(new Date(ms));

/** The achievements: the three nearest to done and the earned ones (the latest first) in sight; every other one
 * behind „Всички постижения“, by tier, the hidden ones not found yet together in one. */
function achievements(p: Progress): Child {
  const earned = p.achievements.filter((a) => a.at).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const near = nearest(p.achievements, 3);
  const rest = p.achievements.filter((a) => !a.at && !near.includes(a));
  const list = (title: string, items: AchievementInfo[], locked: boolean) =>
    items.length
      ? h(
          "section",
          { class: "tier" },
          h("h3", { class: "tier-head" }, title),
          h(
            "ul",
            { class: "achievements" },
            items.map((a) => h("li", { class: locked ? `achievement locked t-${a.tier}` : "achievement" }, card(a))),
          ),
        )
      : null;
  return h(
    "section",
    { class: "stack" },
    h("h2", { class: "section-title" }, `Постижения · ${earned.length} от ${p.achievements.length}`),
    list("Най-близо", near, true),
    list("Спечелени", earned, false),
    rest.length
      ? h(
          "details",
          { class: "more" },
          h("summary", null, `Останалите постижения (${rest.length})`),
          tiers.map((tier) => {
            const all = p.achievements.filter((a) => a.tier === tier);
            const left = rest.filter((a) => a.tier === tier);
            if (!left.length) return null;
            const hidden = left.filter((a) => a.hidden);
            return h(
              "section",
              { class: `tier t-${tier}` },
              h(
                "h3",
                { class: "tier-head" },
                tierWords[tier].group,
                h("span", { class: "muted" }, ` · ${all.filter((a) => a.at).length} от ${all.length}`),
              ),
              p.tierUnlocks[tier]?.length
                ? h(
                    "p",
                    { class: "tier-reward" },
                    `Първото ${tierWords[tier].one} постижение отключва ${listWords(p.tierUnlocks[tier]?.map(unlockWords) ?? [])}.`,
                  )
                : null,
              h(
                "ul",
                { class: "achievements" },
                left.filter((a) => !a.hidden).map((a) => h("li", { class: "achievement locked" }, card(a))),
                hidden[0] ? h("li", { class: "achievement locked" }, secret(hidden)) : null,
              ),
            );
          }),
        )
      : null,
  );
}

/** An achievement in full: its medal, how it's earned, how far along it is (or the day it was earned), and what it
 * gives (no XP said before XP is open: the server leaves it out). */
function card(a: AchievementInfo): Child {
  const gives = rewardWords(a);
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
      gives
        ? h("span", { class: "achievement-reward" }, rewardMark(a), `${a.at ? "Донесе" : "Награда"}: ${gives}`)
        : null,
    ),
  ];
}

/** The picture beside an achievement's reward: the avatar it gives, if it gives one. */
function rewardMark(a: AchievementInfo): Child {
  const shape = a.rewards?.find((u) => u.kind === "avatar")?.id;
  return shape ? h("span", { class: "reward-mark tone-gold", "aria-hidden": "true" }, picture(shape)) : null;
}

/** How it all fits together, in a few lines, of the systems the player has met (all of them told to nobody signed in
 * would be a tour): what points are, what earns XP, what the rating and the league are for, what unlocks what. */
function howItWorks(open?: Open): Child {
  const item = (head: string, text: string) => h("li", null, h("b", null, head), text);
  return h(
    "details",
    { class: "more how" },
    h("summary", null, "Как се печели"),
    h(
      "ul",
      { class: "how-list" },
      item("Точки. ", meaning.points + meaning.dayBoard),
      open?.xp
        ? item(
            "XP и нива. ",
            `XP носят отговорите (верните — повече), въпросите на деня (най-много), всяка цел за деня, всяко постижение${open.league ? " и първите три места в седмицата на лигата" : ""}. XP вдига нивото, а нивата отключват титли, рамки, фонове и короната. Дните с изиграни въпроси на деня отключват титли за постоянство.`,
          )
        : null,
      open?.rating
        ? item(
            "Рейтинг и дивизии. ",
            "Дуелите и Роял променят рейтинга. Първите 10 игри с рейтинг го определят и тогава получаваш дивизия. Нова дивизия отключва титла, рамка или фон.",
          )
        : null,
      open?.league
        ? item(
            "Лиги. ",
            "Всяка седмица се състезаваш с група от своята лига по верните отговори на въпросите на деня, а при равенство по точките. Първите се качват, последните слизат: от Странджа до Рила. Първо място във високите лиги отключва рамка, а в Рила и титла.",
          )
        : null,
      item(
        "Постижения. ",
        open?.xp
          ? "Всяко носи XP според рядкостта си, а някои и аватар, титла или рамка."
          : "Някои носят аватар, титла или рамка.",
      ),
      open?.xp
        ? item(
            "Цели за деня. ",
            "Три на ден, всяка за една игра: въпросите на деня, още една игра (по тема, във Втори шанс или дуел) и игра с поне 8 верни от 10. Всяка носи XP. Изпълниш ли и трите, печелиш резервен ден.",
          )
        : null,
      item(
        "Серия и резервни дни. ",
        `Серията са дните поред с въпросите на деня. Ако пропуснеш ден, резервен ден я пази. Първият идва на третия ден поред, после на всеки седми${open?.xp ? " или с трите цели за деня" : ""}. Най-много един на седмица и два в запас.`,
      ),
      item(
        "Майсторство. ",
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
      h(
        "span",
        { class: "achievement-about" },
        list.length === 1 ? "Откриваш го, докато играеш." : "Откриваш ги, докато играеш.",
      ),
      h(
        "span",
        { class: "achievement-reward" },
        h("span", { class: "reward-mark secret", "aria-hidden": "true" }),
        first.xp ? `Награда: +${first.xp} XP и още нещо — ще разбереш` : "Наградата е изненада",
      ),
    ),
  ];
}
