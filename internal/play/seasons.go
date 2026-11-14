package play

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Seasons are the rating's: a calendar month in Bulgaria. Rated games (duels, Роял) count for the season they're
// played in; a player with MinSeasonGames of them is placed on its board. When the month ends the board is kept —
// its first three take the season's podium: a medal, a frame in its metal, and a title that counts how many times
// („Трикратен шампион“, „Двукратен вицешампион“) — and every rating goes halfway back to the start: the strong stay
// ahead, but each month is a race again.

const (
	// MinSeasonGames is how many rated games a season takes to be placed in it: a win or two isn't a season.
	MinSeasonGames = 10
)

// softened is a rating as the next season starts it: halfway back to the start.
func softened(rating int) int { return StartRating + (rating-StartRating)/2 }

// seasonOf is the season a moment is in (YYYY-MM).
func seasonOf(t time.Time) string { return t.In(Bulgaria).Format("2006-01") }

// SeasonNews is told to each player placed in a season when it ends.
type SeasonNews struct {
	To        int64
	Season    string
	Place, Of int
}

// ensureSeason ends the season being played if its month is over: it places everyone with enough games in it,
// softens every rating and starts the season of now. It runs before anything that moves a rating and every minute,
// so that no game of a new month counts for the old one; it's cheap once the season is the month's.
func (g *Game) ensureSeason(ctx context.Context) error {
	now := seasonOf(g.Now())
	g.seasonMu.Lock()
	defer g.seasonMu.Unlock()
	if g.season == now {
		return nil
	}
	var news []SeasonNews
	err := g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var open string
		err := tx.QueryRow(`SELECT id FROM season`).Scan(&open)
		if errors.Is(err, sql.ErrNoRows) {
			_, err = tx.Exec(`INSERT INTO season (id) VALUES (?)`, now)
			return err
		}
		if err != nil || open >= now {
			return err
		}
		// The board as it ends: the same order as RatingBoard's.
		if _, err := tx.Exec(`INSERT INTO season_results (season, user_id, place, rating, games)
			SELECT ?, id, row_number() OVER (ORDER BY rating DESC, season_games DESC, id), rating, season_games
			FROM users WHERE season_games >= ?`, open, MinSeasonGames); err != nil {
			return err
		}
		rows, err := tx.Query(`SELECT user_id, place, count(*) OVER () FROM season_results WHERE season = ?`, open)
		if err != nil {
			return err
		}
		for rows.Next() {
			n := SeasonNews{Season: open}
			if err := rows.Scan(&n.To, &n.Place, &n.Of); err != nil {
				rows.Close()
				return err
			}
			news = append(news, n)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		// SQLite's integer division goes towards zero, as softened's does.
		if _, err := tx.Exec(`UPDATE users SET rating = ?1 + (rating - ?1) / 2, season_games = 0
			WHERE rating <> ?1 OR season_games <> 0`, StartRating); err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE season SET id = ?`, now)
		return err
	})
	if err != nil {
		return err
	}
	g.season = now
	if g.SeasonNews != nil {
		for _, n := range news {
			g.SeasonNews(ctx, n)
		}
	}
	return nil
}

// Season is the season as a player sees it: which month, the days left, their games in it and their place on its
// board now, and how the seasons before ended for them.
type Season struct {
	ID       string `json:"id"` // YYYY-MM
	DaysLeft int    `json:"daysLeft"`
	MinGames int    `json:"minGames"`
	Games    int    `json:"games"`
	// Place is where the player stands on the season's board now (0: not placed yet), of Of placed.
	Place int `json:"place,omitempty"`
	Of    int `json:"of"`
	// Podium is how many seasons the player has ended first, second and third.
	Podium Podium       `json:"podium"`
	Past   []PastSeason `json:"past"`
}

// PastSeason is how a season ended for a player placed in it.
type PastSeason struct {
	ID       string   `json:"id"`
	Place    int      `json:"place"`
	Of       int      `json:"of"`
	Rating   int      `json:"rating"`
	Division Division `json:"division"`
}

// SeasonOf is the season now, as a player sees it (0: nobody signed in, the season alone).
func (g *Game) SeasonOf(ctx context.Context, userID int64) (Season, error) {
	if err := g.ensureSeason(ctx); err != nil {
		return Season{}, err
	}
	now := g.Now().In(Bulgaria)
	s := Season{ID: seasonOf(now), MinGames: MinSeasonGames, Past: []PastSeason{}}
	end := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, Bulgaria)
	s.DaysLeft = int(end.Sub(now).Hours()/24) + 1
	db := g.DB.Read
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE season_games >= ?`, MinSeasonGames).
		Scan(&s.Of); err != nil || userID == 0 {
		return s, err
	}
	var rating int
	if err := db.QueryRowContext(ctx, `SELECT rating, season_games FROM users WHERE id = ?`, userID).
		Scan(&rating, &s.Games); err != nil {
		return s, err
	}
	if s.Games >= MinSeasonGames {
		if err := db.QueryRowContext(ctx, `SELECT 1 + count(*) FROM users WHERE season_games >= ?1
			AND (rating > ?2 OR (rating = ?2 AND (season_games > ?3 OR (season_games = ?3 AND id < ?4))))`,
			MinSeasonGames, rating, s.Games, userID).Scan(&s.Place); err != nil {
			return s, err
		}
	}
	rows, err := db.QueryContext(ctx, `SELECT r.season, r.place, r.rating,
			(SELECT count(*) FROM season_results x WHERE x.season = r.season)
		FROM season_results r WHERE r.user_id = ? ORDER BY r.season DESC`, userID)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var p PastSeason
		if err := rows.Scan(&p.ID, &p.Place, &p.Rating, &p.Of); err != nil {
			return s, err
		}
		p.Division, _ = DivisionOf(p.Rating)
		if p.Place <= len(s.Podium) {
			s.Podium[p.Place-1]++
		}
		s.Past = append(s.Past, p)
	}
	return s, rows.Err()
}

// Podium is how many seasons a player has ended in each of the first three places.
type Podium [3]int

// podiumOf is a player's podium.
func (g *Game) podiumOf(ctx context.Context, userID int64) (Podium, error) {
	var p Podium
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT place, count(*) FROM season_results WHERE user_id = ? AND place <= 3
		GROUP BY place`, userID)
	if err != nil {
		return p, err
	}
	defer rows.Close()
	for rows.Next() {
		var place, n int
		if err := rows.Scan(&place, &n); err != nil {
			return p, err
		}
		p[place-1] = n
	}
	return p, rows.Err()
}

// best is the best place a player has ended a season in (0: none on the podium).
func (p Podium) best() int {
	for i, n := range p {
		if n > 0 {
			return i + 1
		}
	}
	return 0
}
