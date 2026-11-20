package play

import (
	"context"
	"database/sql"
	"strconv"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Ink and grey (DECISIONS.md, „The direction“, as the Fable review amended it): every question a player meets puts its
// fact in their Алманах once, and how says where. A right answer in the day's issue, the first time the player meets
// that question, writes it in ink („мастило“, the one word for it): the one mark of the day's ten, the same that
// counts in its score. Every other fact met is in the book in grey, as met: a miss in the issue, any answer (right or
// not, or let run out) in a chapter's game, a duel, a recording, and a right answer in the issue to a question met
// before. Grey is never counted and never turns to ink: nothing is ink twice, and nothing played before is ink at
// all. A game played at a script's speed (ShadowScript, fair.go) writes nothing. The other shadows are a person's own
// game (fair.go: their own numbers are theirs): a guest's day brought to an account (ShadowGuest) is written by the
// same rule, and a throwaway guest's day (ShadowThrowaway) is the guest's own book. A question that counts for nobody
// in its day (Pick.Void, day.go) writes nothing, and what it wrote goes when it's voided. The issue played a second
// time in one browser (runs.pencil: SecondPlay, the day's answers in sight there) writes grey. A fact is written once.
//
// The book keeps what was written (facts: the player, the question, ink or not, when, and the game), so that a
// chapter's ink is a count, never a walk over every answer. It's written as each answer is kept (record: writeFact),
// and by the whole rule at once (factsRule) where a player's history changes under it: a game found to be a script's
// mid-way (fair.go: its answers so far go), and a guest's games brought to an account (merge.go). The rule and the
// writing as answers come are one rule: TestFactsAsTheRule plays them against each other.
//
// What the book shows of a fact is the bank's: a question whose fact turned out untrue (bank.Tail.Untrue) shows
// nowhere, and one without a fact has nothing to show; neither counts in a chapter's ink. A chapter shows one number,
// its ink („180 с мастило“): grey is listed, never counted, and nothing is out of anything (no denominator).

// shadowWrites is, in SQL over runs r, whether a run's answers write the book: any but a script's game.
var shadowWrites = `r.shadow <> ` + strconv.Itoa(ShadowScript)

// factsRule writes a player's book (?1) from their answers by the rule above, the whole of it: the first time they met
// each question (any answer, any game), and of their answers that write, for each question the one that's ink if any
// is (right, in a day's issue, at that first meeting), else the first.
var factsRule = `WITH met AS (
		SELECT a.question_id, min(a.at) AS at FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ?1 GROUP BY a.question_id),
	meets AS (
		SELECT a.question_id, a.at, a.run_id, a.is_right AND r.kind = 'day' AND NOT r.pencil AND a.at = m.at AS ink
		FROM answers a JOIN runs r ON r.id = a.run_id JOIN met m ON m.question_id = a.question_id
		WHERE r.user_id = ?1 AND ` + shadowWrites + ` AND NOT ` + voidAt + `),
	ranked AS (
		SELECT *, row_number() OVER (PARTITION BY question_id ORDER BY ink DESC, at, run_id) AS k FROM meets)
	INSERT INTO facts (user_id, question_id, ink, at, run_id)
	SELECT ?1, question_id, ink, at, run_id FROM ranked WHERE k = 1`

// rewriteBook writes a player's book again from their answers (rewriteFacts) and counts their ranks again from it
// (countRanksIn), on the day it's done: a rank never falls, and one risen by it is told with the next news, as any
// is. Whatever writes a book again does it so, so that a chapter's seal is never behind its ink („15 с мастило ·
// Страница“).
func rewriteBook(ctx context.Context, tx *sql.Tx, b *bank.Bank, userID int64, day string) error {
	if err := rewriteFacts(tx, userID); err != nil {
		return err
	}
	return countRanksIn(ctx, tx, tx, b, userID, day, false)
}

// rewriteFacts writes a player's book again from their answers, by the whole rule (factsRule); rewriteBook counts
// their ranks again after it.
func rewriteFacts(tx *sql.Tx, userID int64) error {
	if _, err := tx.Exec(`DELETE FROM facts WHERE user_id = ?`, userID); err != nil {
		return err
	}
	_, err := tx.Exec(factsRule, userID)
	return err
}

// writeFact writes the fact of the question a run stands at (r.at), just answered (right or not, or let run out), at a
// moment (ms): in ink if it's right, in the day's issue, and the player's first meeting with it, else in grey; nothing
// if the book has it already (written once), the run is a script's (shadowWrites), or the question counts for nobody.
// It says whether it wrote the fact in ink (Result.Ink: the run says so).
func (g *Game) writeFact(tx *sql.Tx, r *run, at int64, right bool) (bool, error) {
	p := r.picks[r.at]
	if r.shadow == ShadowScript || p.Void {
		return false, nil
	}
	ink := false
	if right && r.kind == "day" && !r.pencil {
		met, err := metBefore(tx, r, p.ID)
		if err != nil {
			return false, err
		}
		ink = !met
	}
	res, err := tx.Exec(`INSERT INTO facts (user_id, question_id, ink, at, run_id) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, question_id) DO NOTHING`, r.userID, p.ID, ink, at, r.id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return ink && n == 1, err
}

// metBefore is whether a player met a question of their day's run (r) before it: an answer to it before the day began
// (by the question's answers, in time: only the few from before its day), or in another game of theirs begun in the
// days a game can last (a duel's DuelFor), by their own games: never by everyone's answers to the day's question.
func metBefore(tx *sql.Tx, r *run, id string) (bool, error) {
	start, _ := dayBounds(r.day)
	var met bool
	err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM answers a JOIN runs o ON o.id = a.run_id
			WHERE a.question_id = ?1 AND a.at < ?3 AND o.user_id = ?2)
		OR EXISTS (SELECT 1 FROM runs o JOIN answers a ON a.run_id = o.id
			WHERE o.user_id = ?2 AND o.started_at >= ?4 AND o.id <> ?5 AND a.question_id = ?1)`,
		id, r.userID, start, start-(DuelFor+dayLate).Milliseconds(), r.id).Scan(&met)
	return met, err
}

// Written is a fact as the book has it: its question, and ink or grey.
type written struct {
	id  string
	ink bool
	at  learnedAt
}

// written calls fn with every fact in a player's book that it shows (writtenShows), in the order they were written.
func (g *Game) written(ctx context.Context, userID int64, fn func(q bank.Question, w written)) error {
	return writtenIn(ctx, g.DB.Read, g.Bank(), userID, fn)
}

// writtenIn is written, read by db (a transaction that has just written the book again, or the database) by bank b.
func writtenIn(ctx context.Context, db querier, b *bank.Bank, userID int64, fn func(q bank.Question, w written)) error {
	rows, err := db.QueryContext(ctx, `SELECT f.question_id, f.ink, f.at, coalesce(r.kind, ''),
			coalesce(r.day, '')
		FROM facts f LEFT JOIN runs r ON r.id = f.run_id WHERE f.user_id = ? ORDER BY f.at, f.question_id`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var w written
		if err := rows.Scan(&w.id, &w.ink, &w.at.at, &w.at.kind, &w.at.day); err != nil {
			return err
		}
		if q, ok := b.Get(w.id); ok && writtenShows(q) {
			fn(q, w)
		}
	}
	return rows.Err()
}

// writtenShows is whether the book shows a question's fact: it has one, and it's so (one retired as untrue isn't).
func writtenShows(q bank.Question) bool { return q.Extra().Fact != "" && !q.Extra().Untrue() }

// InkOf is how many facts a player's book has in ink in each chapter: the bank's topics, „Микс“ (all of them) and
// „България“ (the questions about Bulgaria).
func (g *Game) InkOf(ctx context.Context, userID int64) (map[string]int, error) {
	return inkIn(ctx, g.DB.Read, g.Bank(), userID)
}

// inkIn is InkOf, read by db by bank b.
func inkIn(ctx context.Context, db querier, b *bank.Bank, userID int64) (map[string]int, error) {
	ink := map[string]int{}
	err := writtenIn(ctx, db, b, userID, func(q bank.Question, w written) {
		if w.ink {
			countIn(ink, q)
		}
	})
	return ink, err
}

// countIn counts a question in the chapters it's in.
func countIn(by map[string]int, q bank.Question) {
	by[q.Base().Category]++
	by[MixTopic]++
	if q.Extra().BG {
		by[BulgariaTopic]++
	}
}

// GreyIn is how many facts a game (runID) wrote in a player's book in grey: the questions it met first (a chapter's
// game, a duel, a miss in the issue). A chapter game's result says it („+4 в сиво“): what that game wrote, never a
// count of the book's grey.
func (g *Game) GreyIn(ctx context.Context, userID, runID int64) (int, error) {
	b := g.Bank()
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT f.question_id FROM facts f
		WHERE f.user_id = ? AND f.run_id = ? AND NOT f.ink`, userID, runID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	grey := 0
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		if q, ok := b.Get(id); ok && writtenShows(q) {
			grey++
		}
	}
	return grey, rows.Err()
}

// InkIn is how many facts a game (runID) wrote in a player's book in ink, and how many of its right answers were to
// questions the book had in grey already, written by an earlier game (metBefore: „вече беше в твоя Алманах“; the news
// says it of a day's issue only). A game that writes nothing (a script's), or writes grey by its own rule (the issue
// played a second time: runs.pencil), met nothing before by that: its metBefore is 0.
func (g *Game) InkIn(ctx context.Context, userID, runID int64) (ink, metBefore int, err error) {
	b := g.Bank()
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, coalesce(f.ink, 0), coalesce(f.run_id = a.run_id, 0),
			coalesce(f.run_id <> a.run_id AND f.at < a.at, 0) AND NOT r.pencil AND `+shadowWrites+`
		FROM answers a JOIN runs r ON r.id = a.run_id
		LEFT JOIN facts f ON f.user_id = r.user_id AND f.question_id = a.question_id
		WHERE a.run_id = ?2 AND r.user_id = ?1 AND (a.is_right OR f.ink) AND NOT `+voidAt, userID, runID)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var inked, here, before bool
		if err := rows.Scan(&id, &inked, &here, &before); err != nil {
			return 0, 0, err
		}
		q, ok := b.Get(id)
		switch {
		case !ok || !writtenShows(q):
		case inked && here:
			ink++
		case !inked && before:
			metBefore++
		}
	}
	return ink, metBefore, rows.Err()
}
