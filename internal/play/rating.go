package play

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strconv"
)

// Rating is a player's strength in duels: Elo, from 1000, moved by every duel that counts. It shows as a division once
// it's set: its first MinRatedGames games place it (Placed), and until then it says so, „Рейтингът се определя · 4 от
// 10“, not „Бронз“ from a win or two. It has no seasons.

// StartRating is where every player starts.
const StartRating = 1000

// Division is a band of rating with a name: Бронз to Легенда. Reaching one first unlocks a title, a frame or a
// pattern (wardrobe.go).
type Division struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	From int    `json:"from"`
}

// Divisions from the lowest up; each begins at From. Elo keeps the average near the start (duels are zero-sum), so
// the bands are set by the share of players in each, not by the start: a placed player of average strength is in
// Сребро, about a third are below it in Бронз, and each division above takes more, the top ones rare. With Сребро
// from above the start (it was 1050), more than half of all players read „Бронз“ after every duel for good (review
// 2026-11-18, E5); /admin's share of players by division says whether the bands still fit.
var Divisions = []Division{
	{"bronze", "Бронз", 0},
	{"silver", "Сребро", 900},
	{"gold", "Злато", 1050},
	{"platinum", "Платина", 1200},
	{"diamond", "Диамант", 1350},
	{"legend", "Легенда", 1500},
}

// Placed says whether a rating is set, from so many rated games: until then it shows no division.
func Placed(rated int) bool { return rated >= MinRatedGames }

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
	// Of is how many rated games place the rating (MinRatedGames), while it's still being set (not Placed): then it
	// shows as „Рейтингът се определя · Rated от Of“, not by its division. 0 once placed.
	Of int `json:"of,omitempty"`
}

// standingAt is a rating from so many rated games, as a player sees it.
func standingAt(rating, rated int) Standing {
	s := Standing{Rating: rating, Rated: rated}
	s.Division, s.Next = DivisionOf(rating)
	if !Placed(rated) {
		s.Of = MinRatedGames
	}
	return s
}

// StandingOf reads a player's rating.
func (g *Game) StandingOf(ctx context.Context, userID int64) (Standing, error) {
	var rating, rated int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT rating, rated FROM users WHERE id = ?`, userID).Scan(&rating, &rated)
	return standingAt(rating, rated), err
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
	// Answers is, on the board of knowledge, the viewer's answers while they're short of the board: how far they are.
	Answers *int `json:"answers,omitempty"`
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

// MinRatedGames is how many rated games set a rating (Placed), and put a player on the rating's board and in a
// division: a win or two isn't a rating yet.
const MinRatedGames = 10

// onRatingBoard is who's on the rating's board, as the index of it (users_rated) says it: SQLite uses an index of
// some rows only for a query that says the very same of them, a number written out, not one bound.
var onRatingBoard = "u.rated >= " + strconv.Itoa(MinRatedGames)

// RatingBoard is the rating's board: everyone (or the viewer's friends) with MinRatedGames rated games, by rating
// (then more rated games, then who came first). The best are read in order from the board's index; the viewer's
// place, if they're further down, is counted there, never walked to; names and looks only for those shown
// (rankingOf). It's all one read, so the viewer's place and the best agree.
func (g *Game) RatingBoard(ctx context.Context, viewer int64, friends bool) (Ranking, error) {
	tx, err := g.DB.Read.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Ranking{}, err
	}
	defer tx.Rollback() //nolint:errcheck // a read: nothing to keep
	rows, err := tx.QueryContext(ctx, `SELECT u.id, u.rating FROM users u WHERE `+onRatingBoard+among(friends)+`
		ORDER BY u.rating DESC, u.rated DESC, u.id LIMIT ?1`, BoardSize, viewer)
	if err != nil {
		return Ranking{}, err
	}
	var list []ranked
	placed := viewer == 0 // nothing of the viewer's to find
	for rows.Next() {
		r := ranked{place: len(list) + 1}
		if err := rows.Scan(&r.id, &r.value); err != nil {
			rows.Close()
			return Ranking{}, err
		}
		list = append(list, r)
		placed = placed || r.id == viewer
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return Ranking{}, err
	}
	if !placed {
		var rating, rated, ahead int
		err := tx.QueryRowContext(ctx, `SELECT rating, rated FROM users WHERE id = ?`, viewer).Scan(&rating, &rated)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Ranking{}, err
		}
		if rated >= MinRatedGames {
			// Ahead of them: a better rating, or the same with more rated games, or the same games and earlier.
			if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users u WHERE `+onRatingBoard+among(friends)+`
				AND u.rating >= ?1 AND NOT (u.rating = ?1 AND (u.rated < ?3 OR u.rated = ?3 AND u.id >= ?2))`,
				rating, viewer, rated).Scan(&ahead); err != nil {
				return Ranking{}, err
			}
			list = append(list, ranked{id: viewer, place: ahead + 1, value: rating})
		}
	}
	tx.Rollback() //nolint:errcheck // done reading; its connection back before rankingOf takes one
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
