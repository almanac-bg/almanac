import { randomBytes } from 'node:crypto';
import { type ChallengeEntry, type ChallengeInfo, type ChallengePreview, type MatchRewards, MODES, type MyChallenge, ordinal } from '@quiz/shared';
import { config } from './config';
import { all, one, run } from './db';
import { notifyUser } from './notify';
import { pickQuestions, type PreparedQuestion, recentFor, reorderOptions } from './questions';
import { toPublicUser, type UserRow } from './users';

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
    JSON.stringify(questions),
    now,
    now + CHALLENGE_DAYS * DAY,
  );
  return id;
}

/** The link's questions in this player's own option order. */
export function challengeQuestions(id: string, userId: number): PreparedQuestion[] {
  return reorderOptions(JSON.parse(getChallenge(id)!.questions), `challenge:${id}:${userId}`);
}

/** One attempt per player and link — except one a server restart cut short. */
export function claimChallengeAttempt(id: string, userId: number): { ok: true } | { ok: false; error: string } {
  const challenge = getChallenge(id);
  if (!challenge) return { ok: false, error: 'Няма такова предизвикателство.' };
  if (challenge.expires_at < Date.now()) return { ok: false, error: 'Това предизвикателство вече изтече.' };
  const mine = one<{ started_at: number; finished_at: number | null }>(
    'SELECT started_at, finished_at FROM challenge_results WHERE challenge_id = ? AND user_id = ?',
    id,
    userId,
  );
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
  return { ok: true };
}

function finished(id: string): ResultRow[] {
  return all<ResultRow>(
    `SELECT u.*, r.score, r.correct, r.time_ms FROM challenge_results r JOIN users u ON u.id = r.user_id
     WHERE r.challenge_id = ? AND r.finished_at IS NOT NULL ORDER BY r.score DESC, r.time_ms ASC, r.finished_at ASC`,
    id,
  );
}

/** Saves a finished run (also one cut short by leaving: it was the one attempt) and tells the creator. */
export function recordChallengeResult(id: string, userId: number, score: number, correct: number, timeMs: number): NonNullable<MatchRewards['challenge']> {
  run(
    'UPDATE challenge_results SET finished_at = ?, score = ?, correct = ?, time_ms = ? WHERE challenge_id = ? AND user_id = ?',
    Date.now(),
    score,
    correct,
    timeMs,
    id,
    userId,
  );
  const results = finished(id);
  const rank = results.findIndex((r) => r.id === userId) + 1;
  const creator = getChallenge(id)?.creator_id;
  const player = results[rank - 1];
  if (creator && creator !== userId && player) {
    notifyUser(creator, 'notice', {
      kind: 'info',
      message: `${player.username} изигра предизвикателството ти: ${score} точки, ${ordinal(rank)} място.`,
    });
  }
  return { id, rank, total: results.length };
}

export function challengeInfo(id: string, viewerId: number): ChallengeInfo | null {
  const challenge = getChallenge(id);
  if (!challenge) return null;
  const creator = challenge.creator_id ? one<UserRow>('SELECT * FROM users WHERE id = ?', challenge.creator_id) : undefined;
  const entries: ChallengeEntry[] = finished(id).map((r, i) => ({
    rank: i + 1,
    user: toPublicUser(r),
    score: r.score,
    correct: r.correct,
    timeMs: r.time_ms,
    you: r.id === viewerId,
  }));
  return {
    id,
    creator: creator ? toPublicUser(creator) : null,
    createdAt: challenge.created_at,
    expiresAt: challenge.expires_at,
    questions: MODES.challenge.questions,
    entries,
    attempted: !!one('SELECT 1 AS x FROM challenge_results WHERE challenge_id = ? AND user_id = ?', id, viewerId),
    expired: challenge.expires_at < Date.now(),
  };
}

/** For a visitor who isn't signed in yet: who's challenging them, and the score to beat. */
export function challengePreview(id: string): ChallengePreview | null {
  const challenge = getChallenge(id);
  if (!challenge) return null;
  const creator = challenge.creator_id
    ? one<Pick<UserRow, 'username' | 'avatar' | 'frame'>>('SELECT username, avatar, frame FROM users WHERE id = ?', challenge.creator_id)
    : undefined;
  const top = one<{ score: number | null; players: number }>(
    'SELECT MAX(score) AS score, COUNT(*) AS players FROM challenge_results WHERE challenge_id = ? AND finished_at IS NOT NULL',
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
    const results = finished(c.id);
    const mine = results.find((r) => r.id === userId);
    return {
      id: c.id,
      createdAt: c.created_at,
      expiresAt: c.expires_at,
      players: results.length,
      myScore: mine?.score ?? null,
      leader: results[0] ? { username: results[0].username, score: results[0].score } : null,
    };
  });
}

/** Links expired over three months ago go, with their results. */
export function purgeOldChallenges(now = Date.now()) {
  return run('DELETE FROM challenges WHERE expires_at < ?', now - 90 * DAY).changes;
}
