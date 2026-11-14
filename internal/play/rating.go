package play

import (
	"context"
	"encoding/json"
	"math"
	"slices"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Rating is a player's strength in duels: Elo, from 1000, moved by every duel that counts. It shows as a division.

// StartRating is where every player starts.
const StartRating = 1000

// Division is a band of rating with a name: Бронз to Легенда.
type Division struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	From int    `json:"from"`
}

// Divisions from the lowest up; each begins at From. Everyone starts in Бронз; a few wins make Сребро, and each
// division after takes more (Elo keeps the average near the start, so the top ones stay rare).
var Divisions = []Division{
	{"bronze", "Бронз", 0},
	{"silver", "Сребро", 1050},
	{"gold", "Злато", 1150},
	{"platinum", "Платина", 1300},
	{"diamond", "Диамант", 1450},
	{"legend", "Легенда", 1600},
}

// DivisionOf is the division a rating is in, and where the next one starts (0 at the top).
func DivisionOf(rating int) (Division, int) {
	d, next := Divisions[0], 0
	for i, x := range Divisions {
		if rating >= x.From {
			d, next = x, 0
			if i+1 < len(Divisions) {
				next = Divisions[i+1].From
			}
		}
	}
	return d, next
}

// k is how far one duel moves a rating: more while a player's rating is still finding its level.
func k(rated int) float64 {
	if rated < 20 {
		return 40
	}
	return 24
}

// eloDelta is how much a duel moves a rating: score is 1 for a win, 0.5 a draw, 0 a loss.
func eloDelta(rating, against, rated int, score float64) int {
	expected := 1 / (1 + math.Pow(10, float64(against-rating)/400))
	return int(math.Round(k(rated) * (score - expected)))
}

// Standing is a player's rating as they see it.
type Standing struct {
	Rating   int      `json:"rating"`
	Rated    int      `json:"rated"`
	Division Division `json:"division"`
	// Next is the rating the next division starts at (0 at the top).
	Next int `json:"next"`
}

// StandingOf reads a player's rating.
func (g *Game) StandingOf(ctx context.Context, userID int64) (Standing, error) {
	var s Standing
	err := g.DB.Read.QueryRowContext(ctx, `SELECT rating, rated FROM users WHERE id = ?`, userID).Scan(&s.Rating, &s.Rated)
	s.Division, s.Next = DivisionOf(s.Rating)
	return s, err
}

// Ranked is a player on a board: who they are, and the number the board is by (a rating, XP, a share right).
type Ranked struct {
	Name     string    `json:"name"`
	Tag      string    `json:"tag"`
	Value    int       `json:"value"`
	Division *Division `json:"division,omitempty"`
	// Answers is what a board of knowledge counts a share of.
	Answers int  `json:"answers,omitempty"`
	Me      bool `json:"me,omitempty"`
	Look
}

// Ranking is a board: the best, and the viewer's place on it (0: not on it).
type Ranking struct {
	Top   []Ranked `json:"top"`
	Place int      `json:"place,omitempty"`
	Mine  *Ranked  `json:"mine,omitempty"`
}

const (
	// BoardSize is how many a board shows.
	BoardSize = 50
	// KnowAll is how many answers a player needs to be on the board of knowledge, and KnowTopic in one topic: a
	// share of a few is luck.
	KnowAll   = 100
	KnowTopic = 30
)

// among limits a board's query over users u to the viewer and their friends (friends), or not at all; ?9 is the
// viewer.
func among(friends bool) string {
	if !friends {
		return ""
	}
	return ` AND (u.id = ?9 OR u.id IN (SELECT friend_id FROM friends WHERE user_id = ?9))`
}

// RatingBoard is the season's board: everyone (or the viewer's friends) with MinSeasonGames rated games in it, by
// rating. As it stands when the month ends, it's the season's result.
func (g *Game) RatingBoard(ctx context.Context, viewer int64, friends bool) (Ranking, error) {
	if err := g.ensureSeason(ctx); err != nil {
		return Ranking{}, err
	}
	return g.ranking(ctx, viewer, `SELECT u.id, u.name, u.tag, u.rating, 0, `+lookColumns+`
		FROM users u WHERE u.season_games >= ?1`+among(friends)+`
		ORDER BY u.rating DESC, u.season_games DESC, u.id`, true, MinSeasonGames)
}

// LevelBoard is the most XP ever earned (the highest levels): who has played the most, and the most knowingly.
func (g *Game) LevelBoard(ctx context.Context, viewer int64, friends bool) (Ranking, error) {
	return g.ranking(ctx, viewer, `SELECT u.id, u.name, u.tag, x.xp, 0, `+lookColumns+`
		FROM (SELECT user_id, sum(xp) AS xp FROM (SELECT user_id, xp FROM runs UNION ALL SELECT user_id, xp FROM goals_done)
			GROUP BY user_id) x JOIN users u ON u.id = x.user_id
		WHERE x.xp > 0`+among(friends)+` ORDER BY x.xp DESC, u.id`, false)
}

// KnowledgeBoard is the best share of right answers, over every topic ("") or in one, among those with enough
// answers there (KnowAll, KnowTopic): who knows the most, whatever the speed. A time-out counts as wrong.
func (g *Game) KnowledgeBoard(ctx context.Context, viewer int64, friends bool, topic string) (Ranking, error) {
	b := g.Bank()
	ids, least := "", KnowAll // no list: every answer
	if topic != "" {
		if !slices.ContainsFunc(b.Categories, func(c bank.Category) bool { return c.ID == topic }) {
			return Ranking{}, ErrNoTopic
		}
		var list []string
		for _, q := range b.Questions {
			if q.Base().Category == topic {
				list = append(list, q.Base().ID)
			}
		}
		raw, err := json.Marshal(list)
		if err != nil {
			return Ranking{}, err
		}
		ids, least = string(raw), KnowTopic
	}
	return g.ranking(ctx, viewer, `SELECT u.id, u.name, u.tag, CAST(round(100.0 * k.ok / k.n) AS INTEGER), k.n, `+
		lookColumns+`
		FROM (SELECT r.user_id, count(*) AS n, sum(a.is_right) AS ok FROM answers a JOIN runs r ON r.id = a.run_id
			WHERE ?2 = '' OR a.question_id IN (SELECT value FROM json_each(?2))
			GROUP BY r.user_id HAVING count(*) >= ?1) k JOIN users u ON u.id = k.user_id
		WHERE 1`+among(friends)+` ORDER BY 1.0 * k.ok / k.n DESC, k.n DESC, u.id`, false, least, ids)
}

// ranking reads a board from a query of (id, name, tag, value, answers, look columns), best first; its arguments
// are ?1, ?2…, and ?9 is the viewer.
func (g *Game) ranking(ctx context.Context, viewer int64, query string, divisions bool, args ...any) (Ranking, error) {
	var out Ranking
	params := make([]any, 9) // ?1…?8, then the viewer
	copy(params, args)
	params[8] = viewer
	rows, err := g.DB.Read.QueryContext(ctx, query, params...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	out.Top = []Ranked{}
	for place := 1; rows.Next(); place++ {
		var r Ranked
		var id int64
		var avatar, title string
		var xp int
		if err := rows.Scan(&id, &r.Name, &r.Tag, &r.Value, &r.Answers, &avatar, &title, &xp); err != nil {
			return out, err
		}
		r.Look, r.Me = lookOf(id, avatar, title, xp), id == viewer
		if divisions {
			d, _ := DivisionOf(r.Value)
			r.Division = &d
		}
		if r.Me {
			out.Place, out.Mine = place, &r
		}
		if place <= BoardSize {
			out.Top = append(out.Top, r)
		} else if viewer == 0 || out.Mine != nil {
			break
		}
	}
	return out, rows.Err()
}
