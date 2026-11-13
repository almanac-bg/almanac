package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	mrand "math/rand/v2"
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Роял is a tournament played in each one's own time: up to RoyalSize players on the same RoyalLength questions,
// easy to hard, in three rounds; the first wrong answer is the way out. Players place by how far they got, then by
// how quick; the places move their ratings against everyone else in it. A tournament ends when everyone in a full
// one has played, or RoyalOpen after it began.

const (
	RoyalSize   = 20
	RoyalLength = 15
	// RoyalRound is how many questions a round has (three rounds: easy, medium, hard).
	RoyalRound = 5
	RoyalOpen  = 24 * time.Hour
)

var ErrNoRoyal = errors.New("no such royal")

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

// JoinRoyal puts the player in a tournament and gives them their run: back into one they haven't finished, else
// into the fullest open one they aren't in yet, else a new one.
func (g *Game) JoinRoyal(ctx context.Context, userID int64) (State, int64, error) {
	var s State
	var royalID int64
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		now := store.Ms(g.Now())
		var runID int64
		err := tx.QueryRow(`SELECT p.royal_id, p.run_id FROM royal_players p JOIN royals t ON t.id = p.royal_id
			JOIN runs r ON r.id = p.run_id WHERE p.user_id = ? AND t.ended_at IS NULL AND r.finished_at IS NULL`, userID).
			Scan(&royalID, &runID)
		if err == nil {
			r, err := load(tx, userID, runID)
			if err != nil {
				return err
			}
			s, err = g.state(tx, r)
			return err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var questions string
		err = tx.QueryRow(`SELECT t.id, t.questions FROM royals t WHERE t.ended_at IS NULL AND t.closes_at > ?
			AND (SELECT count(*) FROM royal_players WHERE royal_id = t.id) < ?
			AND NOT EXISTS (SELECT 1 FROM royal_players WHERE royal_id = t.id AND user_id = ?)
			ORDER BY (SELECT count(*) FROM royal_players WHERE royal_id = t.id) DESC, t.created_at LIMIT 1`,
			now, RoyalSize, userID).Scan(&royalID, &questions)
		var picks []Pick
		switch {
		case err == nil:
			if err := json.Unmarshal([]byte(questions), &picks); err != nil {
				return err
			}
		case errors.Is(err, sql.ErrNoRows):
			seen, err := seenBy(tx, userID)
			if err != nil {
				return err
			}
			picks = drawRoyal(g.Bank(), seen, mrand.New(mrand.NewPCG(newSeed(), newSeed())))
			if len(picks) < RoyalLength {
				return ErrNoQuestion
			}
			data, _ := json.Marshal(picks)
			res, err := tx.Exec(`INSERT INTO royals (questions, created_at, closes_at) VALUES (?, ?, ?)`,
				string(data), now, now+RoyalOpen.Milliseconds())
			if err != nil {
				return err
			}
			royalID, _ = res.LastInsertId()
		default:
			return err
		}
		r, err := g.insertRun(tx, userID, "royal", nil, nil, picks)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO royal_players (royal_id, user_id, run_id, joined_at) VALUES (?, ?, ?, ?)`,
			royalID, userID, r.id, now); err != nil {
			return err
		}
		s, err = g.state(tx, r)
		return err
	})
	return s, royalID, err
}

// royalRunDone ends a tournament once a just-finished run makes it full and played by all.
func (g *Game) royalRunDone(ctx context.Context, runID int64) error {
	var royalID int64
	var players, done int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT p.royal_id,
			(SELECT count(*) FROM royal_players WHERE royal_id = p.royal_id),
			(SELECT count(*) FROM royal_players q JOIN runs r ON r.id = q.run_id WHERE q.royal_id = p.royal_id
				AND r.finished_at IS NOT NULL)
		FROM royal_players p JOIN royals t ON t.id = p.royal_id WHERE p.run_id = ? AND t.ended_at IS NULL`, runID).
		Scan(&royalID, &players, &done)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil || players < RoyalSize || done < players {
		return err
	}
	return g.settleRoyal(ctx, royalID)
}

type royalist struct {
	user          int64
	name          string
	rights        int
	ms            int64
	rating, rated int
	place, delta  int
}

// settleRoyal ends a tournament: places by how far each got (then how quick), and ratings moved by each place
// against everyone else's (with three or more in it).
func (g *Game) settleRoyal(ctx context.Context, royalID int64) error {
	if err := g.ensureSeason(ctx); err != nil { // a new month's game counts for the new season
		return err
	}
	var list []royalist
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT p.user_id, u.name, coalesce(r.rights, 0), coalesce(r.ms, 0), u.rating, u.rated
			FROM royal_players p JOIN users u ON u.id = p.user_id LEFT JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ? AND r.at > 0`, royalID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var p royalist
			if err := rows.Scan(&p.user, &p.name, &p.rights, &p.ms, &p.rating, &p.rated); err != nil {
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
			for i := range list {
				sum := 0.0
				for j := range list {
					if i == j {
						continue
					}
					score := 0.5
					if list[i].place < list[j].place {
						score = 1
					} else if list[i].place > list[j].place {
						score = 0
					}
					sum += float64(eloDelta(list[i].rating, list[j].rating, list[i].rated, score))
				}
				list[i].delta = int(math.Round(sum / float64(len(list)-1)))
			}
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
		_, err = tx.Exec(`UPDATE royals SET ended_at = ? WHERE id = ?`, store.Ms(g.Now()), royalID)
		return err
	})
	if err != nil {
		return err
	}
	for _, p := range list {
		if _, err := g.Award(ctx, p.user); err != nil {
			return err
		}
		if g.RoyalNews != nil {
			g.RoyalNews(ctx, RoyalNews{To: p.user, Place: p.place, Of: len(list), Delta: p.delta})
		}
	}
	return nil
}

// RoyalNews is told to each player in a tournament when it ends.
type RoyalNews struct {
	To        int64
	Place, Of int
	Delta     int
}

// settleRoyalsDue ends the tournaments whose time is up.
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
	for _, id := range ids {
		if err := g.settleRoyal(ctx, id); err != nil {
			return err
		}
	}
	return rows.Err()
}

// RoyalPlayer is a player in a tournament as others see them: how far they got, and whether they're out.
type RoyalPlayer struct {
	Name    string `json:"name"`
	Tag     string `json:"tag"`
	Reached int    `json:"reached"` // questions answered right
	Out     bool   `json:"out"`     // a wrong answer (or the time) ended their run before the last question
	Done    bool   `json:"done"`
	Place   int    `json:"place,omitempty"`
	Delta   int    `json:"delta,omitempty"`
	Me      bool   `json:"me,omitempty"`
	Look
}

// Royal is a tournament as one of its players sees it.
type Royal struct {
	ID       int64         `json:"id"`
	Length   int           `json:"length"`
	Round    int           `json:"round"`
	Size     int           `json:"size"`
	ClosesAt int64         `json:"closesAt"`
	EndedAt  int64         `json:"endedAt,omitempty"`
	Players  []RoyalPlayer `json:"players"`
	RunID    int64         `json:"runId,omitempty"`
}

// RoyalsOf are the tournaments a player is in: open ones first, then the latest ended.
func (g *Game) RoyalsOf(ctx context.Context, userID int64) ([]Royal, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT t.id, t.closes_at, coalesce(t.ended_at, 0), coalesce(p.run_id, 0)
		FROM royal_players p JOIN royals t ON t.id = p.royal_id WHERE p.user_id = ?
		ORDER BY t.ended_at IS NOT NULL, coalesce(t.ended_at, t.created_at) DESC LIMIT 20`, userID)
	if err != nil {
		return nil, err
	}
	var out []Royal
	for rows.Next() {
		v := Royal{Length: RoyalLength, Round: RoyalRound, Size: RoyalSize, Players: []RoyalPlayer{}}
		if err := rows.Scan(&v.ID, &v.ClosesAt, &v.EndedAt, &v.RunID); err != nil {
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
				coalesce(r.finished_at IS NOT NULL, 0), coalesce(p.place, 0), coalesce(p.delta, 0), `+lookColumns+`
			FROM royal_players p JOIN users u ON u.id = p.user_id LEFT JOIN runs r ON r.id = p.run_id
			WHERE p.royal_id = ? ORDER BY p.place IS NULL, p.place, coalesce(r.rights, 0) DESC, coalesce(r.ms, 0)`, out[i].ID)
		if err != nil {
			return nil, err
		}
		for players.Next() {
			var p RoyalPlayer
			var id int64
			var avatar, title string
			var points int
			if err := players.Scan(&id, &p.Name, &p.Tag, &p.Reached, &p.Done, &p.Place, &p.Delta,
				&avatar, &title, &points); err != nil {
				players.Close()
				return nil, err
			}
			p.Look, p.Me = lookOf(id, avatar, title, points), id == userID
			p.Out = p.Done && p.Reached < RoyalLength
			out[i].Players = append(out[i].Players, p)
		}
		players.Close()
	}
	return out, nil
}
