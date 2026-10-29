// A database with a long history, for the load test (`npm run load -w @quiz/server -- --seed 20000`): that many
// accounts, each with months of what play leaves behind — matches, the answer log, dailies, seasons, notifications,
// friends, the almanac, groups — as a server has after a year or two. A query that's instant on ten players can crawl
// through a million rows; the load test then plays on top of this. Written straight in with SQL (seconds, not hours);
// the running tallies are left for the server's first start to count (catchUpTallies), which the load test times.
//
// `node --import tsx test/seed.ts <database file> <players>` — also writes `<database file>.sessions.json`: signed-in
// cookies for a sample of the accounts, for requests as them.
import fs from 'node:fs';
import { CATEGORY_IDS, dayKey, shiftDay } from '@quiz/shared';

const [file, count] = process.argv.slice(2);
const players = Number(count);
if (!file || !(players > 0)) {
  console.error('Usage: node --import tsx test/seed.ts <database file> <players>');
  process.exit(1);
}
process.env.DB_PATH = file;
process.env.BACKUP_DIR = 'off';
const { db, run } = await import('../src/db');
const { createSession } = await import('../src/auth');

const DAY = 24 * 60 * 60_000;
const now = Date.now();
const today = dayKey(now);
/** Matches per account: about two a day for a few months, for the average player. */
const MATCHES_PER_PLAYER = 40;
const matches = players * MATCHES_PER_PLAYER;
/** The history reaches this far back; the answer log keeps its last 90 days. */
const SPAN_DAYS = 365;
const FIRST = 1_000;

// The test server's questions (helpers.ts → writeFixtureQuestions): 30 per category.
const questionIds = CATEGORY_IDS.flatMap((c) => Array.from({ length: 30 }, (_, i) => `${c}-${i}`));
db.exec('CREATE TEMP TABLE q (n INTEGER PRIMARY KEY, id TEXT, category TEXT, difficulty TEXT)');
for (const [n, id] of questionIds.entries()) {
  const i = Number(id.split('-').at(-1));
  run(
    'INSERT INTO q VALUES (?, ?, ?, ?)',
    n,
    id,
    id.slice(0, id.lastIndexOf('-')),
    i < 12 ? 'easy' : i < 24 ? 'medium' : 'hard',
  );
}
const Q = questionIds.length;

const started = performance.now();
const step = (what: string, sql: string, ...params: (number | string)[]) => {
  const t = performance.now();
  const { changes } = db.prepare(sql).run(...params);
  console.log(
    `${what}: ${Number(changes).toLocaleString('en')} rows (${((performance.now() - t) / 1000).toFixed(1)} s)`,
  );
};
/** 1…n, as rows. */
const upTo = (n: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})`;

db.exec('PRAGMA synchronous = OFF');
db.exec('BEGIN');
step(
  'accounts',
  `${upTo(players)}
   INSERT INTO users (id, username, username_key, username_shape, password_hash, created_at, xp, games_played, mp_games,
     wins, questions_answered, correct_answers, best_streak, total_correct_ms, daily_streak, best_daily_streak,
     last_daily_day, last_seen_at, title, share_runs)
   SELECT ${FIRST} + i, 'igrach' || i, 'igrach' || i, 'igrach' || i, 'x', ? - (i % ${SPAN_DAYS}) * ${DAY},
     abs(random()) % 150000, ${MATCHES_PER_PLAYER}, ${MATCHES_PER_PLAYER * 0.7}, abs(random()) % 20,
     ${MATCHES_PER_PLAYER * 10}, ${MATCHES_PER_PLAYER * 6}, abs(random()) % 15, 2500000, i % 9, i % 30,
     ?, ? - (i % 60) * ${DAY}, 'rookie', 1
   FROM n`,
  now,
  shiftDay(today, -1),
  now,
);
// A guest per ten accounts, who played once and stayed (guests nobody plays as again are cleared after a day).
step(
  'guests',
  `${upTo(Math.ceil(players / 10))}
   INSERT INTO users (id, username, username_key, username_shape, password_hash, created_at, is_guest, xp, games_played,
     last_seen_at)
   SELECT ${FIRST + players} + i, 'Гост' || (1000000 + i), 'гост' || (1000000 + i), 'гост' || (1000000 + i), 'x',
     ? - (i % 30) * ${DAY}, 1, 300, 1, ? - (i % 30) * ${DAY}
   FROM n`,
  now,
  now,
);
// Matches in the order they were played (a match's row and its players' rows go in as it ends).
step(
  'matches',
  `${upTo(matches)}
   INSERT INTO matches (id, mode, ranked, room_code, player_count, question_count, started_at, ended_at)
   SELECT 's' || i, CASE i % 5 WHEN 0 THEN 'solo' WHEN 1 THEN 'daily' WHEN 2 THEN 'royale' WHEN 3 THEN 'squad' ELSE 'duel' END,
     i % 5 > 1, NULL, CASE WHEN i % 5 < 2 THEN 1 WHEN i % 5 = 2 THEN 8 WHEN i % 5 = 3 THEN 4 ELSE 2 END, 10,
     ? - ${SPAN_DAYS * DAY} + i * ${Math.floor((SPAN_DAYS * DAY) / matches)} - 150000,
     ? - ${SPAN_DAYS * DAY} + i * ${Math.floor((SPAN_DAYS * DAY) / matches)}
   FROM n`,
  now,
  now,
);
// Each match: its player, and in the multiplayer ones another account and bots for the other seats.
step(
  'match players',
  `INSERT INTO match_players (match_id, player_id, user_id, name, avatar, is_bot, placement, score, correct, faced,
     best_streak, left_match, xp_gained, rating_delta, won)
   SELECT m.id, 'p' || s.seat, CASE WHEN s.seat = 0 THEN ${FIRST} + 1 + (m.rowid % ${players})
       WHEN s.seat = 1 THEN ${FIRST} + 1 + ((m.rowid * 7919) % ${players}) END,
     'igrach', '🙂', s.seat > 1, s.seat + 1, 9000 - s.seat * 800, 8 - s.seat, 10, 5, 0, 150,
     CASE WHEN m.ranked THEN 12.5 - s.seat * 10 END, s.seat = 0 AND m.player_count > 1
   FROM matches m JOIN (SELECT 0 AS seat UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
     UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7) s ON s.seat < m.player_count
   WHERE m.id LIKE 's%'`,
);
// Ten answers for each person in each match of the last 90 days: the answer log.
step(
  'answer log',
  `INSERT INTO answers (user_id, match_id, question_id, difficulty, correct, time_ms, answered_at)
   SELECT mp.user_id, mp.match_id, q.id, q.difficulty, (mp.rowid + k.i) % 10 < 6, 2000 + (mp.rowid * k.i) % 9000, m.ended_at
   FROM match_players mp JOIN matches m ON m.id = mp.match_id
   JOIN (SELECT 0 AS i UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
     UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) k
   JOIN q ON q.n = (mp.rowid * 13 + k.i * 31) % ${Q}
   WHERE mp.user_id IS NOT NULL AND m.ended_at > ?`,
  now - 90 * DAY,
);
step(
  'question totals',
  `INSERT INTO question_stats (question_id, answered, correct, correct_ms, pick0, pick1, pick2, pick3, unanswered)
   SELECT question_id, COUNT(*), SUM(correct), SUM(correct * time_ms), SUM(correct), COUNT(*) - SUM(correct), 0, 0, 0
   FROM answers GROUP BY question_id`,
);
step(
  'recent questions',
  `INSERT INTO seen_questions (user_id, question_id, seen_at)
   SELECT u.id, q.id, ? - q.n * 60000 FROM users u JOIN q ON (u.id + q.n) % 3 = 0 WHERE u.is_guest = 0`,
  now,
);
step(
  'dailies',
  `${upTo(60)}
   INSERT INTO daily_results (user_id, day, started_at, finished_at, score, correct, time_ms, revealed)
   SELECT u.id, date(?, '-' || n.i || ' days'), ? - n.i * ${DAY}, ? - n.i * ${DAY} + 120000, 5000 + (u.id * n.i) % 4000,
     (u.id + n.i) % 11, 60000, 10
   FROM users u JOIN n ON (u.id + n.i) % 2 = 0 WHERE u.is_guest = 0`,
  today,
  now,
  now,
);
step(
  'seasons',
  `INSERT INTO season_ratings (user_id, season, mode, rating, peak, games, wins)
   SELECT u.id, s.season, s.mode, 1000 + (u.id * 37) % 800, 1100 + (u.id * 37) % 800, 15 + u.id % 30, 8
   FROM users u JOIN (SELECT strftime('%Y-%m', 'now') AS season, 'duel' AS mode UNION ALL
     SELECT strftime('%Y-%m', 'now'), 'royale' UNION ALL SELECT strftime('%Y-%m', 'now', '-1 month'), 'duel' UNION ALL
     SELECT strftime('%Y-%m', 'now', '-2 months'), 'duel') s
   WHERE u.is_guest = 0`,
);
step(
  'category totals',
  `INSERT INTO category_stats (user_id, category, answered, correct, correct_ms)
   SELECT u.id, c.category, 40, 25, 100000 FROM users u JOIN (SELECT DISTINCT category FROM q) c WHERE u.is_guest = 0`,
);
step(
  'notifications',
  `${upTo(25)}
   INSERT INTO notifications (user_id, icon, text, link, created_at, read_at)
   SELECT u.id, '🏆', 'Нещо се случи с акаунта ти.', '/notifications', ? - n.i * ${DAY / 2}, CASE WHEN n.i > 2 THEN ? END
   FROM users u JOIN n WHERE u.is_guest = 0`,
  now,
  now,
);
step(
  'friends',
  `${upTo(4)}
   INSERT OR IGNORE INTO friendships (user_a, user_b, requested_by, status, created_at, accepted_at)
   SELECT MIN(u.id, f.v), MAX(u.id, f.v), u.id, 'accepted', ?, ?
   FROM users u JOIN (SELECT n.i, ${FIRST} + 1 + ((n.i * 104729) % ${players}) AS v FROM n) f
     ON f.v <> u.id AND (u.id + f.i) % 4 = 0
   WHERE u.is_guest = 0`,
  now,
  now,
);
step(
  'almanac',
  `INSERT INTO learned (user_id, question_id, learned_at)
   SELECT u.id, q.id, ? - q.n * 600000 FROM users u JOIN q ON (u.id * 7 + q.n) % 4 = 0 WHERE u.is_guest = 0`,
  now,
);
step(
  'achievements',
  `INSERT INTO user_achievements (user_id, achievement_id, unlocked_at)
   SELECT u.id, a.id, ? FROM users u JOIN (SELECT 'first_win' AS id UNION ALL SELECT 'level_10' UNION ALL
     SELECT 'duelist') a WHERE u.is_guest = 0`,
  now,
);
step(
  'groups',
  `${upTo(Math.ceil(players / 20))}
   INSERT INTO player_groups (id, name, code, owner_id, created_at)
   SELECT i, 'Група ' || i, 'g' || i, ${FIRST} + i, ? - 60 * ${DAY} FROM n`,
  now,
);
step(
  'group members',
  `INSERT INTO group_members (group_id, user_id, joined_at)
   SELECT 1 + (u.id % ${Math.ceil(players / 20)}), u.id, ? FROM users u WHERE u.is_guest = 0`,
  now,
);
// A server with this much history seeded its skill model long ago (from the answers of its first days).
run("INSERT INTO settings (key, value) VALUES ('skill_seeded', '1')");
db.exec('COMMIT');

const sample = Array.from({ length: Math.min(200, players) }, (_, i) => FIRST + 1 + Math.floor((i * players) / 200));
const sessions = sample.map((id) => ({ id, username: `igrach${id - FIRST}`, token: createSession(id) }));
fs.writeFileSync(`${file}.sessions.json`, JSON.stringify(sessions));
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();
const mb = Math.round(fs.statSync(file).size / 1024 / 1024);
console.log(
  `Seeded ${players.toLocaleString('en')} players in ${((performance.now() - started) / 1000).toFixed(0)} s: ${mb} MB`,
);
