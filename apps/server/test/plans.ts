// How SQLite runs every statement the tests ran: `npm test` (and the browser tests) write each statement the server
// prepares to a folder (SQL_LOG, see src/db.ts), and this asks SQLite for each one's query plan on the current schema.
// A statement that reads a whole table that grows with players (or makes SQLite build a throwaway index each time it
// runs) fails, unless it's listed below with the reason it's fine. At ten players a full scan is free; at a hundred
// thousand it's what makes every match on the server wait.
//
// `node --import tsx test/plans.ts [folder]` (default .sql-log); `npm test -w @quiz/server` runs it after the suite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const folder = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', '.sql-log'));

/** Tables that stay small however many people play, and why: a full read is a few thousand rows at most. */
const SMALL: Record<string, string> = {
  settings: 'a handful of keys',
  daily_sets: 'one row a day, a week kept',
  question_stats: 'one row per question in the bank',
  question_skill: 'one row per question in the bank',
  hidden_questions: 'questions moderators hid, out of the bank',
};

/**
 * Statements that read a whole table on purpose, each with why that's fine. Matched against the statement's text
 * (whitespace collapsed).
 */
const ALLOWED: { sql: RegExp; why: string }[] = [
  {
    sql: /^SELECT COUNT\(\*\) AS n FROM users$/,
    why: 'development only: whether this is the first account (it becomes an administrator)',
  },
  {
    sql: /^SELECT \(SELECT COUNT\(\*\) FROM users WHERE is_guest = 0\) AS accounts/,
    why: 'the moderators’ stats page',
  },
  { sql: /^SELECT \* FROM users WHERE username_key LIKE \? ESCAPE/, why: 'the moderators’ player search' },
  {
    sql: /^SELECT user_id, answered AS n, correct AS hits, last_at FROM answer_tallies/,
    why: 'the moderators’ flag list: a row per player',
  },
  {
    sql: /^SELECT q\.id, q\.category, .* FROM questions q LEFT JOIN users u/,
    why: 'loading the bank: every approved question from players is part of it',
  },
  {
    sql: /^SELECT DISTINCT json_extract\(q\.value, '\$\.image\.id'\) AS id FROM question_sets s, json_each/,
    why: 'once a day (sweepPictures): the pictures sets use, so the ones no set uses can go',
  },
  {
    sql: /^SELECT id FROM player_groups g WHERE created_at < \? AND NOT EXISTS/,
    why: 'once a week (settleGroupWeeks): every group gets its week settled',
  },
  {
    sql: /^SELECT user_id, question_id, difficulty, correct FROM answers ORDER BY answered_at, rowid$/,
    why: 'once: the skill model is seeded from the answers logged so far',
  },
  {
    sql: /^INSERT INTO (mode_stats|answer_tallies) \(.*\) SELECT .* GROUP BY (mp\.)?user_id(, m\.mode)?$/,
    why: 'after a crash or a rollback only: the running tallies counted again from the rows (catchUpTallies)',
  },
  { sql: /^DELETE FROM (mode_stats|answer_tallies)$/, why: 'with the line above' },
];

interface PlanRow {
  id: number;
  parent: number;
  detail: string;
}

const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.jsonl')) : [];
if (!files.length) {
  console.error(`No statements in ${folder}: run the tests with SQL_LOG=${folder} first.`);
  process.exit(1);
}
const statements = new Set<string>();
for (const f of files)
  for (const line of fs.readFileSync(path.join(folder, f), 'utf8').split('\n'))
    if (line) statements.add(JSON.parse(line));

// A fresh database with every migration, as a new server has.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-plans-'));
process.env.DB_PATH = path.join(dir, 'plans.db');
const { db } = await import('../src/db');
const names = (sql: string) => new Set((db.prepare(sql).all() as { name: string }[]).map((r) => r.name));
const tables = names("SELECT name FROM sqlite_master WHERE type = 'table'");
/** Indexes of some rows only (`… WHERE …`): reading one through is reading just the rows the query is about. */
const partial = names("SELECT name FROM sqlite_master WHERE type = 'index' AND sql LIKE '% WHERE %'");

const KEYWORDS = new Set(
  'where join left right inner cross outer natural on using order group limit set values select union except intersect window having returning indexed not'.split(
    ' ',
  ),
);

/** What each name in the plan stands for: SQLite reports a table by its alias when it has one. */
function aliases(sql: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const m of sql.matchAll(
    /\b(?:from|join|update|into)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi,
  )) {
    const table = m[1].toLowerCase();
    names.set(table, table);
    const alias = m[2]?.toLowerCase();
    if (alias && !KEYWORDS.has(alias)) names.set(alias, table);
  }
  return names;
}

const oneLine = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const problems: string[] = [];
const allowedUsed = new Set<RegExp>();
let explained = 0;

for (const sql of [...statements].sort()) {
  let plan: PlanRow[];
  try {
    plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as unknown as PlanRow[];
  } catch (err) {
    problems.push(`${oneLine(sql)}\n    doesn't prepare on the current schema: ${(err as Error).message}`);
    continue;
  }
  explained++;
  const tableOf = aliases(sql);
  // The first rows in an index's (or the table's) order, with nothing to skip: as many rows as the limit.
  const topRows = /\blimit\b/i.test(sql) && !/\bwhere\b/i.test(sql) && !plan.some((r) => /TEMP B-TREE/.test(r.detail));
  const found: string[] = [];
  for (const { detail } of plan) {
    if (/AUTOMATIC (PARTIAL )?(COVERING )?INDEX/.test(detail)) {
      found.push(`${detail} (SQLite builds an index for this query each time it runs)`);
      continue;
    }
    const scan = detail.match(/^SCAN (\S+)/);
    if (!scan) continue;
    const table = tableOf.get(scan[1].toLowerCase()) ?? scan[1].toLowerCase();
    if (!tables.has(table) || table in SMALL) continue; // a CTE or subquery (its own reads are listed), or small
    const index = detail.match(/USING (?:COVERING )?INDEX (\S+)/)?.[1];
    if (topRows || (index && partial.has(index))) continue;
    found.push(detail);
  }
  if (!found.length) continue;
  const line = oneLine(sql);
  const allowed = ALLOWED.find((a) => a.sql.test(line));
  if (allowed) {
    allowedUsed.add(allowed.sql);
    continue;
  }
  problems.push(`${line}\n    ${found.join('\n    ')}`);
}

db.close();
fs.rmSync(dir, { recursive: true, force: true });

// Not a failure: a run of part of the suite doesn't reach every statement.
for (const a of ALLOWED.filter((a) => !allowedUsed.has(a.sql)))
  console.warn(`Allowed, but not run here (or no longer reading the whole table): ${a.sql}`);

console.log(`${explained} statements explained, ${problems.length} problems`);
if (problems.length) {
  console.error(`\n${problems.join('\n\n')}`);
  process.exit(1);
}
