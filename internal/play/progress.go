package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"strings"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

// Progress is what a player earns by playing: a level from every point they've scored, achievements for things
// they've done, and with them titles and avatars to choose from. All of it comes from the game's own records:
// nothing to buy, nothing made up.

// ErrNotYours is a title or an avatar the player hasn't earned (or one there's no such thing as).
var ErrNotYours = errors.New("not earned")

// LevelOf is the level a number of points reaches, with the points where that level starts and the next one does.
// The first level-up takes 1000 points (a game or two); each takes 500 more than the one before.
func LevelOf(points int) (level, from, to int) {
	level, from, step := 1, 0, 1000
	for points >= from+step {
		from += step
		level++
		step += 500
	}
	return level, from, from + step
}

// Achievement is something a player has done, once and for good. Its name is also a title they may show.
type Achievement struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	About string `json:"about"`
	Icon  string `json:"icon"` // the shape it's drawn with; earning it unlocks that shape as an avatar
}

// Achievements are every achievement there is, in the order a profile shows them.
var Achievements = []Achievement{
	{"streak3", "Три поред", "Три дни поред с въпросите на деня.", "flame"},
	{"streak7", "Цяла седмица", "Седем дни поред с въпросите на деня.", "flame"},
	{"streak30", "Цял месец", "Тридесет дни поред с въпросите на деня.", "flame"},
	{"streak100", "Сто дни", "Сто дни поред с въпросите на деня.", "flame"},
	{"perfect", "Десет от десет", "Всички верни във въпросите на деня.", "star"},
	{"exact", "Точно в целта", "Точно числото, без грешка.", "target"},
	{"fast", "Светкавица", "Верен отговор за по-малко от 2 секунди.", "bolt"},
	{"answers100", "Сто отговора", "Сто отговорени въпроса.", "book"},
	{"answers1000", "Хиляда отговора", "Хиляда отговорени въпроса.", "book"},
	{"games100", "Сто игри", "Сто изиграни игри.", "trophy"},
	{"allTopics", "Обиколка", "Поне една игра във всяка тема.", "rosette"},
	{"master", "Като на длан", "80% верни в тема, след поне 30 въпроса в нея.", "trophy"},
	{"master5", "Ходеща енциклопедия", "80% верни в пет теми, след поне 30 въпроса във всяка.", "trophy"},
	{"duel1", "Първа победа", "Спечели дуел.", "shield"},
	{"duel10", "Десет победи", "Спечели десет дуела.", "shield"},
	{"duel50", "Петдесет победи", "Спечели петдесет дуела.", "shield"},
	{"friend1", "Двама сме", "Първият ти приятел в играта.", "heart"},
	{"friends5", "Цяла компания", "Пет приятели в играта.", "heart"},
	{"friendWin", "Между приятели", "Победи приятел в дуел.", "heart"},
}

func achievementByID(id string) (Achievement, bool) {
	i := slices.IndexFunc(Achievements, func(a Achievement) bool { return a.ID == id })
	if i < 0 {
		return Achievement{}, false
	}
	return Achievements[i], true
}

// TitleOf is the name an achievement's id is shown by as a title ("" for none).
func TitleOf(id string) string {
	a, _ := achievementByID(id)
	return a.Name
}

// Avatars are a shape in a tone. Some shapes are everyone's from the start; the rest unlock: with an achievement
// drawn with that shape, or (the crown) at a level.
var (
	Tones      = []string{"gold", "lilac", "sky", "rose", "mint"}
	FreeShapes = []string{"petal", "rosette", "circle", "diamond", "triangle", "moon", "leaf", "wave", "hex"}
	Unlockable = []string{"flame", "star", "target", "bolt", "book", "trophy", "shield", "heart", "crown"}
)

// CrownLevel is the level that unlocks the crown.
const CrownLevel = 10

// DefaultAvatar is the avatar the game gives a player until they choose one: a free shape and a tone, from their id.
func DefaultAvatar(userID int64) string {
	n, shapes, tones := max(userID, 0), int64(len(FreeShapes)), int64(len(Tones))
	return FreeShapes[n%shapes] + "-" + Tones[n/shapes%tones]
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
	Level  int    `json:"level"`
}

func lookOf(userID int64, avatar, title string, points int) Look {
	if avatar == "" {
		avatar = DefaultAvatar(userID)
	}
	level, _, _ := LevelOf(points)
	return Look{Avatar: avatar, Title: TitleOf(title), Level: level}
}

// lookColumns read a player's look in a query over users u: their avatar, title and points.
const lookColumns = `coalesce(u.avatar, ''), coalesce(u.title, ''),
	(SELECT coalesce(sum(points), 0) FROM runs WHERE user_id = u.id)`

// LookOf is how a player shows to others.
func (g *Game) LookOf(ctx context.Context, userID int64) (Look, error) {
	var avatar, title string
	var points int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT `+lookColumns+` FROM users u WHERE u.id = ?`, userID).
		Scan(&avatar, &title, &points)
	return lookOf(userID, avatar, title, points), err
}

// Earned is an achievement with when the player earned it (0: not yet).
type Earned struct {
	Achievement
	At int64 `json:"at,omitempty"`
}

// Progress is a player's level, every achievement (earned or not), and what they may choose to look like.
type Progress struct {
	Level        int      `json:"level"`
	Points       int      `json:"points"`
	From         int      `json:"from"` // the points where this level starts
	To           int      `json:"to"`   // and where the next one does
	Achievements []Earned `json:"achievements"`
	Avatar       string   `json:"avatar"`
	Title        string   `json:"title"` // the chosen achievement's id ("" for none)
	Shapes       []Shape  `json:"shapes"`
	Tones        []string `json:"tones"`
}

func (g *Game) points(ctx context.Context, userID int64) (int, error) {
	var points int
	err := g.DB.Read.QueryRowContext(ctx, `SELECT coalesce(sum(points), 0) FROM runs WHERE user_id = ?`, userID).Scan(&points)
	return points, err
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
	var avatar, title sql.NullString
	err := g.DB.Read.QueryRowContext(ctx, `SELECT avatar, title FROM users WHERE id = ?`, userID).Scan(&avatar, &title)
	if err != nil {
		return p, err
	}
	if p.Points, err = g.points(ctx, userID); err != nil {
		return p, err
	}
	p.Level, p.From, p.To = LevelOf(p.Points)
	earned, err := g.earned(ctx, userID)
	if err != nil {
		return p, err
	}
	for _, a := range Achievements {
		p.Achievements = append(p.Achievements, Earned{Achievement: a, At: earned[a.ID]})
	}
	p.Avatar, p.Title = avatar.String, title.String
	if p.Avatar == "" {
		p.Avatar = DefaultAvatar(userID)
	}
	p.Shapes, p.Tones = shapes(earned, p.Level), Tones
	return p, nil
}

// Award gives a player every achievement their games have earned and they don't have yet, and returns those. It's
// called whenever something that counts happens (a run or a duel ends, a friend is made); it looks at everything, so
// a player whose games came before an achievement existed gets it the next time too.
func (g *Game) Award(ctx context.Context, userID int64) ([]string, error) {
	db := g.DB.Read
	streak, err := g.Streak(ctx, userID)
	if err != nil {
		return nil, err
	}
	var games, duelsWon, friends, topicsPlayed int
	var perfect, fast, friendWin bool
	err = db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND finished_at IS NOT NULL),
		(SELECT count(*) FROM runs WHERE user_id = ?1 AND kind = 'duel' AND outcome = 'won'),
		(SELECT count(*) FROM friends WHERE user_id = ?1),
		(SELECT count(DISTINCT category) FROM runs WHERE user_id = ?1 AND kind = 'topic' AND finished_at IS NOT NULL
			AND category <> ''),
		EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'day' AND finished_at IS NOT NULL
			AND rights = json_array_length(questions)),
		EXISTS (SELECT 1 FROM answers a JOIN runs r ON r.id = a.run_id WHERE r.user_id = ?1 AND a.is_right AND a.ms < 2000),
		EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'duel' AND outcome = 'won'
			AND opponent_id IN (SELECT friend_id FROM friends WHERE user_id = ?1))`, userID).
		Scan(&games, &duelsWon, &friends, &topicsPlayed, &perfect, &fast, &friendWin)
	if err != nil {
		return nil, err
	}
	topics, answers, _, err := g.topicStats(ctx, userID)
	if err != nil {
		return nil, err
	}
	masters := 0
	for _, t := range topics {
		if t.Answers >= 30 && t.Right*100 >= t.Answers*80 {
			masters++
		}
	}
	exact, err := g.anyExact(ctx, userID)
	if err != nil {
		return nil, err
	}
	b := g.Bank()
	has := map[string]bool{
		"streak3": streak >= 3, "streak7": streak >= 7, "streak30": streak >= 30, "streak100": streak >= 100,
		"perfect": perfect, "exact": exact, "fast": fast,
		"answers100": answers >= 100, "answers1000": answers >= 1000, "games100": games >= 100,
		"allTopics": len(b.Categories) > 0 && topicsPlayed >= len(b.Categories),
		"master":    masters >= 1, "master5": masters >= 5,
		"duel1": duelsWon >= 1, "duel10": duelsWon >= 10, "duel50": duelsWon >= 50,
		"friend1": friends >= 1, "friends5": friends >= 5, "friendWin": friendWin,
	}
	earned, err := g.earned(ctx, userID)
	if err != nil {
		return nil, err
	}
	var news []string
	now := store.Ms(g.Now())
	for _, a := range Achievements {
		if _, already := earned[a.ID]; already || !has[a.ID] {
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

// News is what's new for a player since they last looked: achievements earned, and their level (and whether it's
// gone up).
type News struct {
	Achievements []Achievement `json:"achievements"`
	Level        int           `json:"level"`
	Points       int           `json:"points"`
	From         int           `json:"from"`
	To           int           `json:"to"`
	LevelUp      bool          `json:"levelUp,omitempty"`
}

// NewsOf tells a player what's new, once: the achievements and the level are marked as told.
func (g *Game) NewsOf(ctx context.Context, userID int64) (News, error) {
	n := News{Achievements: []Achievement{}}
	points, err := g.points(ctx, userID)
	if err != nil {
		return n, err
	}
	n.Points = points
	n.Level, n.From, n.To = LevelOf(points)
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
				n.Achievements = append(n.Achievements, a)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE achievements SET seen = 1 WHERE user_id = ? AND NOT seen`, userID); err != nil {
			return err
		}
		res, err := tx.Exec(`UPDATE users SET level_seen = ? WHERE id = ? AND level_seen < ?`, n.Level, userID, n.Level)
		if err != nil {
			return err
		}
		up, _ := res.RowsAffected()
		n.LevelUp = up == 1
		return nil
	})
	return n, err
}

// SetLook changes how a player shows to others: an avatar (shape-tone, of what they may pick) and a title (an
// achievement of theirs, or "" for none). Nil leaves either as it is.
func (g *Game) SetLook(ctx context.Context, userID int64, avatar, title *string) error {
	earned, err := g.earned(ctx, userID)
	if err != nil {
		return err
	}
	if avatar != nil {
		shape, tone, _ := strings.Cut(*avatar, "-")
		points, err := g.points(ctx, userID)
		if err != nil {
			return err
		}
		level, _, _ := LevelOf(points)
		i := slices.IndexFunc(shapes(earned, level), func(s Shape) bool { return s.Shape == shape && !s.Locked })
		if i < 0 || !slices.Contains(Tones, tone) {
			return ErrNotYours
		}
	}
	if title != nil && *title != "" {
		if _, ok := earned[*title]; !ok {
			return ErrNotYours
		}
	}
	return g.DB.Tx(ctx, func(tx *sql.Tx) error {
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
