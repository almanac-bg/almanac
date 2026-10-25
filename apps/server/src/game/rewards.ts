import {
  DAILY_XP,
  dayKey,
  type FinalStanding,
  isQueueMode,
  levelFromXp,
  type MatchRewards,
  newlyUnlocked,
  ordinal,
  START_RATING,
  type XpLine,
} from '@quiz/shared';
import { unlockContext } from '../account';
import { type MatchContext, settleAchievements } from '../achievements';
import { recordChallengeResult } from '../challenges';
import { recordDailyResult } from '../daily';
import { all, run, tx } from '../db';
import { advanceQuests } from '../quests';
import { getRating, recordRating } from '../seasons';
import { DELETED_NAME, getUser } from '../users';
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
  daily: 100,
};

/** Elo step against people; bots move ratings less (their strength is an estimate). */
const RATING_K = 40;
const RATING_K_BOTS = 24;
/** Win-trading guard: the same two people only move each other's rating this many times a day. */
const RATED_GAMES_PER_PAIR = 3;

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

    const deltas =
      setup.ranked && isQueueMode(setup.mode)
        ? setup.teams
          ? teamRatingDeltas(game, standings)
          : ratingDeltas(game, standings)
        : new Map<string, number>();

    // Insert every row first so per-mode win counts include this match.
    for (const s of standings) {
      const p = game.participants.get(s.id)!;
      run(
        `INSERT INTO match_players (match_id, player_id, user_id, name, avatar, is_bot, placement, score, correct,
           faced, best_streak, eliminated_at, left_match, rating_delta, team)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        game.id,
        s.id,
        p.player.userId,
        p.player.name,
        p.player.avatar,
        p.player.isBot ? 1 : 0,
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
      const r = rewardHuman(game, p, s, standings, deltas.get(s.id) ?? null);
      rewards.set(p.player.userId, r);
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
): MatchRewards {
  const { setup } = game;
  const userId = p.player.userId!;
  const before = getUser(userId)!;
  const ctxBefore = unlockContext(userId);
  const playerCount = game.participants.size;
  const multiplayer = playerCount > 1;
  // Walking out after being knocked out isn't a forfeit: that player keeps their place and its rewards.
  const left = game.forfeited(p);
  const won = multiplayer && s.placement === 1 && !left;
  const solo = setup.mode === 'solo';
  const daily = setup.dailyDay !== null;
  const challenge = setup.challengeId !== null;
  // In ranked queues bots only fill seats nobody else took; in a private room the host picks them, so beating bots
  // there earns nothing extra (else a room full of bots is an XP farm).
  const rivals = standings.filter((o) => {
    const them = game.participants.get(o.id)!.player;
    return o.id !== s.id && (!setup.roomCode || !them.isBot) && (!setup.teams || them.team !== p.player.team);
  });
  const beaten = rivals.filter((o) => o.placement > s.placement).length;

  // ── XP ──
  const lines: XpLine[] = [];
  if (!left) lines.push({ label: 'Изигран мач', amount: XP.played });
  const correctXp =
    p.correctByDifficulty.easy * XP.perCorrect.easy +
    p.correctByDifficulty.medium * XP.perCorrect.medium +
    p.correctByDifficulty.hard * XP.perCorrect.hard;
  if (correctXp > 0) lines.push({ label: `Верни отговори (${p.correct})`, amount: correctXp });
  if (!left && setup.teams) {
    if (won && rivals.length > 0) lines.push({ label: 'Отборна победа', amount: XP.teamWin });
  } else if (!left && multiplayer) {
    const amount = won ? (rivals.length ? XP.winBase + XP.winPerOpponent * rivals.length : 0) : XP.perOpponentBeaten * beaten;
    if (amount > 0) lines.push({ label: won ? 'Победа' : `${ordinal(s.placement)} място`, amount });
  }
  if (!left && (solo || daily || challenge)) {
    const amount = Math.floor(s.score / XP.soloScoreDivisor);
    if (amount > 0) lines.push({ label: 'Бонус за резултат', amount });
  }
  if (!left && p.faced === game.questions.length && p.correct === game.questions.length) {
    lines.push({ label: 'Перфектна игра', amount: XP.perfect });
  }
  const today = dayKey();
  const claimDaily = !left && before.last_daily_bonus !== today;
  if (claimDaily) lines.push({ label: 'Първи мач за деня', amount: XP.daily });

  // ── Daily challenge (recorded even after leaving: one attempt per day) ──
  let dailyResult: MatchRewards['daily'] = null;
  if (daily) {
    dailyResult = recordDailyResult(userId, setup.dailyDay!, s.score, p.correct, p.answerMs);
    if (!left) {
      lines.push({ label: 'Дневно предизвикателство', amount: DAILY_XP.complete });
      const streakBonus = Math.min(dailyResult.streak, DAILY_XP.streakCap) * DAILY_XP.perStreakDay;
      if (dailyResult.streak > 1) lines.push({ label: `Дневна серия ×${dailyResult.streak}`, amount: streakBonus });
    }
  }

  // ── Challenge link (recorded even after leaving: one attempt each) ──
  const challengeResult = challenge ? recordChallengeResult(setup.challengeId!, userId, s.score, p.correct, p.answerMs) : null;

  // ── Daily quests ──
  if (!left) {
    lines.push(
      ...advanceQuests(userId, {
        mode: setup.mode,
        multiplayer,
        won,
        correct: p.correct,
        hardCorrect: p.correctByDifficulty.hard,
        bestStreak: p.bestStreak,
        jokers: p.usedPowerups.size,
        correctByCategory: new Map([...p.categories].map(([category, c]) => [category, c.correct])),
      }),
    );
  }

  // ── Lifetime stats ──
  const counted = left ? 0 : 1;
  const fastest =
    p.fastestCorrectMs === null
      ? before.fastest_correct_ms
      : Math.min(before.fastest_correct_ms ?? Infinity, p.fastestCorrectMs);
  run(
    `UPDATE users SET games_played = ?, mp_games = ?, wins = ?, questions_answered = ?, correct_answers = ?,
       best_streak = ?, fastest_correct_ms = ?, total_correct_ms = ?, powerups_used = ?, best_solo_score = ?,
       hosted_games = ?, last_daily_bonus = ?, freezes = ?, xp = xp + ?
     WHERE id = ?`,
    before.games_played + counted,
    before.mp_games + (multiplayer ? counted : 0),
    before.wins + (won ? 1 : 0),
    before.questions_answered + p.faced,
    before.correct_answers + p.correct,
    Math.max(before.best_streak, p.bestStreak),
    fastest,
    before.total_correct_ms + p.correctMs,
    before.powerups_used + p.usedPowerups.size,
    solo && !left ? Math.max(before.best_solo_score, s.score) : before.best_solo_score,
    before.hosted_games + (setup.roomCode && setup.hostUserId === userId && !left ? 1 : 0),
    claimDaily ? today : before.last_daily_bonus,
    before.freezes + p.freezesUsed,
    lines.reduce((sum, l) => sum + l.amount, 0),
    userId,
  );
  for (const [category, c] of p.categories) {
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
    recordRating(userId, setup.mode, old + ratingDelta, won);
    rating = { before: Math.round(old), after: Math.round(old + ratingDelta) };
  }

  // ── Achievements ──
  const topScore = Math.max(...standings.map((x) => x.score));
  const runnerUp = setup.teams ? null : standings.find((x) => x.placement === 2);
  const match: MatchContext = {
    mode: setup.mode,
    won,
    left,
    teams: setup.teams,
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
  const unlocked = settleAchievements(userId, match);
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
    daily: dailyResult,
    challenge: challengeResult,
  };
}

const ratingOf = (game: Game, id: string) => game.participants.get(id)!.player.rating ?? START_RATING;

/** Pairs of people who already played each other RATED_GAMES_PER_PAIR rated matches in the last 24 hours. */
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
       AND m.ranked = 1 AND m.ended_at > ? AND m.id != ? AND a.rating_delta IS NOT NULL
     GROUP BY a.user_id, b.user_id`,
    ...ids,
    ...ids,
    Date.now() - 24 * 60 * 60 * 1000,
    game.id,
  );
  for (const r of rows) if (r.n >= RATED_GAMES_PER_PAIR) pairs.add(`${r.a}:${r.b}`);
  return pairs;
}

/** Multiplayer Elo: every pair of players is treated as a head-to-head result. */
function ratingDeltas(game: Game, standings: FinalStanding[]): Map<string, number> {
  const overplayed = overplayedPairs(game);
  const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const deltas = new Map<string, number>();
  for (const me of standings) {
    const myUserId = game.participants.get(me.id)!.player.userId;
    if (myUserId === null) continue;
    let sum = 0;
    for (const other of standings) {
      if (other.id === me.id) continue;
      const them = game.participants.get(other.id)!.player;
      if (them.userId !== null && overplayed.has(pairKey(myUserId, them.userId))) continue;
      const expected = 1 / (1 + 10 ** ((ratingOf(game, other.id) - ratingOf(game, me.id)) / 400));
      const actual = me.placement < other.placement ? 1 : me.placement > other.placement ? 0 : 0.5;
      sum += (them.isBot ? RATING_K_BOTS : RATING_K) * (actual - expected);
    }
    deltas.set(me.id, sum / (standings.length - 1));
  }
  return deltas;
}

/** Team Elo: your team's average rating against theirs; everyone on a team moves together. */
function teamRatingDeltas(game: Game, standings: FinalStanding[]): Map<string, number> {
  const avg = (team: number) => {
    const members = standings.filter((s) => game.participants.get(s.id)!.player.team === team);
    return members.reduce((sum, s) => sum + ratingOf(game, s.id), 0) / Math.max(1, members.length);
  };
  const deltas = new Map<string, number>();
  for (const s of standings) {
    const p = game.participants.get(s.id)!;
    if (p.player.userId === null || p.player.team === null) continue;
    const expected = 1 / (1 + 10 ** ((avg(1 - p.player.team) - avg(p.player.team)) / 400));
    const k = standings.some((o) => game.participants.get(o.id)!.player.isBot) ? RATING_K_BOTS : RATING_K;
    deltas.set(s.id, k * ((s.placement === 1 ? 1 : 0) - expected));
  }
  return deltas;
}
