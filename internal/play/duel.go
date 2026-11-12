package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Recording is a game someone else finished, to be played against when nobody else is about: its questions, dealt
// as they were, and for each what they gave and how long they took. It's a real person's game, said as such: never
// a made-up opponent.
type Recording struct {
	Name    string
	Picks   []Pick
	Answers map[int]Recorded // by the question's place; none: their time ran out
}

type Recorded struct {
	Shown json.RawMessage
	Ms    int64
}

// RecordingFor finds a recording for a player to play against: someone else's finished topic run or duel among the
// latest, the one with the fewest questions the player has seen. Nil if there's none.
func (g *Game) RecordingFor(ctx context.Context, userID int64) (*Recording, error) {
	db := g.DB.Read
	seen := map[string]bool{}
	rows, err := db.QueryContext(ctx, `SELECT a.question_id FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		seen[id] = true
	}
	rows.Close()

	rows, err = db.QueryContext(ctx, `SELECT r.id, u.name, r.questions FROM runs r JOIN users u ON u.id = r.user_id
		WHERE r.kind IN ('topic', 'duel') AND r.finished_at IS NOT NULL AND r.user_id != ?
		ORDER BY r.finished_at DESC LIMIT 200`, userID)
	if err != nil {
		return nil, err
	}
	b := g.Bank()
	var best *Recording
	var bestID int64
	bestSeen := 1 << 30
	for rows.Next() {
		var id int64
		var name, raw string
		if err := rows.Scan(&id, &name, &raw); err != nil {
			rows.Close()
			return nil, err
		}
		var picks []Pick
		if json.Unmarshal([]byte(raw), &picks) != nil || len(picks) == 0 {
			continue
		}
		n, whole := 0, true
		for _, p := range picks {
			if _, ok := b.Get(p.ID); !ok {
				whole = false
			}
			if seen[p.ID] {
				n++
			}
		}
		if whole && n < bestSeen {
			best, bestID, bestSeen = &Recording{Name: name, Picks: picks, Answers: map[int]Recorded{}}, id, n
		}
	}
	rows.Close()
	if best == nil {
		return nil, nil
	}
	rows, err = db.QueryContext(ctx, `SELECT n, shown, ms FROM answers WHERE run_id = ?`, bestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var n int
		var shown sql.NullString
		var ms int64
		if err := rows.Scan(&n, &shown, &ms); err != nil {
			return nil, err
		}
		if shown.Valid {
			best.Answers[n] = Recorded{Shown: json.RawMessage(shown.String), Ms: ms}
		}
	}
	return best, rows.Err()
}

// Duel is a duel as one player played it, to keep: the questions, every answer, against whom, how it ended.
type Duel struct {
	UserID   int64
	Picks    []Pick
	Answers  []DuelAnswer // one for each question, in order
	Opponent string
	// OpponentID is the other player's (0 for a recording): for the record between friends.
	OpponentID int64
	Recorded   bool   // against a recording
	Outcome    string // won, lost or draw
}

type DuelAnswer struct {
	QuestionID   string
	Given, Shown json.RawMessage // nil: no answer
	Score        float64
	Points       int
	Right        bool
	Ms           int64
}

// SaveDuel keeps a duel as a run of its own, with its answers: for the player's games and stats, the questions'
// statistics, and as a recording for others to play against.
func (g *Game) SaveDuel(ctx context.Context, d Duel) error {
	if len(d.Answers) != len(d.Picks) || len(d.Picks) == 0 {
		return errors.New("a duel to keep has an answer for each question")
	}
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		points, rights, ms := 0, 0, int64(0)
		for _, a := range d.Answers {
			points += a.Points
			ms += a.Ms
			if a.Right {
				rights++
			}
		}
		picks, _ := json.Marshal(d.Picks)
		now := store.Ms(g.Now())
		var opponentID any
		if d.OpponentID > 0 {
			opponentID = d.OpponentID
		}
		res, err := tx.Exec(`INSERT INTO runs (user_id, kind, category, questions, at, points, rights, ms, opponent,
			opponent_id, recorded, outcome, started_at, finished_at) VALUES (?, 'duel', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			d.UserID, string(picks), len(d.Picks), points, rights, ms, d.Opponent, opponentID, d.Recorded, d.Outcome,
			now-ms-int64(len(d.Picks))*int64(5*time.Second/time.Millisecond), now)
		if err != nil {
			return err
		}
		runID, _ := res.LastInsertId()
		for n, a := range d.Answers {
			var given, shown any
			if a.Given != nil {
				given, shown = string(a.Given), string(a.Shown)
			}
			if _, err := tx.Exec(`INSERT INTO answers (run_id, n, question_id, given, shown, score, points, is_right, ms, at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, runID, n, a.QuestionID, given, shown, a.Score, a.Points, a.Right, a.Ms, now); err != nil {
				return err
			}
		}
		return nil
	})
}
