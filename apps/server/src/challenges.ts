import { randomBytes } from 'node:crypto';
import {
  type ChallengeEntry,
  type ChallengeInfo,
  type ChallengePreview,
  type MatchRewards,
  MODES,
  type MyChallenge,
  ordinal,
} from '@quiz/shared';
import { config } from './config';
import { cutShortError } from './daily';
import { all, one, run } from './db';
import { notify, unreadAbout } from './notifications';
import { type PreparedQuestion, pickQuestions, recentFor, reorderOptions, withoutAuthors } from './questions';
import { count } from './stats';
import { NOT_BANNED, toPublicUser, type UserRow } from './users';

/** How long a challenge link can be played. */
const CHALLENGE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

interface ChallengeRow {
  id: string;
  creator_id: number | null;
  questions: string;
  created_at: number;
  expires_at: number;
}

type ResultRow = UserRow & { score: number; correct: number; time_ms: number };

const getChallenge = (id: string) => one<ChallengeRow>('SELECT * FROM challenges WHERE id = ?', id);

/** A new link with ten fresh questions for its creator (picked like any match: unseen first). */
export function createChallenge(creatorId: number): string {
  const id = randomBytes(6).toString('base64url');
  const questions = pickQuestions(MODES.challenge.questions, 'mixed', recentFor([creatorId]));
  const now = Date.now();
  run(
    'INSERT INTO challenges (id, creator_id, questions, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    id,
    creatorId,
    JSON.stringify(withoutAuthors(questions)),
    now,
    now + CHALLENGE_DAYS * DAY,
  );
  count('challenges');
  return id;
}

/** The link's questions in this player's own option order. */
export function challengeQuestions(id: string, userId: number): PreparedQuestion[] {
  return reorderOptions(JSON.parse(getChallenge(id)!.questions), `challenge:${id}:${userId}`);
}

/**
 * One attempt per player and link — except one a server restart cut short before any of its answers was revealed. Once
 * one was, the run ends with the score saved at its last reveal.
 */
export function claimChallengeAttempt(id: string, userId: number): { ok: true } | { ok: false; error: string } {
  const challenge = getChallenge(id);
  if (!challenge) return { ok: false, error: 'Няма такова предизвикателство.' };
  if (challenge.expires_at < Date.now()) return { ok: false, error: 'Това предизвикателство вече изтече.' };
  const mine = one<{ started_at: number; finished_at: number | null; revealed: number }>(
    'SELECT started_at, finished_at, revealed FROM challenge_results WHERE challenge_id = ? AND user_id = ?',
    id,
    userId,
  );
  if (mine && !mine.finished_at && mine.started_at < config.bootedAt && mine.revealed > 0) {
    run('UPDATE challenge_results SET finished_at = ? WHERE challenge_id = ? AND user_id = ?', Date.now(), id, userId);
    return { ok: false, error: cutShortError(mine.revealed) };
  }
  if (mine && (mine.finished_at || mine.started_at >= config.bootedAt)) {
    return { ok: false, error: 'Вече изигра това предизвикателство — всеки има по един опит.' };
  }
  run(
    `INSERT INTO challenge_results (challenge_id, user_id, started_at) VALUES (?, ?, ?)
     ON CONFLICT (challenge_id, user_id) DO UPDATE SET started_at = excluded.started_at`,
    id,
    userId,
    Date.now(),
  );
  count('challenge_runs');
  return { ok: true };
}

/** Saved at each reveal of a link run: what stands if the run is cut short from here on. */
export function saveChallengeProgress(
  id: string,
  userId: number,
  revealed: number,
  score: number,
  correct: number,
  timeMs: number,
) {
  run(
    `UPDATE challenge_results SET revealed = ?, score = ?, correct = ?, time_ms = ?
     WHERE challenge_id = ? AND user_id = ? AND finished_at IS NULL`,
    revealed,
    score,
    correct,
    timeMs,
    id,
    userId,
  );
}

/**
 * A run that ended without its result: with none of its answers revealed the link's one attempt is the player's again;
 * once one was, the run stands with the score saved at its last reveal (see releaseDailyAttempt).
 */
export function releaseChallengeAttempt(id: string, userId: number) {
  run(
    `UPDATE challenge_results SET finished_at = ?
     WHERE challenge_id = ? AND user_id = ? AND finished_at IS NULL AND revealed > 0`,
    Date.now(),
    id,
    userId,
  );
  run('DELETE FROM challenge_results WHERE challenge_id = ? AND user_id = ? AND finished_at IS NULL', id, userId);
}

/** How many rows of a link's board are sent: the page shows these, and the viewer's own further down. */
const BOARD_ROWS = 50;

/** The link's best runs, best first: higher score, then faster, then earlier. */
function finished(id: string, limit = BOARD_ROWS): ResultRow[] {
  return all<ResultRow>(
    `SELECT u.*, r.score, r.correct, r.time_ms FROM challenge_results r JOIN users u ON u.id = r.user_id
     WHERE r.challenge_id = ? AND r.finished_at IS NOT NULL AND ${NOT_BANNED}
     ORDER BY r.score DESC, r.time_ms ASC, r.finished_at ASC LIMIT ?`,
    id,
    limit,
  );
}

/** How many are on the link's board. */
const boardSize = (id: string) =>
  one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM challenge_results r JOIN users u ON u.id = r.user_id
     WHERE r.challenge_id = ? AND r.finished_at IS NOT NULL AND ${NOT_BANNED}`,
    id,
  )!.n;

/**
 * A player's run on the link and its place on the board (counted, not found in a list: a link shared widely can have
 * thousands of runs). Null if they have no finished run on it.
 */
function placeOf(id: string, userId: number): (ResultRow & { rank: number }) | null {
  const mine = one<ResultRow & { finished_at: number }>(
    `SELECT u.*, r.score, r.correct, r.time_ms, r.finished_at FROM challenge_results r JOIN users u ON u.id = r.user_id
     WHERE r.challenge_id = ? AND r.user_id = ? AND r.finished_at IS NOT NULL AND ${NOT_BANNED}`,
    id,
    userId,
  );
  if (!mine) return null;
  const ahead = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM challenge_results r JOIN users u ON u.id = r.user_id
     WHERE r.challenge_id = ? AND r.finished_at IS NOT NULL AND ${NOT_BANNED} AND (r.score > ?
       OR (r.score = ? AND r.time_ms < ?) OR (r.score = ? AND r.time_ms = ? AND r.finished_at < ?))`,
    id,
    mine.score,
    mine.score,
    mine.time_ms,
    mine.score,
    mine.time_ms,
    mine.finished_at,
  )!.n;
  return { ...mine, rank: ahead + 1 };
}

/**
 * Since when the creator hasn't looked at this link's notes: null when nothing about it is waiting unread (this result
 * is the first news), else when they last read one (0: never).
 */
function sinceSeen(creatorId: number, link: string): number | null {
  if (!unreadAbout(creatorId, link)) return null;
  return (
    one<{ t: number | null }>(
      'SELECT MAX(read_at) AS t FROM notifications WHERE user_id = ? AND link = ? AND read_at IS NOT NULL',
      creatorId,
      link,
    )?.t ?? 0
  );
}

/** Others' runs on the link finished after `since`. */
const freshResults = (id: string, creatorId: number, since: number) =>
  one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM challenge_results WHERE challenge_id = ? AND user_id <> ? AND finished_at > ?`,
    id,
    creatorId,
    since,
  )!.n;

/** Saves a finished run (also one cut short by leaving: it was the one attempt) and tells the creator. */
export function recordChallengeResult(
  id: string,
  userId: number,
  score: number,
  correct: number,
  timeMs: number,
): NonNullable<MatchRewards['challenge']> {
  run(
    'UPDATE challenge_results SET finished_at = ?, score = ?, correct = ?, time_ms = ? WHERE challenge_id = ? AND user_id = ?',
    Date.now(),
    score,
    correct,
    timeMs,
    id,
    userId,
  );
  const player = placeOf(id, userId);
  const rank = player?.rank ?? 0;
  const creator = getChallenge(id)?.creator_id;
  if (creator && creator !== userId && player) {
    // Kept for the creator (they're rarely on the page when a friend plays): the reason to come back and send another.
    const creatorPlace = placeOf(id, creator)?.rank ?? 0;
    const beaten = rank === 1 && creatorPlace > 1;
    const link = `/c/${id}`;
    // Played by several since the creator last looked: one note says how many (and who's ahead), not one each.
    const since = sinceSeen(creator, link);
    const fresh = since === null ? 1 : freshResults(id, creator, since);
    const leader = finished(id, 1)[0];
    notify(creator, {
      icon: beaten || (fresh > 1 && creatorPlace > 1) ? '⚔️' : '🔗',
      text:
        fresh > 1
          ? `${fresh} души изиграха линка ти, последен ${player.username}. Води ${leader.username} с ${leader.score} точки${creatorPlace > 1 ? ` — ти си ${ordinal(creatorPlace)}` : ''}.`
          : beaten
            ? `${player.username} те изпревари на линка ти: ${score} точки — вече си ${ordinal(creatorPlace)}.`
            : `${player.username} изигра предизвикателството ти: ${score} точки, ${ordinal(rank)} място. Води ${leader.username}.`,
      link,
      replace: true,
    });
  }
  return { id, rank, total: boardSize(id) };
}

export function challengeInfo(id: string, viewerId: number): ChallengeInfo | null {
  const challenge = getChallenge(id);
  if (!challenge) return null;
  const creator = challenge.creator_id
    ? one<UserRow>('SELECT * FROM users WHERE id = ?', challenge.creator_id)
    : undefined;
  const entry = (r: ResultRow, rank: number): ChallengeEntry => ({
    rank,
    user: toPublicUser(r),
    score: r.score,
    correct: r.correct,
    timeMs: r.time_ms,
    you: r.id === viewerId,
  });
  const entries = finished(id).map((r, i) => entry(r, i + 1));
  const mine = entries.some((e) => e.you) ? null : placeOf(id, viewerId);
  if (mine) entries.push(entry(mine, mine.rank));
  return {
    id,
    creator: creator ? toPublicUser(creator) : null,
    createdAt: challenge.created_at,
    expiresAt: challenge.expires_at,
    questions: MODES.challenge.questions,
    entries,
    total: boardSize(id),
    attempted: !!one('SELECT 1 AS x FROM challenge_results WHERE challenge_id = ? AND user_id = ?', id, viewerId),
    expired: challenge.expires_at < Date.now(),
  };
}

/** For a visitor who isn't signed in yet: who's challenging them, and the score to beat. */
export function challengePreview(id: string): ChallengePreview | null {
  const challenge = getChallenge(id);
  if (!challenge) return null;
  const creator = challenge.creator_id
    ? one<Pick<UserRow, 'username' | 'avatar' | 'frame'>>(
        'SELECT username, avatar, frame FROM users WHERE id = ?',
        challenge.creator_id,
      )
    : undefined;
  const top = one<{ score: number | null; players: number }>(
    `SELECT MAX(r.score) AS score, COUNT(*) AS players FROM challenge_results r JOIN users u ON u.id = r.user_id
     WHERE r.challenge_id = ? AND r.finished_at IS NOT NULL AND ${NOT_BANNED}`,
    id,
  )!;
  return {
    id,
    creator: creator ? { username: creator.username, avatar: creator.avatar, frame: creator.frame } : null,
    topScore: top.score,
    players: top.players,
    expired: challenge.expires_at < Date.now(),
  };
}

/** The links this player made in the last month, newest first. */
export function myChallenges(userId: number): MyChallenge[] {
  const rows = all<{ id: string; created_at: number; expires_at: number }>(
    'SELECT id, created_at, expires_at FROM challenges WHERE creator_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 20',
    userId,
    Date.now() - 30 * DAY,
  );
  return rows.map((c) => {
    const leader = finished(c.id, 1)[0];
    return {
      id: c.id,
      createdAt: c.created_at,
      expiresAt: c.expires_at,
      players: boardSize(c.id),
      myScore: placeOf(c.id, userId)?.score ?? null,
      leader: leader ? { username: leader.username, score: leader.score } : null,
    };
  });
}

/** Links expired over three months ago go, with their results. */
export function purgeOldChallenges(now = Date.now()) {
  return run('DELETE FROM challenges WHERE expires_at < ?', now - 90 * DAY).changes;
}
