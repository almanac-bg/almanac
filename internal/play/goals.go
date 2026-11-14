package play

import (
	"context"
	"hash/fnv"
	"strconv"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Daily goals: every day a player has three, the day's questions and two more drawn for them. Each one done earns
// GoalXP, kept as it's done (whether or not the player looks) and told once, at the end of the game that did it.

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
	{"xp400", "Спечели 400 XP от игри", 400},
	{"fast3", "Три верни отговора за по-малко от 5 секунди", 3},
}

const (
	// GoalsPerDay is how many goals a day has.
	GoalsPerDay = 3
	// GoalXP is what a goal done earns: about half a game's, so that all three are worth a game and a half.
	GoalXP = 100
)

// goalByID is a goal by its id.
func goalByID(id string) (Goal, bool) {
	for _, g := range Goals {
		if g.ID == id {
			return g, true
		}
	}
	return Goal{}, false
}

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

// DayGoal is a goal as the player sees it today: how far along, whether done, and what it earns.
type DayGoal struct {
	Goal
	Progress int  `json:"progress"`
	Done     bool `json:"done"`
	XP       int  `json:"xp"`
}

// dayBounds are the day's start and end, in milliseconds.
func dayBounds(day string) (int64, int64) {
	t, _ := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	return t.UnixMilli(), t.AddDate(0, 0, 1).UnixMilli()
}

// GoalsOf are the player's goals for today, with how far along each is; any newly done is kept, with its XP.
func (g *Game) GoalsOf(ctx context.Context, userID int64) ([]DayGoal, error) {
	day := g.Today()
	from, to := dayBounds(day)
	var dayDone, topics, duels, royals, earned int
	var right, fast int
	// A goal for XP counts the games' XP only: what goals earn doesn't finish another.
	err := g.DB.Read.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'day' AND day = ?4 AND finished_at IS NOT NULL),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'topic' AND finished_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'duel' AND finished_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'royal' AND finished_at BETWEEN ?2 AND ?3),
		(SELECT coalesce(sum(xp), 0) FROM runs WHERE user_id = ?1 AND finished_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1 AND a.is_right AND a.at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1 AND a.is_right AND a.ms < 5000
			AND a.at BETWEEN ?2 AND ?3)`, userID, from, to, day).
		Scan(&dayDone, &topics, &duels, &royals, &earned, &right, &fast)
	if err != nil {
		return nil, err
	}
	reached := map[string]int{"day": dayDone, "right15": right, "topic": topics, "duel": duels, "royal": royals,
		"xp400": earned, "fast3": fast}
	now := store.Ms(g.Now())
	var out []DayGoal
	for _, goal := range goalsFor(userID, day) {
		d := DayGoal{Goal: goal, Progress: min(reached[goal.ID], goal.Target), XP: GoalXP}
		d.Done = d.Progress >= goal.Target
		if d.Done {
			if _, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO goals_done (user_id, day, goal, at, xp, seen)
				VALUES (?, ?, ?, ?, ?, 0)`, userID, day, goal.ID, now, GoalXP); err != nil {
				return nil, err
			}
		}
		out = append(out, d)
	}
	return out, nil
}
