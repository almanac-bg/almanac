import { type CategoryId, type Difficulty, type PowerupId, START_RATING } from '@quiz/shared';
import { all, one, run, tx } from './db';
import type { AnswerLogEntry } from './game/Game';
import { questionById } from './questions';

/**
 * How hard each question really is and how strong each player is, on one scale (like chess ratings). A player of
 * skill θ meeting a question rated b is expected to get it right with E = 1 / (1 + 10^((b − θ) / 400)); each answer
 * moves both by how surprising it was. A question strong players miss climbs; a player who gets hard questions right
 * climbs. Skill is kept overall and per category. Players never see these numbers: they're for choosing bots,
 * opponents, questions and difficulty labels.
 */
export const SKILL = {
  start: 1000,
  /** Where a question starts, by its label, until answers say otherwise. */
  questionStart: { easy: 800, medium: 1000, hard: 1200 } satisfies Record<Difficulty, number>,
  /** How far one answer moves a player's skill: a lot while there's little to go on, less once it has settled. */
  player: { k: 32, settled: 16, after: 200 },
  /** And a question's rating: it has answers from many players, so it settles sooner and moves less. */
  question: { k: 16, settled: 4, after: 100 },
  /** Answers a player's skill needs before bots are sized by it (three matches or so). */
  reliableAfter: 30,
};

/** The chance that a player of skill `skill` gets a question rated `rating` right. */
export const expectedRight = (skill: number, rating: number) => 1 / (1 + 10 ** ((rating - skill) / 400));

const kFor = (k: { k: number; settled: number; after: number }, answers: number) =>
  answers < k.after ? k.k : k.settled;

/** Козове that make an answer easier (two options gone, a second try): such an answer says little about who knew. */
const HELPED: ReadonlySet<PowerupId> = new Set(['fifty', 'retry']);

/** A player's skill, overall (`all`) or in a category; the start for one with no answers yet. */
export function playerSkill(userId: number, category: CategoryId | 'all' = 'all') {
  return (
    one<{ rating: number; answers: number }>(
      'SELECT rating, answers FROM player_skill WHERE user_id = ? AND category = ?',
      userId,
      category,
    ) ?? { rating: SKILL.start, answers: 0 }
  );
}

/**
 * What bots are centred on for this player (bots.ts): their measured skill once there's enough of it, else the rating
 * they show (a newcomer's first few matches).
 */
export function skillCentre(userId: number, rating: number | null): number {
  const skill = playerSkill(userId);
  return skill.answers >= SKILL.reliableAfter ? skill.rating : (rating ?? START_RATING);
}

/** A question's rating; its label's start for one nobody has answered yet. */
export function questionRating(questionId: string, difficulty: Difficulty) {
  return (
    one<{ rating: number; answers: number }>(
      'SELECT rating, answers FROM question_skill WHERE question_id = ?',
      questionId,
    ) ?? { rating: SKILL.questionStart[difficulty], answers: 0 }
  );
}

function savePlayer(userId: number, category: CategoryId | 'all', rating: number) {
  run(
    `INSERT INTO player_skill (user_id, category, rating, answers) VALUES (?, ?, ?, 1)
     ON CONFLICT (user_id, category) DO UPDATE SET rating = excluded.rating, answers = answers + 1`,
    userId,
    category,
    rating,
  );
}

/**
 * One answer: the question's rating and the player's skill (overall and in its category) move. A number counts by how
 * close it was (`closeness`, 0–1), not just right or wrong.
 */
function rate(
  userId: number,
  a: { questionId: string; difficulty: Difficulty; category: CategoryId; correct: boolean; closeness?: number | null },
) {
  const question = questionRating(a.questionId, a.difficulty);
  const overall = playerSkill(userId);
  const own = playerSkill(userId, a.category);
  const right = a.closeness ?? (a.correct ? 1 : 0);
  const surprise = right - expectedRight(overall.rating, question.rating);
  run(
    `INSERT INTO question_skill (question_id, rating, answers) VALUES (?, ?, 1)
     ON CONFLICT (question_id) DO UPDATE SET rating = excluded.rating, answers = answers + 1`,
    a.questionId,
    question.rating - kFor(SKILL.question, question.answers) * surprise,
  );
  savePlayer(userId, 'all', overall.rating + kFor(SKILL.player, overall.answers) * surprise);
  savePlayer(
    userId,
    a.category,
    own.rating + kFor(SKILL.player, own.answers) * (right - expectedRight(own.rating, question.rating)),
  );
}

/** Moves skill and ratings by a person's answers in one match. Call inside the match's transaction. */
export function recordSkill(userId: number, log: AnswerLogEntry[]) {
  for (const a of log) if (!a.powerup || !HELPED.has(a.powerup)) rate(userId, a);
}

/**
 * The first start with these tables: they're filled from the answers logged so far (the last ANSWER_LOG_DAYS), in the
 * order they were given. That log doesn't say which коз was played, so every answer counts.
 */
export function seedSkillOnce() {
  if (one("SELECT 1 AS x FROM settings WHERE key = 'skill_seeded'")) return;
  const answers = all<{ user_id: number; question_id: string; difficulty: Difficulty; correct: number }>(
    'SELECT user_id, question_id, difficulty, correct FROM answers ORDER BY answered_at, rowid',
  );
  tx(() => {
    for (const a of answers) {
      const category = questionById(a.question_id)?.category;
      if (category)
        rate(a.user_id, { questionId: a.question_id, difficulty: a.difficulty, category, correct: a.correct === 1 });
    }
    run("INSERT INTO settings (key, value) VALUES ('skill_seeded', ?)", String(Date.now()));
  });
  if (answers.length) console.log(`🎚️  Skill and question ratings seeded from ${answers.length} logged answers`);
}
