import {
  DAILY_XP,
  dayKey,
  type FinalStanding,
  isQueueMode,
  levelFromXp,
  type MatchRewards,
  newlyUnlocked,
  START_RATING,
  type XpLine,
} from '@quiz/shared';
import { unlockContext } from '../account';
import { type MatchContext, settleAchievements } from '../achievements';
import { recordDailyResult } from '../daily';
import { run, tx } from '../db';
import { getRating, recordRating } from '../seasons';
import { getUser } from '../users';
import type { Game, Participant } from './Game';

const XP = {
  played: 20,
  perCorrect: { easy: 8, medium: 12, hard: 18 },
  winBase: 30,
  winPerOpponent: 15,
  perOpponentBeaten: 10,
  teamWin: 60,
  soloScoreDivisor: 150,
  perfect: 50,
  daily: 100,
};

const RATING_K = 40;

/** "1-во", "2-ро", "3-то", "7-мо"… */
export function ordinal(n: number): string {
  const last = n % 10;
  const tens = n % 100;
  if (tens >= 11 && tens <= 19) return `${n}-то`;
  if (last === 1) return `${n}-во`;
  if (last === 2) return `${n}-ро`;
  if (last === 7 || last === 8) return `${n}-мо`;
  return `${n}-то`;
}

/** Writes the match, updates every human's stats, XP, rating and achievements. */
export function finalizeMatch(game: Game, standings: FinalStanding[]): Map<number, MatchRewards> {
  const { setup } = game;
  const playerCount = game.participants.size;
  const rewards = new Map<number, MatchRewards>();

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
        p.left ? 1 : 0,
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
  const won = multiplayer && s.placement === 1 && !p.left;
  const solo = setup.mode === 'solo';
  const daily = setup.dailyDay !== null;

  // ── XP ──
  const lines: XpLine[] = [];
  if (!p.left) lines.push({ label: 'Изигран мач', amount: XP.played });
  const correctXp =
    p.correctByDifficulty.easy * XP.perCorrect.easy +
    p.correctByDifficulty.medium * XP.perCorrect.medium +
    p.correctByDifficulty.hard * XP.perCorrect.hard;
  if (correctXp > 0) lines.push({ label: `Верни отговори (${p.correct})`, amount: correctXp });
  if (!p.left && setup.teams) {
    if (won) lines.push({ label: 'Отборна победа', amount: XP.teamWin });
  } else if (!p.left && multiplayer) {
    const amount = won ? XP.winBase + XP.winPerOpponent * (playerCount - 1) : XP.perOpponentBeaten * (playerCount - s.placement);
    if (amount > 0) lines.push({ label: won ? 'Победа' : `${ordinal(s.placement)} място`, amount });
  }
  if (!p.left && (solo || daily)) {
    const amount = Math.floor(s.score / XP.soloScoreDivisor);
    if (amount > 0) lines.push({ label: 'Бонус за резултат', amount });
  }
  if (!p.left && p.faced === game.questions.length && p.correct === game.questions.length) {
    lines.push({ label: 'Перфектна игра', amount: XP.perfect });
  }
  const today = dayKey();
  const claimDaily = !p.left && before.last_daily_bonus !== today;
  if (claimDaily) lines.push({ label: 'Първи мач за деня', amount: XP.daily });

  // ── Daily challenge (recorded even after leaving: one attempt per day) ──
  let dailyResult: MatchRewards['daily'] = null;
  if (daily) {
    dailyResult = recordDailyResult(userId, setup.dailyDay!, s.score, p.correct, p.answerMs);
    if (!p.left) {
      lines.push({ label: 'Дневно предизвикателство', amount: DAILY_XP.complete });
      const streakBonus = Math.min(dailyResult.streak, DAILY_XP.streakCap) * DAILY_XP.perStreakDay;
      if (dailyResult.streak > 1) lines.push({ label: `Дневна серия ×${dailyResult.streak}`, amount: streakBonus });
    }
  }

  // ── Lifetime stats ──
  const counted = p.left ? 0 : 1;
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
    solo && !p.left ? Math.max(before.best_solo_score, s.score) : before.best_solo_score,
    before.hosted_games + (setup.roomCode && setup.hostUserId === userId && !p.left ? 1 : 0),
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
    left: p.left,
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
  };
}

const ratingOf = (game: Game, id: string) => game.participants.get(id)!.player.rating ?? START_RATING;

/** Multiplayer Elo: every pair of players is treated as a head-to-head result. */
function ratingDeltas(game: Game, standings: FinalStanding[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const me of standings) {
    if (game.participants.get(me.id)!.player.userId === null) continue;
    let sum = 0;
    for (const other of standings) {
      if (other.id === me.id) continue;
      const expected = 1 / (1 + 10 ** ((ratingOf(game, other.id) - ratingOf(game, me.id)) / 400));
      const actual = me.placement < other.placement ? 1 : me.placement > other.placement ? 0 : 0.5;
      sum += actual - expected;
    }
    deltas.set(me.id, (RATING_K * sum) / (standings.length - 1));
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
    deltas.set(s.id, RATING_K * ((s.placement === 1 ? 1 : 0) - expected));
  }
  return deltas;
}
