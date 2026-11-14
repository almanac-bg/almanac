package play

import (
	"context"
	"database/sql"
	"math"

	"github.com/almanac-bg/almanac/internal/store"
)

// Арена is played live, in a room the room package fills (3 to 5 players, matched at random); here its places are
// kept and move the ratings, as a Роял's do.

// ArenaPlace is how one player ended an arena: their place (equal points, equal place), points and right answers.
type ArenaPlace struct {
	UserID int64
	Place  int
	Points int
	Rights int
}

// placeDeltas is what places do to ratings: each player's place against each other one's counts as a duel won, lost
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

// SettleArena keeps an arena's places and moves each player's rating by them; it says by how much, per player.
func (g *Game) SettleArena(ctx context.Context, list []ArenaPlace) (map[int64]int, error) {
	deltas := map[int64]int{}
	if len(list) == 0 {
		return deltas, nil
	}
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		places, ratings, rated := make([]int, len(list)), make([]int, len(list)), make([]int, len(list))
		for i, p := range list {
			places[i] = p.Place
			if err := tx.QueryRow(`SELECT rating, rated FROM users WHERE id = ?`, p.UserID).Scan(&ratings[i], &rated[i]); err != nil {
				return err // a player gone (an account deleted mid-game) leaves the whole game unkept
			}
		}
		moved := placeDeltas(places, ratings, rated)
		res, err := tx.Exec(`INSERT INTO arenas (played_at) VALUES (?)`, store.Ms(g.Now()))
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		for i, p := range list {
			if _, err := tx.Exec(`INSERT INTO arena_players (arena_id, user_id, place, points, rights, delta)
				VALUES (?, ?, ?, ?, ?, ?)`, id, p.UserID, p.Place, p.Points, p.Rights, moved[i]); err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE users SET rating = max(0, rating + ?1), peak = max(peak, rating + ?1),
				rated = rated + 1 WHERE id = ?2`, moved[i], p.UserID); err != nil {
				return err
			}
			deltas[p.UserID] = moved[i]
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, p := range list {
		if _, err := g.Award(ctx, p.UserID); err != nil {
			return deltas, err
		}
	}
	return deltas, nil
}
