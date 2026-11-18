package play

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	mrand "math/rand/v2"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Роял is played live in the evening (Friday to Sunday, every evening once those fill: RoyalPaceOf): up to RoyalSize
// players on the same RoyalLength questions at the same moment, easy to hard in three rounds. A wrong answer puts
// nobody out by itself: the game is cut, at RoyalCuts, to those ahead (the most right answers, and of as many, the
// quickest right ones: RoyalAhead), each cut keeping a share of those who began, and the last question is the final
// of RoyalFinal. Everyone in has a chance at every question until a cut, and the game always reaches its last
// question. Those cut keep answering to its end, off the standings: their answers go into their own run (XP, goals,
// their count of right answers), never into a place or the rating. Those still in at the end place first, by the
// same order; those cut after them, the later cut ahead, each by how they stood at it; the places move their ratings
// against everyone else in it.
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
			// The version too, from the start: the evening deals its questions once, and its every run plays them so.
			picks = append(picks, Pick{ID: q.Base().ID, Seed: r.Uint64(), V: bank.Version(q)})
		}
	}
	return picks
}

// DrawRoyal draws an evening's questions, leaving out (while there are others) those of the last month's evenings,
// and the day's and those due for review (DayQuestions).
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

// StartRoyal begins a tournament with those of its lobby who are there, in one write: each is given a run of its
// questions, and the first question shows. One given a run already (a start tried before, whose answer never came
// back) keeps it, so that a start tried again deals nobody a second. It returns each player's run, and when the
// question showed. The others stay in it without a run: they may still come in late (EnterRoyal), and are taken out
// as it ends (SettleRoyal).
func (g *Game) StartRoyal(ctx context.Context, royalID int64, players []int64) (map[int64]int64, time.Time, error) {
	runs := map[int64]int64{}
	now := g.Now()
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
			var had sql.NullInt64
			err := tx.QueryRow(`SELECT run_id FROM royal_players WHERE royal_id = ? AND user_id = ?`, royalID, u).Scan(&had)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if had.Valid {
				runs[u] = had.Int64
				continue
			}
			r, err := g.insertRun(tx, u, "royal", nil, nil, picks)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE royal_players SET run_id = ? WHERE royal_id = ? AND user_id = ?`, r.id, royalID, u); err != nil {
				return err
			}
			runs[u] = r.id
		}
		return showRoyal(tx, 0, store.Ms(now), royalID)
	})
	if err != nil {
		return nil, time.Time{}, err
	}
	return runs, now, nil
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

// ShowRoyal puts question n on the screens of everyone still in the tournaments (an evening's together, in one
// write: they go on one clock), and starts its time (again, for those who haven't answered it, when the server picks
// up a game it was running). It returns when that was.
func (g *Game) ShowRoyal(ctx context.Context, n int, royalIDs ...int64) (time.Time, error) {
	now := g.Now()
	return now, g.DB.Tx(ctx, func(tx *sql.Tx) error { return showRoyal(tx, n, store.Ms(now), royalIDs...) })
}

func showRoyal(tx *sql.Tx, n int, at int64, royalIDs ...int64) error {
	for _, id := range royalIDs {
		if _, err := tx.Exec(`UPDATE runs SET shown_at = ? WHERE finished_at IS NULL AND at = ?
			AND id IN (SELECT run_id FROM royal_players WHERE royal_id = ?)`, at, n, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE royals SET n = ?, phase = 'question', phase_at = ? WHERE id = ?`, n, at, id); err != nil {
			return err
		}
	}
	return nil
}

// RoyalShown is what the answer to a tournament's question did: how everyone still in stands now, ahead first
// (RoyalAhead); on a question the game is cut after (RoyalKeep), who's out; and whose runs it ended (the last
// question's time run out on them: what the game earned is AfterRoyal's).
type RoyalShown struct {
	Scores     []RoyalScore
	Out, Ended []int64
}

// RevealRoyal shows the answer to the question now: those who haven't answered it (the time ran out on them, or
// they're gone) have it recorded as missed. Those a cut puts out are those behind the last who goes on (all level
// with them go on too); they keep their runs, and answer on; their standing is kept as it was at their cut.
func (g *Game) RevealRoyal(ctx context.Context, royalID int64) (RoyalShown, error) {
	var rv RoyalShown
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
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
		var lateRuns []struct{ user, run int64 } // whose runs that ends
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
			if r.finished {
				rv.Ended = append(rv.Ended, l.user)
			}
		}
		// How everyone still in stands (those out are off the standings; one who came late after question n has no
		// answer to it).
		rows, err = tx.Query(`SELECT r.user_id, r.rights,
				(SELECT coalesce(sum(b.ms), 0) FROM answers b WHERE b.run_id = r.id AND b.is_right)
			FROM royal_players p JOIN runs r ON r.id = p.run_id JOIN answers a ON a.run_id = r.id AND a.n = ?
			WHERE p.royal_id = ? AND p.out_at IS NULL`, n, royalID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var s RoyalScore
			if err := rows.Scan(&s.User, &s.Rights, &s.Ms); err != nil {
				rows.Close()
				return err
			}
			rv.Scores = append(rv.Scores, s)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		slices.SortStableFunc(rv.Scores, RoyalAhead)
		if keep := RoyalKeep(n, entered); keep > 0 && len(rv.Scores) > keep {
			line := rv.Scores[keep-1]
			for _, s := range rv.Scores[keep:] {
				if RoyalAhead(s, line) <= 0 {
					continue // level with the last who goes on
				}
				rv.Out = append(rv.Out, s.User)
				if _, err := tx.Exec(`UPDATE royal_players SET out_at = ? WHERE royal_id = ? AND user_id = ?`,
					n, royalID, s.User); err != nil {
					return err
				}
			}
		}
		_, err = tx.Exec(`UPDATE royals SET phase = 'reveal', phase_at = ? WHERE id = ?`, store.Ms(g.Now()), royalID)
		return err
	})
	if err != nil {
		return RoyalShown{}, err
	}
	return rv, nil
}

// AnswerRoyal grades a player's answer to a tournament's question n, the one showing (whether they're still in or
// play on after a cut), which arrived at at (its time is to then), against the question as the evening deals it (d).
// Who goes on is RevealRoyal's to say, once the answer shows, and the crowd shows then too, to everyone at once (none
// comes with the result). What the game earned, if this answer ended it (State.Done), is AfterRoyal's.
func (g *Game) AnswerRoyal(ctx context.Context, userID, runID int64, n int, answer json.RawMessage, at time.Time, d bank.Dealt) (Result, error) {
	return g.answer(ctx, userID, runID, n, answer, at, byRoyal, d)
}

// AfterRoyal keeps what a player's Роял earned them once its game is over for them: all a game earns (afterRun, on
// their latest Роял's run) if their run has just ended (ended), else what their place earned (the achievements). The hub calls it off the
// evening's clock: it goes over the player's history, and a tournament's end is fifty of them at once.
func (g *Game) AfterRoyal(ctx context.Context, userID int64, ended bool) error {
	if ended {
		var runID int64
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT id FROM runs WHERE user_id = ? AND kind = 'royal'
			ORDER BY started_at DESC LIMIT 1`, userID).Scan(&runID); err != nil {
			return err
		}
		p, err := g.playedOf(ctx, userID, runID)
		if err != nil {
			return err
		}
		return g.afterRun(ctx, p)
	}
	_, err := g.Award(ctx, userID)
	return err
}

// RoyalStanding is where a player came in a tournament, once it's ended. Ended says their run ended with it (it
// hadn't reached its last answer): AfterRoyal's ended.
type RoyalStanding struct {
	User  int64
	Place int
	Delta int
	Ended bool
}

// SettleRoyal ends a tournament: places (those still in the game at its end first; then those out, the later cut
// further ahead; each by RoyalAhead, those out as they stood at their cut), and ratings moved by each place against
// everyone else's (with three or more in it). A run still open (the game ended before its last question: the server
// was down for it) was played to where it got: it ends as a game of the questions it asked. An ended one is left as
// it is (no standings come back). What each player earned is AfterRoyal's to keep.
func (g *Game) SettleRoyal(ctx context.Context, royalID int64) ([]RoyalStanding, error) {
	type royalist struct {
		RoyalScore
		out           int // the question they went out at; RoyalLength: still in
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
		rows, err := tx.Query(`SELECT r.user_id, r.id FROM royal_players p JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ? AND r.finished_at IS NULL`, royalID)
		if err != nil {
			return err
		}
		var open []struct{ user, run int64 }
		for rows.Next() {
			var o struct{ user, run int64 }
			if err := rows.Scan(&o.user, &o.run); err != nil {
				rows.Close()
				return err
			}
			open = append(open, o)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, o := range open {
			r, err := load(tx, o.user, o.run)
			if err != nil {
				return err
			}
			if err := g.finishOf(tx, r, r.at); err != nil {
				return err
			}
			played = append(played, o.user)
		}
		// Equal right answers are told apart by the time the right ones took: a slow miss costs nothing more. Those
		// out stand as they did at their cut.
		rows, err = tx.Query(`SELECT p.user_id, coalesce(p.out_at, ?),
				(SELECT count(*) FROM answers a WHERE a.run_id = r.id AND a.is_right AND a.n <= coalesce(p.out_at, a.n)),
				(SELECT coalesce(sum(a.ms), 0) FROM answers a WHERE a.run_id = r.id AND a.is_right AND a.n <= coalesce(p.out_at, a.n)),
				u.rating, u.rated
			FROM royal_players p JOIN users u ON u.id = p.user_id JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ?`, RoyalLength, royalID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var p royalist
			if err := rows.Scan(&p.User, &p.out, &p.Rights, &p.Ms, &p.rating, &p.rated); err != nil {
				rows.Close()
				return err
			}
			list = append(list, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		// Those still in beat those out, and those out later those out sooner: a cut is final.
		better := func(a, b royalist) int {
			if a.out != b.out {
				return b.out - a.out
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
		out = append(out, RoyalStanding{User: p.User, Place: p.place, Delta: p.delta, Ended: slices.Contains(played, p.User)})
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
		list, err := g.SettleRoyal(ctx, id)
		if err != nil {
			return err
		}
		for _, p := range list {
			if err := g.AfterRoyal(ctx, p.User, p.Ended); err != nil {
				return err
			}
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
	User int64
	Name string
	Tag  string
	Run  int64 // 0: in the lobby (or away from it at the start)
	At   int   // questions answered
	// Rights is how many they've answered right in all, as of the last answer shown; Right, of those, as they stand
	// (to their cut, if they're out), and RightMs the time those took.
	Rights  int
	Right   int
	RightMs int64
	// OutAt is the question they went out at (-1: they're still in).
	OutAt int
	// Now is their answer to the question now (n), if they have one: Gave says it was given (not their time run out),
	// Shown is what they gave as shown, and Points and NowRight how it went.
	Now      bool
	Gave     bool
	Shown    json.RawMessage
	Points   int
	NowRight bool
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
		// What's shown: the answers to the questions whose answer has shown (not the one showing's, given or not).
		shown := out[i].N + 1
		if out[i].Phase == RoyalQuestion {
			shown = out[i].N
		}
		rows, err := g.DB.Read.QueryContext(ctx, `SELECT p.user_id, u.name, u.tag, coalesce(p.run_id, 0), coalesce(r.at, 0),
				(SELECT count(*) FROM answers a WHERE a.run_id = r.id AND a.is_right AND a.n < ?2),
				(SELECT count(*) FROM answers a WHERE a.run_id = r.id AND a.is_right AND a.n < ?2 AND a.n <= coalesce(p.out_at, a.n)),
				(SELECT coalesce(sum(a.ms), 0) FROM answers a WHERE a.run_id = r.id AND a.is_right AND a.n < ?2
					AND a.n <= coalesce(p.out_at, a.n)),
				coalesce(p.out_at, -1),
				q.run_id IS NOT NULL, q.given IS NOT NULL, q.shown, coalesce(q.points, 0), coalesce(q.is_right, 0)
			FROM royal_players p JOIN users u ON u.id = p.user_id LEFT JOIN runs r ON r.id = p.run_id
				LEFT JOIN answers q ON q.run_id = r.id AND q.n = ?3
			WHERE p.royal_id = ?1 ORDER BY p.joined_at, p.user_id`, out[i].ID, shown, out[i].N)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var p LiveRoyalist
			var shownAs sql.NullString
			if err := rows.Scan(&p.User, &p.Name, &p.Tag, &p.Run, &p.At, &p.Rights, &p.Right, &p.RightMs, &p.OutAt, &p.Now,
				&p.Gave, &shownAs, &p.Points, &p.NowRight); err != nil {
				rows.Close()
				return nil, err
			}
			if shownAs.Valid {
				p.Shown = json.RawMessage(shownAs.String)
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

// RoyalFriends are the names of a player's friends who said they'd come to the evening of day (a few at most, by name).
func (g *Game) RoyalFriends(ctx context.Context, day string, userID int64) ([]string, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.name FROM royal_plans p JOIN friends f ON f.friend_id = p.user_id
		JOIN users u ON u.id = p.user_id WHERE p.day = ? AND f.user_id = ? ORDER BY u.name LIMIT 3`, day, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	names := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		names = append(names, n)
	}
	return names, rows.Err()
}

// RoyalPlans is how many said they'd come to the evening of day, and whether the player (0: nobody signed in) is one
// of them.
func (g *Game) RoyalPlans(ctx context.Context, day string, userID int64) (n int, mine bool, err error) {
	err = g.DB.Read.QueryRowContext(ctx, `SELECT count(*), coalesce(max(user_id = ?), 0) FROM royal_plans WHERE day = ?`,
		userID, day).Scan(&n, &mine)
	return n, mine, err
}

// How often Роял plays: an evening of one or two isn't a Роял, so until the evenings fill it plays on RoyalDays only,
// and every evening once the median evening, of the last RoyalEvenings held, has had RoyalTurnout players or more.
//
// And whom the game points at it (NudgeRoyal): a first live game that feels empty teaches that nobody plays it, so
// while the median of the last RoyalRecent evenings is under RoyalTurnout, a player in their first RoyalNewDays days
// isn't drawn the goal of a Роял, nor shown it among the ways to play with others on Начало (one who has found it
// keeps it: who has been in one, or said they'd come).
const (
	RoyalTurnout  = 8
	RoyalEvenings = 14
	RoyalRecent   = 7
	RoyalNewDays  = 7
)

// RoyalDays are the days Роял always plays.
var RoyalDays = []time.Weekday{time.Friday, time.Saturday, time.Sunday}

// RoyalPace is how often Роял plays, as the evenings before a day decided it.
type RoyalPace struct {
	// Nightly says it plays every evening; else on RoyalDays only.
	Nightly bool
	// Median is how many played on the median evening of the last Evenings held (at most RoyalEvenings: with fewer,
	// it isn't nightly yet).
	Median   float64
	Evenings int
	// Recent is how many played on the median evening of the last RoyalRecent held (0 with none).
	Recent float64
}

// HeldRoyal keeps that the evening that starts at start was held (again changes nothing).
func (g *Game) HeldRoyal(ctx context.Context, start time.Time) error {
	_, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO royal_evenings (day) VALUES (?)`,
		start.In(Bulgaria).Format(time.DateOnly))
	return err
}

// RoyalPaceOf is how often Роял plays today, from the evenings held before it (worked out once a day).
func (g *Game) RoyalPaceOf(ctx context.Context) (RoyalPace, error) {
	today := g.Today()
	g.paceMu.Lock()
	defer g.paceMu.Unlock()
	if g.paceOn == today {
		return g.pace, nil
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT (SELECT count(*) FROM royal_players p JOIN royals r ON r.id = p.royal_id
			WHERE r.day = e.day AND p.run_id IS NOT NULL)
		FROM royal_evenings e WHERE e.day < ? ORDER BY e.day DESC LIMIT ?`, today, RoyalEvenings)
	if err != nil {
		return RoyalPace{}, err
	}
	var players []int
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return RoyalPace{}, err
		}
		players = append(players, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return RoyalPace{}, err
	}
	p := RoyalPace{Evenings: len(players), Recent: median(players[:min(len(players), RoyalRecent)]), Median: median(players)}
	p.Nightly = p.Evenings >= RoyalEvenings && p.Median >= RoyalTurnout
	g.pace, g.paceOn = p, today
	return p, nil
}

// median is the middle of some numbers (of two in the middle, halfway between them; 0 for none). It sorts a copy.
func median(of []int) float64 {
	k := len(of)
	if k == 0 {
		return 0
	}
	s := slices.Sorted(slices.Values(of))
	if k%2 == 0 {
		return float64(s[k/2-1]+s[k/2]) / 2
	}
	return float64(s[k/2])
}

// NudgeRoyal says whether the game points the player at the evening's Роял (its goal, its place among the ways to play
// with others): always, but in their first RoyalNewDays days while the last RoyalRecent evenings were thin, unless
// they've found it already (been in one, or said they'd come).
func (g *Game) NudgeRoyal(ctx context.Context, userID int64) (bool, error) {
	p, err := g.RoyalPaceOf(ctx)
	if err != nil || p.Recent >= RoyalTurnout {
		return err == nil, err
	}
	var since int64
	var found bool
	err = g.DB.Read.QueryRowContext(ctx, `SELECT created_at,
			EXISTS (SELECT 1 FROM royal_players WHERE user_id = ?1) OR EXISTS (SELECT 1 FROM royal_plans WHERE user_id = ?1)
		FROM users WHERE id = ?1`, userID).Scan(&since, &found)
	if err != nil {
		return false, err
	}
	return found || g.Now().Sub(time.UnixMilli(since)) >= RoyalNewDays*24*time.Hour, nil
}

// RoyalOn says whether Роял plays on the day of t (in Bulgaria): on RoyalDays, and on every other while it's nightly.
func (g *Game) RoyalOn(t time.Time) bool {
	if slices.Contains(RoyalDays, t.In(Bulgaria).Weekday()) {
		return true
	}
	p, err := g.RoyalPaceOf(context.Background())
	if err != nil {
		slog.Error("royal pace", "err", err)
	}
	return p.Nightly
}
