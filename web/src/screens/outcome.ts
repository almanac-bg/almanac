// A duel's result, the most dramatic moment in the game, for every way a duel ends (a challenge, between friends or
// taken by anyone; a live one, against a recording): the two face to face with their scores, the winner in gold and the
// other plain; the duel question by question, the two rows of marks aligned, the quicker of two right answers ringed,
// and the question that decided it; what it meant (the rating from and to, in its division, and the record against
// this person); and what to do next. A challenge sent to a friend, waiting for them, shows the player's own side, and
// until when; one turned down, not played in time or cut off says so. The first time it shows, it lands as a moment
// (feel.ts: duel), never again.
//
// It loads on its own, with its style (outcome.css) and the game's feel, the first time a duel's result shows (kit.ts:
// duelResult; asked for as a duel starts, so it's in by its end), and is handed the app's pieces: it imports only types.

import type { Reviewed } from "../game/types.ts";
import type { Kit } from "../kit.ts";
import type { Child } from "../lib/dom.ts";
import type { SoundName } from "../lib/sound.ts";
import type { DuelMark, DuelView, Side } from "./duel.ts";

// The app's pieces, set as a result is drawn (outcome).
let {
  api,
  errorText,
  avatar,
  challengeButton,
  challengeText,
  emblem,
  explain,
  feelKit,
  formatNumber,
  go,
  h,
  hands,
  landing,
  meaning,
  meter,
  nextSteps,
  ordinal,
  play,
  profileHref,
  record,
  reviewParts,
  signal,
  trail,
  until,
  withName,
} = {} as Kit;

/** How many questions a duel has. */
const total = 10;

/** Seconds, the Bulgarian way: „34,5 с“. */
const secs = (ms: number) => `${(ms / 1000).toLocaleString("bg", { maximumFractionDigits: 1 })} с`;

/** What to do next, where the screen that shows a result has its own: the gold button, and plain ones beside it. */
export interface Steps {
  main: Child;
  also?: Child[];
}

/** A duel as it stands or ended (`d`, as one duel's view has it); what to do next (`again`: after a live one, a
 * rematch and another duel; else, after a challenge between friends, one back); and what the game earned (`more`). */
export function outcome(kit: Kit, d: DuelView, again: Child | Steps, more: Child): Child {
  ({
    api,
    errorText,
    avatar,
    challengeButton,
    challengeText,
    emblem,
    explain,
    feelKit,
    formatNumber,
    go,
    h,
    hands,
    landing,
    meaning,
    meter,
    nextSteps,
    ordinal,
    play,
    profileHref,
    record,
    reviewParts,
    signal,
    trail,
    until,
    withName,
  } = kit);
  const settled = d.state === "won" || d.state === "lost" || d.state === "draw";
  const steps = again && typeof again === "object" && "main" in again ? again : null;
  const next = steps ? steps.main : ((again as Child) ?? rematch(d) ?? sendOn(d));
  // A challenge between friends: anyone else may be challenged with the player's game of it too.
  const challenge = !steps && d.kind === "challenge" && d.friend && d.state !== "wait" ? challengeAnyone(d) : null;
  const questions =
    d.runId && d.you?.done
      ? reviewParts(async () => (await api<{ questions: Reviewed[] }>("GET", `/api/runs/${d.runId}/review`)).questions)
      : null;
  const head = settled || d.state === "wait" ? hero(d) : plain(d);
  return h(
    "section",
    { class: "screen" },
    head,
    // The gold button is another duel where there's one (a live one, or a challenge back to the friend), else the
    // way back to the duels; the rest are plain, side by side.
    nextSteps(
      next ?? toDuels(true),
      steps ? [questions?.button, ...(steps.also ?? [])] : [questions?.button, challenge, next ? toDuels(false) : null],
    ),
    more,
    questions?.list,
  );
}

/** „Дуел на живо с Мария“, „Дуел срещу запис“, „Предизвикателство от Мария“ or (the one who sent it)
 * „Предизвикателство към Мария“. */
function kicker(d: DuelView): string {
  if (d.recorded) return "Дуел срещу запис";
  const them = d.opponent?.name;
  if (d.kind === "challenge") return them ? `Предизвикателство ${d.sent ? "към" : "от"} ${them}` : "Предизвикателство";
  return them ? `Дуел на живо ${withName(them)}` : "Дуел";
}

const headings: Record<DuelView["state"], string> = {
  play: "Дуел",
  wait: "Твоите десет са изиграни",
  won: "Победа",
  lost: "Загуба",
  draw: "Равенство",
  declined: "Предизвикателството е отказано",
  expired: "Времето за предизвикателството изтече",
};

/** A duel with a result, or a challenge waiting for the friend: the card that holds it, landing once as a moment. */
function hero(d: DuelView): Child {
  const settled = d.state !== "wait";
  const you = d.you as Side;
  const them = d.opponent;
  const mine = you?.marks ?? [];
  const theirs = settled ? (them?.marks ?? []) : [];
  const card = h(
    "section",
    { class: `card hero duel-end s-${d.state}`, "aria-labelledby": "duel-verdict" },
    h(
      "div",
      { class: "duel-head" },
      h("p", { class: "kicker" }, kicker(d)),
      h("h1", { class: "duel-verdict", id: "duel-verdict" }, headings[d.state]),
    ),
    h(
      "div",
      { class: "duel-faces" },
      face(you, "Ти", "", d.state === "won", true),
      h("span", { class: "duel-colon", "aria-hidden": "true" }, ":"),
      them
        ? face(them, them.name, them.tag ?? "", d.state === "lost", settled, d.recorded)
        : h("div", { class: "duel-face" }),
    ),
    them?.tag && d.befriend ? befriend(them.name, them.tag) : null,
    marks(d, mine, theirs),
    h("p", { class: "duel-line" }, line(d)),
    settled ? meant(d) : null,
  ) as HTMLElement;
  land(card, d, mine, theirs);
  return card;
}

/** One side, face to face: the avatar (with its frame), the name (a way to their profile) and title, and the score;
 * the winner's in gold. The other's score shows only once there's a result: nobody plays knowing what to beat. */
function face(s: Side, label: string, tag: string, won: boolean, shown: boolean, recorded = false): Child {
  const look = s.look ?? {};
  return h(
    "div",
    { class: won ? "duel-face win" : "duel-face" },
    avatar(look.avatar, { size: "l", level: look.level, name: s.name }),
    tag ? h("a", { class: "duel-name", href: profileHref(tag) }, label) : h("strong", { class: "duel-name" }, label),
    // The title's line is kept with or without one, so that the two scores stand level.
    h(
      "span",
      { class: "duel-title" },
      recorded
        ? h("span", { class: "kicker" }, "Запис")
        : look.title
          ? h("span", { class: `who-title t-${look.titleTier ?? "common"}` }, look.title)
          : null,
    ),
    shown
      ? [
          h("b", { class: "duel-points", "data-n": s.points }, formatNumber(s.points)),
          h("span", { class: "duel-rights" }, `${s.rights} от ${total} верни`),
        ]
      : [h("b", { class: "duel-points none" }, "–"), h("span", { class: "duel-rights" }, "Тепърва ще играе")],
  );
}

/** Under the other, met in a live duel or by a challenge: a tap asks them to be friends (a request, as by their
 * tag). */
function befriend(name: string, tag: string): Child {
  const said = signal("");
  const busy = signal(false);
  const ask = async () => {
    busy.set(true);
    try {
      const r = await api<{ friends?: boolean }>("POST", "/api/friends/requests", { to: tag });
      said.set(r.friends ? "Вече сте приятели." : "Поканата е изпратена.");
    } catch (err) {
      said.set(errorText(err));
    } finally {
      busy.set(false);
    }
  };
  return h("div", { class: "duel-add" }, () =>
    said()
      ? h("p", { class: "muted", role: "status" }, said())
      : h(
          "button",
          { class: "link", type: "button", disabled: busy, "aria-label": `Добави ${name} в приятели`, onclick: ask },
          "Добави в приятели",
        ),
  );
}

/** The duel question by question: the player's marks over the other's, aligned, the quicker of two right answers
 * ringed in gold, and a band behind the question that decided it. */
function marks(d: DuelView, mine: DuelMark[], theirs: DuelMark[]): Child {
  const fast = (a?: DuelMark, b?: DuelMark) => !!a?.right && !!b?.right && a.ms < b.ms;
  const words = (m: DuelMark) =>
    m.right ? `вярно за ${secs(m.ms)}` : m.partial ? "близо" : m.missed ? "без отговор" : "грешно";
  const them = d.opponent?.name ?? "съперникът";
  const pip = (m: DuelMark | undefined, other: DuelMark | undefined, row: number, i: number) =>
    h("span", {
      class: ["duel-pip", m && (m.right ? "right" : m.partial ? "partial" : "wrong"), fast(m, other) && "fast"]
        .filter(Boolean)
        .join(" "),
      style: { "grid-row": String(row), "grid-column": String(i + 2) },
      title: m ? `${i + 1}: ${words(m)}` : null,
    });
  const rights = (list: DuelMark[]) => list.filter((m) => m.right).length;
  const label = [
    `Въпрос по въпрос. Ти: ${rights(mine)} от ${total} верни`,
    theirs.length ? `; ${them}: ${rights(theirs)} от ${total} верни` : "",
    d.decided ? `; реши се на ${ordinal(d.decided)}я въпрос` : "",
  ].join("");
  // Small beside the marks: the avatar alone, without its frame.
  const bare = (s?: Side) => s?.look?.avatar?.split("/")[0];
  const you = { avatar: bare(d.you) };
  const other = { avatar: bare(d.opponent) };
  const anyFast = mine.some((m, i) => fast(m, theirs[i]) || fast(theirs[i], m));
  return [
    h(
      "div",
      { class: "duel-marks", role: "img", "aria-label": label },
      d.decided && d.decided > 1
        ? h("span", { class: "duel-band", style: { "grid-row": "1 / span 2", "grid-column": String(d.decided + 1) } })
        : null,
      h(
        "span",
        { class: "duel-who", style: { "grid-row": "1", "grid-column": "1" } },
        avatar(you.avatar, { size: "s" }),
      ),
      Array.from({ length: total }, (_, i) => pip(mine[i], theirs[i], 1, i)),
      h(
        "span",
        { class: "duel-who", style: { "grid-row": "2", "grid-column": "1" } },
        avatar(other.avatar, { size: "s", name: d.opponent?.name }),
      ),
      Array.from({ length: total }, (_, i) => pip(theirs[i], mine[i], 2, i)),
    ),
    anyFast
      ? h(
          "p",
          { class: "duel-key", "aria-hidden": "true" },
          h("span", { class: "duel-key-ring" }),
          "по-бърз верен отговор",
        )
      : null,
  ];
}

/** What decided the duel: the question after which the winner led to the end, or the time on even points; while it
 * waits, until when the friend has. */
function line(d: DuelView): string {
  const them = d.opponent?.name ?? "Приятелят ти";
  if (d.state === "wait") return `${them} има време до ${until(d.expiresAt)} Ще ти кажем резултата.`;
  const you = d.you;
  const other = d.opponent;
  // One left under way: the duel went on without them, and that's what decided it.
  const after = (n: number) => (n > 0 ? `след ${ordinal(n)}я въпрос` : "още на първия въпрос");
  if (d.theyLeft !== undefined) return `${them} излезе ${after(d.theyLeft)}.`;
  if (d.youLeft !== undefined) return `Излезе ${after(d.youLeft)}: дуелът продължи без теб.`;
  if (d.state === "draw") return "Равни точки и равно време.";
  if (you && other && you.points === other.points)
    return `Равни точки: реши времето (${secs(you.ms)} срещу ${secs(other.ms)}).`;
  if (!d.decided) return "";
  if (d.decided >= total) return "Реши се на последния въпрос.";
  if (d.decided === 1)
    return d.state === "won" ? "Водеше от първия въпрос до края." : `${them} водеше от първия въпрос до края.`;
  return `Реши се на ${ordinal(d.decided)}я въпрос.`;
}

/** Why a duel moved no rating (play.DuelView.Unrated); a notification says the same (server/notify.go). */
const unratedWords: Record<NonNullable<DuelView["unrated"]>, string> = {
  again: "Дуел без рейтинг: днес вече сте играли.",
  recordings: "Срещу запис рейтингът се променя до пет пъти на ден: този дуел е без рейтинг.",
  network: "Дуел без рейтинг: играете от една и съща мрежа.",
  newcomers: "Дуел без рейтинг: с нови играчи рейтингът се променя до пет пъти на ден.",
  known: "Дуел без рейтинг: някой друг вече беше изиграл това предизвикателство.",
};

/** What the duel meant: where the rating went (from and to, its division and how far to the next), or why it didn't
 * move; and the record against this person. */
function meant(d: DuelView): Child {
  const r = d.rating;
  const span = r?.next ? r.next.from - r.division.from : 0;
  const share = (n: number) => (span && r ? Math.round((100 * (n - r.division.from)) / span) : 100);
  const delta = r ? r.after - r.before : 0;
  const why = d.friendly ? unratedWords[d.unrated ?? (d.recorded ? "recordings" : "again")] : "";
  const rec = d.record;
  const them = d.opponent?.name ?? "";
  return h(
    "div",
    { class: "duel-meant" },
    r
      ? h(
          "div",
          { class: `duel-rating d-${r.division.id}` },
          emblem(r.division.id, "m"),
          h(
            "div",
            { class: "duel-rating-text" },
            h(
              "p",
              { class: "duel-rating-top" },
              h("strong", null, r.division.name),
              h("b", { class: delta > 0 ? "delta up" : "delta down" }, `${delta > 0 ? "+" : ""}${delta}`),
            ),
            meter(share(r.after), r.next ? `${share(r.after)}% до ${r.next.name}` : "Най-високата дивизия"),
            h(
              "p",
              { class: "duel-rating-line", "data-from": share(r.before), "data-to": share(r.after) },
              explain("Рейтинг", meaning.rating),
              ` ${r.before} → ${r.after}`,
              // Kept on one line: „70 до Злато“.
              r.next ? ` · ${r.next.from - r.after} до ${r.next.name}` : " · най-високата дивизия",
            ),
          ),
        )
      : null,
    why ? h("p", { class: "duel-why" }, why) : null,
    d.recorded && d.opponent
      ? h("p", { class: "duel-why" }, "Записът е от истинска игра: никой не дойде навреме.")
      : null,
    rec && them && rec.won + rec.lost + rec.drawn > 0
      ? h(
          "p",
          { class: "duel-record" },
          h("span", null, `Срещу ${them}`),
          h(
            "span",
            { class: "duel-record-end" },
            h(
              "b",
              { class: "duel-record-n", "aria-label": record(rec.won, rec.lost, rec.drawn) },
              `${rec.won} : ${rec.lost}`,
            ),
            rec.drawn
              ? h("span", { class: "duel-why" }, `и ${rec.drawn} ${rec.drawn === 1 ? "равенство" : "равенства"}`)
              : null,
          ),
        )
      : null,
  );
}

/** A duel without a result (turned down, not played in time, cut off): what happened, and the player's own game if
 * they played it. */
function plain(d: DuelView): Child {
  const live = d.kind === "live";
  const them = d.opponent?.name ?? "Приятелят ти";
  const heading = d.state === "expired" && live ? "Дуелът прекъсна" : headings[d.state];
  const lead =
    d.state === "expired" && !live && d.you?.done
      ? `${them} не изигра предизвикателството навреме. Без резултат: рейтингът не се променя.`
      : "Без резултат: рейтингът не се променя.";
  const you = d.you;
  return [
    h(
      "div",
      { class: "intro" },
      h("p", { class: "kicker" }, kicker(d)),
      h("h1", null, heading),
      h("p", { class: "lead" }, lead),
    ),
    you?.done
      ? h(
          "div",
          { class: "card duel-mine" },
          h("p", { class: "kicker" }, "Твоята игра"),
          h(
            "p",
            { class: "duel-mine-score" },
            h("b", { class: "duel-mine-n" }, formatNumber(you.points)),
            ` ${you.points === 1 ? "точка" : "точки"} · ${you.rights} от ${total} верни`,
          ),
          trail(you.marks ?? [], total),
        )
      : null,
  ];
}

/** A challenge between friends with a result: „Предизвикай отново“ challenges the friend again (the count-in first,
 * with a way back). */
function rematch(d: DuelView): Child {
  if (d.kind !== "challenge" || !d.friend || !["won", "lost", "draw"].includes(d.state)) return null;
  return h(
    "button",
    { class: "btn primary big", type: "button", onclick: () => go(`/challenge/${d.friend}`) },
    "Предизвикай отново",
  );
}

/** A challenge sent to a friend, waiting for them: the gold way is to send it to them where they talk (its link
 * brings them to their turn; anyone else it reaches can take it too). A challenge taken from anyone: send it on, the
 * player's own game the one to beat. */
function sendOn(d: DuelView): Child {
  if (d.kind !== "challenge" || !d.runId || !d.you?.done) return null;
  if (d.sent && d.state === "wait")
    return challengeButton(
      `Прати на ${d.opponent?.name ?? "приятеля си"}`,
      d.runId,
      () => "Изиграх предизвикателството в АЛМАНАХ. Ти си наред.",
      true,
    );
  if (!d.sent && ["won", "lost", "draw"].includes(d.state))
    return challengeButton("Предизвикай и ти", d.runId, () => challengeText(d.you?.rights ?? 0), true);
  return null;
}

/** The player's own ten of a challenge between friends, as a challenge to anyone: plain, beside the gold way on. */
function challengeAnyone(d: DuelView): Child {
  if (!d.runId || !d.you?.done) return null;
  return challengeButton("Предизвикай", d.runId, () => challengeText(d.you?.rights ?? 0));
}

const toDuels = (main: boolean) => h("a", { class: main ? "btn primary big" : "btn", href: "/duel" }, "Към дуелите");

/** Where the results already landed are kept, on this device: a duel's lands once (as each state of it: waiting,
 * then its result), never again on a reload or a visit back. */
const landedKey = "almanac.duelsLanded";

function firstTime(key: string): boolean {
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(landedKey) ?? "[]");
    if (seen.includes(key)) return false;
    localStorage.setItem(landedKey, JSON.stringify([...seen, key].slice(-40)));
  } catch {
    // Storage refused (a private window): it lands each time, the lesser loss.
  }
  return true;
}

/** The result as a moment, the first time it shows (feel.ts: duel); without the feel, its sound alone. The game's
 * big news waits for it to land. */
function land(card: HTMLElement, d: DuelView, mine: DuelMark[], theirs: DuelMark[]): void {
  if (!firstTime(`${d.id}:${d.state}`)) return;
  const end: SoundName = d.state === "won" ? "win" : d.state === "lost" ? "lose" : "end";
  const feel = feelKit();
  if (!feel) {
    play(end);
    return;
  }
  const moment = new Promise<void>((done) =>
    requestAnimationFrame(() =>
      feel
        .duel(
          card,
          { mine: mine.map((m) => m.points), theirs: theirs.map((m) => m.points), end, decided: d.decided ?? 0 },
          hands(),
        )
        .then(done),
    ),
  );
  if (d.runId) landing(d.runId, moment);
}
