package play

import (
	"context"
	"hash/fnv"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Daily goals and seasons. Every day a player has three goals: the day's questions, and two more drawn for them.
// Each one done is a star, and a season (a calendar month in Bulgaria) counts the stars: enough of them earn the
// season's medal — bronze, silver, gold — and the gold one the season's own frame.

// Goal is one of the day's goals: what to do, and how much of it.
type Goal struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Target int    `json:"target"`
}

// Goals are every goal there is; the first is every day's.
var Goals = []Goal{
	{"day", "Изиграй въпросите на деня", 1},
	{"right15", "Отговори вярно на 15 въпроса", 15},
	{"topic", "Изиграй игра по тема", 1},
	{"duel", "Изиграй дуел", 1},
	{"royal", "Влез в Роял", 1},
	{"points500", "Събери 500 точки", 500},
	{"fast3", "Три верни отговора за под 5 секунди", 3},
}

// GoalsPerDay is how many goals a day has.
const GoalsPerDay = 3

// SeasonTiers are the stars each season medal takes: bronze, silver, gold (and with gold, the season's frame).
var SeasonTiers = []struct {
	Stars int    `json:"stars"`
	ID    string `json:"id"`
	Name  string `json:"name"`
}{{10, "bronze", "Бронзов"}, {30, "silver", "Сребърен"}, {60, "gold", "Златен"}}

// goalsFor are a player's goals on a day: the day's questions, and two of the rest, drawn by the player and the day
// (the same all day, another the next).
func goalsFor(userID int64, day string) []Goal {
	rest := append([]Goal(nil), Goals[1:]...)
	h := fnv.New64a()
	_, _ = h.Write([]byte(strconv.FormatInt(userID, 10) + "/" + day))
	seed := h.Sum64()
	out := []Goal{Goals[0]}
	for len(out) < GoalsPerDay && len(rest) > 0 {
		i := int(seed % uint64(len(rest)))
		seed /= uint64(len(rest)) + 1
		out = append(out, rest[i])
		rest = append(rest[:i], rest[i+1:]...)
	}
	return out
}

// DayGoal is a goal as the player sees it today: how far along, and whether done.
type DayGoal struct {
	Goal
	Progress int  `json:"progress"`
	Done     bool `json:"done"`
}

// dayBounds are the day's start and end, in milliseconds.
func dayBounds(day string) (int64, int64) {
	t, _ := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	return t.UnixMilli(), t.AddDate(0, 0, 1).UnixMilli()
}

// GoalsOf are the player's goals for today, with how far along each is; any newly done is kept (a star).
func (g *Game) GoalsOf(ctx context.Context, userID int64) ([]DayGoal, error) {
	day := g.Today()
	from, to := dayBounds(day)
	var dayDone, topics, duels, royals, points int
	var right, fast int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'day' AND day = ?4 AND finished_at IS NOT NULL),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'topic' AND finished_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'duel' AND finished_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'royal' AND finished_at BETWEEN ?2 AND ?3),
		(SELECT coalesce(sum(points), 0) FROM runs WHERE user_id = ?1 AND finished_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1 AND a.is_right AND a.at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1 AND a.is_right AND a.ms < 5000
			AND a.at BETWEEN ?2 AND ?3)`, userID, from, to, day).
		Scan(&dayDone, &topics, &duels, &royals, &points, &right, &fast)
	if err != nil {
		return nil, err
	}
	reached := map[string]int{"day": dayDone, "right15": right, "topic": topics, "duel": duels, "royal": royals,
		"points500": points, "fast3": fast}
	now := store.Ms(g.Now())
	var out []DayGoal
	for _, goal := range goalsFor(userID, day) {
		d := DayGoal{Goal: goal, Progress: min(reached[goal.ID], goal.Target)}
		d.Done = d.Progress >= goal.Target
		if d.Done {
			if _, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO goals_done (user_id, day, goal, at) VALUES (?, ?, ?, ?)`,
				userID, day, goal.ID, now); err != nil {
				return nil, err
			}
		}
		out = append(out, d)
	}
	return out, nil
}

// Season is a season as a player sees it: which month, their stars, the medals' tiers, and the days left.
type Season struct {
	ID       string `json:"id"` // YYYY-MM
	Stars    int    `json:"stars"`
	DaysLeft int    `json:"daysLeft"`
	// Hue is the season's colour (0–359), from its month: its art and frame are drawn in it.
	Hue   int          `json:"hue"`
	Tiers any          `json:"tiers"`
	Past  []PastSeason `json:"past"`
}

// PastSeason is a season gone by: its stars, and the medal they earned ("" for none).
type PastSeason struct {
	ID    string `json:"id"`
	Stars int    `json:"stars"`
	Medal string `json:"medal,omitempty"`
	Hue   int    `json:"hue"`
}

// seasonHue is a season's colour: the months go round the colour wheel, a step a month.
func seasonHue(id string) int {
	t, err := time.Parse("2006-01", id)
	if err != nil {
		return 45
	}
	months := t.Year()*12 + int(t.Month())
	return (months * 137) % 360
}

func medalOf(stars int) string {
	medal := ""
	for _, t := range SeasonTiers {
		if stars >= t.Stars {
			medal = t.ID
		}
	}
	return medal
}

// SeasonOf is the player's season now, and the ones before.
func (g *Game) SeasonOf(ctx context.Context, userID int64) (Season, error) {
	now := g.Now().In(Bulgaria)
	s := Season{ID: now.Format("2006-01"), Tiers: SeasonTiers, Past: []PastSeason{}}
	s.Hue = seasonHue(s.ID)
	end := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, Bulgaria)
	s.DaysLeft = int(end.Sub(now).Hours()/24) + 1
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT substr(day, 1, 7), count(*) FROM goals_done WHERE user_id = ?
		GROUP BY substr(day, 1, 7) ORDER BY 1 DESC`, userID)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return s, err
		}
		if id == s.ID {
			s.Stars = n
			continue
		}
		s.Past = append(s.Past, PastSeason{ID: id, Stars: n, Medal: medalOf(n), Hue: seasonHue(id)})
	}
	return s, rows.Err()
}

// SeasonBoard is the most stars this season.
func (g *Game) SeasonBoard(ctx context.Context, viewer int64) (Ranking, error) {
	month := g.Now().In(Bulgaria).Format("2006-01")
	return g.ranking(ctx, viewer, `SELECT u.id, u.name, u.tag, s.stars, `+lookColumns+`
		FROM (SELECT user_id, count(*) AS stars FROM goals_done WHERE substr(day, 1, 7) = '`+month+`' GROUP BY user_id) s
		JOIN users u ON u.id = s.user_id ORDER BY s.stars DESC, u.id`, false)
}

// goldSeasons are the seasons a player earned gold in: each one's frame is theirs.
func (g *Game) goldSeasons(ctx context.Context, userID int64) ([]string, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT substr(day, 1, 7) FROM goals_done WHERE user_id = ?
		GROUP BY substr(day, 1, 7) HAVING count(*) >= ?`, userID, SeasonTiers[len(SeasonTiers)-1].Stars)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
