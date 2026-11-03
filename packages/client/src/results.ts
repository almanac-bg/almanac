import {
  DAILY_FIELD,
  LEVEL_CHOICES,
  type MatchRewards,
  MODES,
  REVIEW,
  type UnlockRef,
  type UnratedReason,
} from '@almanac/shared';
import { ordinal } from './format';
import type { LiveGame } from './store';

/** More players than this (a class in a room) and the standings show the top and you, not everyone. */
export const BIG_MATCH = 12;

/**
 * The first `top` of a ranked list and you, if you're further down: what a big match's standings show. `gap`: the
 * index in `shown` before which places were left out (null: none were).
 */
export function topAndYou<T extends { id: string }>(
  list: T[],
  youId: string,
  top: number,
): { shown: T[]; gap: number | null } {
  if (list.length <= top + 1) return { shown: list, gap: null };
  const mine = list.findIndex((x) => x.id === youId);
  if (mine < top) return { shown: list.slice(0, top), gap: null };
  return { shown: [...list.slice(0, top), list[mine]!], gap: mine > top ? top : null };
}

/** Whether a day with this many runs (the player's among them) says a place (DAILY_FIELD.placeFrom). */
export const placeShown = (runs: number) => runs >= DAILY_FIELD.placeFrom;

/**
 * Why a run is off the day's board, and when the player joins it: a guest once the profile is saved (made before today:
 * that day; made today: the next), a new account from tomorrow. A second account costs seconds, so one made today could
 * be there only to read the answers off for another.
 */
export function offBoardWhy(d: { guest: boolean; madeToday: boolean; moreTime?: boolean }) {
  if (d.moreTime) return 'С „Повече време“ резултатът е извън класацията.';
  if (!d.guest) return 'Новият ти профил влиза в класацията от утре.';
  return d.madeToday ? 'Запази профила — от утре влизаш в класацията.' : 'Запази профила и влизаш в класацията.';
}

/** Where a run off the day's board would stand on it, and when the player joins the board. */
export function offBoardLine(d: {
  guest: boolean;
  madeToday: boolean;
  moreTime?: boolean;
  rank: number;
  total: number;
}) {
  if (!placeShown(d.total + 1)) return offBoardWhy(d);
  return `Щеше да си на ${ordinal(d.rank)} място от ${d.total + 1}. ${offBoardWhy(d)}`;
}

export type RewardStep =
  | { kind: 'level'; level: number }
  | { kind: 'choice'; level: number }
  | { kind: 'unlock'; unlock: UnlockRef; more: number };

/** Unlocks shown one by one at most; the rest are counted on the last one (a first match can bring half a dozen). */
const SHOWN_UNLOCKS = 3;

/**
 * What a match brought that deserves a moment of its own: a new level, a milestone's reward to pick (LEVEL_CHOICES),
 * then the avatars and frames it unlocked.
 */
export function rewardSteps(rewards: MatchRewards | null | undefined): RewardStep[] {
  if (!rewards) return [];
  const unlocks = rewards.unlocks.filter((u) => u.kind === 'avatar' || u.kind === 'frame');
  const shown = unlocks.slice(0, SHOWN_UNLOCKS);
  const milestones = LEVEL_CHOICES.filter((c) => c.level > rewards.levelBefore && c.level <= rewards.levelAfter);
  return [
    ...(rewards.levelAfter > rewards.levelBefore ? [{ kind: 'level' as const, level: rewards.levelAfter }] : []),
    ...milestones.map((c) => ({ kind: 'choice' as const, level: c.level })),
    ...shown.map((unlock, i) => ({
      kind: 'unlock' as const,
      unlock,
      more: i === shown.length - 1 ? unlocks.length - shown.length : 0,
    })),
  ];
}

/**
 * How a finished match went for the one who played it, as its results screen says it, the same on the web and in the
 * app: the headline, whether it was won or lost (and how loudly to say it), the record to beat, and what to show.
 * `roomGuest`: a guest only for a class's room — nothing is celebrated as theirs (the account goes within the hour).
 * `reviewDue`: missed questions back for „Поправителен“ now.
 */
export function matchOutcome(game: LiveGame, { roomGuest, reviewDue }: { roomGuest: boolean; reviewDue: number }) {
  const end = game.end!;
  const youId = game.start.youId;
  const mine = end.standings.find((s) => s.id === youId)!;
  const solo = end.mode === 'solo';
  const daily = end.mode === 'daily';
  const challenge = end.mode === 'challenge';
  const review = end.mode === 'review';
  // More missed questions back already: another „Поправителен“; else „Моите знания“, where they went.
  const moreReview = review && reviewDue >= REVIEW.min;
  const single = game.start.players.length === 1;
  const teamScores = end.teamScores;
  const winningTeam = teamScores?.[0]?.team ?? null;
  const rewards = end.rewards;
  const classPupil = roomGuest && !!end.roomCode;
  // A challenge link is played alone, but it has a board: first place over others is a win too. A friend duel is won
  // once the friend has played it too.
  const link = rewards?.challenge ?? null;
  const duel = link?.duel ?? null;
  const won =
    (!single && mine.placement === 1 && !end.noContest) ||
    (!!link && !duel && link.rank === 1 && link.total > 1) ||
    duel?.outcome === 'won';
  // Everyone else walked out (after the match got going, or it would be no contest). A link is played alone: its win
  // is a place on the board, never a walkout.
  const byWalkout = won && !single && !teamScores && end.standings.every((s) => s.id === youId || s.left);
  const rivals = end.standings.length > 2 ? 'Съперниците напуснаха' : 'Съперникът напусна';
  const perfect = mine.correct === game.start.totalQuestions;
  // Beaten on a link's board (or by the friend, in a duel): played alone, but lost all the same.
  const lostLink = !!link && (duel ? duel.outcome === 'lost' : link.rank > 1);
  // Lost to other people, or under half right alone: no fanfare (a level gained along the way still says so, quietly).
  const lost = (!single && !won && !end.noContest) || lostLink;
  const quiet = lost || (single && mine.correct * 2 < game.start.totalQuestions);
  const best = rewards?.soloBest ?? null;
  const newBest = best !== null && best > 0 && mine.score > best;
  // A no contest says so in the headline; the other reasons a rating stayed put get a card.
  const unrated: Exclude<UnratedReason, 'no_contest'> | null =
    rewards?.unrated && rewards.unrated !== 'no_contest' ? rewards.unrated : null;
  // The win's sting and confetti: a win, a perfect run alone, a new record.
  const fanfare = won || (single && perfect && !lostLink) || newBest;
  const headline = end.noContest
    ? rivals
    : daily
      ? perfect
        ? 'Перфектен ден!'
        : 'Денят е изигран'
      : duel
        ? duel.outcome
          ? { won: 'Победа!', lost: 'Загуба', draw: 'Равенство' }[duel.outcome]
          : 'Ходът ти е изигран'
        : link
          ? link.total <= 1
            ? mine.score > 0
              ? 'Летвата е поставена!'
              : 'Линкът е готов'
            : link.rank === 1
              ? 'Първо място!'
              : `${ordinal(link.rank)} място`
          : single
            ? perfect
              ? 'Перфектно!'
              : 'Готово!'
            : teamScores
              ? won
                ? 'Победа!'
                : 'Загуба'
              : won
                ? 'Победа!'
                : // Second of two is a loss, and says so (the rating below says it anyway).
                  end.standings.length === 2
                  ? 'Загуба'
                  : `${ordinal(mine.placement)} място`;
  // „Играй пак“ goes home for these: Отбори starts from a friend's yes, the evening Роял is once a day.
  const againIsHome = (MODES[end.mode].teams && !end.roomCode) || end.mode === 'evening';
  return {
    end,
    mine,
    solo,
    daily,
    challenge,
    review,
    moreReview,
    single,
    teamScores,
    winningTeam,
    rewards,
    classPupil,
    link,
    duel,
    won,
    byWalkout,
    rivals,
    perfect,
    lost,
    quiet,
    best,
    newBest,
    unrated,
    fanfare,
    headline,
    againIsHome,
  };
}

export type MatchOutcome = ReturnType<typeof matchOutcome>;
