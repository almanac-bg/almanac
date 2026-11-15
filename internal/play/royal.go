package play

import (
	"cmp"
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
// easy to hard in three rounds. A wrong answer puts nobody out by itself: the game is cut, at RoyalCuts, to those
// ahead (the most right answers, and of as many, the quickest right ones: RoyalAhead), each cut keeping a share of
// those who began, and the last question is the final of RoyalFinal. Everyone in has a chance at every question
// until a cut, and the game always reaches its last question. Those still in at the end place first, by the same
// order; those cut after them, the later cut ahead; the places move their ratings against everyone else in it.
//
// The game itself is run by package royal, which keeps the clock; this is what it keeps in the database: the
// tournaments and where each is, who's in them, and each player's run of answers (so that what a Роял earns is
// earned as in any game, and a restart of the server picks the game up where it was).

const (
	RoyalSize   = 50
	RoyalLength = 15
	// RoyalRound is how many questions a round has (three rounds: easy, medium, hard).
	RoyalRound = 5
	// RoyalFinal is how many play the last question, of a tournament big enough.
	RoyalFinal = 3
	// royalBackstop is how long after its start a tournament is ended whatever happened (the server down all
	// evening): far longer than any game takes.
	royalBackstop = time.Hour
)

// RoyalCuts are where a tournament is cut: after which question (counted from 1), and the share of those who began
// that goes on, in percent, rounded up (0: the final's RoyalFinal). Nobody goes out before the first, so that
// everyone plays a round.
var RoyalCuts = []struct {
	After   int
	Percent int
}{{5, 60}, {8, 40}, {11, 20}, {14, 0}}

// RoyalKeep is how many of a tournament that entered began go on after question n (counted from 0): 0 if there's no
// cut there. A cut keeps at least two (two play to the end, as a duel), and never more than the cut before it.
func RoyalKeep(n, entered int) int {
	prev := entered
	for _, c := range RoyalCuts {
		k := (c.Percent*entered + 99) / 100
		if c.Percent == 0 {
			k = RoyalFinal
		}
		k = min(max(k, 2), prev)
		prev = k
		if c.After == n+1 {
			return k
		}
	}
	return 0
}

// RoyalScore is how a player stands in a tournament: their right answers, and the time the right ones took.
type RoyalScore struct {
	User   int64
	Rights int
	Ms     int64
}

// RoyalAhead orders scores, those ahead first: more right answers, then, of as many, quicker right ones (a slow miss
// costs nothing more). 0: level, and a cut keeps both or neither.
func RoyalAhead(a, b RoyalScore) int {
	if a.Rights != b.Rights {
		return b.Rights - a.Rights
	}
	return cmp.Compare(a.Ms, b.Ms)
}

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
		if q := choose(pool, s, allowed, fresh, nil, r); q != nil {
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

// MoveRoyal moves a player from one tournament's lobby to another's, of the same evening (as its games begin, to
// even them out).
func (g *Game) MoveRoyal(ctx context.Context, from, to, userID int64) error {
	_, err := g.DB.Write.ExecContext(ctx, `UPDATE royal_players SET royal_id = ? WHERE royal_id = ? AND user_id = ?`,
		to, from, userID)
	return err
}

// StartRoyal begins a tournament with those of its lobby who are there: each is given a run of its questions, and
// the first question shows. It returns each player's run. The others stay in it without a run: they may still come
// in late (EnterRoyal), and are taken out as it ends (SettleRoyal).
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

// EnterRoyal puts a player into a tournament under way, late: the questions before the one showing (and it, if its
// answer shows already) are recorded as missed; the one showing is theirs to answer in the time it has left. A place
// they had in a lobby of the same evening is given up. It returns their run.
func (g *Game) EnterRoyal(ctx context.Context, royalID, userID int64) (int64, error) {
	var run int64
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var questions, phase string
		var n int
		var starts, shown int64
		if err := tx.QueryRow(`SELECT questions, n, phase, starts_at, coalesce(phase_at, 0) FROM royals WHERE id = ?`,
			royalID).Scan(&questions, &n, &phase, &starts, &shown); err != nil {
			return err
		}
		var picks []Pick
		if err := json.Unmarshal([]byte(questions), &picks); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM royal_players WHERE user_id = ? AND run_id IS NULL
			AND royal_id IN (SELECT id FROM royals WHERE starts_at = ?)`, userID, starts); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO royal_players (royal_id, user_id, joined_at) VALUES (?, ?, ?)`,
			royalID, userID, store.Ms(g.Now())); err != nil {
			return err
		}
		r, err := g.insertRun(tx, userID, "royal", nil, nil, picks)
		if err != nil {
			return err
		}
		missed := n
		if phase != RoyalQuestion {
			missed = n + 1
		}
		for r.at < missed {
			ms := int64(0)
			if d, ok := g.deal(r.picks[r.at]); ok {
				ms = Limit(d.Question()).Milliseconds()
			}
			if err := g.record(tx, r, bank.Graded{}, Worth{}, ms); err != nil {
				return err
			}
		}
		if phase == RoyalQuestion {
			if _, err := tx.Exec(`UPDATE runs SET shown_at = ? WHERE id = ?`, shown, r.id); err != nil {
				return err
			}
		}
		run = r.id
		_, err = tx.Exec(`UPDATE royal_players SET run_id = ? WHERE royal_id = ? AND user_id = ?`, r.id, royalID, userID)
		return err
	})
	return run, err
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

// RevealRoyal shows the answer to the question now: those who haven't answered it (the time ran out on them, or
// they're gone) have it recorded as missed. It returns how everyone in for it stands now, ahead first (RoyalAhead), and,
// on a question the game is cut after (RoyalKeep), who's out: those behind the last who goes on (all level with them
// go on too).
func (g *Game) RevealRoyal(ctx context.Context, royalID int64) (scores []RoyalScore, out []int64, err error) {
	var late []int64
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var n, entered int
		if err := tx.QueryRow(`SELECT n, (SELECT count(*) FROM royal_players WHERE royal_id = ?1 AND run_id IS NOT NULL)
			FROM royals WHERE id = ?1`, royalID).Scan(&n, &entered); err != nil {
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
		// How everyone in for question n stands (those out before it have no answer to it).
		rows, err = tx.Query(`SELECT r.user_id, r.id, r.finished_at IS NOT NULL, r.rights,
				(SELECT coalesce(sum(b.ms), 0) FROM answers b WHERE b.run_id = r.id AND b.is_right)
			FROM royal_players p JOIN runs r ON r.id = p.run_id JOIN answers a ON a.run_id = r.id AND a.n = ?
			WHERE p.royal_id = ?`, n, royalID)
		if err != nil {
			return err
		}
		type standing struct {
			RoyalScore
			run  int64
			done bool
		}
		var all []standing
		for rows.Next() {
			var s standing
			if err := rows.Scan(&s.User, &s.run, &s.done, &s.Rights, &s.Ms); err != nil {
				rows.Close()
				return err
			}
			all = append(all, s)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		slices.SortStableFunc(all, func(a, b standing) int { return RoyalAhead(a.RoyalScore, b.RoyalScore) })
		for _, s := range all {
			scores = append(scores, s.RoyalScore)
		}
		if keep := RoyalKeep(n, entered); keep > 0 && len(all) > keep {
			line := all[keep-1].RoyalScore
			for _, s := range all[keep:] {
				if RoyalAhead(s.RoyalScore, line) <= 0 {
					continue // level with the last who goes on
				}
				out = append(out, s.User)
				if s.done {
					continue // the last question: over anyway
				}
				r, err := load(tx, s.User, s.run)
				if err != nil {
					return err
				}
				if err := g.finish(tx, r); err != nil {
					return err
				}
			}
		}
		_, err = tx.Exec(`UPDATE royals SET phase = 'reveal', phase_at = ? WHERE id = ?`, store.Ms(g.Now()), royalID)
		return err
	})
	if err != nil {
		return nil, nil, err
	}
	told := map[int64]bool{}
	for _, u := range append(late, out...) {
		if told[u] {
			continue
		}
		told[u] = true
		if err := g.afterRun(ctx, u); err != nil {
			return scores, out, err
		}
	}
	return scores, out, nil
}

// AnswerRoyal grades a player's answer to a tournament's question n, the one showing. Who goes on is RevealRoyal's to
// say, once everyone has answered.
func (g *Game) AnswerRoyal(ctx context.Context, userID, runID int64, n int, answer json.RawMessage) (Result, error) {
	return g.answer(ctx, userID, runID, n, answer, true)
}

// RoyalStanding is where a player came in a tournament, once it's ended.
type RoyalStanding struct {
	User  int64
	Place int
	Delta int
}

// SettleRoyal ends a tournament: places (those still in the game at its end, in, first; then those out, the later the
// further ahead; each by RoyalAhead), and ratings moved by each place against everyone else's (with three or more in
// it). One still in whose run is open (the game ended before its last question: the server was down for it) played it
// to where it got: their run ends as a game of the questions it asked. An ended one is left as it is.
func (g *Game) SettleRoyal(ctx context.Context, royalID int64, in []int64) ([]RoyalStanding, error) {
	type royalist struct {
		RoyalScore
		in            bool
		at            int
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
		rows, err := tx.Query(`SELECT p.user_id, r.at, r.rights,
				(SELECT coalesce(sum(a.ms), 0) FROM answers a WHERE a.run_id = r.id AND a.is_right), u.rating, u.rated
			FROM royal_players p JOIN users u ON u.id = p.user_id JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ?`, royalID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var p royalist
			if err := rows.Scan(&p.User, &p.at, &p.Rights, &p.Ms, &p.rating, &p.rated); err != nil {
				rows.Close()
				return err
			}
			p.in = slices.Contains(in, p.User)
			list = append(list, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		// Those still in beat those out, and those out later those out sooner: a cut is final.
		better := func(a, b royalist) int {
			if a.in != b.in {
				if a.in {
					return -1
				}
				return 1
			}
			if a.at != b.at {
				return b.at - a.at
			}
			return RoyalAhead(a.RoyalScore, b.RoyalScore)
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
				p.place, p.delta, royalID, p.User); err != nil {
				return err
			}
			if len(list) >= 3 {
				if _, err := tx.Exec(`UPDATE users SET rating = max(0, rating + ?1), peak = max(peak, rating + ?1), rated = rated + 1 WHERE id = ?2`,
					p.delta, p.User); err != nil {
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
		if slices.Contains(played, p.User) {
			// A game just ended: its goals and the week's league as well (afterRun awards too).
			if err := g.afterRun(ctx, p.User); err != nil {
				return nil, err
			}
		} else if _, err := g.Award(ctx, p.User); err != nil {
			return nil, err
		}
		out = append(out, RoyalStanding{User: p.User, Place: p.place, Delta: p.delta})
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
	// RightMs is the time their right answers took.
	RightMs int64
	Out     bool
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
				coalesce(r.rights, 0), coalesce(r.ms, 0),
				coalesce((SELECT sum(ms) FROM answers WHERE run_id = r.id AND is_right), 0),
				coalesce(r.finished_at IS NOT NULL, 0),
				coalesce((SELECT is_right FROM answers WHERE run_id = r.id AND n = r.at - 1), 0)
			FROM royal_players p JOIN users u ON u.id = p.user_id LEFT JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ? ORDER BY p.joined_at, p.user_id`, out[i].ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var p LiveRoyalist
			if err := rows.Scan(&p.User, &p.Name, &p.Tag, &p.Run, &p.At, &p.Right, &p.Ms, &p.RightMs, &p.Out, &p.LastRight); err != nil {
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
