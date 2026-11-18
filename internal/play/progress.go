package play

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Progress is what a player earns by playing, and it's one system: two measures, a race, and what they unlock.
//
//   - XP is for playing: every answer and game (worth.go), the day's goals (goals.go), each achievement (its tier's
//     XP, once) and the first places of each week's league group (leagues.go). All of it adds up to a level.
//   - The rating is strength: duels and Роял move it (rating.go); its divisions are what it's worth.
//   - The week's league is the day's habit: a race on the day's right answers (then points), added up over the week,
//     a day missed adding nothing (leagues.go). It's not on XP, which counts how much is played: the player who plays the day every day,
//     and plays it well, wins it, whatever else anyone plays.
//   - Моят Алманах is what's learned: the fact behind every question answered right (almanac.go). Its achievements
//     count facts collected (a hundred, a thousand, five thousand, every fact of a topic), never answers given, so
//     that a wrong answer or a time-out counts for nothing; Профил says how many there are.
//
// All three unlock the wardrobe (wardrobe.go, titles.go): a level, an achievement, a topic's mastery, a division, a
// Роял won or first place in a high league each gives an avatar, a frame, a pattern or a title. Whatever unlocks something, the player is told
// once, at the end of the game that did it (NewsOf), and is shown what comes next (Next): the next level that gives
// something, the next division, the achievements nearest. Reserve days keep the streak through a missed day (runs.go):
// the day itself earns them (the streak's third day, every seventh in a row), and so do the day's goals, done all
// three, one a week at most; the streak makes achievements of its own, and a year with no day missed at all one more. A streak that ends anyway can be won back by playing, once a month (repair.go).
//
// All of it comes from the game's own records: nothing to buy, nothing made up. A new player meets it a part at a
// time (unfold.go): all of it counts from the first game, but XP, the league and the rating show as each starts to
// matter, and what waited is told then.

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

// Achievement is something a player has done, once and for good, named for the deed („Десет от десет“). It earns its
// tier's XP (AchievementXP); some also unlock an avatar (Icon), a title (titles.go) or a frame (wardrobe.go).
type Achievement struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// About is how it's earned, said to whoever hasn't yet.
	About string `json:"about"`
	Icon  string `json:"icon"` // the avatar's shape it unlocks ("" for none); its medal's picture is the client's
	Tier  Tier   `json:"tier"`
	// Goal is how much of its measure it takes (3 days, 100 facts); 1 for a thing done once.
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

// AchievementXP is what an achievement earns, by its tier: from about a game for a common one to a few evenings'
// play for a legendary one.
var AchievementXP = map[Tier]int{Common: 50, Rare: 150, Epic: 400, Legendary: 1000}

// Speed is an achievement („Пет за миг“) and a title („Светкавица“) only as a way of playing: five right answers in one
// game, each in under three seconds. One quick tap is luck; five in a game are a player's pace. It's hidden, found and
// not chased (review 2026-11-18, E2): XP is never for being quick (worth.go), and a goal or a list of the nearest
// achievements that points at speed asks a slow reader for what they can't give.
const (
	FastRights = 5
	FastMs     = 3000
)

// Achievements are every achievement there is, by tier, in the order a profile shows them.
var Achievements = []Achievement{
	{"streak3", "Три поред", "Играй въпросите на деня три дни поред.", "flame", Common, 3, false},
	{"facts100", "Сто факта", "Събери сто факта в Алманаха.", "book", Common, 100, false},
	{"duel1", "Първа победа", "Спечели дуел.", "shield", Common, 1, false},
	{"friend1", "Двама сме", "Добави първия си приятел в играта.", "heart", Common, 1, false},
	{"fullDay", "Пълен ден", "Изпълни и трите цели за деня.", "", Common, 1, false},
	{"leagueUp", "Нагоре", "Качи се в по-висока лига.", "", Common, 1, false},

	{"streak7", "Цяла седмица", "Играй въпросите на деня седем дни поред.", "flame", Rare, 7, false},
	{"perfect", "Десет от десет", "Отговори вярно и на десетте въпроса на деня.", "star", Rare, 1, false},
	{"exact", "Точно в целта", "Познай число точно, без никаква грешка.", "target", Rare, 1, false},
	{"allTopics", "Обиколка", "Изиграй поне една игра по всяка тема.", "compass", Rare, 10, false},
	{"friends5", "Цяла компания", "Събери пет приятели в играта.", "heart", Rare, 5, false},
	{"friendWin", "Между приятели", "Победи приятел в дуел.", "heart", Rare, 1, false},
	{"fast", "Пет за миг", "Отговори вярно пет пъти в една игра, всеки път за по-малко от три секунди.", "bolt", Rare, FastRights, true},
	{"nightOwl", "След полунощ", "Отговори на въпрос между полунощ и четири сутринта.", "owl", Rare, 1, true},
	{"earlyBird", "Преди седем", "Изиграй въпросите на деня преди седем сутринта.", "sun", Rare, 1, true},
	{"lastSecond", "В последния миг", "Отговори вярно в последната секунда.", "hourglass", Rare, 1, true},
	{"leagueFirst", "Първо място в групата", "Завърши седмица на първо място в групата си.", "", Rare, 1, false},

	{"streak30", "Цял месец", "Играй въпросите на деня тридесет дни поред.", "flame", Epic, 30, false},
	{"facts1000", "Хиляда факта", "Събери хиляда факта в Алманаха.", "book", Epic, 1000, false},
	{"games100", "Сто игри", "Изиграй сто игри.", "trophy", Epic, 100, false},
	{"master", "Като петте си пръста", "Стигни до „Майстор“ в една тема.", "trophy", Epic, 1, false},
	{"duel10", "Десет победи", "Спечели десет дуела.", "shield", Epic, 10, false},
	{"topicPerfect", "Тема без грешка", "Отговори вярно и на десетте въпроса в игра по тема.", "spark", Epic, 1, true},
	{"allTypes", "Всеки вид въпрос", "Отговори вярно на всеки вид въпрос: с четири отговора, с число, с подреждане, „Вярно или невярно“ и с двойки.", "clover", Epic, 5, true},
	{"royalWin", "Вечерта е твоя", "Спечели Роял.", "", Epic, 1, false},
	{"fullDays30", "Тридесет пълни дни", "Изпълни и трите цели за деня в тридесет различни дни.", "", Epic, 30, false},
	{"rila", "На върха", "Стигни до Рила, най-високата лига.", "", Epic, 1, false},

	{"streak100", "Сто дни", "Играй въпросите на деня сто дни поред.", "flame", Legendary, 100, false},
	{"streak365", "Цяла година", "Стигни серия от 365 дни с въпросите на деня.", "flame", Legendary, 365, false},
	{"noMiss", "Без нито един пропуск", "Играй въпросите на деня 365 дни един след друг, без резервен ден и без връщане на серия.", "", Legendary, 365, false},
	{"master5", "Пет теми като петте си пръста", "Стигни до „Майстор“ в пет теми.", "trophy", Legendary, 5, false},
	{"duel50", "Петдесет победи", "Спечели петдесет дуела.", "shield", Legendary, 50, false},
	{"facts5000", "Пет хиляди факта", "Събери пет хиляди факта в Алманаха.", "book", Legendary, 5000, false},
	{"wholeTopic", "Цяла тема", "Събери всички факти от една тема в Алманаха.", "", Legendary, 1, false},
}

func achievementByID(id string) (Achievement, bool) {
	i := slices.IndexFunc(Achievements, func(a Achievement) bool { return a.ID == id })
	if i < 0 {
		return Achievement{}, false
	}
	return Achievements[i], true
}

// Avatars are a picture in a tone (web/src/art/pictures.ts draws them; a "shape" is a picture's id). The animals are
// everyone's from the start; the emblems unlock: with an achievement drawn with that emblem, or (the crown) at a level.
var (
	Tones      = []string{"gold", "lilac", "sky", "rose", "mint"}
	FreeShapes = []string{"fox", "bear", "cat", "hare", "hedgehog", "dog", "deer", "stork", "frog"}
	Unlockable = []string{
		"flame", "star", "target", "bolt", "book", "trophy", "shield", "heart", "owl", "compass", "sun", "hourglass",
		"spark", "clover", "crown",
	}
)

// CrownLevel is the level that unlocks the crown.
const CrownLevel = 10

// DefaultAvatar is the avatar the game gives a player until they choose one: a free shape and a tone, from their id.
// Both turn with the id (9 shapes and 5 tones have no common factor, so every pair comes, once in 45): players who
// sign up one after another never share a tone, and no tone stands for the first ones.
func DefaultAvatar(userID int64) string {
	n := max(userID, 0)
	return FreeShapes[n%int64(len(FreeShapes))] + "-" + Tones[n%int64(len(Tones))]
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
					sh.How = "постижението „" + a.Name + "“" // the first achievement drawn with it
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
	if title == unchosen {
		title = LevelTitle(level)
	}
	name, tier := g.titleOf(title)
	return Look{Avatar: avatar, Title: name, TitleTier: tier, Level: level}
}

// lookColumns read a player's look in a query over users u: their avatar, title (the champion's with how many times)
// and XP.
var lookColumns = `coalesce(u.avatar, '') || '/' || coalesce(u.frame, '') || '/' || coalesce(u.backdrop, ''),
	CASE WHEN u.title = '` + championID + `' THEN u.title || ':' || (SELECT count(*) FROM league_results
		WHERE user_id = u.id AND tier = ` + strconv.Itoa(TopLeague) + ` AND place = 1 AND of >= ` + strconv.Itoa(RaceSize) + `)
		ELSE coalesce(u.title, '` + unchosen + `') END,
	` + xpOf("u.id")

// xpOf is a SQL expression for all the XP a player (a column or a parameter) has earned: their games', goals',
// achievements' and leagues'. Each is summed from its own table by the player's key, so it costs as much as the
// player has earned; summed over the four together (a view of them), SQLite reads all four whole, everyone's.
func xpOf(user string) string {
	sum := func(table string) string {
		return `(SELECT coalesce(sum(xp), 0) FROM ` + table + ` WHERE user_id = ` + user + `)`
	}
	return `(` + sum("runs") + ` + ` + sum("goals_done") + ` + ` + sum("achievements") + ` + ` + sum("league_results") + `)`
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
// goal, the XP it earns and what else it gives them: what it unlocks that nothing they've earned already has (and,
// once earned, what it did). A hidden one not yet earned is told only as hidden: no name, no how, no reward but XP.
type Earned struct {
	Achievement
	At       int64    `json:"at,omitempty"`
	Progress int      `json:"progress"`
	XP       int      `json:"xp"`
	Rewards  []Unlock `json:"rewards,omitempty"`
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
	Title        string   `json:"title"` // the chosen title's id: one of Titles, or the champion's ("" for none)
	// TitleByLevel is set while the player hasn't chosen a title (users.title NULL): they wear their level's
	// (LevelTitle, Title then; "" before „Любопитен ум“), not „Без титла“, which is a choice.
	TitleByLevel bool     `json:"titleByLevel,omitempty"`
	Shapes       []Shape  `json:"shapes"`
	Tones        []string `json:"tones"`
	// Standing is the player's rating and division.
	Standing Standing `json:"standing"`
	// Titles are every title, the champion's first (named by how many times it's won): the player's, or locked with
	// what unlocks them.
	Titles []TitleView `json:"titles"`
	// The wardrobe: the frame and pattern worn ("" for none), and all there are.
	Frame     string     `json:"frame"`
	Backdrop  string     `json:"backdrop"`
	Frames    []Cosmetic `json:"frames"`
	Backdrops []Cosmetic `json:"backdrops"`
	// Next is what comes next: the next level that unlocks something, the next division.
	Next Next `json:"next"`
	// TierUnlocks are what the first achievement of a tier unlocks, of what the player doesn't have yet.
	TierUnlocks map[Tier][]Unlock `json:"tierUnlocks"`
	// Open is which of the game's systems the player has met (unfold.go): what Профил shows.
	Open Open `json:"open"`
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

// ProgressOf reads a player's progress, as far as they've met the game's systems (unfold.go): the achievements of a
// system not open yet (the day's goals', the league's) aren't in it, and no achievement says its XP before XP is.
func (g *Game) ProgressOf(ctx context.Context, userID int64) (Progress, error) {
	var p Progress
	var avatar, title, frame, backdrop sql.NullString
	err := g.DB.Read.QueryRowContext(ctx, `SELECT avatar, title, frame, backdrop FROM users WHERE id = ?`, userID).
		Scan(&avatar, &title, &frame, &backdrop)
	if err != nil {
		return p, err
	}
	if p.Open, err = g.OpenOf(ctx, userID); err != nil {
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
	w, err := g.wardrobeOf(ctx, userID)
	if err != nil {
		return p, err
	}
	p.Achievements = []Earned{}
	for _, a := range Achievements {
		if s := systemOf(a.ID); s != "" && !p.Open.has(s) {
			continue
		}
		e := Earned{Achievement: a, At: earned[a.ID], Progress: min(reached[a.ID], a.Goal), Rewards: w.rewardsOf(a)}
		if p.Open.XP {
			e.XP = AchievementXP[a.Tier]
		}
		if e.At != 0 {
			e.Progress = a.Goal
		} else if a.Hidden {
			e.Achievement, e.Progress, e.Rewards = hiddenAchievement(a), 0, nil
		}
		p.Achievements = append(p.Achievements, e)
	}
	p.Avatar, p.Title = avatar.String, title.String
	if !title.Valid {
		p.Title, p.TitleByLevel = LevelTitle(p.Level), true
	}
	if p.Avatar == "" {
		p.Avatar = DefaultAvatar(userID)
	}
	p.Shapes, p.Tones = shapes(earned, p.Level), Tones
	if p.Standing, err = g.StandingOf(ctx, userID); err != nil {
		return p, err
	}
	p.Titles = w.titleViews(g.titles())
	p.Frame, p.Backdrop = frame.String, backdrop.String
	p.Frames, p.Backdrops = w.list(Frames), w.list(Backdrops)
	p.Next, p.TierUnlocks = w.next(p.Standing.Rating), w.tierUnlocks()
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
		if _, err := g.DB.Write.ExecContext(ctx, `INSERT OR IGNORE INTO achievements (user_id, id, at, xp) VALUES (?, ?, ?, ?)`,
			userID, a.ID, now, AchievementXP[a.Tier]); err != nil {
			return news, err
		}
		news = append(news, a.ID)
	}
	return news, nil
}

// bulgarian is a SQL expression for a time in milliseconds as seconds in Bulgaria: UTC+3 from April to October
// (summer time, near enough for an achievement or a day played), UTC+2 the rest of the year.
func bulgarian(ms string) string {
	return ms + `/1000 + CASE WHEN CAST(strftime('%m', ` + ms + `/1000, 'unixepoch') AS INT) BETWEEN 4 AND 10
		THEN 10800 ELSE 7200 END`
}

// bulgarianHour is a SQL expression for the hour in Bulgaria of a time in milliseconds.
func bulgarianHour(ms string) string {
	return `CAST(strftime('%H', ` + bulgarian(ms) + `, 'unixepoch') AS INT)`
}

// bulgarianDate is a SQL expression for the day in Bulgaria (YYYY-MM-DD) of a time in milliseconds.
func bulgarianDate(ms string) string { return `date(` + bulgarian(ms) + `, 'unixepoch')` }

// measure is how far a player has come by each achievement's measure (days in a row, facts, duels won…), from
// their records: what Award awards and a profile shows the progress of.
func (g *Game) measure(ctx context.Context, userID int64) (map[string]int, error) {
	db := g.DB.Read
	streak, err := g.StreakOf(ctx, userID)
	if err != nil {
		return nil, err
	}
	var games, duelsWon, friends, topicsPlayed, types, fullDays, fast int
	var perfect, friendWin, nightOwl, earlyBird, topicPerfect, royalWin, leagueUp, leagueFirst, rila bool
	err = db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM runs r WHERE r.user_id = ?1 AND r.finished_at IS NOT NULL AND `+together("r")+`
			AND (r.kind <> 'room' OR json_array_length(r.questions) >= `+strconv.Itoa(Length)+`)),
		(SELECT count(*) FROM `+duelResults+` WHERE outcome = 'won'),
		(SELECT count(*) FROM friends WHERE user_id = ?1),
		(SELECT count(DISTINCT category) FROM runs WHERE user_id = ?1 AND kind = 'topic' AND finished_at IS NOT NULL
			AND category NOT IN ('', ?4)),
		(SELECT count(*) FROM (SELECT DISTINCT CASE
				WHEN json_type(a.given, '$.pick') IS NOT NULL THEN 'choice'
				WHEN json_type(a.given, '$.value') IS NOT NULL THEN 'number'
				WHEN json_type(a.given, '$.order') IS NOT NULL THEN 'order'
				WHEN json_type(a.given, '$.truth') IS NOT NULL THEN 'truefalse'
				WHEN json_type(a.given, '$.pairs') IS NOT NULL THEN 'match' END AS t
			FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1 AND a.is_right) WHERE t IS NOT NULL),
		EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'day' AND finished_at IS NOT NULL
			AND rights = json_array_length(questions)),
		(SELECT coalesce(max(n), 0) FROM (SELECT count(*) AS n FROM answers a JOIN runs r ON r.id = a.run_id
			WHERE r.user_id = ?1 AND a.is_right AND a.ms < ?5 GROUP BY a.run_id)),
		EXISTS (SELECT 1 FROM `+duelResults+` WHERE outcome = 'won'
			AND other IN (SELECT friend_id FROM friends WHERE user_id = ?1)),
		EXISTS (SELECT 1 FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1
			AND `+bulgarianHour("a.at")+` < 4),
		EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'day' AND finished_at IS NOT NULL
			AND `+bulgarianHour("finished_at")+` < 7),
		EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'topic' AND finished_at IS NOT NULL
			AND rights = json_array_length(questions)),
		(SELECT count(*) FROM (SELECT day FROM goals_done WHERE user_id = ?1 GROUP BY day HAVING count(*) >= ?2)),
		EXISTS (SELECT 1 FROM royal_players p WHERE p.user_id = ?1 AND p.place = 1
			AND (SELECT count(*) FROM royal_players o WHERE o.royal_id = p.royal_id) > 1),
		EXISTS (SELECT 1 FROM league_results WHERE user_id = ?1 AND moved = 1),
		EXISTS (SELECT 1 FROM league_results WHERE user_id = ?1 AND place = 1 AND of >= `+strconv.Itoa(RaceSize)+`),
		(SELECT league FROM users WHERE id = ?1) >= ?3`, userID, GoalsPerDay, TopLeague, BulgariaTopic, FastMs).
		Scan(&games, &duelsWon, &friends, &topicsPlayed, &types, &perfect, &fast, &friendWin, &nightOwl, &earlyBird,
			&topicPerfect, &fullDays, &royalWin, &leagueUp, &leagueFirst, &rila)
	if err != nil {
		return nil, err
	}
	facts, err := g.factsOf(ctx, userID)
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
		"streak3": streak.Days, "streak7": streak.Days, "streak30": streak.Days, "streak100": streak.Days,
		"streak365": streak.Days, "noMiss": streak.Unbroken,
		"perfect": one(perfect), "exact": one(exact), "fast": fast,
		"facts100": facts.n, "facts1000": facts.n, "facts5000": facts.n, "wholeTopic": one(facts.whole),
		"games100":  games,
		"allTopics": topicsPlayed, "master": masters, "master5": masters,
		"duel1": duelsWon, "duel10": duelsWon, "duel50": duelsWon,
		"friend1": friends, "friends5": friends, "friendWin": one(friendWin),
		"nightOwl": one(nightOwl), "earlyBird": one(earlyBird), "lastSecond": one(lastSecond),
		"topicPerfect": one(topicPerfect), "allTypes": types,
		"fullDay": fullDays, "fullDays30": fullDays, "royalWin": one(royalWin),
		"leagueUp": one(leagueUp), "leagueFirst": one(leagueFirst), "rila": one(rila),
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

// News is what's new for a player since they last looked: achievements earned (each with its XP and what it gave),
// the day's goals done (with their XP), a week of the leagues ended (with what it paid), their level (whether it's gone up), a
// division reached for the first time, and everything they've unlocked to wear, whatever unlocked it. The client
// tells it in three cards at most (web/src/game/news.ts): the goals, the one biggest event, and what's new to wear; a
// card left free may tell, once a day, how others' duels against the player's recordings went (recordings.go); a
// broken streak won back is a line of its own (repair.go). Only what's open to the player is told (unfold.go): the
// rest waits for its system to open.
type News struct {
	Achievements []Earned   `json:"achievements"`
	Goals        []DoneGoal `json:"goals"`
	League       *LeagueEnd `json:"league,omitempty"`
	Level        int        `json:"level"`
	XP           int        `json:"xp"`
	From         int        `json:"from"`
	To           int        `json:"to"`
	LevelUp      bool       `json:"levelUp,omitempty"`
	// Earned is the XP the game just played brings: its own, and the goals and achievements told with it. A week of
	// the league ended tells its pay in its own card (LeagueEnd.XP): it was the player's before the game.
	Earned int `json:"earned"`
	// Division is a division the player's rating has reached for the first time; with Placed, the one it's in as its
	// first MinRatedGames games have just set it (rating.go): none is told before.
	Division *Division `json:"division,omitempty"`
	Placed   bool      `json:"placed,omitempty"`
	// Unlocks are what the player may wear now and hasn't been told of: titles, frames, patterns, avatars.
	Unlocks []Unlock `json:"unlocks"`
	// Avatar is the avatar worn (shape-tone), for an unlocked shape to be put on in it.
	Avatar string `json:"avatar"`
	// Mastery is how the game just played moved the player's mastery of its topics, told after a topic's game only.
	Mastery []MasteryMove `json:"mastery,omitempty"`
	// Open is which of the game's systems the player has met; Opened, those just met, told once (Systems' names).
	Open   Open     `json:"open"`
	Opened []string `json:"opened,omitempty"`
	// Recordings is what others' duels against the player's recordings came to, once a day, in a card the rest
	// leaves free (recordings.go).
	Recordings *RecordingsNews `json:"recordings,omitempty"`
	// Mended is the streak's days, when a broken streak has just been won back (repair.go): said in a line, once.
	Mended int `json:"mended,omitempty"`
	// Kind is the game's kind ("day", "topic", …): what its points are said to be for.
	Kind string `json:"kind,omitempty"`
	// Facts is how many facts the game put in the player's almanac (almanac.go): told from the first day, before XP
	// is, as what playing gives that only goes up.
	Facts int `json:"facts,omitempty"`
	// Moved are the day's goals the game moved without finishing them, with how far along each is (goals.go): told
	// in the card of those it finished, once XP is open.
	Moved []DayGoal `json:"moved,omitempty"`
}

// DoneGoal is one of the day's goals, done: what it was, and the XP it earned.
type DoneGoal struct {
	Name string `json:"name"`
	XP   int    `json:"xp"`
}

// NewsOf tells a player what's new, once: everything in it is marked as told. With the game just played (runID; 0
// for none), it also counts that game's XP and the facts it put in the almanac, the goals it moved, and, for a topic's
// game, how it moved their mastery; that game is told then, and so is every one finished before it (Untold). It waits
// first for what the games just finished earned to be kept (after.go: in the background), and awards, so that
// whatever ended meanwhile (a friend's challenge, a Роял, a week of the leagues) is in it. What belongs to a system
// the player hasn't met yet (unfold.go) waits for it: a new level, what a level unlocks, an achievement of the goals or
// of the league; what can't wait (a day's goals, a week ended) is let go untold, its XP kept.
func (g *Game) NewsOf(ctx context.Context, userID, runID int64) (News, error) {
	n := News{Achievements: []Earned{}, Goals: []DoneGoal{}, Unlocks: []Unlock{}}
	g.AfterWait(ctx, userID) // what the game just finished earned, kept in the background (after.go)
	if err := g.ensureWeek(ctx); err != nil {
		return n, err
	}
	if _, err := g.Award(ctx, userID); err != nil {
		return n, err
	}
	total, err := g.totalXP(ctx, userID)
	if err != nil {
		return n, err
	}
	open, err := g.OpenOf(ctx, userID)
	if err != nil {
		return n, err
	}
	n.Open = open
	var finished int64 // the game's end: it, and every game finished before it, are told with this news
	if runID != 0 {
		// A game that isn't the player's, or isn't over, has nothing to tell: the rest of the news still is.
		err := g.DB.Read.QueryRowContext(ctx, `SELECT kind, xp, finished_at FROM runs WHERE id = ? AND user_id = ?
			AND finished_at IS NOT NULL`, runID, userID).Scan(&n.Kind, &n.Earned, &finished)
		switch {
		case errors.Is(err, sql.ErrNoRows):
		case err != nil:
			return n, err
		default:
			if n.Facts, err = g.learnedIn(ctx, userID, runID); err != nil {
				return n, err
			}
			if open.XP {
				if n.Moved, err = g.GoalsMoved(ctx, userID, runID); err != nil {
					return n, err
				}
			}
			if n.Kind == "topic" {
				if n.Mastery, err = g.MasteryMoves(ctx, userID, runID); err != nil {
					return n, err
				}
			}
		}
	}
	w, err := g.wardrobeOf(ctx, userID)
	if err != nil {
		return n, err
	}
	// A streak won back: told with the streak as it is now.
	var mended bool
	if err := g.DB.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM streak_repairs WHERE user_id = ? AND NOT told)`,
		userID).Scan(&mended); err != nil {
		return n, err
	}
	if mended {
		s, err := g.StreakOf(ctx, userID)
		if err != nil {
			return n, err
		}
		n.Mended = s.Days
	}
	have := w.unlocks()
	n.XP = total
	n.Level, n.From, n.To = LevelOf(total)
	runXP := n.Earned // the game's own, before its goals and achievements
	b := g.Bank()
	err = g.DB.Tx(ctx, func(tx *sql.Tx) error {
		var avatar sql.NullString
		var seen, peak, peakSeen, rating, rated int
		var known bool
		var systems string
		if err := tx.QueryRow(`SELECT avatar, level_seen, peak, peak_seen, rating, rated, unlocks_known, systems_told
			FROM users WHERE id = ?`, userID).Scan(&avatar, &seen, &peak, &peakSeen, &rating, &rated, &known, &systems); err != nil {
			return err
		}
		n.Avatar = cmp.Or(avatar.String, DefaultAvatar(userID))
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
			if sys := systemOf(id); sys != "" && !open.has(sys) {
				continue // its system isn't open: it waits
			}
			if a, ok := achievementByID(id); ok {
				n.Achievements = append(n.Achievements, Earned{Achievement: a, Progress: a.Goal, XP: AchievementXP[a.Tier],
					At: w.earned[id], Rewards: w.rewardsOf(a)})
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, a := range n.Achievements {
			if _, err := tx.Exec(`UPDATE achievements SET seen = 1 WHERE user_id = ? AND id = ?`, userID, a.ID); err != nil {
				return err
			}
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
			if goal, _, _, ok := goalOf(b, id); ok && open.XP {
				d.Name = goal.Name
				n.Goals = append(n.Goals, d)
			}
		}
		goals.Close()
		if err := goals.Err(); err != nil {
			return err
		}
		if n.League, err = g.lastWeek(ctx, tx, userID, `NOT r.seen`); err != nil {
			return err
		}
		if !open.League {
			n.League = nil
		}
		// The unlocks not told yet; a player from before they were kept starts from what they have, untold.
		told := map[string]bool{}
		if known {
			rows, err := tx.Query(`SELECT id FROM unlocks_told WHERE user_id = ?`, userID)
			if err != nil {
				return err
			}
			for rows.Next() {
				var k string
				if err := rows.Scan(&k); err != nil {
					rows.Close()
					return err
				}
				told[k] = true
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
		}
		for _, u := range have {
			if told[u.key()] || (known && u.byLevel > 0 && !open.XP) {
				continue
			}
			// What the first level gives, everyone has from the start: kept as told, never told as news.
			if known && u.byLevel != 1 {
				n.Unlocks = append(n.Unlocks, u)
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO unlocks_told (user_id, id) VALUES (?, ?)`, userID, u.key()); err != nil {
				return err
			}
		}
		for _, a := range n.Achievements {
			n.Earned += a.XP
		}
		for _, d := range n.Goals {
			n.Earned += d.XP
		}
		// While the rating is being set, no division is told, and the peak seen is kept at -1: the first news after
		// it's set tells the division it's in, and the peak from then on.
		if Placed(rated) && open.Rating {
			if peakSeen < 0 {
				d, _ := DivisionOf(rating)
				n.Division, n.Placed = &d, true
			} else if d, _ := DivisionOf(peak); d.From > peakSeen {
				n.Division = &d
			}
		}
		// A level is told once XP is: one reached before waits for it. Else it's new only if what this news tells
		// took the player to it (the games told with it, their goals and achievements): one reached by what was
		// never told as news (a week's pay) was on their level already, and isn't said to be new after a game that
		// didn't reach it.
		level := 0
		if open.XP {
			level = n.Level
		}
		n.Opened = opened(open, systems)
		if seen < level && !slices.Contains(n.Opened, "xp") {
			var games int
			if err := tx.QueryRow(`SELECT coalesce(sum(xp), 0) FROM runs WHERE user_id = ?1 AND NOT told
				AND finished_at IS NOT NULL AND (?2 = 0 OR finished_at <= ?2)`, userID, finished).Scan(&games); err != nil {
				return err
			}
			if before, _, _ := LevelOf(total - games - (n.Earned - runXP)); before >= level {
				seen = level
			}
		}
		n.LevelUp = seen < level
		// Others' duels against the player's recordings take a card the rest leaves free: they wait for one.
		if n.cards() < NewsCards {
			if n.Recordings, err = g.recordingsNews(tx, userID); err != nil {
				return err
			}
		}
		for _, q := range []string{
			`UPDATE goals_done SET seen = 1 WHERE user_id = ?1 AND NOT seen`,
			`UPDATE league_results SET seen = 1 WHERE user_id = ?1 AND NOT seen`,
			`UPDATE streak_repairs SET told = 1 WHERE user_id = ?1 AND NOT told`,
			`UPDATE runs SET told = 1 WHERE user_id = ?1 AND NOT told AND finished_at <= ?4`,
			`UPDATE users SET level_seen = max(level_seen, ?2), unlocks_known = 1,
				peak_seen = CASE WHEN rated >= ?5 THEN max(peak_seen, peak) ELSE -1 END,
				systems_told = trim(systems_told || ' ' || ?3) WHERE id = ?1`,
		} {
			if _, err := tx.Exec(q, userID, level, strings.Join(n.Opened, " "), finished, MinRatedGames); err != nil {
				return err
			}
		}
		return nil
	})
	return n, err
}

// SetLook changes how a player shows to others: an avatar (shape-tone, of what they may pick) and a title (one
// they've unlocked, or "" for none, which is kept as chosen: a player who never chose wears their level's). Nil leaves either as it is.
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
		if title != nil { // "" is a choice too, no title, where NULL wears the level's (LevelTitle)
			if _, err := tx.Exec(`UPDATE users SET title = ? WHERE id = ?`, *title, userID); err != nil {
				return err
			}
		}
		return nil
	})
}
