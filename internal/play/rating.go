package play

import (
	"context"
	"math"
	"strconv"
	"time"
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

// Ranked is a player on a board: who they are, and the number the board is by (a rating, a week's points).
type Ranked struct {
	Name     string    `json:"name"`
	Tag      string    `json:"tag"`
	Value    int       `json:"value"`
	Division *Division `json:"division,omitempty"`
	Me       bool      `json:"me,omitempty"`
	Look
}

// Ranking is a board: the best, and the viewer's place on it (0: not on it).
type Ranking struct {
	Top   []Ranked `json:"top"`
	Place int      `json:"place,omitempty"`
	Mine  *Ranked  `json:"mine,omitempty"`
}

// BoardSize is how many a board shows.
const BoardSize = 50

// RatingBoard is the best by rating, among those who have played a duel that counts.
func (g *Game) RatingBoard(ctx context.Context, viewer int64) (Ranking, error) {
	return g.ranking(ctx, viewer, `SELECT u.id, u.name, u.tag, u.rating, `+lookColumns+`
		FROM users u WHERE u.rated > 0 ORDER BY u.rating DESC, u.rated DESC, u.id`, true)
}

// WeekBoard is the most points this week (from Monday, in Bulgaria), every game counted.
func (g *Game) WeekBoard(ctx context.Context, viewer int64) (Ranking, error) {
	now := g.Now().In(Bulgaria)
	monday := time.Date(now.Year(), now.Month(), now.Day()-(int(now.Weekday())+6)%7, 0, 0, 0, 0, Bulgaria)
	return g.ranking(ctx, viewer, `SELECT u.id, u.name, u.tag, w.points, `+lookColumns+`
		FROM (SELECT user_id, sum(points) AS points FROM runs WHERE finished_at >= `+strconv.FormatInt(monday.UnixMilli(), 10)+`
			GROUP BY user_id) w JOIN users u ON u.id = w.user_id
		WHERE w.points > 0 ORDER BY w.points DESC, u.id`, false)
}

// ranking reads a board from a query of (id, name, tag, value, look columns), best first.
func (g *Game) ranking(ctx context.Context, viewer int64, query string, divisions bool) (Ranking, error) {
	var out Ranking
	rows, err := g.DB.Read.QueryContext(ctx, query)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	out.Top = []Ranked{}
	for place := 1; rows.Next(); place++ {
		var r Ranked
		var id int64
		var avatar, title string
		var points int
		if err := rows.Scan(&id, &r.Name, &r.Tag, &r.Value, &avatar, &title, &points); err != nil {
			return out, err
		}
		r.Look, r.Me = lookOf(id, avatar, title, points), id == viewer
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
