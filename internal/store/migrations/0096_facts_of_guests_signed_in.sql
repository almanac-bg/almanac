-- A guest who signed in mid-issue to an account that was there already wrote nothing for the rest of the issue (its
-- run a ShadowGuest, which play skipped as if a script's: review 2026-11-20). The facts those answers should have
-- written are written now, by the book's rule (play.factsRule, for every player at once), where the book has none yet.
INSERT OR IGNORE INTO facts (user_id, question_id, ink, at, run_id)
WITH met AS (
    SELECT r.user_id, a.question_id, min(a.at) AS at FROM answers a JOIN runs r ON r.id = a.run_id
    GROUP BY r.user_id, a.question_id),
  rights AS (
    SELECT r.user_id, a.question_id, a.at, a.run_id, r.kind = 'day' AND NOT r.pencil AND a.at = m.at AS ink
    FROM answers a JOIN runs r ON r.id = a.run_id
      JOIN met m ON m.user_id = r.user_id AND m.question_id = a.question_id
    WHERE a.is_right AND r.shadow <> 1 AND NOT coalesce(json_extract(r.questions, '$[' || a.n || '].void'), 0)),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY user_id, question_id ORDER BY ink DESC, at, run_id) AS k FROM rights)
SELECT user_id, question_id, ink, at, run_id FROM ranked WHERE k = 1;
