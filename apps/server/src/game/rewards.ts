import {
  type CategoryMastery,
  DAILY_XP,
  dayKey,
  type FinalStanding,
  isQueueMode,
  levelFromXp,
  type MatchRewards,
  MODES,
  newlyUnlocked,
  ordinal,
  RATED_GAMES_PER_PAIR,
  START_RATING,
  type UnratedReason,
  type XpLine,
} from '@quiz/shared';
import { unlockContext } from '../account';
import { type MatchContext, settleAchievements } from '../achievements';
import { factCount, factsSince, noteMatch } from '../almanac';
import { recordAnswers } from '../answers';
import { DUEL, recordChallengeResult } from '../challenges';
import { recordDailyResult } from '../daily';
import { all, run, tx } from '../db';
import { recordEvening } from '../evening';
import { settleMastery } from '../mastery';
import { advanceQuests } from '../quests';
import { noteRecordPlay } from '../records';
import { recordRun } from '../runs';
import { getRating, ratedGames, recordRating } from '../seasons';
import { recordSkill } from '../skill';
import { count, countActive } from '../stats';
import { ratesPeople } from '../trust';
import { DELETED_NAME, getUser } from '../users';
import { BOT_MAX_RATING } from './bots';
import type { Game, Participant } from './Game';

const XP = {
  played: 20,
  perCorrect: { easy: 8, medium: 12, hard: 18 },
  winBase: 50,
  winPerOpponent: 15,
  perOpponentBeaten: 10,
  teamWin: 60,
  soloScoreDivisor: 250,
  perfect: 50,
  /** The perfect-match bonus needs a match this long (as the achievement does): five easy questions are no feat. */
  perfectFrom: 10,
  daily: 100,
};

/**
 * What placements in private rooms (wins, places above others) pay a day, at most: rooms are for friends, and a room
 * with a second account of your own in it was the fastest XP in the game.
 */
export const ROOM_PLACEMENT_XP_PER_DAY = 600;

/** Elo step against people; bots move ratings less (their strength is an estimate). */
const RATING_K = 40;
const RATING_K_BOTS = 24;
/** Where games against bots start to count for less. */
const BOT_K_FADES_FROM = 1450;
/** A player's first rated games in a mode move their rating this much further: it finds their level sooner. */
export const PROVISIONAL = { games: 10, factor: 2 } as const;

/**
 * How far a game against bots moves a rating: the full step up to 1450, then less and less, nothing from the bots' own
 * ceiling (1600) up — a strong player kept beating bots there and climbed without limit. The top of the ladder is for
 * beating people; bots can't push anyone up it, or drag them down.
 */
export function botK(rating: number) {
  const share = (BOT_MAX_RATING - rating) / (BOT_MAX_RATING - BOT_K_FADES_FROM);
  return RATING_K_BOTS * Math.min(1, Math.max(0, share));
}

/** Rating changes by player id; who played a ranked match without one, and why. */
interface Ratings {
  deltas: Map<string, number>;
  unrated: Map<string, UnratedReason>;
}

/** Writes the match, updates every human's stats, XP, rating and achievements. */
export function finalizeMatch(game: Game, standings: FinalStanding[]): Map<number, MatchRewards> {
  const { setup } = game;
  const playerCount = game.participants.size;
  const rewards = new Map<number, MatchRewards>();

  // Someone may have deleted their account mid-match: keep their row, but anonymous.
  for (const p of game.participants.values()) {
    if (p.player.userId !== null && !getUser(p.player.userId)) {
      p.player.userId = null;
      p.player.name = DELETED_NAME;
    }
  }

  tx(() => {
    run(
      `INSERT INTO matches (id, mode, ranked, room_code, player_count, question_count, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      game.id,
      setup.mode,
      setup.ranked ? 1 : 0,
      setup.roomCode,
      playerCount,
      game.questions.length,
      game.startedAt,
      Date.now(),
    );
    count(`matches:${setup.mode}`);

    const ratings: Ratings =
      setup.ranked && isQueueMode(setup.mode)
        ? setup.teams
          ? teamRatingDeltas(game, standings)
          : ratingDeltas(game, standings)
        : { deltas: new Map(), unrated: new Map() };
    const { deltas } = ratings;

    // Insert every row first so per-mode win counts include this match.
    for (const s of standings) {
      const p = game.participants.get(s.id)!;
      run(
        `INSERT INTO match_players (match_id, player_id, user_id, name, avatar, is_bot, placement, score, correct,
           faced, best_streak, eliminated_at, left_match, rating_delta, team, won)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        game.id,
        s.id,
        p.player.userId,
        p.player.name,
        p.player.avatar,
        // A recording is no person in the match either (its owner played it before).
        p.player.isBot || p.player.record ? 1 : 0,
        s.placement,
        s.score,
        s.correct,
        p.faced,
        p.bestStreak,
        s.eliminatedAt,
        game.forfeited(p) ? 1 : 0,
        deltas.get(s.id) ?? null,
        p.player.team,
      );
    }

    for (const s of standings) {
      const p = game.participants.get(s.id)!;
      if (p.player.userId === null) continue;
      // The evening Роял: each person's place, for the night's top, the champion and the wins that earn a frame (before
      // the achievements below count them).
      if (setup.eveningDay && !game.forfeited(p))
        recordEvening(setup.eveningDay, p.player.userId, s.placement, s.score, playerCount);
      const r = rewardHuman(game, p, s, standings, deltas.get(s.id) ?? null, ratings.unrated.get(s.id) ?? null);
      // „Поправителен“ replays questions whose answers the player was shown: it says nothing about the questions, or
      // about how anyone plays (a run of known answers isn't one to replay against, nor play to check).
      if (setup.mode !== 'review' && !setup.questionSet) {
        recordAnswers(game.id, p.player.userId, p.log);
        recordRun({
          matchId: game.id,
          userId: p.player.userId,
          mode: game.setup.mode,
          category: game.setup.category,
          rating: game.setup.ranked ? p.player.rating : null,
          score: s.score,
          correct: p.correct,
          log: p.log,
        });
      }
      rewards.set(p.player.userId, r);
      // Played out against a recording: its owner hears how it did (not after a walkout, or a match we cut short).
      if (!game.cutShort && !game.forfeited(p)) {
        for (const rec of setup.records ?? []) {
          const recordWon = standings.find((x) => x.id === rec.player.id)?.placement === 1;
          noteRecordPlay(rec.runId, rec.ownerId, p.player.userId, recordWon);
        }
      }
      run('UPDATE match_players SET xp_gained = ? WHERE match_id = ? AND player_id = ?', r.xpGained, game.id, s.id);
    }
  });

  return rewards;
}

function rewardHuman(
  game: Game,
  p: Participant,
  s: FinalStanding,
  standings: FinalStanding[],
  ratingDelta: number | null,
  unrated: UnratedReason | null,
): MatchRewards {
  const { setup } = game;
  const userId = p.player.userId!;
  const before = getUser(userId)!;
  const ctxBefore = unlockContext(userId);
  const playerCount = game.participants.size;
  const multiplayer = playerCount > 1;
  // Walking out after being knocked out isn't a forfeit: that player keeps their place and its rewards.
  const left = game.forfeited(p);
  // Left alone before the match got going: the questions answered count, the match doesn't (else an accomplice who
  // walks out at once is a win every few seconds).
  const noContest = !left && game.noContest;
  const counts = !left && !noContest;
  // A match we cut short pays for what was played, but nobody won it.
  const won = multiplayer && s.placement === 1 && counts && !game.cutShort;
  const solo = setup.mode === 'solo';
  // „Поправителен“: questions the player has seen answered. Its right answers pay, but it measures nobody's knowledge:
  // no skill, accuracy, streaks, quests or match feats from it.
  const review = setup.mode === 'review';
  // A host's own set: questions nobody checked, which the host knows — played for the fun of it. It pays a room's
  // placements, but measures nothing, and its right answers pay nothing (a set of easy ones would be an XP farm).
  const ownSet = !!setup.questionSet;
  // Either way, nothing here says what anyone knows.
  const practice = review || ownSet;
  const daily = setup.dailyDay !== null;
  const challenge = setup.challengeId !== null;
  // In ranked queues bots only fill seats nobody else took; in a private room the host picks them, so beating bots
  // there earns nothing extra (else a room full of bots is an XP farm). Nor does beating someone in a room who didn't
  // play: a second window that never answers was a win every half a minute.
  const rivals = standings.filter((o) => {
    const them = game.participants.get(o.id)!;
    return (
      o.id !== s.id &&
      (!setup.roomCode || (!them.player.isBot && them.answered * 2 >= them.faced)) &&
      (!setup.teams || them.player.team !== p.player.team)
    );
  });
  const beaten = rivals.filter((o) => o.placement > s.placement).length;
  // A private room with nobody else in it is practice: winning there doesn't count as a win (counters, quests,
  // achievements), or one bot in a five-question room would hand them out.
  const realWin = won && (!setup.roomCode || rivals.length > 0);
  // Before the achievements below: the per-mode wins they count include this one.
  run('UPDATE match_players SET won = ? WHERE match_id = ? AND player_id = ?', realWin ? 1 : 0, game.id, s.id);

  // ── XP ──
  const lines: XpLine[] = [];
  if (counts) lines.push({ label: 'Изигран мач', amount: XP.played });
  const correctXp =
    p.correctByDifficulty.easy * XP.perCorrect.easy +
    p.correctByDifficulty.medium * XP.perCorrect.medium +
    p.correctByDifficulty.hard * XP.perCorrect.hard;
  if (correctXp > 0 && !ownSet) lines.push({ label: `Верни отговори (${p.correct})`, amount: correctXp });
  // A win by walkout pays for the part of the match that was played.
  const share = game.playedShare;
  const placementLine = (label: string, earned: number) => {
    if (earned <= 0) return;
    const paid = setup.roomCode ? roomAllowance(userId, earned) : earned;
    lines.push({ label: paid < earned ? `${label} (дневният таван за стаи)` : label, amount: paid });
  };
  if (counts && setup.teams) {
    if (won && rivals.length > 0) placementLine('Отборна победа', Math.round(XP.teamWin * share));
  } else if (counts && multiplayer) {
    // The evening Роял's fifty pay like a Роял's eight: a place among them is the reward, not a pile of XP.
    const cap = setup.eveningDay ? MODES.royale.players - 1 : Infinity;
    const amount = won
      ? rivals.length
        ? XP.winBase + XP.winPerOpponent * Math.min(rivals.length, cap)
        : 0
      : XP.perOpponentBeaten * Math.min(beaten, cap);
    placementLine(won ? 'Победа' : `${ordinal(s.placement)} място`, Math.round(amount * share));
  }
  if (counts && (solo || daily || challenge)) {
    const amount = Math.floor(s.score / XP.soloScoreDivisor);
    if (amount > 0) lines.push({ label: 'Бонус за резултат', amount });
  }
  const full = game.questions.length;
  if (counts && !practice && full >= XP.perfectFrom && p.faced === full && p.correct === full) {
    lines.push({ label: 'Перфектен мач', amount: XP.perfect });
  }
  const today = dayKey();
  const claimDaily = counts && before.last_daily_bonus !== today;
  if (claimDaily) {
    lines.push({ label: 'Първи мач за деня', amount: XP.daily });
    countActive(before.created_at, today);
  }

  // ── Daily challenge (recorded even after leaving: one attempt per day) ──
  let dailyResult: MatchRewards['daily'] = null;
  if (daily) {
    // A day played is half the run or more: leaving at once uses the day's attempt but doesn't keep a streak alive.
    const played = p.faced * 2 >= game.questions.length;
    dailyResult = recordDailyResult(userId, setup.dailyDay!, s.score, p.correct, p.answerMs, played);
    if (!left) {
      lines.push({ label: 'Въпросите на деня', amount: DAILY_XP.complete });
      const streakBonus = Math.min(dailyResult.streak, DAILY_XP.streakCap) * DAILY_XP.perStreakDay;
      if (dailyResult.streak > 1) lines.push({ label: `Дневна серия ×${dailyResult.streak}`, amount: streakBonus });
    }
  }

  // ── Challenge link (recorded even after leaving: one attempt each) ──
  const challengeResult = challenge
    ? recordChallengeResult(setup.challengeId!, userId, s.score, p.correct, p.answerMs)
    : null;
  // A friend duel decided by this run: a win pays as a 1-on-1 win (the friend who played first got theirs then).
  const duelWon = challengeResult?.duel?.outcome === 'won';
  if (duelWon && counts)
    lines.push({ label: `Победа над ${challengeResult!.duel!.friend.username}`, amount: DUEL.winXp });

  // ── Daily quests ──
  if (counts && !practice) {
    lines.push(
      ...advanceQuests(userId, {
        mode: setup.mode,
        // A friend duel is a match against a person, played at different times: it counts as one, and its win as a win.
        multiplayer: multiplayer || !!challengeResult?.duel,
        won: realWin || duelWon,
        correct: p.correct,
        hardCorrect: p.correctByDifficulty.hard,
        bestStreak: p.bestStreak,
        jokers: p.usedPowerups.size,
        correctByCategory: new Map([...p.categories].map(([category, c]) => [category, c.correct])),
      }),
    );
  }

  // ── Lifetime stats ──
  const counted = counts ? 1 : 0;
  // What a review run knew it knew from being told: its answers stay out of the player's accuracy and records.
  const known = practice ? 0 : 1;
  const fastest =
    p.fastestCorrectMs === null || practice
      ? before.fastest_correct_ms
      : Math.min(before.fastest_correct_ms ?? Infinity, p.fastestCorrectMs);
  run(
    `UPDATE users SET games_played = ?, mp_games = ?, wins = ?, questions_answered = ?, correct_answers = ?,
       best_streak = ?, fastest_correct_ms = ?, total_correct_ms = ?, powerups_used = ?, best_solo_score = ?,
       hosted_games = ?, last_daily_bonus = ?, xp = xp + ?
     WHERE id = ?`,
    before.games_played + counted,
    before.mp_games + (multiplayer ? counted : 0),
    before.wins + (realWin ? 1 : 0),
    before.questions_answered + p.faced * known,
    before.correct_answers + p.correct * known,
    Math.max(before.best_streak, p.bestStreak * known),
    fastest,
    before.total_correct_ms + p.correctMs * known,
    before.powerups_used + p.usedPowerups.size,
    solo && counts ? Math.max(before.best_solo_score, s.score) : before.best_solo_score,
    before.hosted_games + (setup.roomCode && setup.hostUserId === userId && counts ? 1 : 0),
    claimDaily ? today : before.last_daily_bonus,
    lines.reduce((sum, l) => sum + l.amount, 0),
    userId,
  );
  for (const [category, c] of practice ? [] : p.categories) {
    run(
      `INSERT INTO category_stats (user_id, category, answered, correct, correct_ms) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, category) DO UPDATE SET answered = answered + excluded.answered,
         correct = correct + excluded.correct, correct_ms = correct_ms + excluded.correct_ms`,
      userId,
      category,
      c.answered,
      c.correct,
      c.correctMs,
    );
  }

  // ── Rating (current season) ──
  let rating: MatchRewards['rating'] = null;
  if (ratingDelta !== null && isQueueMode(setup.mode)) {
    const old = getRating(userId, setup.mode);
    recordRating(userId, setup.mode, old + ratingDelta, won, counts);
    rating = { before: Math.round(old), after: Math.round(old + ratingDelta) };
  }

  // ── What the match taught: skill and mastery, „Моят алманах“, „Поправителен“ ──
  let mastery: CategoryMastery[] = [];
  if (!practice) {
    recordSkill(userId, p.log);
    mastery = settleMastery(userId, p.categories.keys());
  }
  // A host's own questions aren't the bank's: nothing of them goes into the almanac or comes back to review.
  if (!ownSet) noteMatch(userId, p.log, review);

  // ── Achievements ──
  const topScore = Math.max(...standings.map((x) => x.score));
  const runnerUp = setup.teams ? null : standings.find((x) => x.placement === 2);
  const sideSize = (team: number) => [...game.participants.values()].filter((x) => x.player.team === team).length;
  const match: MatchContext = {
    mode: setup.mode,
    won: realWin,
    left: !counts,
    completed: !game.endedByWalkout,
    teams: setup.teams,
    twoAside: setup.teams && sideSize(0) >= 2 && sideSize(1) >= 2,
    elimination: setup.elimination,
    fastestHardCorrectMs: p.fastestHardCorrectMs,
    questions: game.questions.length,
    faced: p.faced,
    correct: p.correct,
    lastAtHalfway: p.lastAtHalfway,
    winMargin: won && runnerUp ? s.score - runnerUp.score : null,
    beatLevelGap: Math.max(
      0,
      ...standings
        .filter((o) => o.placement > s.placement)
        .map((o) => game.participants.get(o.id)!.player)
        .filter((o) => !o.isBot)
        .map((o) => o.level - p.player.level),
    ),
    topScorer: s.score === topScore && s.score > 0,
  };
  // A review run's feats were played on known answers: only what counts over time (levels, facts) can come of it.
  const unlocked = settleAchievements(userId, practice ? null : match);
  lines.push(...unlocked.lines);

  const xpAfter = getUser(userId)!.xp;
  return {
    xpGained: xpAfter - before.xp,
    breakdown: lines,
    xpBefore: before.xp,
    xpAfter,
    levelBefore: levelFromXp(before.xp),
    levelAfter: levelFromXp(xpAfter),
    achievements: unlocked.ids,
    unlocks: newlyUnlocked(ctxBefore, unlockContext(userId)),
    rating,
    unrated: rating ? null : unrated,
    daily: dailyResult,
    challenge: challengeResult,
    soloBest: solo && counts ? before.best_solo_score : null,
    // Read during the match (stopped on, in a run alone) or got right in it.
    almanac: { added: factsSince(userId, game.startedAt), total: factCount(userId) },
    mastery,
  };
}

/**
 * The XP a private-room placement may still pay today (ROOM_PLACEMENT_XP_PER_DAY), booked as paid. Call inside the
 * match's transaction.
 */
function roomAllowance(userId: number, earned: number): number {
  const today = dayKey();
  const u = getUser(userId)!;
  const used = u.room_xp_day === today ? u.room_xp : 0;
  const paid = Math.max(0, Math.min(earned, ROOM_PLACEMENT_XP_PER_DAY - used));
  run('UPDATE users SET room_xp_day = ?, room_xp = ? WHERE id = ?', today, used + paid, userId);
  return paid;
}

const ratingOf = (game: Game, id: string) => game.participants.get(id)!.player.rating ?? START_RATING;

/** PROVISIONAL: twice the step while a player has fewer than ten rated games in the mode. */
const provisional = (game: Game, userId: number) =>
  isQueueMode(game.setup.mode) && ratedGames(userId, game.setup.mode) < PROVISIONAL.games ? PROVISIONAL.factor : 1;

/**
 * Pairs of people who already played each other RATED_GAMES_PER_PAIR rated matches in the last 24 hours. Rated for both
 * of them: a walkout before the match got going moves only the one who left, and that's no game between them.
 */
function overplayedPairs(game: Game): Set<string> {
  const ids = game.humans.map((h) => h.player.userId).filter((id): id is number => id !== null);
  const pairs = new Set<string>();
  if (ids.length < 2) return pairs;
  const rows = all<{ a: number; b: number; n: number }>(
    `SELECT a.user_id AS a, b.user_id AS b, COUNT(*) AS n
     FROM match_players a
     JOIN match_players b ON b.match_id = a.match_id AND b.user_id > a.user_id
     JOIN matches m ON m.id = a.match_id
     WHERE a.user_id IN (${ids.map(() => '?').join(',')}) AND b.user_id IN (${ids.map(() => '?').join(',')})
       AND m.ranked = 1 AND m.ended_at > ? AND m.id != ? AND a.rating_delta IS NOT NULL AND b.rating_delta IS NOT NULL
     GROUP BY a.user_id, b.user_id`,
    ...ids,
    ...ids,
    Date.now() - 24 * 60 * 60 * 1000,
    game.id,
  );
  for (const r of rows) if (r.n >= RATED_GAMES_PER_PAIR) pairs.add(`${r.a}:${r.b}`);
  return pairs;
}

/**
 * Players of this match who don't move people's ratings yet: guests (one click away, so any per-account guard would be
 * void) and accounts too new to (ratesPeople). Bots still rate them.
 */
function unprovenIn(game: Game): Map<number, 'guest' | 'new'> {
  const unproven = new Map<number, 'guest' | 'new'>();
  for (const h of game.humans) {
    const user = getUser(h.player.userId!);
    if (!user) continue;
    if (user.is_guest === 1) unproven.set(user.id, 'guest');
    else if (!ratesPeople(user)) unproven.set(user.id, 'new');
  }
  return unproven;
}

/** Why `me` and `them` (both people) don't rate each other, if they don't: a guest first, then whose account is new. */
function unprovenReason(unproven: Map<number, 'guest' | 'new'>, me: number, them: number): UnratedReason | null {
  const mine = unproven.get(me);
  const theirs = unproven.get(them);
  if (mine === 'guest' || theirs === 'guest') return 'guest';
  return mine ? 'new' : theirs ? 'new_rival' : null;
}

/** A match the other side walked out of moves the rating of whoever stayed by the share that was played. */
const walkoutShare = (game: Game, p: Participant) => (game.endedByWalkout && !game.forfeited(p) ? game.playedShare : 1);

/**
 * Multiplayer Elo: every pair of players is treated as a head-to-head result. A pair of people is skipped when either
 * is a guest or a new account, or the two already played their rated games today; when the match is a no contest, only
 * whoever walked out moves (down). A later walkout pays whoever stayed for the part that was played (with an
 * accomplice who leaves at the fourth question, a win took twenty seconds).
 */
function ratingDeltas(game: Game, standings: FinalStanding[]): Ratings {
  const overplayed = overplayedPairs(game);
  const unproven = unprovenIn(game);
  const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const ratings: Ratings = { deltas: new Map(), unrated: new Map() };
  for (const me of standings) {
    const mine = game.participants.get(me.id)!;
    const myUserId = mine.player.userId;
    if (myUserId === null) continue;
    if (game.noContest && !game.forfeited(mine)) {
      ratings.unrated.set(me.id, 'no_contest');
      continue;
    }
    // We ended it, not the players: only a walkout before that still costs.
    if (game.cutShort && !game.forfeited(mine)) {
      ratings.unrated.set(me.id, 'cut');
      continue;
    }
    let sum = 0;
    let rated = 0;
    let skipped: UnratedReason | null = null;
    for (const other of standings) {
      if (other.id === me.id) continue;
      const them = game.participants.get(other.id)!.player;
      const unprovenPair = them.userId === null ? null : unprovenReason(unproven, myUserId, them.userId);
      if (unprovenPair) {
        skipped = unprovenPair;
        continue;
      }
      if (them.userId !== null && overplayed.has(pairKey(myUserId, them.userId))) {
        skipped ??= 'pair';
        continue;
      }
      const expected = 1 / (1 + 10 ** ((ratingOf(game, other.id) - ratingOf(game, me.id)) / 400));
      const actual = me.placement < other.placement ? 1 : me.placement > other.placement ? 0 : 0.5;
      // A bot's strength, or a recording's (whose owner isn't here), is an estimate: the bots' step.
      sum += (them.isBot || them.record ? botK(ratingOf(game, me.id)) : RATING_K) * (actual - expected);
      rated++;
    }
    if (rated === 0 && skipped) ratings.unrated.set(me.id, skipped);
    else
      ratings.deltas.set(
        me.id,
        (sum / (standings.length - 1)) * walkoutShare(game, mine) * provisional(game, myUserId),
      );
  }
  return ratings;
}

/**
 * Team Elo: your team's average rating against theirs; everyone on a team moves together. A guest or a new account
 * playing with or against other people makes the match unrated for all.
 */
function teamRatingDeltas(game: Game, standings: FinalStanding[]): Ratings {
  const ratings: Ratings = { deltas: new Map(), unrated: new Map() };
  const humans = standings.filter((s) => game.participants.get(s.id)!.player.userId !== null);
  const unproven = humans.length > 1 ? unprovenIn(game) : new Map<number, 'guest' | 'new'>();
  const anyGuest = [...unproven.values()].includes('guest');
  const matchReason: UnratedReason | null = game.noContest ? 'no_contest' : game.cutShort ? 'cut' : null;
  const avg = (team: number) => {
    const members = standings.filter((s) => game.participants.get(s.id)!.player.team === team);
    return members.reduce((sum, s) => sum + ratingOf(game, s.id), 0) / Math.max(1, members.length);
  };
  for (const s of humans) {
    const p = game.participants.get(s.id)!;
    if (p.player.team === null) continue;
    if (matchReason && !game.forfeited(p)) {
      ratings.unrated.set(s.id, matchReason);
      continue;
    }
    const newcomers: UnratedReason | null = anyGuest
      ? 'guest'
      : unproven.has(p.player.userId!)
        ? 'new'
        : unproven.size
          ? 'new_rival'
          : null;
    if (newcomers) {
      ratings.unrated.set(s.id, newcomers);
      continue;
    }
    const expected = 1 / (1 + 10 ** ((avg(1 - p.player.team) - avg(p.player.team)) / 400));
    const k = standings.some((o) => game.participants.get(o.id)!.player.isBot) ? botK(ratingOf(game, s.id)) : RATING_K;
    ratings.deltas.set(
      s.id,
      k * ((s.placement === 1 ? 1 : 0) - expected) * walkoutShare(game, p) * provisional(game, p.player.userId!),
    );
  }
  return ratings;
}
