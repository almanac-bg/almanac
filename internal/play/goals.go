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
// type of question. Each can be done that day: Роял only while the evening's is still ahead (and not for a new player
// while the evenings are thin: NudgeRoyal), nothing mostly luck. What counts on a day is what was played on it, and
// the day's questions count on their own day, all ten, though the last answers came after midnight (onDay): so a day
// run begun at 23:58 finishes that day's goals, not the next's. A goal done earns its tier's XP, kept as it's done
// (whether or not the player looks; after.go keeps the goals of the day a game counts on, whenever that's done) and
// told once, at the end of the game that did it. A day with all three done also earns a reserve day for the streak
// (runs.go), and counts towards the achievements for full days.

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
	{id: "fast5", family: "fast", tier: 1, target: 5, name: "Отговори вярно 5 пъти, всеки път за по-малко от 5 секунди",
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
	{id: "friendDuel", family: "duel", tier: 1, target: 1, friends: true, name: "Изиграй предизвикателство с приятел",
		href: "/friends", reached: func(t *tally, _ string) int { return t.friendDuels }},
	{id: "royal", family: "royal", tier: 1, target: 1, evening: true, name: "Влез в Роял довечера", href: "/royal",
		reached: func(t *tally, _ string) int { return t.royals }},

	{id: "right30", family: "right", tier: 2, target: 30, name: "Отговори вярно на 30 въпроса", href: "/play/all",
		reached: func(t *tally, _ string) int { return t.right }},
	{id: "fast8", family: "fast", tier: 2, target: 8, name: "Отговори вярно 8 пъти, всеки път за по-малко от 5 секунди",
		href: "/play/all", reached: func(t *tally, _ string) int { return t.fast }},
	{id: "eight", family: "perfect", tier: 2, target: 1, name: "Отговори вярно на поне 8 от 10 въпроса в една игра",
		href: "/play/all", reached: func(t *tally, _ string) int { return t.eight }},
	{id: "topics3", family: "topic", tier: 2, target: 3, name: "Изиграй игри по три различни теми",
		reached: func(t *tally, _ string) int { return t.distinctTopics() }},
	{id: "duelWin", family: "duel", tier: 2, target: 1, name: "Спечели дуел", href: "/duel",
		reached: func(t *tally, _ string) int { return t.duelWins }},

	// Retired: goals that couldn't be done most days (the evening Роял rarely lasts to a fifth question; a game without a mistake, or a number to the unit, is mostly luck). Kept for a day
	// they were drawn for.
	{id: "right40", family: "right", tier: 2, target: 40, retired: true, name: "Отговори вярно на 40 въпроса",
		href: "/play/all", reached: func(t *tally, _ string) int { return t.right }},
	{id: "fast12", family: "fast", tier: 2, target: 12, retired: true,
		name: "Отговори вярно 12 пъти, всеки път за по-малко от 5 секунди", href: "/play/all",
		reached: func(t *tally, _ string) int { return t.fast }},
	{id: "perfect", family: "perfect", tier: 2, target: 1, retired: true, name: "Изиграй цяла игра без грешка",
		href: "/play/all", reached: func(t *tally, _ string) int { return t.perfect }},
	{id: "exact", family: "type", tier: 2, target: 1, retired: true, name: "Познай число точно", href: "/play/all",
		reached: func(t *tally, _ string) int { return t.exact }},
	{id: "royal5", family: "royal", tier: 2, target: 5, retired: true, name: "Отговори вярно на 5 въпроса в Роял",
		href: "/royal", reached: func(t *tally, _ string) int { return t.royalBest }},
}

// goalTypes are the types of question a goal can be about, as its name says them (a choice is every game's; no goal).
// A rare one is no longer drawn (kept for a day it was drawn for): a split comes in every other game at most (it takes
// turns with clues, draw.go newKind), so three right ones take six games or more, not one day's play.
var goalTypes = []struct {
	id, words string
	rare      bool
}{
	{"number", "с число", false},
	{"order", "с подреждане", false},
	{"match", "с двойки", false},
	{"split", "с две групи", true},
	{"truefalse", "„Вярно или невярно“", false},
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
			if !t.rare && len(b.Live("", t.id)) > 0 { // a kind the bank has none of yet makes no goal
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
	return g.goalsOn(ctx, userID, g.Today())
}

// goalsOn are the player's goals of a day, with how far along each is; any newly done is kept, with its XP. A day
// past is as it was left (tallyOf): only a run of its questions finished after midnight, within DayGrace, adds to it,
// and what follows that run keeps the goals it finished (afterRun).
func (g *Game) goalsOn(ctx context.Context, userID int64, day string) ([]DayGoal, error) {
	ids, err := g.dayGoals(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	t, err := g.tallyOf(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	kept, err := keptGoals(ctx, g.DB.Read, userID, day)
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
		if d.Done && !kept[id] { // the writer only for a goal newly done: a look at the goals reads alone
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
	if evening { // and not for a new player while the evenings are thin
		if evening, err = g.NudgeRoyal(ctx, userID); err != nil {
			return nil, err
		}
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

// GoalsMoved are the player's goals of the day a game (runID) counts for (played: today's, or yesterday's for the day's
// questions finished after midnight) that it moved without finishing them, with how far along each is now: its news
// says so, in the card of the goals it finished (a goal finished is told as done).
func (g *Game) GoalsMoved(ctx context.Context, userID, runID int64) ([]DayGoal, error) {
	p, err := g.playedOf(ctx, userID, runID)
	if err != nil {
		return nil, err
	}
	day := p.day
	ids, err := storedGoals(ctx, g.DB.Read, userID, day)
	if err != nil || len(ids) == 0 {
		return nil, err
	}
	before, err := g.tallyWithout(ctx, userID, day, runID)
	if err != nil {
		return nil, err
	}
	after, err := g.tallyOf(ctx, userID, day)
	if err != nil {
		return nil, err
	}
	b := g.Bank()
	var out []DayGoal
	for _, id := range ids {
		goal, k, arg, ok := goalOf(b, id)
		if !ok {
			continue
		}
		now, was := min(k.reached(after, arg), goal.Target), min(k.reached(before, arg), goal.Target)
		if now > was && now < goal.Target {
			out = append(out, DayGoal{Goal: goal, Progress: now, XP: GoalXP[k.tier]})
		}
	}
	return out, nil
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

// keptGoals are the player's goals of a day kept as done (goals_done).
func keptGoals(ctx context.Context, db *sql.DB, userID int64, day string) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, `SELECT goal FROM goals_done WHERE user_id = ? AND day = ?`, userID, day)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	kept := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		kept[id] = true
	}
	return kept, rows.Err()
}

// tally is how far a player's day has got, by every measure a goal has.
type tally struct {
	day, duels, duelWins, friendDuels, royals, royalBest, perfect, eight int
	right, fast, row, exact                                              int
	topics                                                               map[string]int // topic games, by topic ("": all of them)
	rightIn                                                              map[string]int // right answers, by topic
	rightOf                                                              map[string]int // right answers, by type of question
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

// onDay is a SQL condition on a run (r): that it's finished and counts on a day, ?2 and ?3 its bounds in ms and ?4
// its date. A run of the day's questions counts on its own day, though its last answer came after midnight
// (DayGrace); any other game on the day it ended.
func onDay(r string) string {
	return `(` + r + `.finished_at IS NOT NULL AND CASE WHEN ` + r + `.kind = 'day' THEN ` + r + `.day = ?4
		ELSE ` + r + `.finished_at BETWEEN ?2 AND ?3 END)`
}

// tallyOf is how far a player's day has got: the games they finished and the answers they gave that day.
func (g *Game) tallyOf(ctx context.Context, userID int64, day string) (*tally, error) {
	return g.tallyWithout(ctx, userID, day, 0)
}

// tallyWithout is how far a player's day had got without one of its games (except; 0 for none): where their goals
// stood before it, for its news to say which goals it moved.
func (g *Game) tallyWithout(ctx context.Context, userID int64, day string, except int64) (*tally, error) {
	from, to := dayBounds(day)
	t := &tally{topics: map[string]int{}, rightIn: map[string]int{}, rightOf: map[string]int{}}
	db := g.DB.Read
	// A duel won counts the day it ends (a challenge may end days after its sender played); against a recording too.
	// A duel with a friend is a challenge between the two, the player's game in it played that day (the sender's, or
	// the taker's). Роял counts the day it's entered.
	err := db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'day' AND day = ?4 AND finished_at IS NOT NULL AND id <> ?6),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'duel' AND finished_at BETWEEN ?2 AND ?3 AND id <> ?6),
		(SELECT count(*) FROM duels WHERE ended_at BETWEEN ?2 AND ?3 AND (?6 = 0 OR ?6 NOT IN (coalesce(a_run, -1), coalesce(b_run, -1)))
			AND ((a_id = ?1 AND outcome IN ('a', 'ghost_won')) OR (b_id = ?1 AND outcome = 'b'))),
		(SELECT count(DISTINCT r.id) FROM duels d JOIN runs r ON r.id = CASE WHEN d.a_id = ?1 THEN d.a_run ELSE d.ghost_run END
			WHERE d.kind = 'challenge' AND d.b_id IS NOT NULL AND (d.a_id = ?1 OR d.b_id = ?1)
				AND r.finished_at BETWEEN ?2 AND ?3 AND r.id <> ?6),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'royal' AND started_at BETWEEN ?2 AND ?3 AND id <> ?6),
		(SELECT coalesce(max(rights), 0) FROM runs WHERE user_id = ?1 AND kind = 'royal' AND started_at BETWEEN ?2 AND ?3
			AND id <> ?6),
		(SELECT count(*) FROM runs r WHERE r.user_id = ?1 AND `+onDay("r")+` AND r.rights > 0
			AND r.rights = json_array_length(r.questions) AND r.id <> ?6),
		(SELECT count(*) FROM runs r WHERE r.user_id = ?1 AND `+onDay("r")+`
			AND json_array_length(r.questions) = ?5 AND r.rights >= ?5 - 2 AND r.id <> ?6)`, userID, from, to, day, Length, except).
		Scan(&t.day, &t.duels, &t.duelWins, &t.friendDuels, &t.royals, &t.royalBest, &t.perfect,
			&t.eight)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT category, count(*) FROM runs
		WHERE user_id = ? AND kind = 'topic' AND finished_at BETWEEN ? AND ? AND id <> ? GROUP BY category`,
		userID, from, to, except)
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
	// The day's answers, game by game in their order (for a row): a game begun before midnight counts from it, but
	// the day's questions are their own day's, all ten, though the last came after midnight.
	rows, err = db.QueryContext(ctx, `SELECT a.run_id, a.question_id, a.is_right, a.ms, coalesce(a.given, '')
		FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ?1 AND r.started_at >= ?2 - 86400000 AND r.started_at < ?3 AND r.id <> ?5
			AND CASE WHEN r.kind = 'day' THEN r.day = ?4 ELSE a.at BETWEEN ?2 AND ?3 END
		ORDER BY a.run_id, a.n`, userID, from, to, day, except)
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
