import {
  achievementById,
  type CategoryId,
  type DuelRecord,
  isQueueMode,
  type LeaderboardBoard,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type ModeId,
  type ProfileStats,
  type QueueModeId,
  seasonEndsAt,
  seasonKey,
  seasonName,
} from '@quiz/shared';
import { Router } from 'express';
import { factCount, factsInAll } from '../almanac';
import { requireAuth } from '../auth';
import { duelRecord } from '../challenges';
import { dailyInfo, liveDailyStreak } from '../daily';
import { all, one } from '../db';
import { friendship } from '../friends';
import { getRatings, seasonHistory } from '../seasons';
import { modeTallies } from '../tallies';
import { getUser, getUserByName, NOT_BANNED, toPublicUser, type UserRow } from '../users';

/** Profiles and leaderboards. */
export const profilesRouter = Router();

profilesRouter.get('/profile/:username', requireAuth, (req, res) => {
  const user = getUserByName(String(req.params.username));
  if (!user) {
    res.status(404).json({ error: 'Няма такъв играч.' });
    return;
  }
  res.json(profileStats(user, res.locals.userId));
});

profilesRouter.get('/leaderboard/:board', requireAuth, (req, res) => {
  const board = String(req.params.board) as LeaderboardBoard;
  if (board !== 'level' && board !== 'daily' && !isQueueMode(board)) {
    res.status(404).json({ error: 'Няма такава класация.' });
    return;
  }
  res.json(leaderboard(board, res.locals.userId));
});

const someDuels = (r: DuelRecord) => (r.wins + r.losses + r.draws ? r : null);

function profileStats(u: UserRow, viewerId: number): ProfileStats {
  const ratings = getRatings(u.id);
  const modes = modeTallies(u.id);
  // The last twenty, newest first: rows go in as matches are settled (none is ever deleted), so the player's index
  // gives them in that order without sorting every match they played.
  const recent = all<{
    id: string;
    mode: ModeId;
    ended_at: number;
    player_count: number;
    question_count: number;
    placement: number;
    score: number;
    correct: number;
    xp_gained: number;
    rating_delta: number | null;
  }>(
    `SELECT m.id, m.mode, m.ended_at, m.player_count, m.question_count, mp.placement, mp.score, mp.correct,
       mp.xp_gained, mp.rating_delta
     FROM match_players mp JOIN matches m ON m.id = mp.match_id
     WHERE mp.user_id = ? ORDER BY mp.rowid DESC LIMIT 20`,
    u.id,
  );
  return {
    user: { ...toPublicUser(u), createdAt: u.created_at },
    friendship: friendship(viewerId, u.id),
    blocked: !!one('SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?', viewerId, u.id),
    duels: viewerId === u.id ? null : someDuels(duelRecord(viewerId, u.id)),
    overview: {
      gamesPlayed: u.games_played,
      multiplayerGames: u.mp_games,
      wins: u.wins,
      questionsAnswered: u.questions_answered,
      correctAnswers: u.correct_answers,
      bestStreak: u.best_streak,
      fastestCorrectMs: u.fastest_correct_ms,
      avgCorrectMs: u.correct_answers > 0 ? Math.round(u.total_correct_ms / u.correct_answers) : null,
      bestSoloScore: u.best_solo_score,
      powerupsUsed: u.powerups_used,
      dailyStreak: liveDailyStreak(u),
      bestDailyStreak: u.best_daily_streak,
      questionsApproved: one<{ n: number }>('SELECT COUNT(*) AS n FROM questions WHERE author_id = ?', u.id)!.n,
    },
    modes: modes.map((m) => ({
      mode: m.mode,
      games: m.games,
      wins: m.firsts,
      avgPlacement: m.placed ? Math.round((m.placements / m.placed) * 10) / 10 : null,
      rating: isQueueMode(m.mode) ? (ratings[m.mode] ?? null) : null,
    })),
    categories: all<{ category: CategoryId; answered: number; correct: number; tier: number | null }>(
      `SELECT c.category, c.answered, c.correct, m.tier FROM category_stats c
       LEFT JOIN mastery m ON m.user_id = c.user_id AND m.category = c.category WHERE c.user_id = ?`,
      u.id,
    ).map((c) => ({ ...c })),
    almanac: { facts: factCount(u.id), total: factsInAll() },
    recent: recent.map((r) => ({
      matchId: r.id,
      mode: r.mode,
      endedAt: r.ended_at,
      placement: r.placement,
      players: r.player_count,
      score: r.score,
      correct: r.correct,
      questions: r.question_count,
      xp: r.xp_gained,
      ratingDelta: r.rating_delta === null ? null : Math.round(r.rating_delta),
    })),
    achievements: all<{ achievement_id: string; unlocked_at: number }>(
      'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at DESC',
      u.id,
    )
      // One that was retired since (it went with "Леден удар") stays in the table, not on the profile.
      .filter((a) => achievementById(a.achievement_id))
      .map((a) => ({ id: a.achievement_id, unlockedAt: a.unlocked_at })),
    seasons: seasonHistory(u.id).map(({ season, tier }) => ({ season, tier })),
  };
}

type BoardRow = UserRow & { rating?: number; games?: number; wins?: number };

function leaderboard(board: LeaderboardBoard, userId: number): LeaderboardResponse {
  const LIMIT = 50;
  const toEntry = (row: BoardRow, rank: number): LeaderboardEntry => ({
    rank,
    user: toPublicUser(row),
    value: board === 'level' ? row.xp : Math.round(row.rating!),
    games: row.games,
    wins: row.wins,
  });

  if (board === 'daily') {
    const info = dailyInfo(userId);
    const me = getUser(userId)!;
    return {
      board,
      entries: info.entries,
      // A guest's run had questions of its own: no place on this board.
      me:
        info.played && info.played.rank !== null
          ? { rank: info.played.rank, user: toPublicUser(me), value: info.played.score, correct: info.played.correct }
          : null,
      season: null,
      friends: info.friends,
    };
  }

  if (board === 'level') {
    // Guests play but aren't listed (they can be made by the dozen); they still see where they'd stand.
    const rows = all<BoardRow>(
      `SELECT * FROM users u WHERE u.is_guest = 0 AND ${NOT_BANNED} ORDER BY u.xp DESC, u.id ASC LIMIT ?`,
      LIMIT,
    );
    const me = getUser(userId)!;
    const rank = one<{ n: number }>(
      `SELECT COUNT(*) + 1 AS n FROM users u WHERE u.is_guest = 0 AND ${NOT_BANNED} AND u.xp > ?`,
      me.xp,
    )!.n;
    return { board, entries: rows.map((r, i) => toEntry(r, i + 1)), me: toEntry(me, rank), season: null };
  }

  const season = seasonKey();
  const mode: QueueModeId = board;
  const rows = all<BoardRow>(
    `SELECT u.*, r.rating, r.games, r.wins FROM season_ratings r JOIN users u ON u.id = r.user_id
     WHERE r.season = ? AND r.mode = ? AND r.games > 0 AND u.is_guest = 0 AND ${NOT_BANNED}
     ORDER BY r.rating DESC, u.id ASC LIMIT ?`,
    season,
    mode,
    LIMIT,
  );
  const mine = one<BoardRow>(
    `SELECT u.*, r.rating, r.games, r.wins FROM season_ratings r JOIN users u ON u.id = r.user_id
     WHERE r.season = ? AND r.mode = ? AND u.id = ?`,
    season,
    mode,
    userId,
  );
  const rank = mine
    ? one<{ n: number }>(
        `SELECT COUNT(*) + 1 AS n FROM season_ratings r JOIN users u ON u.id = r.user_id
         WHERE r.season = ? AND r.mode = ? AND r.games > 0 AND u.is_guest = 0 AND ${NOT_BANNED} AND r.rating > ?`,
        season,
        mode,
        mine.rating!,
      )!.n
    : 0;
  return {
    board,
    entries: rows.map((r, i) => toEntry(r, i + 1)),
    me: mine ? toEntry(mine, rank) : null,
    season: { id: season, name: seasonName(season), endsAt: seasonEndsAt(season) },
  };
}
