-- No pencil as a promise (the Fable review, 20 Nov 2026: DECISIONS.md „The direction“): every fact a player meets is
-- in their book, in ink if they got it right in the day's issue at their first meeting with it, else in grey, as met
-- (any answer, right or not, or let run out, anywhere else; a miss in the issue). The books are written again from the
-- answers by that rule (play.factsRule, for every player at once).
DELETE FROM facts;

INSERT INTO facts (user_id, question_id, ink, at, run_id)
WITH met AS (
    SELECT r.user_id, a.question_id, min(a.at) AS at FROM answers a JOIN runs r ON r.id = a.run_id
    GROUP BY r.user_id, a.question_id),
  meets AS (
    SELECT r.user_id, a.question_id, a.at, a.run_id, a.is_right AND r.kind = 'day' AND NOT r.pencil AND a.at = m.at AS ink
    FROM answers a JOIN runs r ON r.id = a.run_id
      JOIN met m ON m.user_id = r.user_id AND m.question_id = a.question_id
    WHERE r.shadow <> 1 AND NOT coalesce(json_extract(r.questions, '$[' || a.n || '].void'), 0)),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY user_id, question_id ORDER BY ink DESC, at, run_id) AS k FROM meets)
SELECT user_id, question_id, ink, at, run_id FROM ranked WHERE k = 1;
