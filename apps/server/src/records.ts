import {
  dayEndsAt,
  dayKey,
  type GamePlayer,
  levelFromXp,
  MODES,
  START_RATING,
  shiftDay,
  sofiaHour,
} from '@quiz/shared';
import { all, one, run, tx } from './db';
import type { RecordScript } from './game/Game';
import { notify } from './notifications';
import {
  numberBank,
  type PlayableQuestion,
  type PreparedQuestion,
  questionBank,
  type Rng,
  type RoundPlan,
  recentFor,
  shuffle,
} from './questions';
import type { RunAnswer } from './runs';
import { getRating } from './seasons';
import { SKILL, skillCentre } from './skill';
import { NOT_BANNED } from './users';

/**
 * A real player's match, played back: when nobody joins a Дуел in time, the opponent is a recording of a match someone
 * of about the same skill played, rather than a bot. It answers what and when its owner did; the player's rating moves
 * against it as against a bot (its owner's doesn't), and its owner hears the next day how it did.
 */
export const RECORDS = {
  /** A recording older than this no longer stands for its owner. */
  maxAgeDays: 180,
  /** How far its owner's skill may be from the player's. */
  skillBand: 100,
  /** Its questions the player may have seen already (and might remember the answers to). */
  maxSeen: 2,
  /** The newest this many recordings are looked through. */
  candidates: 400,
  /** The owner's XP for each of its wins, and at most this much a day. */
  xpPerWin: 10,
  xpPerDay: 50,
  /** The owners hear about the day before from this hour, Sofia time. */
  tellFromHour: 9,
};

/**
 * The runs that make a Дуел's opponent: ten mixed questions ending on a final, played as a Дуел is (a Дуел, the day's
 * questions, a challenge link). A Дуел first: it was played in rounds.
 */
const SOURCES = ['duel', 'daily', 'challenge'] as const;

export interface RecordPick {
  runId: number;
  ownerId: number;
  player: GamePlayer;
  script: RecordScript;
  questions: PreparedQuestion[];
  rounds: RoundPlan[];
}

interface Candidate {
  id: number;
  user_id: number;
  mode: string;
  rating: number | null;
  answers: string;
  played_at: number;
  username: string;
  avatar: string;
  frame: string;
  title: string;
  xp: number;
  skill: number | null;
  skill_answers: number | null;
}

/**
 * A recording for this player to play a Дуел against, or null when none fits: its owner's skill within
 * RECORDS.skillBand of theirs, at most RECORDS.maxSeen of its questions seen, not their own, its owner neither a guest
 * nor banned nor opted out, every question still in play.
 */
export function pickRecord(userId: number, rating: number | null, rng: Rng = Math.random): RecordPick | null {
  const centre = skillCentre(userId, rating);
  const rows = all<Candidate>(
    `SELECT r.id, r.user_id, r.mode, r.rating, r.answers, r.played_at, u.username, u.avatar, u.frame, u.title, u.xp,
       s.rating AS skill, s.answers AS skill_answers
     FROM runs r JOIN users u ON u.id = r.user_id
     LEFT JOIN player_skill s ON s.user_id = r.user_id AND s.category = 'all'
     WHERE r.mode IN (${SOURCES.map(() => '?').join(', ')}) AND r.category = 'mixed' AND r.played_at > ?
       AND r.user_id <> ? AND u.is_guest = 0 AND u.share_runs = 1 AND ${NOT_BANNED}
     ORDER BY r.played_at DESC LIMIT ?`,
    ...SOURCES,
    Date.now() - RECORDS.maxAgeDays * 24 * 60 * 60_000,
    userId,
    RECORDS.candidates,
  );
  const near = rows.filter((r) => {
    const skill = (r.skill_answers ?? 0) >= SKILL.reliableAfter ? r.skill! : (r.rating ?? START_RATING);
    return Math.abs(skill - centre) <= RECORDS.skillBand;
  });
  if (!near.length) return null;
  const seen = recentFor([userId]);
  const playable = new Map<string, PlayableQuestion>([...questionBank(), ...numberBank()].map((q) => [q.id, q]));
  const ordered = shuffle(near, rng).sort((a, b) => Number(b.mode === 'duel') - Number(a.mode === 'duel'));
  for (const r of ordered) {
    const pick = fromRun(r, playable, seen, rng);
    if (pick) return pick;
  }
  return null;
}

/** The match a run makes, in an option order of its own, with its answers to match; null if it can't be played now. */
function fromRun(
  r: Candidate,
  playable: Map<string, PlayableQuestion>,
  seen: ReadonlyMap<string, number>,
  rng: Rng,
): RecordPick | null {
  const answers = (JSON.parse(r.answers) as RunAnswer[]).sort((a, b) => a.i - b.i);
  if (answers.length !== MODES.duel.questions || answers.some((a, i) => a.i !== i)) return null;
  if (answers.filter((a) => seen.has(a.q)).length > RECORDS.maxSeen) return null;
  const questions: PreparedQuestion[] = [];
  const script: RecordScript = [];
  for (const a of answers) {
    // Hidden or gone since it was played.
    const q = playable.get(a.q);
    if (!q) return null;
    const answered = a.t !== null;
    if (q.kind === 'number') {
      if (answered && typeof a.g !== 'number') return null;
      questions.push(q);
      script.push(answered ? { value: a.g!, timeMs: a.t!, powerup: a.k, retried: false } : null);
      continue;
    }
    // Changed since: the pick (as the bank orders the options) no longer means what it meant.
    if (answered && (a.c === null || !q.options[a.c] || (a.ok === 1) !== (a.c === q.answer))) return null;
    const order = shuffle([0, 1, 2, 3], rng);
    questions.push({ ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) });
    script.push(answered ? { choice: order.indexOf(a.c!), timeMs: a.t!, powerup: a.k, retried: a.r === 1 } : null);
  }
  return {
    runId: r.id,
    ownerId: r.user_id,
    player: {
      id: `r${r.id}`,
      userId: null,
      name: r.username,
      level: levelFromXp(r.xp),
      isBot: false,
      isGuest: false,
      rating: Math.round(r.rating ?? getRating(r.user_id, 'duel')),
      avatar: r.avatar,
      frame: r.frame,
      title: r.title,
      team: null,
      record: { playedAt: r.played_at },
    },
    script,
    questions,
    rounds: r.mode === 'duel' ? roundsOf(questions) : [],
  };
}

/** A Дуел's rounds as they were played (each its category, picked then): none to pick now. */
function roundsOf(questions: PreparedQuestion[]): RoundPlan[] {
  const rounds: RoundPlan[] = [];
  for (let from = 0; from + 3 < questions.length; from += 3) {
    const category = questions[from].category;
    if (questions.slice(from, from + 3).some((q) => q.category !== category)) return [];
    rounds.push({ from, size: 3, category, offers: [] });
  }
  return rounds;
}

/** A match against a recording was played out: its owner hears about it the next day. */
export function noteRecordPlay(runId: number, ownerId: number, playerId: number, recordWon: boolean, at = Date.now()) {
  run(
    'INSERT INTO record_plays (run_id, owner_id, player_id, record_won, played_at) VALUES (?, ?, ?, ?, ?)',
    runId,
    ownerId,
    playerId,
    recordWon ? 1 : 0,
    at,
  );
}

const duels = (n: number) => (n === 1 ? '1 дуел' : `${n} дуела`);
const wins = (n: number) => (n === 1 ? '1 победа' : `${n} победи`);

/**
 * Once a day, from RECORDS.tellFromHour: each owner whose recordings were played the day before (or earlier, if the
 * server was down then) hears how they did, with XP for their wins. Returns how many owners were told.
 */
export function tellRecordOwners(now = Date.now()): number {
  const today = dayKey(now);
  if (sofiaHour(now) < RECORDS.tellFromHour) return 0;
  if (one("SELECT 1 AS x FROM settings WHERE key = 'records_told' AND value = ?", today)) return 0;
  const before = dayEndsAt(shiftDay(today, -1));
  const owners = all<{ owner_id: number; games: number; won: number }>(
    `SELECT owner_id, COUNT(*) AS games, SUM(record_won) AS won FROM record_plays
     WHERE told = 0 AND played_at < ? GROUP BY owner_id`,
    before,
  );
  tx(() => {
    for (const o of owners) {
      const xp = Math.min(o.won * RECORDS.xpPerWin, RECORDS.xpPerDay);
      if (xp > 0) run('UPDATE users SET xp = xp + ? WHERE id = ?', xp, o.owner_id);
      notify(o.owner_id, {
        icon: '📼',
        text: `Записите на мачовете ти изиграха ${duels(o.games)} вчера: ${o.won ? `${wins(o.won)}, +${xp} XP` : 'без победа този път'}.`,
        link: '/settings',
      });
    }
    run('UPDATE record_plays SET told = 1 WHERE told = 0 AND played_at < ?', before);
    run(
      "INSERT INTO settings (key, value) VALUES ('records_told', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      today,
    );
  });
  return owners.length;
}

/** A month after the note: nothing more to tell from them. */
export function pruneRecordPlays(now = Date.now()) {
  run('DELETE FROM record_plays WHERE told = 1 AND played_at < ?', now - 30 * 24 * 60 * 60_000);
}
