package play

import (
	"context"
	"database/sql"
	"encoding/json"
	mrand "math/rand/v2"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Роял is played live, every evening: up to RoyalSize players on the same RoyalLength questions at the same moment,
// easy to hard in three rounds, and the first wrong answer (or the time running out) is the way out. Players place
// by how far they got, then by how quick; the places move their ratings against everyone else in it.
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

func drawRoyal(b *bank.Bank, seen map[string]bool, r *mrand.Rand) []Pick {
	var pool []bank.Question
	for _, q := range b.Live("", "") {
		if t := q.Base().Type; t == "choice" || t == "truefalse" {
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

// DrawRoyal draws an evening's questions, leaving out (while there are others) those of the last month's evenings.
func (g *Game) DrawRoyal(ctx context.Context) ([]Pick, error) {
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
	picks := drawRoyal(g.Bank(), seen, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
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

// RevealRoyal shows the answer to the question now: whoever hasn't answered it is out (the time ran out on them, or
// they're gone).
func (g *Game) RevealRoyal(ctx context.Context, royalID int64) error {
	var late []struct{ user, run int64 }
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT r.user_id, r.id FROM runs r JOIN royal_players p ON p.run_id = r.id
			JOIN royals t ON t.id = p.royal_id WHERE t.id = ? AND r.finished_at IS NULL AND r.at = t.n`, royalID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var l struct{ user, run int64 }
			if err := rows.Scan(&l.user, &l.run); err != nil {
				rows.Close()
				return err
			}
			late = append(late, l)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, l := range late {
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
		}
		_, err = tx.Exec(`UPDATE royals SET phase = 'reveal', phase_at = ? WHERE id = ?`, store.Ms(g.Now()), royalID)
		return err
	})
	if err != nil {
		return err
	}
	for _, l := range late {
		if err := g.afterRun(ctx, l.user); err != nil {
			return err
		}
	}
	return nil
}

// AnswerRoyal grades a player's answer to a tournament's question n, the one showing. A wrong one ends their run.
func (g *Game) AnswerRoyal(ctx context.Context, userID, runID int64, n int, answer json.RawMessage) (Result, error) {
	return g.answer(ctx, userID, runID, n, answer, true)
}

// RoyalStanding is where a player came in a tournament, once it's ended.
type RoyalStanding struct {
	User  int64
	Place int
	Delta int
}

// SettleRoyal ends a tournament: places by how far each got (then how quick), and ratings moved by each place
// against everyone else's (with three or more in it). An ended one is left as it is.
func (g *Game) SettleRoyal(ctx context.Context, royalID int64) ([]RoyalStanding, error) {
	type royalist struct {
		user          int64
		rights        int
		ms            int64
		rating, rated int
		place, delta  int
	}
	if err := g.ensureSeason(ctx); err != nil { // a new month's game counts for the new season
		return nil, err
	}
	var list []royalist
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var ended bool
		if err := tx.QueryRow(`SELECT ended_at IS NOT NULL FROM royals WHERE id = ?`, royalID).Scan(&ended); err != nil {
			return err
		}
		if ended {
			return nil
		}
		// Anyone still mid-question (the server was down when the game should have gone on) is out where they are.
		if _, err := tx.Exec(`UPDATE runs SET shown_at = NULL, finished_at = ? WHERE finished_at IS NULL
			AND id IN (SELECT run_id FROM royal_players WHERE royal_id = ?)`, store.Ms(g.Now()), royalID); err != nil {
			return err
		}
		rows, err := tx.Query(`SELECT p.user_id, r.rights, r.ms, u.rating, u.rated
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
			list = append(list, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		better := func(a, b royalist) int {
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
				if _, err := tx.Exec(`UPDATE users SET rating = max(0, rating + ?1), peak = max(peak, rating + ?1), rated = rated + 1, season_games = season_games + 1 WHERE id = ?2`,
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
		if _, err := g.Award(ctx, p.user); err != nil {
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
		list, err := g.SettleRoyal(ctx, id)
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
				coalesce(r.rights, 0), coalesce(r.ms, 0), coalesce(r.finished_at IS NOT NULL, 0)
			FROM royal_players p JOIN users u ON u.id = p.user_id LEFT JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ? ORDER BY p.joined_at, p.user_id`, out[i].ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var p LiveRoyalist
			if err := rows.Scan(&p.User, &p.Name, &p.Tag, &p.Run, &p.At, &p.Right, &p.Ms, &p.Out); err != nil {
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
