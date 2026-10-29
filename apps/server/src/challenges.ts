import { randomBytes } from 'node:crypto';
import {
  type CategoryId,
  type ChallengeEntry,
  type ChallengeInfo,
  type ChallengePreview,
  type DuelEntry,
  type DuelRecord,
  type DuelStanding,
  type MatchRewards,
  MODES,
  type MyChallenge,
  ordinal,
} from '@quiz/shared';
import { config } from './config';
import { cutShortError } from './daily';
import { all, one, run } from './db';
import { notify, unreadAbout } from './notifications';
import { type PreparedQuestion, pickDuelSet, pickMatch, recentFor, reorderOptions, withoutAuthors } from './questions';
import { count } from './stats';
import { NOT_BANNED, toPublicUser, type UserRow } from './users';

/** How long a challenge link can be played. */
const CHALLENGE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
/**
 * A friend duel: a challenge for one friend, who has a day to play it. Not rated (they play it at different times);
 * a win pays as a 1-on-1 win does.
 */
export const DUEL = { hours: 24, winXp: 65, openPerPair: 3 } as const;

interface ChallengeRow {
  id: string;
  creator_id: number | null;
  questions: string;
  created_at: number;
  expires_at: number;
  /** A friend duel's friend. */
  rival_id: number | null;
}

type ResultRow = UserRow & { score: number; correct: number; time_ms: number };

const getChallenge = (id: string) => one<ChallengeRow>('SELECT * FROM challenges WHERE id = ?', id);

/** A new link with ten fresh questions for its creator (picked like any match: unseen first, a number final). */
export function createChallenge(creatorId: number): string {
  const id = randomBytes(6).toString('base64url');
  const questions = pickMatch(MODES.challenge.questions, 'mixed', recentFor([creatorId]), {
    final: MODES.challenge.final,
    formats: MODES.challenge.formats,
  });
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

/**
 * A friend duel: questions neither has seen lately, in rounds (on `categories`, when whoever lost the last one picked
 * them), for the creator to play now and the friend within DUEL.hours. The friend hears once the creator has played.
 */
export function createDuel(
  creatorId: number,
  rivalId: number,
  categories: CategoryId[] = [],
): { ok: true; id: string } | { ok: false; error: string } {
  const open = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM challenges c WHERE c.rival_id IS NOT NULL AND c.expires_at > ?
       AND ((c.creator_id = ? AND c.rival_id = ?) OR (c.creator_id = ? AND c.rival_id = ?))
       AND (SELECT COUNT(*) FROM challenge_results r WHERE r.challenge_id = c.id AND r.finished_at IS NOT NULL) < 2`,
    Date.now(),
    creatorId,
    rivalId,
    rivalId,
    creatorId,
  )!.n;
  if (open >= DUEL.openPerPair) return { ok: false, error: 'Имате достатъчно неизиграни дуели — първо ги довършете.' };
  if (categories.length && !mayPick(creatorId, rivalId)) {
    return { ok: false, error: 'Категориите избира загубилият последния ви дуел.' };
  }
  const questions = pickDuelSet(recentFor([creatorId, rivalId]), categories, Math.random, {
    formats: MODES.duel.formats,
  });
  if (!questions) return { ok: false, error: 'Няма достатъчно въпроси за тези категории.' };
  const id = randomBytes(6).toString('base64url');
  const now = Date.now();
  run(
    'INSERT INTO challenges (id, creator_id, rival_id, questions, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    creatorId,
    rivalId,
    JSON.stringify(withoutAuthors(questions)),
    now,
    now + DUEL.hours * 60 * 60_000,
  );
  count('duels');
  return { ok: true, id };
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
  if (challenge.rival_id !== null && userId !== challenge.rival_id && userId !== challenge.creator_id) {
    return { ok: false, error: 'Този дуел е между двама приятели.' };
  }
  if (challenge.expires_at < Date.now()) {
    return {
      ok: false,
      error: challenge.rival_id ? 'Времето за този дуел изтече.' : 'Това предизвикателство вече изтече.',
    };
  }
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
  if (userId !== challenge.creator_id) count('link_uses:challenge');
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

/**
 * Saves a finished run (also one cut short by leaving: it was the one attempt) and tells the creator — or, in a friend
 * duel, the friend: that it's their turn, or how it ended.
 */
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
  const challenge = getChallenge(id);
  if (challenge?.rival_id) return { id, rank: 0, total: 0, duel: duelPlayed(challenge, userId, score) };
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
          ? `${fresh} души изиграха линка ти, последен ${player.username}. Води ${leader.username} с ${leader.score} точки${creatorPlace > 1 ? ` — ти си на ${ordinal(creatorPlace)} място` : ''}.`
          : beaten
            ? `${player.username} те изпревари на линка ти: ${score} точки — вече си на ${ordinal(creatorPlace)} място.`
            : `${player.username} изигра предизвикателството ти: ${score} точки, ${ordinal(rank)} място. Води ${leader.username}.`,
      link,
      replace: true,
    });
  }
  return { id, rank, total: boardSize(id), duel: null };
}

// ─── Friend duels ─────────────────────────────────────────────────────────

interface DuelRun {
  score: number;
  correct: number;
  time_ms: number;
}

const finishedRun = (id: string, userId: number | null) =>
  userId === null
    ? undefined
    : one<DuelRun>(
        'SELECT score, correct, time_ms FROM challenge_results WHERE challenge_id = ? AND user_id = ? AND finished_at IS NOT NULL',
        id,
        userId,
      );

/** Who won, from one side: more points; on equal points the faster; else a draw. */
function outcomeOf(mine: DuelRun, theirs: DuelRun): 'won' | 'lost' | 'draw' {
  if (mine.score !== theirs.score) return mine.score > theirs.score ? 'won' : 'lost';
  if (mine.time_ms !== theirs.time_ms) return mine.time_ms < theirs.time_ms ? 'won' : 'lost';
  return 'draw';
}

/** Both friends' runs on each of their duels both played, newest first: [mine, theirs] from `userId`'s side. */
function playedDuels(userId: number, friendId: number) {
  return all<{ a_score: number; a_time: number; b_score: number; b_time: number }>(
    `SELECT a.score AS a_score, a.time_ms AS a_time, b.score AS b_score, b.time_ms AS b_time
     FROM challenges c
     JOIN challenge_results a ON a.challenge_id = c.id AND a.user_id = ? AND a.finished_at IS NOT NULL
     JOIN challenge_results b ON b.challenge_id = c.id AND b.user_id = ? AND b.finished_at IS NOT NULL
     WHERE c.rival_id IS NOT NULL AND ((c.creator_id = ? AND c.rival_id = ?) OR (c.creator_id = ? AND c.rival_id = ?))
     ORDER BY c.created_at DESC`,
    userId,
    friendId,
    userId,
    friendId,
    friendId,
    userId,
  ).map(
    (r) =>
      [
        { score: r.a_score, time_ms: r.a_time, correct: 0 },
        { score: r.b_score, time_ms: r.b_time, correct: 0 },
      ] as const,
  );
}

/** Two friends' duels both played, from `userId`'s side. */
export function duelRecord(userId: number, friendId: number): DuelRecord {
  const record = { wins: 0, losses: 0, draws: 0 };
  for (const [mine, theirs] of playedDuels(userId, friendId)) {
    const outcome = outcomeOf(mine, theirs);
    if (outcome === 'won') record.wins++;
    else if (outcome === 'lost') record.losses++;
    else record.draws++;
  }
  return record;
}

/** Lost the last duel the two played: picks the next one's categories. */
function mayPick(userId: number, friendId: number): boolean {
  const [last] = playedDuels(userId, friendId);
  return !!last && outcomeOf(last[0], last[1]) === 'lost';
}

const runView = (r: DuelRun | undefined) => (r ? { score: r.score, correct: r.correct, timeMs: r.time_ms } : null);

/** A friend duel as one of its two sees it; null for anyone else (or when the other's account is gone). */
function standingFor(c: ChallengeRow, viewerId: number, now = Date.now()): DuelStanding | null {
  const friendId = viewerId === c.creator_id ? c.rival_id : viewerId === c.rival_id ? c.creator_id : null;
  const friend = friendId === null ? undefined : one<UserRow>('SELECT * FROM users WHERE id = ?', friendId);
  if (!friend) return null;
  const mine = finishedRun(c.id, viewerId);
  const theirs = finishedRun(c.id, friend.id);
  return {
    friend: toPublicUser(friend),
    mine: runView(mine),
    theirs: runView(theirs),
    outcome: mine && theirs ? outcomeOf(mine, theirs) : null,
    record: duelRecord(viewerId, friend.id),
    expiresAt: c.expires_at,
    expired: c.expires_at < now,
    canPick: mayPick(viewerId, friend.id),
  };
}

const NOTE_OUTCOME = { won: 'печелиш', lost: 'губиш', draw: 'равенство' } as const;

/**
 * One of a duel's two has played it. First: the friend hears it's their turn (with the score to beat). Second: the one
 * who played first hears how it ended, and gets the win's XP if it's theirs (the second gets it with their results).
 */
function duelPlayed(c: ChallengeRow, userId: number, score: number): DuelStanding | null {
  const standing = standingFor(c, userId);
  const me = one<{ username: string }>('SELECT username FROM users WHERE id = ?', userId);
  if (!standing || !me) return standing;
  const link = `/c/${c.id}`;
  const friendId = standing.friend.id;
  if (!standing.theirs) {
    notify(friendId, {
      icon: '⚔️',
      text: `${me.username} те предизвика на дуел: ${score} точки за биене. Имаш ${DUEL.hours} часа да го изиграеш.`,
      link,
      replace: true,
    });
  } else {
    const theirs = standing.outcome === 'won' ? 'lost' : standing.outcome === 'lost' ? 'won' : 'draw';
    if (theirs === 'won') run('UPDATE users SET xp = xp + ? WHERE id = ?', DUEL.winXp, friendId);
    notify(friendId, {
      icon: theirs === 'won' ? '🏆' : theirs === 'lost' ? '⚔️' : '🤝',
      text: `${me.username} изигра дуела ви: ${standing.theirs.score} на ${score} — ${NOTE_OUTCOME[theirs]}${
        theirs === 'won' ? ` (+${DUEL.winXp} XP)` : ''
      }.`,
      link,
      replace: true,
    });
  }
  return standing;
}

/** Who a friend duel is against, for its start screen: their name, and their score if they've played it. */
export function duelOpponent(id: string, userId: number): { username: string; score: number | null } | null {
  const c = getChallenge(id);
  if (!c?.rival_id) return null;
  const friendId = userId === c.creator_id ? c.rival_id : c.creator_id;
  const friend =
    friendId === null ? undefined : one<{ username: string }>('SELECT username FROM users WHERE id = ?', friendId);
  return friend ? { username: friend.username, score: finishedRun(id, friendId)?.score ?? null } : null;
}

/** This player's friend duels: the open ones, and the ones of the last week, newest first. */
export function myDuels(userId: number, now = Date.now()): DuelEntry[] {
  const rows = all<ChallengeRow>(
    `SELECT * FROM challenges WHERE rival_id IS NOT NULL AND (creator_id = ? OR rival_id = ?) AND created_at > ?
     ORDER BY created_at DESC LIMIT 20`,
    userId,
    userId,
    now - 7 * DAY,
  );
  return rows.flatMap((c) => {
    const standing = standingFor(c, userId, now);
    if (!standing) return [];
    const state: DuelEntry['state'] = standing.outcome
      ? 'done'
      : standing.expired
        ? 'expired'
        : standing.mine
          ? 'theirs'
          : 'yours';
    return [{ ...standing, id: c.id, createdAt: c.created_at, state }];
  });
}

/** Duels that ran out unplayed: whoever played theirs hears so (once). Returns how many ran out. */
export function tellExpiredDuels(now = Date.now()): number {
  const rows = all<ChallengeRow>(
    'SELECT * FROM challenges WHERE rival_id IS NOT NULL AND expired_told = 0 AND expires_at < ?',
    now,
  );
  for (const c of rows) {
    const rival = one<{ username: string }>('SELECT username FROM users WHERE id = ?', c.rival_id);
    if (c.creator_id && rival && finishedRun(c.id, c.creator_id) && !finishedRun(c.id, c.rival_id)) {
      notify(c.creator_id, { icon: '⌛', text: `${rival.username} не изигра дуела ви навреме.`, link: `/c/${c.id}` });
    }
    run('UPDATE challenges SET expired_told = 1 WHERE id = ?', c.id);
  }
  return rows.length;
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
    duelOnly: challenge.rival_id !== null,
    duel: challenge.rival_id ? withCreator(standingFor(challenge, viewerId), challenge.creator_id) : null,
  };
}

const withCreator = (standing: DuelStanding | null, creatorId: number | null) => standing && { ...standing, creatorId };

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
    `SELECT id, created_at, expires_at FROM challenges WHERE creator_id = ? AND rival_id IS NULL AND created_at > ?
     ORDER BY created_at DESC LIMIT 20`,
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
