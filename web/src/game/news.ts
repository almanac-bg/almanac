// What a game earned, said once, at its end, in three cards at most: the day's goals it finished (with their XP, and
// how far it took those it moved: a goal moved alone is a line, not a card); the one biggest thing that happened (a
// week of the league ended, a division reached, a new level), or else a line of the XP it brought and the level; and
// „Ново за теб“: achievements and everything they unlocked to wear (each a tap from being worn), three rows at most,
// the highest tier first, the rest a tap away; with how a topic's game moved its mastery, said only when it's news (a
// share gone down isn't: Профил has it); in a card left free, once a day, how others' duels against the player's
// recordings went (play/recordings.go). The facts it put in Моят Алманах are a line of their own, from the first day:
// what playing gives that only goes up. Only the biggest of it plays its sound. Only what the player has met is told
// (play/unfold.go: no XP on a first day); a system met with this game is said first, once, in a line, and so is a
// broken streak won back (play/repair.go). What really is big (bigOne) is also brought forward in a sheet over the
// result (feel.ts), its sound playing as it opens. A game that ended without its result on screen has its news told on
// Начало later (play/told.go), quietly, with no sheet and no sound: under its result, if it's the day's; else under a
// line that says whose it is.

import { emblem } from "../art/emblem.ts";
import { leagueEmblem } from "../art/league.ts";
import { type ApiError, api } from "../lib/api.ts";
import { haptic } from "../lib/app.ts";
import { type Child, h, onCleanup, signal } from "../lib/dom.ts";
import { place } from "../lib/ordinal.ts";
import { feelKit, play, type SoundName, voice } from "../lib/sound.ts";
import { type LeagueEnd, moveWords } from "../screens/league.ts";
import {
  type AchievementInfo,
  avatar,
  badge,
  type Division,
  explain,
  levelNumber,
  meaning,
  meter,
  type Open,
  pointsWords,
  profileHref,
  tierWords,
  type Unlock,
  unlockPicture,
  unlockWords,
} from "../ui.ts";
import { type MasteryMove, masteryLine } from "./mastery.ts";
import { hands, landed } from "./results.ts";

interface News {
  achievements: AchievementInfo[];
  goals: { name: string; xp: number }[];
  /** How the player's last week in the league ended, not told yet. */
  league?: LeagueEnd;
  level: number;
  xp: number;
  from: number;
  to: number;
  levelUp?: boolean;
  /** The XP all this brought: the game just played, and the goals, achievements and week told with it. */
  earned: number;
  /** A division the rating has reached for the first time. */
  division?: Division;
  /** Everything newly unlocked to wear, whatever unlocked it. */
  unlocks: Unlock[];
  /** The avatar worn (shape-tone): an unlocked shape is put on in its tone. */
  avatar: string;
  /** How a topic's game moved its mastery. */
  mastery?: MasteryMove[];
  /** Which of the game's systems the player has met, and those met with this game (told once). */
  open: Open;
  opened?: (keyof Open)[];
  /** Others' duels against the player's recordings, once a day, in a card the rest leaves free. */
  recordings?: { text: string; players: { name: string; tag: string }[] };
  /** The streak's days, when a broken streak has just been won back (play/repair.go). */
  mended?: number;
  /** The game's kind: what its points are said to be for. */
  kind?: string;
  /** The facts the game put in Моят Алманах. */
  facts?: number;
  /** The day's goals the game moved without finishing them, with how far along each is now. */
  moved?: MovedGoal[];
}

/** A goal of the day a game moved, not done yet. */
interface MovedGoal {
  id: string;
  name: string;
  target: number;
  progress: number;
  href?: string;
  xp: number;
}

/** What a game earned, asked for once the game (run) is kept (after `delay`: a duel is kept a moment after it ends).
 * The one big thing among it, if any (`round`: the streak reached a round number with this game), is brought forward
 * in a sheet once the result has landed (feel.ts), with its sound then; everything else plays its sound as it comes.
 * Told `late` (on Начало, of a game whose result was never on screen), it's said without a sheet or a sound, under a
 * line that says whose it is (`late.title`), if any. */
export function news(run: number, delay = 0, round?: Promise<number>, late?: { title?: string }): Child {
  const data = signal<News | null>(null);
  let gone = false;
  const t = setTimeout(
    () =>
      api<News>("POST", "/api/me/news", { run }).then(
        async (n) => {
          data.set(n);
          if (late) return;
          const kit = feelKit();
          const top = kit && bigOne(n, (await round) ?? 0);
          if (!kit || !top) {
            const sound = loudest(n);
            if (sound) play(sound);
            return;
          }
          await landed(run);
          if (gone) return;
          haptic("big");
          kit.sheet(top.parts, top.sound, top.glow, { ...hands(), play: voice }, top.actions);
        },
        () => {},
      ),
    delay,
  );
  onCleanup(() => {
    gone = true;
    clearTimeout(t);
  });
  return () => {
    const n = data();
    if (!n) return null;
    const top = headline(n);
    // The goals a game moved; not the day's, whose result lists the goals still open, each with how far along.
    const moved = n.open.xp && n.kind !== "day" ? (n.moved ?? []) : [];
    const parts = [
      (n.opened ?? []).map((s) => opened(s, n)),
      n.mended ? h("p", { class: "news-open" }, h("b", null, `Серията ти е върната: ${n.mended} дни.`)) : null,
      n.facts ? factsLine(n.facts) : null,
      top === "level" || !n.open.xp ? null : xpLine(n),
      n.goals.length ? goalsDone(n.goals, moved) : moved.length ? movedLine(moved) : null,
      top === "league" && n.league ? leagueEnded(n.league) : null,
      top === "division" && n.division ? divisionReached(n.division) : null,
      top === "level" ? levelCard(n.level, n.xp, n.from, n.to, true, n.earned) : null,
      fresh(n),
      n.recordings ? recordings(n.recordings) : null,
    ];
    if (!late?.title) return parts;
    // Late, on Начало: whose news it is, over it; nothing at all when there's nothing to tell.
    return parts.flat().some(Boolean) ? [h("p", { class: "kicker news-late" }, late.title), parts] : null;
  };
}

/** The facts a game put in Моят Алманах, a tap from them. */
function factsLine(n: number): Child {
  return h(
    "p",
    { class: "news-facts" },
    h("a", { href: "/almanac" }, h("b", { class: "num" }, `+${n}`), ` ${n === 1 ? "факт" : "факта"} в Алманаха`),
  );
}

/** Others played against recordings of the player's games: how it went, and who, each a tap from their profile. */
function recordings(r: NonNullable<News["recordings"]>): Child {
  return h(
    "section",
    { class: "card stack" },
    h("p", { class: "kicker" }, "Твоите записи"),
    h("p", null, r.text),
    h(
      "details",
      { class: "more" },
      h("summary", null, "Кои играха"),
      h(
        "ul",
        { class: "duel-friends" },
        r.players.map((p) => h("li", null, h("a", { href: profileHref(p.tag) }, p.name))),
      ),
    ),
  );
}

/** The one biggest thing a game's news holds, if any: a week of the league ended, then a division reached, then a
 * new level. */
function headline(n: News): "league" | "division" | "level" | null {
  if (n.league) return "league";
  if (n.division) return "division";
  if (n.levelUp) return "level";
  return null;
}

/** The sound of the biggest thing told: one, never a run of them. */
function loudest(n: News): SoundName | null {
  const top = headline(n);
  if (top === "level") return "level";
  if (top || n.achievements.length) return "achievement";
  if (n.goals.length) return "goal";
  return null;
}

/** The one big thing a game brought, for its sheet: a week of the league ended up or on its podium, a division reached,
 * the streak at a round number (`days`), a level that unlocks something or is a fifth, an epic or legendary
 * achievement. The smaller news stays in the cards. */
function bigOne(
  n: News,
  days: number,
): {
  parts: Element[];
  sound: SoundName;
  glow: boolean;
  actions?: (close: () => void) => HTMLElement[];
} | null {
  const sheet = (picture: HTMLElement, kicker: string, name: string, ...lines: Child[]) =>
    [
      picture,
      h("p", { class: "kicker" }, kicker),
      // The name, big; a sentence (the streak's, under its number), as text.
      h(
        "strong",
        { id: "moment-name", style: name.endsWith(".") ? {} : { "font-size": "2.125rem", "line-height": "2.5rem" } },
        name,
      ),
      ...lines.filter((l) => l != null).map((l) => (typeof l === "string" ? h("p", { class: "muted" }, l) : l)),
    ] as Element[];
  const big = (el: HTMLElement) => {
    el.style.setProperty("width", "112px");
    el.style.setProperty("height", "112px");
    el.style.setProperty("--size", "112px");
    return el;
  };
  const numeral = (text: string) =>
    h("b", { class: "num", style: { font: "900 7.5rem/1 var(--font-numeral)", color: "var(--gold-display)" } }, text);
  const e = n.league;
  if (e && (e.moved > 0 || e.place <= 3))
    return {
      parts: sheet(
        big(leagueEmblem(e.now.tier, "l")),
        "Седмицата в лигата свърши",
        `${place(e.place, e.of)} в ${e.from.name}`,
        `${moveWords(e)}${e.xp ? ` · +${e.xp} XP` : ""}`,
      ),
      sound: "level",
      glow: false,
    };
  const d = n.division;
  if (d)
    return {
      parts: sheet(big(emblem(d.id, "l")), "Нова дивизия", d.name, `Рейтинг ${d.from} и нагоре.`),
      sound: "level",
      glow: false,
    };
  if (days)
    return {
      parts: sheet(numeral(String(days)), "Серия", `${days} дни поред с въпросите на деня.`),
      sound: "streak",
      glow: true,
    };
  // A level: its number is the hero, in the levels' lilac, with „Ново ниво“ under it; then what it brings, as a gift.
  const level = (...rest: Child[]) =>
    [
      h(
        "b",
        {
          class: "num",
          style: { font: "900 7.5rem/1 var(--font-numeral)", color: "var(--lilac-ink, var(--tier-epic-ink))" },
        },
        String(n.level),
      ),
      h("strong", { id: "moment-name", style: { "font-size": "2.125rem", "line-height": "2.5rem" } }, "Ново ниво"),
      ...rest.filter((l) => l != null),
    ] as Element[];
  const unlock = n.unlocks.find((u) => u.from === `ниво ${n.level}`);
  if (n.levelUp && unlock)
    // The gift is seen before it's worn: the avatar in the player's tone, the frame or pattern around their own face,
    // a title under it in its colour. „Сложи“ is the gold button; „По-късно“ leaves it in the wardrobe.
    return {
      parts: level(
        h("p", null, `Получаваш ${unlockWords(unlock)}.`),
        big(levelPicture(unlock, n.avatar)),
        unlock.kind === "title"
          ? h("p", null, h("span", { class: `who-title t-${unlock.tier ?? "common"}` }, unlock.name))
          : null,
      ),
      sound: "level",
      glow: true,
      actions: (close) => {
        const error = h("p", { class: "bad", role: "alert" });
        const put = h(
          "button",
          {
            class: "btn primary big",
            type: "button",
            style: { width: "100%", "margin-top": "var(--space-3)" },
            onclick: async () => {
              try {
                await api("PATCH", "/api/me/look", lookBody(unlock, n.avatar));
                close();
              } catch (err) {
                error.textContent = (err as ApiError).message;
              }
            },
          },
          "Сложи",
        );
        return [put, h("button", { class: "link", type: "button", onclick: close }, "По-късно"), error];
      },
    };
  if (n.levelUp && n.level % 5 === 0)
    return {
      parts: level(h("p", { class: "muted" }, `Още ${n.to - n.xp} XP до ниво ${n.level + 1}.`)),
      sound: "level",
      glow: true,
    };
  const a = n.achievements.find((x) => x.tier === "legendary") ?? n.achievements.find((x) => x.tier === "epic");
  if (a)
    return {
      parts: sheet(big(badge(a, true, "l")), achievementWord(a.tier), a.name, a.about),
      sound: "achievement",
      glow: false,
    };
  return null;
}

/** A system met with this game (`n`), said once, in a line: what it is, in a few words. */
function opened(system: keyof Open, n: News): Child {
  const line = (lead: string, ...rest: Child[]) => h("p", { class: "news-open" }, lead && h("b", null, lead), rest);
  switch (system) {
    case "points":
      // One line: the rest is a tap away, on the word (with the day's board only after the day's ten: it's theirs).
      return line(
        "",
        explain(h("b", null, "Точките"), n.kind === "day" ? pointsWords(n.open) : meaning.points),
        " са резултатът ти в една игра.",
      );
    case "xp":
      return line("Ново: XP и цели за деня. ", meaning.xp);
    case "league":
      return line(
        "Ново: лигата. ",
        "Всяка седмица се състезаваш с група играчи по точките от въпросите на деня. ",
        h("a", { href: "/ranks#league" }, "Виж лигата"),
      );
    default:
      return line("Ново: рейтинг. ", meaning.rating);
  }
}

/** The XP a game brought and the level it leaves, in a line (when no new level has a card of its own). */
function xpLine(n: News): Child {
  const level = `${n.levelUp ? "ново ниво" : "ниво"} ${n.level}`;
  return h(
    "p",
    { class: "news-xp" },
    n.earned > 0
      ? [explain(h("b", { class: "num" }, `+${n.earned} XP`), meaning.xp), ` · ${level}`]
      : level.charAt(0).toUpperCase() + level.slice(1),
  );
}

/** The level: its number, how far into it, and the XP left to the next (and, a new one, the XP that brought it). */
export function levelCard(level: number, xp: number, from: number, to: number, up = false, earned = 0): Child {
  const share = to > from ? Math.round((100 * (xp - from)) / (to - from)) : 0;
  return h(
    "section",
    { class: up ? "card level-card up" : "card level-card" },
    h(
      "div",
      { class: "level-head" },
      up ? h("p", { class: "kicker" }, "Ново ниво") : null,
      h("span", { class: "level-n" }, levelNumber(level)),
      h("span", { class: "muted" }, `${earned > 0 ? `+${earned} XP · ` : ""}още ${to - xp} XP до ниво ${level + 1}`),
    ),
    meter(share, `${share}% от ниво ${level}`),
  );
}

/** The day's goals a game finished, and the XP they earned; under them, the ones it moved, and how far along. */
function goalsDone(goals: News["goals"], moved: MovedGoal[]): Child {
  return h(
    "section",
    { class: "card goals" },
    h("p", { class: "kicker" }, goals.length === 1 ? "Изпълнена цел" : "Изпълнени цели"),
    h(
      "ul",
      { class: "goal-list" },
      goals.map((g) =>
        h(
          "li",
          { class: "goal done fresh" },
          h("span", { class: "goal-mark", "aria-hidden": "true" }),
          h("span", { class: "goal-name" }, g.name),
          h("span", { class: "goal-xp num" }, `+${g.xp} XP`),
        ),
      ),
      moved.map(movedRow),
    ),
  );
}

/** A goal a game moved, not done yet: its name (a tap from where it's done), and how far along, as Начало's card
 * has it. */
function movedRow(g: MovedGoal): Child {
  return h(
    "li",
    { class: "goal" },
    h("span", { class: "goal-mark", "aria-hidden": "true" }),
    g.href ? h("a", { class: "goal-name", href: g.href }, g.name) : h("span", { class: "goal-name" }, g.name),
    h("span", { class: "goal-xp num" }, `+${g.xp} XP`),
    meter(Math.round((100 * g.progress) / g.target), `${g.progress} от ${g.target}`),
    h("span", { class: "goal-n num" }, `${g.progress}/${g.target}`),
  );
}

/** The goals a game moved, when it finished none: a line each, not a card („Цел: 3 от 5 · …“). */
function movedLine(moved: MovedGoal[]): Child {
  return moved.map((g) =>
    h(
      "p",
      { class: "news-goal" },
      h("span", { class: "news-goal-n" }, `Цел: ${g.progress} от ${g.target}`),
      " · ",
      g.href ? h("a", { href: g.href }, g.name) : g.name,
    ),
  );
}

/** A week of the league ended: the place in the group, where it takes the player, and the XP the place paid. */
function leagueEnded(e: LeagueEnd): Child {
  return h(
    "section",
    { class: `card unlock league-end lg-${e.now.tier}` },
    leagueEmblem(e.now.tier, "m"),
    h(
      "div",
      { class: "unlock-text" },
      h("p", { class: "kicker" }, "Седмицата в лигата свърши"),
      h("strong", null, `${place(e.place, e.of)} в ${e.from.name}`),
      h("span", { class: "unlock-reward" }, `${moveWords(e)}${e.xp ? ` · +${e.xp} XP` : ""}`),
    ),
  );
}

/** A division the rating has reached for the first time. */
function divisionReached(d: Division): Child {
  return h(
    "section",
    { class: `card unlock d-${d.id}` },
    emblem(d.id, "m"),
    h(
      "div",
      { class: "unlock-text" },
      h("p", { class: "kicker" }, "Нова дивизия"),
      h("strong", null, d.name),
      h("span", { class: "muted" }, `Рейтинг ${d.from} и нагоре.`),
    ),
  );
}

/** How many rows „Ново за теб“ shows, achievements and unlocks together. */
const shownRows = 3;

/** „Ново за теб“: the achievements earned and everything unlocked to wear, in one list (each unlock a tap from being
 * worn), and how a topic's game moved its mastery, in a line. */
function fresh(n: News): Child {
  const mastery = masteryLine(n.mastery ?? []);
  if (!n.achievements.length && !n.unlocks.length && !mastery) return null;
  // One list, the highest tier first (an achievement before what it unlocks, of a tier): an unlock is of its own tier
  // (a title's), or of the achievement's that unlocked it.
  const from = (u: Unlock) => n.achievements.find((a) => u.from.includes(`„${a.name}“`));
  const rows = [
    ...n.achievements.map((a) => ({ rank: tierRank[a.tier], achievement: true, row: () => earned(a, n.open.xp) })),
    ...n.unlocks.map((u) => ({
      rank: tierRank[u.tier ?? from(u)?.tier ?? "common"],
      achievement: false,
      // What an achievement just told here unlocks needs no „С постижението …“, when it's shown too.
      row: () => unlockRow(u, n.avatar, !!from(u)),
    })),
  ].sort((a, b) => b.rank - a.rank);
  const shown = rows.slice(0, shownRows);
  const rest = rows.slice(shownRows);
  return h(
    "section",
    { class: "card unlocks" },
    h("p", { class: "kicker" }, "Ново за теб"),
    shown.length
      ? h(
          "ul",
          { class: "unlock-list" },
          shown.map((r) => r.row()),
        )
      : null,
    mastery,
    // A first game earns several things at once: three are told here, the rest wait where they're kept (an
    // achievement, with what it gives, in Награди; what's to wear, in the wardrobe).
    rest.length
      ? rest.some((r) => r.achievement)
        ? h("a", { class: "link", href: "/rewards" }, `Още ${rest.length} в Награди`)
        : h("a", { class: "link", href: "/wardrobe" }, `Още ${rest.length} в гардероба`)
      : n.unlocks.length
        ? h("a", { class: "link", href: "/wardrobe" }, "Към гардероба")
        : null,
  );
}

/** The tiers, lowest first, for the news to put the highest first. */
const tierRank: Record<AchievementInfo["tier"], number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/** An achievement just earned: its medal, its name, its tier and (once XP is open) its XP. */
function earned(a: AchievementInfo, xp: boolean): Child {
  return h(
    "li",
    { class: `unlock-row achievement-row t-${a.tier}` },
    badge(a, true, "s"),
    h(
      "span",
      { class: "unlock-text" },
      h("strong", null, a.name),
      h("span", { class: "unlock-about" }, a.about),
      // The tier in its own ink; gold only for the XP, which is a reward.
      h(
        "span",
        { class: "unlock-reward" },
        h("span", { class: "unlock-tier" }, achievementWord(a.tier)),
        xp ? [" · ", h("span", { class: "unlock-xp" }, `+${a.xp ?? 0} XP`)] : null,
      ),
    ),
  );
}

/** Something just unlocked to wear, drawn, and a tap from being worn (`told`: what unlocked it is told already). */
function unlockRow(u: Unlock, worn: string, told = false): Child {
  return h(
    "li",
    { class: u.tier ? `unlock-row t-${u.tier}` : "unlock-row" },
    unlockPicture(u, worn),
    h(
      "span",
      { class: "unlock-text" },
      h("strong", { class: u.kind === "title" ? "unlock-title-name" : undefined }, cap(unlockWords(u))),
      told ? null : h("span", { class: "unlock-about" }, `${/^„?[сз]/i.test(u.from) ? "Със" : "С"} ${u.from}.`),
    ),
    wear(u, worn),
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** An achievement, said with its tier: „Рядко постижение“; a common one, the first a player earns, just „Постижение“
 * (its tier is in its ink: „обикновено“ would read as „nothing special“). */
const achievementWord = (tier: AchievementInfo["tier"]) =>
  tier === "common" ? "Постижение" : `${cap(tierWords[tier].one)} постижение`;

/** What wears an unlock (/api/me/look): an avatar's shape in the tone worn, a title, a frame or a pattern. */
function lookBody(u: Unlock, worn: string): Record<string, string> {
  const [, tone = "gold"] = worn.split("-");
  return u.kind === "avatar"
    ? { avatar: `${u.id}-${tone}` }
    : u.kind === "title"
      ? { title: u.id }
      : { [u.kind]: u.id };
}

/** Puts an unlock on at once (an avatar's shape in the tone worn), and says so. */
function wear(u: Unlock, worn: string): Child {
  const done = signal(false);
  const error = signal("");
  const body = lookBody(u, worn);
  return [
    () =>
      done()
        ? h("span", { class: "muted", role: "status" }, "Сложено")
        : h(
            "button",
            {
              class: "btn inline",
              type: "button",
              "aria-label": `Сложи: ${unlockWords(u)}`,
              onclick: async () => {
                try {
                  await api("PATCH", "/api/me/look", body);
                  done.set(true);
                } catch (err) {
                  error.set((err as ApiError).message);
                }
              },
            },
            "Сложи",
          ),
    () => error() && h("span", { class: "bad" }, error()),
  ];
}

/** An unlock as the level's sheet shows it, large: a new avatar in the tone the player wears, a frame or a pattern
 * around their own avatar, a title's owner (the player) with the title under them. */
function levelPicture(u: Unlock, worn: string): HTMLElement {
  const [, tone = "gold"] = worn.split("-");
  switch (u.kind) {
    case "avatar":
      return avatar(`${u.id}-${tone}`, { size: "l" });
    case "frame":
      return avatar(worn, { size: "l", frame: u.id });
    case "backdrop":
      return avatar(worn, { size: "l", backdrop: u.id });
    default:
      return avatar(worn, { size: "l" });
  }
}
