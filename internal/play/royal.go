package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	mrand "math/rand/v2"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Роял is played live, every evening: up to RoyalSize players on the same RoyalLength questions at the same moment,
// easy to hard in three rounds, and the first wrong answer (or the time running out) is the way out — unless nobody
// still in answers a question right: then those who answered stay in (among two or more: one playing alone is out at
// their first wrong answer, with nobody else to measure a question by). The game ends after its last question, once
// nobody's left in it, or once one is left of two or more, who has won (package royal keeps to it). Those still in at
// the end place first; the rest by how many they got right, then by how quick the right ones were; the places move
// their ratings against everyone else in it.
//
// The game itself is run by package royal, which keeps the clock; this is what it keeps in the database: the
// tournaments and where each is, who's in them, and each player's run of answers (so that what a Роял earns is
// earned as in any game, and a restart of the server picks the game up where it was).

const (
	RoyalSize   = 50
	RoyalLength = 15
	// RoyalRound is how many questions a round has (three rounds: easy, medium, hard).
	RoyalRound = 5
	// royalBackstop is how long after its start a tournament is ended whatever happened (the server down all
	// evening): far longer than any game takes.
	royalBackstop = time.Hour
)

// A tournament is in one of these phases.
const (
	RoyalLobby    = "lobby"
	RoyalQuestion = "question"
	RoyalReveal   = "reveal"
	RoyalEnd      = "end"
)

// royalSlots are a tournament's questions: quick ones (a choice, or true or not), five easy, five medium, five hard.
func royalSlots() []slot {
	slots := make([]slot, RoyalLength)
	for i := range slots {
		d := bank.Easy
		if i >= 2*RoyalRound {
			d = bank.Hard
		} else if i >= RoyalRound {
			d = bank.Medium
		}
		typ := "choice"
		if i%RoyalRound == 2 {
			typ = "truefalse"
		}
		slots[i] = slot{difficulty: d, typ: typ, picture: noPicture}
	}
	return slots
}

func drawRoyal(b *bank.Bank, seen, barred map[string]bool, r *mrand.Rand) []Pick {
	var pool []bank.Question
	for _, q := range b.Live("", "") {
		if t := q.Base().Type; (t == "choice" || t == "truefalse") && !barred[q.Base().ID] {
			pool = append(pool, q)
		}
	}
	taken := map[string]bool{}
	allowed := func(q bank.Question) bool { return !taken[q.Base().ID] }
	fresh := func(q bank.Question) bool { return !seen[q.Base().ID] }
	var picks []Pick
	for _, s := range royalSlots() {
		if q := choose(pool, s, allowed, fresh, r); q != nil {
			taken[q.Base().ID] = true
			picks = append(picks, Pick{ID: q.Base().ID, Seed: r.Uint64()})
		}
	}
	return picks
}

// DrawRoyal draws an evening's questions, leaving out (while there are others) those of the last month's evenings,
// and the day's (DayQuestions).
func (g *Game) DrawRoyal(ctx context.Context) ([]Pick, error) {
	barred, err := g.DayQuestions(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT DISTINCT questions FROM royals WHERE created_at > ?`,
		store.Ms(g.Now().Add(-31*24*time.Hour)))
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s string
		var picks []Pick
		if err := rows.Scan(&s); err != nil {
			rows.Close()
			return nil, err
		}
		_ = json.Unmarshal([]byte(s), &picks)
		for _, p := range picks {
			seen[p.ID] = true
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	picks := drawRoyal(g.Bank(), seen, barred, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
	if len(picks) < RoyalLength {
		return nil, ErrNoQuestion
	}
	return picks, nil
}

// NewRoyal opens a tournament of the evening that starts at startsAt, on its questions.
func (g *Game) NewRoyal(ctx context.Context, startsAt time.Time, picks []Pick) (int64, error) {
	data, _ := json.Marshal(picks)
	now := store.Ms(g.Now())
	res, err := g.DB.Write.ExecContext(ctx, `INSERT INTO royals (questions, day, starts_at, phase, created_at, closes_at)
		VALUES (?, ?, ?, 'lobby', ?, ?)`, string(data), startsAt.In(Bulgaria).Format(time.DateOnly),
		store.Ms(startsAt), now, store.Ms(startsAt.Add(royalBackstop)))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// JoinRoyal puts a player in a tournament's lobby (again changes nothing).
func (g *Game) JoinRoyal(ctx context.Context, royalID, userID int64) error {
	_, err := g.DB.Write.ExecContext(ctx, `INSERT INTO royal_players (royal_id, user_id, joined_at) VALUES (?, ?, ?)
		ON CONFLICT DO NOTHING`, royalID, userID, store.Ms(g.Now()))
	return err
}

// LeaveRoyal takes a player out of a tournament's lobby.
func (g *Game) LeaveRoyal(ctx context.Context, royalID, userID int64) error {
	_, err := g.DB.Write.ExecContext(ctx, `DELETE FROM royal_players WHERE royal_id = ? AND user_id = ? AND run_id IS NULL`,
		royalID, userID)
	return err
}

// StartRoyal begins a tournament with those of its lobby who are there (the others are left out of it): each is given
// a run of its questions, and the first question shows. It returns each player's run.
func (g *Game) StartRoyal(ctx context.Context, royalID int64, players []int64) (map[int64]int64, error) {
	runs := map[int64]int64{}
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var questions string
		if err := tx.QueryRow(`SELECT questions FROM royals WHERE id = ?`, royalID).Scan(&questions); err != nil {
			return err
		}
		var picks []Pick
		if err := json.Unmarshal([]byte(questions), &picks); err != nil {
			return err
		}
		ids, _ := json.Marshal(players)
		if _, err := tx.Exec(`DELETE FROM royal_players WHERE royal_id = ? AND user_id NOT IN (SELECT value FROM json_each(?))`,
			royalID, string(ids)); err != nil {
			return err
		}
		for _, u := range players {
			r, err := g.insertRun(tx, u, "royal", nil, nil, picks)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE royal_players SET run_id = ? WHERE royal_id = ? AND user_id = ?`, r.id, royalID, u); err != nil {
				return err
			}
			runs[u] = r.id
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return runs, g.ShowRoyal(ctx, royalID, 0)
}

// ShowRoyal puts question n on the screens of everyone still in the tournament, and starts its time (again, for
// those who haven't answered it, when the server picks up a game it was running).
func (g *Game) ShowRoyal(ctx context.Context, royalID int64, n int) error {
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		now := store.Ms(g.Now())
		if _, err := tx.Exec(`UPDATE runs SET shown_at = ? WHERE finished_at IS NULL AND at = ?
			AND id IN (SELECT run_id FROM royal_players WHERE royal_id = ?)`, now, n, royalID); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE royals SET n = ?, phase = 'question', phase_at = ? WHERE id = ?`, n, now, royalID)
		return err
	})
}

// RevealRoyal shows the answer to the question now, and says who's out on it: whoever hasn't answered it (the time
// ran out on them, or they're gone), and whoever answered it wrong — unless nobody still in answered it right, in which
// case those who answered stay in (spared): an evening isn't over because a question beat everyone. One playing alone
// isn't spared: a question that beats them is no news about anyone else.
func (g *Game) RevealRoyal(ctx context.Context, royalID int64) (out []int64, spared bool, err error) {
	var late []int64
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRow(`SELECT n FROM royals WHERE id = ?`, royalID).Scan(&n); err != nil {
			return err
		}
		rows, err := tx.Query(`SELECT r.user_id, r.id FROM runs r JOIN royal_players p ON p.run_id = r.id
			WHERE p.royal_id = ? AND r.finished_at IS NULL AND r.at = ?`, royalID, n)
		if err != nil {
			return err
		}
		var lateRuns []struct{ user, run int64 }
		for rows.Next() {
			var l struct{ user, run int64 }
			if err := rows.Scan(&l.user, &l.run); err != nil {
				rows.Close()
				return err
			}
			lateRuns = append(lateRuns, l)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, l := range lateRuns {
			r, err := load(tx, l.user, l.run)
			if err != nil {
				return err
			}
			ms := int64(0)
			if d, ok := g.deal(r.picks[r.at]); ok {
				ms = Limit(d.Question()).Milliseconds()
			}
			if err := g.record(tx, r, bank.Graded{}, Worth{}, ms); err != nil {
				return err
			}
			late = append(late, l.user)
		}
		// How everyone still in answered question n.
		rows, err = tx.Query(`SELECT r.user_id, r.id, r.finished_at IS NOT NULL, a.is_right, a.given IS NULL
			FROM royal_players p JOIN runs r ON r.id = p.run_id JOIN answers a ON a.run_id = r.id AND a.n = ?
			WHERE p.royal_id = ?`, n, royalID)
		if err != nil {
			return err
		}
		type answered struct {
			user, run             int64
			done, right, timedOut bool
		}
		var all []answered
		anyRight, anyWrong := false, false
		for rows.Next() {
			var a answered
			if err := rows.Scan(&a.user, &a.run, &a.done, &a.right, &a.timedOut); err != nil {
				rows.Close()
				return err
			}
			anyRight = anyRight || a.right
			anyWrong = anyWrong || (!a.right && !a.timedOut)
			all = append(all, a)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		spared = !anyRight && anyWrong && len(all) > 1
		for _, a := range all {
			if a.right || (spared && !a.timedOut) {
				continue
			}
			out = append(out, a.user)
			if a.done {
				continue // the last question: over anyway
			}
			r, err := load(tx, a.user, a.run)
			if err != nil {
				return err
			}
			if err := g.finish(tx, r); err != nil {
				return err
			}
		}
		_, err = tx.Exec(`UPDATE royals SET phase = 'reveal', phase_at = ? WHERE id = ?`, store.Ms(g.Now()), royalID)
		return err
	})
	if err != nil {
		return nil, false, err
	}
	told := map[int64]bool{}
	for _, u := range append(late, out...) {
		if told[u] {
			continue
		}
		told[u] = true
		if err := g.afterRun(ctx, u); err != nil {
			return out, spared, err
		}
	}
	return out, spared, nil
}

// AnswerRoyal grades a player's answer to a tournament's question n, the one showing. Whether a wrong one is the way
// out is RevealRoyal's to say.
func (g *Game) AnswerRoyal(ctx context.Context, userID, runID int64, n int, answer json.RawMessage) (Result, error) {
	return g.answer(ctx, userID, runID, n, answer, true)
}

// RoyalStanding is where a player came in a tournament, once it's ended.
type RoyalStanding struct {
	User  int64
	Place int
	Delta int
}

// SettleRoyal ends a tournament: places (those still in the game at its end, in, first; then by how many each got
// right, then how quick), and ratings moved by each place against everyone else's (with three or more in it). One
// still in whose game ended before its last question (the last left of two or more) played it to its end: their run
// ends as a game of the questions it asked. An ended one is left as it is.
func (g *Game) SettleRoyal(ctx context.Context, royalID int64, in []int64) ([]RoyalStanding, error) {
	type royalist struct {
		user          int64
		in            bool
		rights        int
		ms            int64
		rating, rated int
		place, delta  int
	}
	var list []royalist
	var played []int64 // whose runs ended here, played to their end
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var ended bool
		if err := tx.QueryRow(`SELECT ended_at IS NOT NULL FROM royals WHERE id = ?`, royalID).Scan(&ended); err != nil {
			return err
		}
		if ended {
			return nil
		}
		for _, u := range in {
			var run int64
			var open bool
			err := tx.QueryRow(`SELECT r.id, r.finished_at IS NULL FROM royal_players p JOIN runs r ON r.id = p.run_id
				WHERE p.royal_id = ? AND p.user_id = ?`, royalID, u).Scan(&run, &open)
			if errors.Is(err, sql.ErrNoRows) || (err == nil && !open) {
				continue // at the last question, the run ended with its answer
			}
			if err != nil {
				return err
			}
			r, err := load(tx, u, run)
			if err != nil {
				return err
			}
			if err := g.finishOf(tx, r, r.at); err != nil {
				return err
			}
			played = append(played, u)
		}
		// Anyone still mid-question (the server was down when the game should have gone on) is out where they are.
		if _, err := tx.Exec(`UPDATE runs SET shown_at = NULL, finished_at = ? WHERE finished_at IS NULL
			AND id IN (SELECT run_id FROM royal_players WHERE royal_id = ?)`, store.Ms(g.Now()), royalID); err != nil {
			return err
		}
		// Equal right answers are told apart by the time the right ones took: a slow miss costs nothing more.
		rows, err := tx.Query(`SELECT p.user_id, r.rights,
				(SELECT coalesce(sum(a.ms), 0) FROM answers a WHERE a.run_id = r.id AND a.is_right), u.rating, u.rated
			FROM royal_players p JOIN users u ON u.id = p.user_id JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ?`, royalID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var p royalist
			if err := rows.Scan(&p.user, &p.rights, &p.ms, &p.rating, &p.rated); err != nil {
				rows.Close()
				return err
			}
			p.in = slices.Contains(in, p.user)
			list = append(list, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		// Those still in beat those out, whatever the count: the last one in may have been spared a wrong answer on the
		// question another left unanswered, with as many right.
		better := func(a, b royalist) int {
			if a.in != b.in {
				if a.in {
					return -1
				}
				return 1
			}
			if a.rights != b.rights {
				return b.rights - a.rights
			}
			return int(a.ms - b.ms)
		}
		slices.SortStableFunc(list, better)
		for i := range list {
			list[i].place = i + 1
			if i > 0 && better(list[i-1], list[i]) == 0 {
				list[i].place = list[i-1].place
			}
		}
		if len(list) >= 3 {
			places, ratings, rated := make([]int, len(list)), make([]int, len(list)), make([]int, len(list))
			for i, p := range list {
				places[i], ratings[i], rated[i] = p.place, p.rating, p.rated
			}
			for i, d := range placeDeltas(places, ratings, rated) {
				list[i].delta = d
			}
		}
		// Those in the lobby when it never started (the server down at the start) were in no game.
		if _, err := tx.Exec(`DELETE FROM royal_players WHERE royal_id = ? AND run_id IS NULL`, royalID); err != nil {
			return err
		}
		for _, p := range list {
			if _, err := tx.Exec(`UPDATE royal_players SET place = ?, delta = ? WHERE royal_id = ? AND user_id = ?`,
				p.place, p.delta, royalID, p.user); err != nil {
				return err
			}
			if len(list) >= 3 {
				if _, err := tx.Exec(`UPDATE users SET rating = max(0, rating + ?1), peak = max(peak, rating + ?1), rated = rated + 1 WHERE id = ?2`,
					p.delta, p.user); err != nil {
					return err
				}
			}
		}
		_, err = tx.Exec(`UPDATE royals SET phase = 'end', ended_at = ?1, phase_at = ?1 WHERE id = ?2`, store.Ms(g.Now()), royalID)
		return err
	})
	if err != nil {
		return nil, err
	}
	out := make([]RoyalStanding, 0, len(list))
	for _, p := range list {
		if slices.Contains(played, p.user) {
			// A game just ended: its goals and the week's league as well (afterRun awards too).
			if err := g.afterRun(ctx, p.user); err != nil {
				return nil, err
			}
		} else if _, err := g.Award(ctx, p.user); err != nil {
			return nil, err
		}
		out = append(out, RoyalStanding{User: p.user, Place: p.place, Delta: p.delta})
	}
	return out, nil
}

// RoyalNews is told to a player when a tournament they were in ends while they're away from it.
type RoyalNews struct {
	To        int64
	Place, Of int
	Delta     int
}

// settleRoyalsDue ends the tournaments the server wasn't there to end (and tells their players).
func (g *Game) settleRoyalsDue(ctx context.Context) error {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT id FROM royals WHERE ended_at IS NULL AND closes_at <= ?`,
		store.Ms(g.Now()))
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range ids {
		list, err := g.SettleRoyal(ctx, id, nil)
		if err != nil {
			return err
		}
		if g.RoyalNews != nil {
			for _, p := range list {
				g.RoyalNews(ctx, RoyalNews{To: p.User, Place: p.Place, Of: len(list), Delta: p.Delta})
			}
		}
	}
	return nil
}

// LiveRoyal is a tournament not yet ended, as the database has it: for the server to pick the game up again.
type LiveRoyal struct {
	ID       int64
	StartsAt time.Time
	Picks    []Pick
	N        int
	Phase    string
	Players  []LiveRoyalist
}

// LiveRoyalist is a player in a tournament not yet ended.
type LiveRoyalist struct {
	User  int64
	Name  string
	Tag   string
	Run   int64 // 0: in the lobby
	At    int   // questions answered
	Right int
	Ms    int64
	Out   bool
	// LastRight is whether their last answer was right.
	LastRight bool
}

// LiveRoyals are the tournaments under way or about to be (not those of before: SettleDue ends those).
func (g *Game) LiveRoyals(ctx context.Context) ([]LiveRoyal, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT id, starts_at, questions, n, phase FROM royals
		WHERE ended_at IS NULL AND starts_at IS NOT NULL AND closes_at > ? ORDER BY id`, store.Ms(g.Now()))
	if err != nil {
		return nil, err
	}
	var out []LiveRoyal
	for rows.Next() {
		var t LiveRoyal
		var starts int64
		var questions string
		if err := rows.Scan(&t.ID, &starts, &questions, &t.N, &t.Phase); err != nil {
			rows.Close()
			return nil, err
		}
		t.StartsAt = time.UnixMilli(starts)
		if err := json.Unmarshal([]byte(questions), &t.Picks); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		rows, err := g.DB.Read.QueryContext(ctx, `SELECT p.user_id, u.name, u.tag, coalesce(p.run_id, 0), coalesce(r.at, 0),
				coalesce(r.rights, 0), coalesce(r.ms, 0), coalesce(r.finished_at IS NOT NULL, 0),
				coalesce((SELECT is_right FROM answers WHERE run_id = r.id AND n = r.at - 1), 0)
			FROM royal_players p JOIN users u ON u.id = p.user_id LEFT JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ? ORDER BY p.joined_at, p.user_id`, out[i].ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var p LiveRoyalist
			if err := rows.Scan(&p.User, &p.Name, &p.Tag, &p.Run, &p.At, &p.Right, &p.Ms, &p.Out, &p.LastRight); err != nil {
				rows.Close()
				return nil, err
			}
			out[i].Players = append(out[i].Players, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// RoyalPlayer is a player in an ended tournament as others see them: how far they got, and where they came.
type RoyalPlayer struct {
	Name    string `json:"name"`
	Tag     string `json:"tag"`
	Reached int    `json:"reached"` // questions answered right
	Place   int    `json:"place"`
	Delta   int    `json:"delta,omitempty"`
	Me      bool   `json:"me,omitempty"`
	Look
}

// Royal is an ended tournament as one of its players sees it.
type Royal struct {
	ID       int64         `json:"id"`
	Length   int           `json:"length"`
	Round    int           `json:"round"`
	StartsAt int64         `json:"startsAt"`
	Players  []RoyalPlayer `json:"players"`
	RunID    int64         `json:"runId,omitempty"`
}

// RoyalsOf are the latest tournaments a player was in, once ended.
func (g *Game) RoyalsOf(ctx context.Context, userID int64) ([]Royal, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT t.id, coalesce(t.starts_at, t.created_at), p.run_id
		FROM royal_players p JOIN royals t ON t.id = p.royal_id WHERE p.user_id = ? AND t.ended_at IS NOT NULL
		AND p.run_id IS NOT NULL ORDER BY t.ended_at DESC LIMIT 10`, userID)
	if err != nil {
		return nil, err
	}
	out := []Royal{}
	for rows.Next() {
		v := Royal{Length: RoyalLength, Round: RoyalRound, Players: []RoyalPlayer{}}
		if err := rows.Scan(&v.ID, &v.StartsAt, &v.RunID); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		players, err := g.DB.Read.QueryContext(ctx, `SELECT u.id, u.name, u.tag, coalesce(r.rights, 0),
				coalesce(p.place, 0), coalesce(p.delta, 0), `+lookColumns+`
			FROM royal_players p JOIN users u ON u.id = p.user_id LEFT JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ? ORDER BY p.place, coalesce(r.rights, 0) DESC, coalesce(r.ms, 0)`, out[i].ID)
		if err != nil {
			return nil, err
		}
		for players.Next() {
			var p RoyalPlayer
			var id int64
			var avatar, title string
			var points int
			if err := players.Scan(&id, &p.Name, &p.Tag, &p.Reached, &p.Place, &p.Delta, &avatar, &title, &points); err != nil {
				players.Close()
				return nil, err
			}
			p.Look, p.Me = g.lookOf(id, avatar, title, points), id == userID
			out[i].Players = append(out[i].Players, p)
		}
		players.Close()
		if err := players.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// PlanRoyal says that a player will come to the evening of day (Bulgaria's date of its start), or, coming false, that
// they won't after all.
func (g *Game) PlanRoyal(ctx context.Context, day string, userID int64, coming bool) error {
	q := `INSERT INTO royal_plans (day, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING`
	if !coming {
		q = `DELETE FROM royal_plans WHERE day = ? AND user_id = ?`
	}
	_, err := g.DB.Write.ExecContext(ctx, q, day, userID)
	return err
}

// RoyalPlans is how many said they'd come to the evening of day, and whether the player (0: nobody signed in) is one
// of them.
func (g *Game) RoyalPlans(ctx context.Context, day string, userID int64) (n int, mine bool, err error) {
	err = g.DB.Read.QueryRowContext(ctx, `SELECT count(*), coalesce(max(user_id = ?), 0) FROM royal_plans WHERE day = ?`,
		userID, day).Scan(&n, &mine)
	return n, mine, err
}
