package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Progress is what a player earns by playing: a level from all the XP they've earned, achievements for things
// they've done, and with them avatars and titles (titles.go) to choose from. All of it comes from the game's own records:
// nothing to buy, nothing made up.

// ErrNotYours is a title or an avatar the player hasn't earned (or one there's no such thing as).
var ErrNotYours = errors.New("not earned")

// LevelOf is the level an amount of XP reaches, with the XP where that level starts and the next one does. The first
// level-up takes 300 XP (a game or two: one earns about 150 to 250); each takes 150 more than the one before, so level
// 10 takes about forty games.
func LevelOf(total int) (level, from, to int) {
	level, from, step := 1, 0, 300
	for total >= from+step {
		from += step
		level++
		step += 150
	}
	return level, from, from + step
}

// Achievement is something a player has done, once and for good, named for the deed („Десет от десет“). Its shape is
// an avatar they may wear; some unlock a title too (titles.go).
type Achievement struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// About is how it's earned, said to whoever hasn't yet.
	About string `json:"about"`
	Icon  string `json:"icon"` // the shape it's drawn with; earning it unlocks that shape as an avatar (its reward)
	Tier  Tier   `json:"tier"`
	// Goal is how much of its measure it takes (3 days, 100 answers); 1 for a thing done once.
	Goal int `json:"goal"`
	// Hidden ones aren't told until they're earned: found while playing.
	Hidden bool `json:"hidden,omitempty"`
}

// Tier is how hard an achievement or a title is to earn: common ones come in the first days, legendary ones take
// months. A title shows in its tier's colour.
type Tier string

const (
	Common    Tier = "common"
	Rare      Tier = "rare"
	Epic      Tier = "epic"
	Legendary Tier = "legendary"
)

// Achievements are every achievement there is, by tier, in the order a profile shows them.
var Achievements = []Achievement{
	{"streak3", "Три поред", "Играй въпросите на деня три дни поред.", "flame", Common, 3, false},
	{"answers100", "Сто отговора", "Отговори на сто въпроса.", "book", Common, 100, false},
	{"fast", "Под две секунди", "Отговори вярно за по-малко от 2 секунди.", "bolt", Common, 1, false},
	{"duel1", "Първа победа", "Спечели дуел.", "shield", Common, 1, false},
	{"friend1", "Двама сме", "Добави първия си приятел в играта.", "heart", Common, 1, false},

	{"streak7", "Цяла седмица", "Играй въпросите на деня седем дни поред.", "torch", Rare, 7, false},
	{"perfect", "Десет от десет", "Познай и десетте въпроса на деня.", "star", Rare, 1, false},
	{"exact", "Точно в целта", "Познай число точно, без никаква грешка.", "target", Rare, 1, false},
	{"allTopics", "Обиколка", "Изиграй поне една игра във всяка тема.", "compass", Rare, 10, false},
	{"friends5", "Цяла компания", "Събери пет приятели в играта.", "hearts", Rare, 5, false},
	{"friendWin", "Между приятели", "Победи приятел в дуел.", "knight", Rare, 1, false},
	{"nightOwl", "След полунощ", "Отговори на въпрос между полунощ и четири сутринта.", "owl", Rare, 1, true},
	{"earlyBird", "Преди седем", "Изиграй въпросите на деня преди седем сутринта.", "sun", Rare, 1, true},
	{"lastSecond", "В последния миг", "Отговори вярно в последната секунда.", "hourglass", Rare, 1, true},

	{"streak30", "Цял месец", "Играй въпросите на деня тридесет дни поред.", "bonfire", Epic, 30, false},
	{"answers1000", "Хиляда отговора", "Отговори на хиляда въпроса.", "books", Epic, 1000, false},
	{"games100", "Сто игри", "Изиграй сто игри.", "trophy", Epic, 100, false},
	{"master", "Като на длан", "Стигни до „Майстор“ в една тема.", "cap", Epic, 1, false},
	{"duel10", "Десет победи", "Спечели десет дуела.", "blades", Epic, 10, false},
	{"topicPerfect", "Тема без грешка", "Познай и десетте въпроса на игра по тема.", "spark", Epic, 1, true},
	{"allTypes", "Всеки вид въпрос", "Отговори вярно на всеки вид въпрос: избор, число, подреждане, вярно или не, свързване.", "clover", Epic, 5, true},

	{"streak100", "Сто дни", "Играй въпросите на деня сто дни поред.", "phoenix", Legendary, 100, false},
	{"master5", "Пет теми като на длан", "Стигни до „Майстор“ в пет теми.", "wreath", Legendary, 5, false},
	{"duel50", "Петдесет победи", "Спечели петдесет дуела.", "helmet", Legendary, 50, false},
}

func achievementByID(id string) (Achievement, bool) {
	i := slices.IndexFunc(Achievements, func(a Achievement) bool { return a.ID == id })
	if i < 0 {
		return Achievement{}, false
	}
	return Achievements[i], true
}

// Avatars are a picture in a tone (web/src/art/pictures.ts draws them; a "shape" is a picture's id). The animals are
// everyone's from the start; each achievement unlocks an emblem of its own (the crown comes at a level). Within a
// family the pictures grow with the deed: a flame, a torch, a bonfire, a phoenix.
var (
	Tones      = []string{"gold", "lilac", "sky", "rose", "mint"}
	FreeShapes = []string{
		"fox", "bear", "cat", "hare", "hedgehog", "dog", "deer", "stork", "frog",
		"squirrel", "lynx", "badger", "sheep", "turtle", "mouse",
	}
	Unlockable = []string{
		"flame", "torch", "bonfire", "phoenix", "book", "books", "bolt", "hourglass", "shield", "blades", "helmet",
		"heart", "hearts", "knight", "star", "spark", "target", "compass", "owl", "sun", "trophy", "cap", "wreath",
		"clover", "crown",
	}
)

// givenShapes are the animals the game gives a player until they choose: the first nine, so that a player who hasn't
// chosen keeps the same one as the list grows.
var givenShapes = FreeShapes[:9]

// CrownLevel is the level that unlocks the crown.
const CrownLevel = 10

// DefaultAvatar is the avatar the game gives a player until they choose one: a free shape and a tone, from their id.
func DefaultAvatar(userID int64) string {
	n, shapes, tones := max(userID, 0), int64(len(givenShapes)), int64(len(Tones))
	return givenShapes[n%shapes] + "-" + Tones[n/shapes%tones]
}

// Shape is an avatar's shape as a player may pick it: free, unlocked, or still locked (and what unlocks it: the name
// of an achievement, or a level).
type Shape struct {
	Shape  string `json:"shape"`
	Locked bool   `json:"locked,omitempty"`
	How    string `json:"how,omitempty"`
}

// shapes are every shape, as a player with these achievements and this level may pick them.
func shapes(earned map[string]int64, level int) []Shape {
	list := make([]Shape, 0, len(FreeShapes)+len(Unlockable))
	for _, s := range FreeShapes {
		list = append(list, Shape{Shape: s})
	}
	for _, s := range Unlockable {
		sh := Shape{Shape: s}
		if s == "crown" {
			if level < CrownLevel {
				sh.Locked, sh.How = true, "ниво 10"
			}
		} else {
			sh.Locked = true
			for _, a := range Achievements {
				if a.Icon != s {
					continue
				}
				if _, ok := earned[a.ID]; ok {
					sh.Locked, sh.How = false, ""
					break
				}
				if sh.How == "" {
					sh.How = a.Name // the first achievement drawn with it
					if a.Hidden {
						sh.How = "скрито постижение" // found while playing: not told
					}
				}
			}
		}
		list = append(list, sh)
	}
	return list
}

// Look is how a player shows to others: their avatar, their title (a name, "" for none) and their level.
type Look struct {
	Avatar string `json:"avatar"`
	Title  string `json:"title,omitempty"`
	// TitleTier is the title's tier: it shows in that tier's colour.
	TitleTier Tier `json:"titleTier,omitempty"`
	Level     int  `json:"level"`
}

// lookOf makes a look from what lookColumns read. The avatar comes as "shape-tone/frame/backdrop" (the wardrobe's
// parts empty when none), and goes out the same way, so that every avatar drawn shows its frame and pattern.
func (g *Game) lookOf(userID int64, avatar, title string, total int) Look {
	base, rest, _ := strings.Cut(avatar, "/")
	if base == "" {
		base = DefaultAvatar(userID)
	}
	avatar = base
	if strings.Trim(rest, "/") != "" {
		avatar += "/" + rest
	}
	level, _, _ := LevelOf(total)
	name, tier := g.titleOf(title)
	return Look{Avatar: avatar, Title: name, TitleTier: tier, Level: level}
}

// lookColumns read a player's look in a query over users u: their avatar, title (a podium's with how many times) and
// XP.
var lookColumns = `coalesce(u.avatar, '') || '/' || coalesce(u.frame, '') || '/' || coalesce(u.backdrop, ''),
	CASE WHEN u.title LIKE 'podium_' THEN u.title || ':' || (SELECT count(*) FROM season_results
		WHERE user_id = u.id AND place = CAST(substr(u.title, 7) AS INTEGER)) ELSE coalesce(u.title, '') END,
	` + xpOf("u.id")

// xpOf is a SQL expression for all the XP a player (a column or a parameter) has earned: their games', and their
// goals'.
func xpOf(user string) string {
	return `((SELECT coalesce(sum(xp), 0) FROM runs WHERE user_id = ` + user + `) +
		(SELECT coalesce(sum(xp), 0) FROM goals_done WHERE user_id = ` + user + `))`
}

// LookOf is how a player shows to others.
func (g *Game) LookOf(ctx context.Context, userID int64) (Look, error) {
	var avatar, title string
	var total int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT `+lookColumns+` FROM users u WHERE u.id = ?`, userID).
		Scan(&avatar, &title, &total)
	return g.lookOf(userID, avatar, title, total), err
}

// Earned is an achievement as a player sees it: when they earned it (0: not yet), how far they are towards its
// goal, and the title it unlocks, if any. A hidden one not yet earned is told only as hidden: no name, no how, no
// reward.
type Earned struct {
	Achievement
	At       int64     `json:"at,omitempty"`
	Progress int       `json:"progress"`
	Title    *TitleRef `json:"title,omitempty"`
}

// hiddenAchievement is what a player sees of a hidden achievement they haven't found yet.
func hiddenAchievement(a Achievement) Achievement {
	return Achievement{ID: a.ID, Name: "Скрито постижение", About: "Открий го, докато играеш.", Icon: "secret",
		Tier: a.Tier, Goal: 1, Hidden: true}
}

// Progress is a player's level, every achievement (earned or not), and what they may choose to look like.
type Progress struct {
	Level        int      `json:"level"`
	XP           int      `json:"xp"`
	From         int      `json:"from"` // the XP where this level starts
	To           int      `json:"to"`   // and where the next one does
	Achievements []Earned `json:"achievements"`
	Avatar       string   `json:"avatar"`
	Title        string   `json:"title"` // the chosen title's id: one of Titles, or podium1–3 ("" for none)
	Shapes       []Shape  `json:"shapes"`
	Tones        []string `json:"tones"`
	// Standing is the player's rating and division.
	Standing Standing `json:"standing"`
	// Titles are every title, the podium's first (named by how many times they're won): the player's, or locked with
	// what unlocks them.
	Titles []TitleView `json:"titles"`
	// The wardrobe: the frame and pattern worn ("" for none), and all there are.
	Frame     string     `json:"frame"`
	Backdrop  string     `json:"backdrop"`
	Frames    []Cosmetic `json:"frames"`
	Backdrops []Cosmetic `json:"backdrops"`
}

// totalXP is all the XP a player has earned.
func (g *Game) totalXP(ctx context.Context, userID int64) (int, error) {
	var total int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT `+xpOf("?1"), userID).Scan(&total)
	return total, err
}

// Level is where a player stands on the ladder of levels: the level, all the XP earned, and where this level and the
// next begin.
type Level struct {
	Level int `json:"level"`
	XP    int `json:"xp"`
	From  int `json:"from"`
	To    int `json:"to"`
}

// LevelNow is a player's level, from all the XP they've earned.
func (g *Game) LevelNow(ctx context.Context, userID int64) (Level, error) {
	xp, err := g.totalXP(ctx, userID)
	if err != nil {
		return Level{}, err
	}
	l := Level{XP: xp}
	l.Level, l.From, l.To = LevelOf(xp)
	return l, nil
}

func (g *Game) earned(ctx context.Context, userID int64) (map[string]int64, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT id, at FROM achievements WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	earned := map[string]int64{}
	for rows.Next() {
		var id string
		var at int64
		if err := rows.Scan(&id, &at); err != nil {
			return nil, err
		}
		earned[id] = at
	}
	return earned, rows.Err()
}

// ProgressOf reads a player's progress.
func (g *Game) ProgressOf(ctx context.Context, userID int64) (Progress, error) {
	var p Progress
	var avatar, title, frame, backdrop sql.NullString
	err := g.DB.Read.QueryRowContext(ctx, `SELECT avatar, title, frame, backdrop FROM users WHERE id = ?`, userID).
		Scan(&avatar, &title, &frame, &backdrop)
	if err != nil {
		return p, err
	}
	if p.XP, err = g.totalXP(ctx, userID); err != nil {
		return p, err
	}
	p.Level, p.From, p.To = LevelOf(p.XP)
	earned, err := g.earned(ctx, userID)
	if err != nil {
		return p, err
	}
	reached, err := g.measure(ctx, userID)
	if err != nil {
		return p, err
	}
	for _, a := range Achievements {
		e := Earned{Achievement: a, At: earned[a.ID], Progress: min(reached[a.ID], a.Goal), Title: titleFor(a.ID)}
		if e.At != 0 {
			e.Progress = a.Goal
		} else if a.Hidden {
			e.Achievement, e.Progress, e.Title = hiddenAchievement(a), 0, nil
		}
		p.Achievements = append(p.Achievements, e)
	}
	p.Avatar, p.Title = avatar.String, title.String
	if p.Avatar == "" {
		p.Avatar = DefaultAvatar(userID)
	}
	p.Shapes, p.Tones = shapes(earned, p.Level), Tones
	if p.Standing, err = g.StandingOf(ctx, userID); err != nil {
		return p, err
	}
	w, err := g.wardrobeOf(ctx, userID)
	if err != nil {
		return p, err
	}
	p.Titles = w.titleViews(g.titles())
	p.Frame, p.Backdrop = frame.String, backdrop.String
	p.Frames, p.Backdrops = w.list(Frames), w.list(Backdrops)
	return p, nil
}

// Award gives a player every achievement their games have earned and they don't have yet, and returns those. It's
// called whenever something that counts happens (a run or a duel ends, a friend is made); it looks at everything, so
// a player whose games came before an achievement existed gets it the next time too.
func (g *Game) Award(ctx context.Context, userID int64) ([]string, error) {
	reached, err := g.measure(ctx, userID)
	if err != nil {
		return nil, err
	}
	earned, err := g.earned(ctx, userID)
	if err != nil {
		return nil, err
	}
	var news []string
	now := store.Ms(g.Now())
	for _, a := range Achievements {
		if _, already := earned[a.ID]; already || reached[a.ID] < a.Goal {
			continue
		}
		if _, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO achievements (user_id, id, at) VALUES (?, ?, ?)`,
			userID, a.ID, now); err != nil {
			return news, err
		}
		news = append(news, a.ID)
	}
	return news, nil
}

// bulgarianHour is a SQL expression for the hour in Bulgaria of a time in milliseconds: UTC+3 from April to October
// (summer time, near enough for an achievement), UTC+2 the rest of the year.
func bulgarianHour(ms string) string {
	return `CAST(strftime('%H', ` + ms + `/1000 + CASE WHEN CAST(strftime('%m', ` + ms + `/1000, 'unixepoch') AS INT)
		BETWEEN 4 AND 10 THEN 10800 ELSE 7200 END, 'unixepoch') AS INT)`
}

// measure is how far a player has come by each achievement's measure (days in a row, answers, duels won…), from
// their records: what Award awards and a profile shows the progress of.
func (g *Game) measure(ctx context.Context, userID int64) (map[string]int, error) {
	db := g.DB.Read
	streak, err := g.Streak(ctx, userID)
	if err != nil {
		return nil, err
	}
	var games, duelsWon, friends, topicsPlayed, types int
	var perfect, fast, friendWin, nightOwl, earlyBird, topicPerfect bool
	err = db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND finished_at IS NOT NULL),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'duel' AND outcome = 'won'),
		(SELECT count(*) FROM friends WHERE user_id = ?1),
		(SELECT count(DISTINCT category) FROM runs WHERE user_id = ?1 AND kind = 'topic' AND finished_at IS NOT NULL
			AND category <> ''),
		(SELECT count(*) FROM (SELECT DISTINCT CASE
				WHEN json_type(a.given, '$.pick') IS NOT NULL THEN 'choice'
				WHEN json_type(a.given, '$.value') IS NOT NULL THEN 'number'
				WHEN json_type(a.given, '$.order') IS NOT NULL THEN 'order'
				WHEN json_type(a.given, '$.truth') IS NOT NULL THEN 'truefalse'
				WHEN json_type(a.given, '$.pairs') IS NOT NULL THEN 'match' END AS t
			FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1 AND a.is_right) WHERE t IS NOT NULL),
		EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'day' AND finished_at IS NOT NULL
			AND rights = json_array_length(questions)),
		EXISTS (SELECT 1 FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1 AND a.is_right AND a.ms < 2000),
		EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'duel' AND outcome = 'won'
			AND opponent_id IN (SELECT friend_id FROM friends WHERE user_id = ?1)),
		EXISTS (SELECT 1 FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1
			AND `+bulgarianHour("a.at")+` < 4),
		EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'day' AND finished_at IS NOT NULL
			AND `+bulgarianHour("finished_at")+` < 7),
		EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'topic' AND finished_at IS NOT NULL
			AND rights = json_array_length(questions))`, userID).
		Scan(&games, &duelsWon, &friends, &topicsPlayed, &types, &perfect, &fast, &friendWin, &nightOwl, &earlyBird,
			&topicPerfect)
	if err != nil {
		return nil, err
	}
	answers, _, err := g.answered(ctx, userID)
	if err != nil {
		return nil, err
	}
	mastery, err := g.MasteryOf(ctx, userID)
	if err != nil {
		return nil, err
	}
	masters := 0
	for _, m := range mastery {
		if m.Sure && m.Tier >= MasterTier {
			masters++
		}
	}
	exact, err := g.anyExact(ctx, userID)
	if err != nil {
		return nil, err
	}
	lastSecond, err := g.anyLastSecond(ctx, userID)
	if err != nil {
		return nil, err
	}
	one := func(ok bool) int {
		if ok {
			return 1
		}
		return 0
	}
	return map[string]int{
		"streak3": streak, "streak7": streak, "streak30": streak, "streak100": streak,
		"perfect": one(perfect), "exact": one(exact), "fast": one(fast),
		"answers100": answers, "answers1000": answers, "games100": games,
		"allTopics": topicsPlayed, "master": masters, "master5": masters,
		"duel1": duelsWon, "duel10": duelsWon, "duel50": duelsWon,
		"friend1": friends, "friends5": friends, "friendWin": one(friendWin),
		"nightOwl": one(nightOwl), "earlyBird": one(earlyBird), "lastSecond": one(lastSecond),
		"topicPerfect": one(topicPerfect), "allTypes": types,
	}, nil
}

// anyLastSecond is whether a player has ever answered right in a question's last second.
func (g *Game) anyLastSecond(ctx context.Context, userID int64) (bool, error) {
	shortest := Limit(&bank.TrueFalse{Head: bank.Head{Type: "truefalse"}}) // no question's time is shorter
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, a.ms FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? AND a.is_right AND a.ms >= ?`, userID, (shortest - time.Second).Milliseconds())
	if err != nil {
		return false, err
	}
	defer rows.Close()
	b := g.Bank()
	for rows.Next() {
		var id string
		var ms int64
		if err := rows.Scan(&id, &ms); err != nil {
			return false, err
		}
		if q, ok := b.Get(id); ok && ms >= (Limit(q)-time.Second).Milliseconds() {
			return true, nil
		}
	}
	return false, rows.Err()
}

// anyExact is whether a player has ever given a number exactly (a number question's answer kept with its value).
func (g *Game) anyExact(ctx context.Context, userID int64) (bool, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, a.given FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? AND a.is_right AND json_type(a.given, '$.value') IS NOT NULL`, userID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	b := g.Bank()
	for rows.Next() {
		var id, given string
		if err := rows.Scan(&id, &given); err != nil {
			return false, err
		}
		q, ok := b.Get(id)
		n, isNumber := q.(*bank.Number)
		var a bank.NumberAnswer
		if ok && isNumber && json.Unmarshal([]byte(given), &a) == nil && n.Exact(a.Value) {
			return true, nil
		}
	}
	return false, rows.Err()
}

// News is what's new for a player since they last looked: achievements earned (each with the title it unlocks, if
// any), the day's goals done (with their XP), and their level (whether it's gone up, and the titles that came with
// it).
type News struct {
	Achievements []Earned   `json:"achievements"`
	Goals        []DoneGoal `json:"goals"`
	Level        int        `json:"level"`
	XP           int        `json:"xp"`
	From         int        `json:"from"`
	To           int        `json:"to"`
	LevelUp      bool       `json:"levelUp,omitempty"`
	// Titles are the titles the levels just reached unlock, and the game's mastery of its topics.
	Titles []TitleRef `json:"titles,omitempty"`
	// Mastery is how the game just played moved the player's mastery of its topics, when one is told of.
	Mastery []MasteryMove `json:"mastery,omitempty"`
}

// DoneGoal is one of the day's goals, done: what it was, and the XP it earned.
type DoneGoal struct {
	Name string `json:"name"`
	XP   int    `json:"xp"`
}

// NewsOf tells a player what's new, once: the achievements, the goals and the level are marked as told. With the
// game just played (runID; 0 for none), it also tells how that game moved their mastery.
func (g *Game) NewsOf(ctx context.Context, userID, runID int64) (News, error) {
	n := News{Achievements: []Earned{}, Goals: []DoneGoal{}}
	total, err := g.totalXP(ctx, userID)
	if err != nil {
		return n, err
	}
	if runID != 0 {
		// A game that isn't the player's, or isn't over, has nothing to tell: the rest of the news still is.
		if n.Mastery, err = g.MasteryMoves(ctx, userID, runID); err != nil && !errors.Is(err, ErrNoRun) && !errors.Is(err, ErrOutOfStep) {
			return n, err
		}
	}
	n.Titles = g.titlesOfMoves(n.Mastery)
	n.XP = total
	n.Level, n.From, n.To = LevelOf(total)
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT id FROM achievements WHERE user_id = ? AND NOT seen ORDER BY at`, userID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			if a, ok := achievementByID(id); ok {
				n.Achievements = append(n.Achievements, Earned{Achievement: a, Progress: a.Goal, Title: titleFor(id)})
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE achievements SET seen = 1 WHERE user_id = ? AND NOT seen`, userID); err != nil {
			return err
		}
		goals, err := tx.Query(`SELECT goal, xp FROM goals_done WHERE user_id = ? AND NOT seen ORDER BY at`, userID)
		if err != nil {
			return err
		}
		for goals.Next() {
			var id string
			var d DoneGoal
			if err := goals.Scan(&id, &d.XP); err != nil {
				goals.Close()
				return err
			}
			if goal, ok := goalByID(id); ok {
				d.Name = goal.Name
				n.Goals = append(n.Goals, d)
			}
		}
		goals.Close()
		if err := goals.Err(); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE goals_done SET seen = 1 WHERE user_id = ? AND NOT seen`, userID); err != nil {
			return err
		}
		var seen int
		if err := tx.QueryRow(`SELECT level_seen FROM users WHERE id = ?`, userID).Scan(&seen); err != nil {
			return err
		}
		if n.LevelUp = seen < n.Level; n.LevelUp {
			n.Titles = append(titlesAtLevel(seen, n.Level), n.Titles...)
			_, err = tx.Exec(`UPDATE users SET level_seen = ? WHERE id = ?`, n.Level, userID)
		}
		return err
	})
	return n, err
}

// SetLook changes how a player shows to others: an avatar (shape-tone, of what they may pick) and a title (one
// they've unlocked, or "" for none). Nil leaves either as it is.
func (g *Game) SetLook(ctx context.Context, userID int64, avatar, title *string, wear ...*string) error {
	earned, err := g.earned(ctx, userID)
	if err != nil {
		return err
	}
	if avatar != nil {
		shape, tone, _ := strings.Cut(*avatar, "-")
		total, err := g.totalXP(ctx, userID)
		if err != nil {
			return err
		}
		level, _, _ := LevelOf(total)
		i := slices.IndexFunc(shapes(earned, level), func(s Shape) bool { return s.Shape == shape && !s.Locked })
		if i < 0 || !slices.Contains(Tones, tone) {
			return ErrNotYours
		}
	}
	if title != nil && *title != "" {
		w, err := g.wardrobeOf(ctx, userID)
		if err != nil {
			return err
		}
		if !w.wears(g.titles(), *title) {
			return ErrNotYours
		}
	}
	// The wardrobe: a frame and a pattern ("" takes them off), if the player has unlocked them.
	var frame, backdrop *string
	if len(wear) > 0 {
		frame = wear[0]
	}
	if len(wear) > 1 {
		backdrop = wear[1]
	}
	if frame != nil || backdrop != nil {
		w, err := g.wardrobeOf(ctx, userID)
		if err != nil {
			return err
		}
		if (frame != nil && *frame != "" && !w.owns(Frames, *frame)) ||
			(backdrop != nil && *backdrop != "" && !w.owns(Backdrops, *backdrop)) {
			return ErrNotYours
		}
	}
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
		for column, v := range map[string]*string{"frame": frame, "backdrop": backdrop} {
			if v == nil {
				continue
			}
			var val any
			if *v != "" {
				val = *v
			}
			if _, err := tx.Exec(`UPDATE users SET `+column+` = ? WHERE id = ?`, val, userID); err != nil {
				return err
			}
		}
		if avatar != nil {
			if _, err := tx.Exec(`UPDATE users SET avatar = ? WHERE id = ?`, *avatar, userID); err != nil {
				return err
			}
		}
		if title != nil {
			var t any
			if *title != "" {
				t = *title
			}
			if _, err := tx.Exec(`UPDATE users SET title = ? WHERE id = ?`, t, userID); err != nil {
				return err
			}
		}
		return nil
	})
}
