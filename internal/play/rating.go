package play

import (
	"context"
	"math"
)

// Rating is a player's strength in duels: Elo, from 1000, moved by every duel that counts. It shows as a division. It
// has no seasons: the weekly race is the leagues' (leagues.go), on playing, not on strength.

// StartRating is where every player starts.
const StartRating = 1000

// Division is a band of rating with a name: Бронз to Легенда. Reaching one first unlocks a title, a frame or a
// pattern (wardrobe.go).
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

// Ranked is a player on a board: who they are, and the number the board is by (a rating, or the percent of a topic
// known).
type Ranked struct {
	Name     string    `json:"name"`
	Tag      string    `json:"tag"`
	Value    int       `json:"value"`
	Division *Division `json:"division,omitempty"`
	// Answers is how many answers a board of knowledge has the mastery from, and Tier the mastery's name.
	Answers int    `json:"answers,omitempty"`
	Tier    string `json:"tier,omitempty"`
	Me      bool   `json:"me,omitempty"`
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
	// mark from a few is luck.
	KnowAll   = 100
	KnowTopic = 30
)

// among limits a board's query over users u to the viewer and their friends (friends), or not at all; ?2 is the
// viewer.
func among(friends bool) string {
	if !friends {
		return ""
	}
	return ` AND (u.id = ?2 OR u.id IN (SELECT friend_id FROM friends WHERE user_id = ?2))`
}

// MinRatedGames is how many rated games put a player on the rating's board: a win or two isn't a rating yet.
const MinRatedGames = 10

// RatingBoard is the rating's board: everyone (or the viewer's friends) with MinRatedGames rated games, by rating.
// Only who's where goes over everyone; names and looks are read for those shown (rankingOf).
func (g *Game) RatingBoard(ctx context.Context, viewer int64, friends bool) (Ranking, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT u.id, u.rating FROM users u WHERE u.rated >= ?1`+among(friends)+`
		ORDER BY u.rating DESC, u.rated DESC, u.id`, MinRatedGames, viewer)
	if err != nil {
		return Ranking{}, err
	}
	defer rows.Close()
	var list []ranked
	placed := viewer == 0 // nothing of the viewer's to find
	for place := 1; rows.Next(); place++ {
		var r ranked
		if err := rows.Scan(&r.id, &r.value); err != nil {
			return Ranking{}, err
		}
		r.place = place
		if place <= BoardSize || r.id == viewer {
			list = append(list, r)
		}
		placed = placed || r.id == viewer
		if place >= BoardSize && placed {
			break
		}
	}
	if err := rows.Err(); err != nil {
		return Ranking{}, err
	}
	rows.Close()
	return g.rankingOf(ctx, viewer, list, true)
}

// placeDeltas is what places in a game of many (Роял) do to ratings: each player's place against each other one's counts as a duel won, lost
// or drawn, and the rating moves by the average of those.
func placeDeltas(places, ratings, rated []int) []int {
	out := make([]int, len(places))
	if len(places) < 2 {
		return out
	}
	for i := range places {
		sum := 0.0
		for j := range places {
			if i == j {
				continue
			}
			score := 0.5
			if places[i] < places[j] {
				score = 1
			} else if places[i] > places[j] {
				score = 0
			}
			sum += float64(eloDelta(ratings[i], ratings[j], rated[i], score))
		}
		out[i] = int(math.Round(sum / float64(len(places)-1)))
	}
	return out
}
