package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"hash/fnv"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Daily goals: every day a player has three — the day's questions, a goal drawn for them, and a harder one drawn too —
// kept once drawn (day_goals), so that they stay the day's whatever changes. They come in families (how many right,
// in a row, how fast, a topic, a type of question, a game nearly without a mistake, duels, Роял); the two drawn are
// never of one family, nor of a family drawn the day before, and some are about something drawn with them: a topic, a
// type of question. Each can be done that day: Роял only while the evening's is still ahead, nothing that needs
// players the game may not have at once (Арена), nothing mostly luck. A goal done earns its tier's XP, kept as it's done (whether or not the player looks) and told
// once, at the end of the game that did it. A day with all three done earns a reserve day for the streak (runs.go),
// and counts towards the achievements for full days.

// Goal is one of the day's goals: what to do, how much of it, and where it's done.
type Goal struct {
	ID     string `json:"id"` // its kind, and what it's about after a colon: topic:history
	Name   string `json:"name"`
	Target int    `json:"target"`
	Href   string `json:"href,omitempty"` // where it's done; none: anywhere, or right here (the day's questions)
}

// GoalsPerDay is how many goals a day has.
const GoalsPerDay = 3

// GoalXP is what a goal done earns, by its tier: the day's questions, the goal drawn, the harder one. All three are
// worth about a game and a half.
var GoalXP = [GoalsPerDay]int{50, 100, 150}

// goalKind is a kind of goal. A kind about something has "{}" in its name and its place, for the topic or the type of
// question it's drawn with.
type goalKind struct {
	id, family string
	tier       int
	target     int
	about      string // what it's drawn with: "topic", "type", or nothing
	friends    bool   // drawn only for a player with a friend
	evening    bool   // drawn only while the day's Роял is still ahead
	retired    bool   // no longer drawn; kept so that a day it was drawn for still counts it
	name, href string
	reached    func(t *tally, arg string) int
}

// goalKinds are every kind of goal there is; the first is every day's.
var goalKinds = []goalKind{
	{id: "day", tier: 0, target: 1, name: "Изиграй въпросите на деня", reached: func(t *tally, _ string) int { return t.day }},

	{id: "right20", family: "right", tier: 1, target: 20, name: "Отговори вярно на 20 въпроса", href: "/play/all",
		reached: func(t *tally, _ string) int { return t.right }},
	{id: "row5", family: "row", tier: 1, target: 5, name: "Отговори вярно на 5 въпроса поред", href: "/play/all",
		reached: func(t *tally, _ string) int { return t.row }},
	{id: "fast5", family: "fast", tier: 1, target: 5, name: "Отговори вярно 5 пъти за по-малко от 5 секунди",
		href: "/play/all", reached: func(t *tally, _ string) int { return t.fast }},
	{id: "topic", family: "topic", tier: 1, target: 1, about: "topic", name: "Изиграй игра по тема „{}“",
		href: "/play/{}", reached: func(t *tally, c string) int { return t.topics[c] }},
	{id: "know", family: "topic", tier: 1, target: 5, about: "topic", name: "Отговори вярно на 5 въпроса по тема „{}“",
		href: "/play/{}", reached: func(t *tally, c string) int { return t.rightIn[c] }},
	{id: "topics2", family: "topic", tier: 1, target: 2, name: "Изиграй игри по две различни теми",
		reached: func(t *tally, _ string) int { return t.distinctTopics() }},
	{id: "type", family: "type", tier: 1, target: 3, about: "type", name: "Отговори вярно на 3 въпроса {}",
		href: "/play/all", reached: func(t *tally, ty string) int { return t.rightOf[ty] }},
	{id: "duel", family: "duel", tier: 1, target: 1, name: "Изиграй дуел", href: "/duel",
		reached: func(t *tally, _ string) int { return t.duels }},
	{id: "friendDuel", family: "duel", tier: 1, target: 1, friends: true, name: "Изиграй дуел с приятел",
		href: "/friends", reached: func(t *tally, _ string) int { return t.friendDuels }},
	{id: "royal", family: "royal", tier: 1, target: 1, evening: true, name: "Влез в Роял довечера", href: "/royal",
		reached: func(t *tally, _ string) int { return t.royals }},

	{id: "right30", family: "right", tier: 2, target: 30, name: "Отговори вярно на 30 въпроса", href: "/play/all",
		reached: func(t *tally, _ string) int { return t.right }},
	{id: "fast8", family: "fast", tier: 2, target: 8, name: "Отговори вярно 8 пъти за по-малко от 5 секунди",
		href: "/play/all", reached: func(t *tally, _ string) int { return t.fast }},
	{id: "eight", family: "perfect", tier: 2, target: 1, name: "Отговори вярно на поне 8 от 10 въпроса в една игра",
		href: "/play/all", reached: func(t *tally, _ string) int { return t.eight }},
	{id: "topics3", family: "topic", tier: 2, target: 3, name: "Изиграй игри по три различни теми",
		reached: func(t *tally, _ string) int { return t.distinctTopics() }},
	{id: "duelWin", family: "duel", tier: 2, target: 1, name: "Спечели дуел", href: "/duel",
		reached: func(t *tally, _ string) int { return t.duelWins }},

	// Retired: goals that couldn't be done most days (Арена needs three players at once; the evening Роял rarely
	// lasts to a fifth question; a game without a mistake, or a number to the unit, is mostly luck). Kept for a day
	// they were drawn for.
	{id: "arena", family: "arena", tier: 1, target: 1, retired: true, name: "Изиграй игра в Арената", href: "/arena",
		reached: func(t *tally, _ string) int { return t.arenas }},
	{id: "right40", family: "right", tier: 2, target: 40, retired: true, name: "Отговори вярно на 40 въпроса",
		href: "/play/all", reached: func(t *tally, _ string) int { return t.right }},
	{id: "fast12", family: "fast", tier: 2, target: 12, retired: true,
		name: "Отговори вярно 12 пъти за по-малко от 5 секунди", href: "/play/all",
		reached: func(t *tally, _ string) int { return t.fast }},
	{id: "perfect", family: "perfect", tier: 2, target: 1, retired: true, name: "Изиграй цяла игра без грешка",
		href: "/play/all", reached: func(t *tally, _ string) int { return t.perfect }},
	{id: "exact", family: "type", tier: 2, target: 1, retired: true, name: "Познай число точно", href: "/play/all",
		reached: func(t *tally, _ string) int { return t.exact }},
	{id: "arenaWin", family: "arena", tier: 2, target: 1, retired: true, name: "Спечели игра в Арената",
		href: "/arena", reached: func(t *tally, _ string) int { return t.arenaWins }},
	{id: "royal5", family: "royal", tier: 2, target: 5, retired: true, name: "Отговори вярно на 5 въпроса в Роял",
		href: "/royal", reached: func(t *tally, _ string) int { return t.royalBest }},
}

// goalTypes are the types of question a goal can be about, as its name says them (a choice is every game's; no goal).
var goalTypes = []struct{ id, words string }{
	{"number", "с число"},
	{"order", "с подреждане"},
	{"match", "със свързване"},
	{"split", "с разделяне"},
	{"truefalse", "„Вярно или невярно“"},
}

// args are what a kind of goal can be about, in the bank as it is.
func (k goalKind) args(b *bank.Bank) []string {
	var out []string
	switch k.about {
	case "topic":
		for _, c := range b.Categories {
			out = append(out, c.ID)
		}
	case "type":
		for _, t := range goalTypes {
			if len(b.Live("", t.id)) > 0 { // a kind the bank has none of yet makes no goal
				out = append(out, t.id)
			}
		}
	}
	return out
}

// goalOf is a goal by its id, with its kind and what it's about; not ok if there's no such kind any more, or nothing
// it was about (a topic gone from the bank).
func goalOf(b *bank.Bank, id string) (Goal, goalKind, string, bool) {
	kindID, arg, _ := strings.Cut(id, ":")
	for _, k := range goalKinds {
		if k.id != kindID || (k.about == "") != (arg == "") {
			continue
		}
		words := ""
		switch k.about {
		case "topic":
			for _, c := range b.Categories {
				if c.ID == arg {
					words = c.Name
				}
			}
		case "type":
			for _, t := range goalTypes {
				if t.id == arg {
					words = t.words
				}
			}
		}
		if k.about != "" && words == "" {
			return Goal{}, goalKind{}, "", false
		}
		return Goal{ID: id, Name: strings.ReplaceAll(k.name, "{}", words), Target: k.target,
			Href: strings.ReplaceAll(k.href, "{}", arg)}, k, arg, true
	}
	return Goal{}, goalKind{}, "", false
}

// drawGoals are a day's goals: the day's questions, then one of each tier after it, drawn by the seed. The two drawn
// are of two families, neither drawn the day before (unless nothing else is left), need a friend only if the player
// has one, and the evening's Роял only while it's still ahead (evening): each can be done that day.
func drawGoals(seed uint64, b *bank.Bank, friends, evening bool, yesterday []string) []string {
	r := rand.New(rand.NewPCG(seed, seed>>32|seed<<32))
	before := map[string]bool{}
	for _, id := range yesterday {
		if _, k, _, ok := goalOf(b, id); ok && k.family != "" {
			before[k.family] = true
		}
	}
	out := []string{goalKinds[0].id}
	used := map[string]bool{}
	for tier := 1; tier < GoalsPerDay; tier++ {
		var drawn []goalKind
		for _, fresh := range []bool{true, false} {
			for _, k := range goalKinds {
				if k.tier == tier && !k.retired && !used[k.family] && (!fresh || !before[k.family]) &&
					(friends || !k.friends) && (evening || !k.evening) && (k.about == "" || len(k.args(b)) > 0) {
					drawn = append(drawn, k)
				}
			}
			if len(drawn) > 0 {
				break
			}
		}
		if len(drawn) == 0 {
			continue
		}
		k := drawn[r.IntN(len(drawn))]
		id := k.id
		if args := k.args(b); len(args) > 0 {
			id += ":" + args[r.IntN(len(args))]
		}
		used[k.family] = true
		out = append(out, id)
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
	ids, err := g.dayGoals(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	t, err := g.tallyOf(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	b := g.Bank()
	now := store.Ms(g.Now())
	out := []DayGoal{}
	for _, id := range ids {
		goal, k, arg, ok := goalOf(b, id)
		if !ok {
			continue
		}
		d := DayGoal{Goal: goal, Progress: min(k.reached(t, arg), goal.Target), XP: GoalXP[k.tier]}
		d.Done = d.Progress >= goal.Target
		if d.Done {
			if _, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO goals_done (user_id, day, goal, at, xp, seen)
				VALUES (?, ?, ?, ?, ?, 0)`, userID, day, id, now, d.XP); err != nil {
				return nil, err
			}
		}
		out = append(out, d)
	}
	return out, nil
}

// dayGoals are the ids of the player's goals on a day, drawn and kept the first time they're asked for.
func (g *Game) dayGoals(ctx context.Context, userID int64, day string) ([]string, error) {
	ids, err := storedGoals(ctx, g.DB.Read, userID, day)
	if err != nil || len(ids) > 0 {
		return ids, err
	}
	t, _ := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	yesterday := t.AddDate(0, 0, -1).Format(time.DateOnly)
	before, err := storedGoals(ctx, g.DB.Read, userID, yesterday)
	if err != nil {
		return nil, err
	}
	var friends bool
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM friends WHERE user_id = ?)`, userID).
		Scan(&friends); err != nil {
		return nil, err
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(strconv.FormatInt(userID, 10) + "/" + day))
	evening := false
	if g.RoyalAt != nil {
		now := g.Now()
		evening = g.RoyalAt(now).In(Bulgaria).Format(time.DateOnly) == day && day == now.In(Bulgaria).Format(time.DateOnly)
	}
	drawn := drawGoals(h.Sum64(), g.Bank(), friends, evening, before)
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM day_goals WHERE user_id = ? AND day < ?`, userID, yesterday); err != nil {
			return err
		}
		for n, id := range drawn {
			if _, err := tx.Exec(`INSERT OR IGNORE INTO day_goals (user_id, day, n, goal) VALUES (?, ?, ?, ?)`,
				userID, day, n, id); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return storedGoals(ctx, g.DB.Write, userID, day) // the ones kept, should another look have drawn them first
}

// storedGoals are the ids of a player's goals kept for a day, in their order.
func storedGoals(ctx context.Context, db *sql.DB, userID int64, day string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT goal FROM day_goals WHERE user_id = ? AND day = ? ORDER BY n`, userID, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// tally is how far a player's day has got, by every measure a goal has.
type tally struct {
	day, duels, duelWins, friendDuels, royals, royalBest, arenas, arenaWins, perfect, eight int
	right, fast, row, exact                                                                 int
	topics                                                                                  map[string]int // topic games, by topic ("": all of them)
	rightIn                                                                                 map[string]int // right answers, by topic
	rightOf                                                                                 map[string]int // right answers, by type of question
}

// distinctTopics is how many topics the day's topic games were of.
func (t *tally) distinctTopics() int {
	n := 0
	for c, games := range t.topics {
		if c != "" && games > 0 {
			n++
		}
	}
	return n
}

// fastMs is how quick an answer is for a goal of speed.
const fastMs = 5000

// tallyOf is how far a player's day has got: the games they finished and the answers they gave that day.
func (g *Game) tallyOf(ctx context.Context, userID int64, day string) (*tally, error) {
	from, to := dayBounds(day)
	t := &tally{topics: map[string]int{}, rightIn: map[string]int{}, rightOf: map[string]int{}}
	db := g.DB.Read
	// A duel won counts the day it ends (a friend's challenge may end days after the challenger played); against a
	// recording too. Роял counts the day it's entered.
	err := db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'day' AND day = ?4 AND finished_at IS NOT NULL),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'duel' AND finished_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM duels WHERE ended_at BETWEEN ?2 AND ?3
			AND ((a_id = ?1 AND outcome IN ('a', 'ghost_won')) OR (b_id = ?1 AND outcome = 'b'))),
		(SELECT count(*) FROM duels d JOIN runs r ON r.id = CASE WHEN d.a_id = ?1 THEN d.a_run ELSE d.b_run END
			WHERE d.kind = 'friend' AND (d.a_id = ?1 OR d.b_id = ?1) AND r.finished_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'royal' AND started_at BETWEEN ?2 AND ?3),
		(SELECT coalesce(max(rights), 0) FROM runs WHERE user_id = ?1 AND kind = 'royal' AND started_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM arena_players p JOIN arenas a ON a.id = p.arena_id
			WHERE p.user_id = ?1 AND a.played_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM arena_players p JOIN arenas a ON a.id = p.arena_id
			WHERE p.user_id = ?1 AND p.place = 1 AND a.played_at BETWEEN ?2 AND ?3),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND finished_at BETWEEN ?2 AND ?3 AND rights > 0
			AND rights = json_array_length(questions)),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND finished_at BETWEEN ?2 AND ?3
			AND json_array_length(questions) = ?5 AND rights >= ?5 - 2)`, userID, from, to, day, Length).
		Scan(&t.day, &t.duels, &t.duelWins, &t.friendDuels, &t.royals, &t.royalBest, &t.arenas, &t.arenaWins, &t.perfect,
			&t.eight)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT category, count(*) FROM runs
		WHERE user_id = ? AND kind = 'topic' AND finished_at BETWEEN ? AND ? GROUP BY category`, userID, from, to)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c sql.NullString
		var n int
		if err := rows.Scan(&c, &n); err != nil {
			rows.Close()
			return nil, err
		}
		t.topics[c.String] += n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// The day's answers, game by game in their order (for a row); a game begun before midnight counts from it.
	rows, err = db.QueryContext(ctx, `SELECT a.run_id, a.question_id, a.is_right, a.ms, coalesce(a.given, '')
		FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? AND r.started_at >= ? AND a.at BETWEEN ? AND ? ORDER BY a.run_id, a.n`,
		userID, from-24*time.Hour.Milliseconds(), from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	b := g.Bank()
	var run int64
	row := 0
	for rows.Next() {
		var id int64
		var question, given string
		var right bool
		var ms int64
		if err := rows.Scan(&id, &question, &right, &ms, &given); err != nil {
			return nil, err
		}
		if id != run {
			run, row = id, 0
		}
		if !right {
			row = 0
			continue
		}
		row++
		t.row = max(t.row, row)
		t.right++
		if ms < fastMs {
			t.fast++
		}
		q, ok := b.Get(question)
		if !ok {
			continue
		}
		head := q.Base()
		t.rightIn[head.Category]++
		t.rightOf[head.Type]++
		var a bank.NumberAnswer
		if n, isNumber := q.(*bank.Number); isNumber && json.Unmarshal([]byte(given), &a) == nil && n.Exact(a.Value) {
			t.exact++
		}
	}
	return t, rows.Err()
}
