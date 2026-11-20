package play

import (
	"context"
	"slices"
	"strconv"
)

// The wardrobe: besides the avatar's shape and tone and the title (titles.go), a frame around the avatar and a pattern behind
// it. Each is unlocked by something the player has done — a level, an achievement, a division reached, a Роял won —
// and shows wherever they do. Every unlock, of any of them, is an Unlock: what NewsOf tells once, an
// achievement lists as its reward, and Next shows ahead. The art is drawn in the client (web/src/art).

// Cosmetic is a frame or a pattern as a player may pick it: free, unlocked, or locked with what unlocks it.
type Cosmetic struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Locked bool   `json:"locked,omitempty"`
	How    string `json:"how,omitempty"`
}

// unlock is what makes a cosmetic or a title a player's: a level, days on which the day's questions were played, an
// achievement of a tier (any one), one achievement, a division reached (by the highest rating), Роял won some times,
// or a mastery tier (or higher) in a topic or in some number of topics.
type unlock struct {
	level    int
	days     int
	tier     Tier
	achieved string
	division string
	royal    int
	topic    string
	topics   int // how many topics (everyTopic: all the bank's) at a mastery tier or higher
	mastery  int
}

// everyTopic is an unlock's topics when it takes all of them.
const everyTopic = -1

type cosmetic struct {
	id, name string
	by       unlock
}

// Frames, from the plainest. The level's come every few levels past 12, between its titles and patterns, so that the
// ladder never goes quiet for long (review 2026-11-18, E8).
var Frames = []cosmetic{
	{"ring", "Пръстен", unlock{level: 2}},
	{"double", "Двоен пръстен", unlock{level: 5}},
	{"dots", "Мъниста", unlock{level: 8}},
	{"constellation", "Съзвездие", unlock{level: 18}},
	{"embroidery", "Шевица", unlock{level: 27}},
	{"sparks", "Искри", unlock{level: 38}},
	{"flames", "Пламъци", unlock{achieved: "streak30"}},
	{"laurel", "Лавров венец", unlock{tier: Legendary}},
	{"gem", "Кристал", unlock{division: "diamond"}},
	{"halo", "Ореол", unlock{division: "legend"}},
	{"sun", "Слънце", unlock{achieved: "streak365"}},
}

// Backdrops, the patterns behind the avatar's shape, from the plainest.
var Backdrops = []cosmetic{
	{"dots", "Точици", unlock{level: 3}},
	{"stripes", "Ивици", unlock{level: 6}},
	{"grid", "Мрежа", unlock{level: 12}},
	{"waves", "Вълни", unlock{level: 14}},
	{"zigzag", "Зигзаг", unlock{level: 22}},
	{"diamonds", "Ромбове", unlock{level: 32}},
	{"rings", "Кръгове", unlock{level: 42}},
	{"glow", "Сияние", unlock{level: 48}},
	{"rays", "Лъчи", unlock{tier: Epic}},
	{"stars", "Звезди", unlock{division: "gold"}},
}

// wardrobe is what a player has done that unlocks things: their level, the days they played the day's questions,
// achievements, highest rating, the Роял tournaments they've won, and their
// mastery tier in each topic they're sure in.
type wardrobe struct {
	level   int
	days    int
	earned  map[string]int64
	peak    int  // the highest rating, once placed (0 before)
	placed  bool // the rating is set (Placed)
	royals  int
	mastery map[string]int
	titles  []Title           // every title there is (the game's: topics come from the bank)
	topics  map[string]string // the bank's topics' names, by id
}

func (w wardrobe) has(u unlock) bool {
	switch {
	case u.level > 0:
		return w.level >= u.level
	case u.days > 0:
		return w.days >= u.days
	case u.achieved != "":
		_, ok := w.earned[u.achieved]
		return ok
	case u.tier != "":
		return slices.ContainsFunc(Achievements, func(a Achievement) bool {
			_, ok := w.earned[a.ID]
			return ok && a.Tier == u.tier
		})
	case u.division != "":
		i := slices.IndexFunc(Divisions, func(d Division) bool { return d.ID == u.division })
		return i >= 0 && w.peak >= Divisions[i].From
	case u.royal > 0:
		return w.royals >= u.royal
	case u.topic != "":
		tier, ok := w.mastery[u.topic]
		return ok && tier >= u.mastery
	case u.topics != 0:
		need, n := u.topics, 0
		if need == everyTopic {
			need = len(w.topics)
		}
		for _, tier := range w.mastery {
			if tier >= u.mastery {
				n++
			}
		}
		return need > 0 && n >= need
	}
	return true
}

// how says what unlocks a cosmetic, for whoever hasn't yet.
func (u unlock) how() string {
	switch {
	case u.level > 0:
		return "ниво " + strconv.Itoa(u.level)
	case u.days > 0:
		return strconv.Itoa(u.days) + " дни с въпросите на деня"
	case u.achieved != "":
		a, _ := achievementByID(u.achieved)
		return "постижението „" + a.Name + "“"
	case u.tier != "":
		return "първото " + map[Tier]string{Common: "обикновено", Rare: "рядко", Epic: "епично",
			Legendary: "легендарно"}[u.tier] + " постижение"
	case u.division != "":
		for _, d := range Divisions {
			if d.ID == u.division {
				return "дивизия " + d.Name
			}
		}
	case u.topics == everyTopic:
		return "„" + MasteryTiers[u.mastery].Name + "“ във всички теми"
	case u.topics > 0:
		return "„" + MasteryTiers[u.mastery].Name + "“ в " + inWords(u.topics) + " теми"
	case u.royal == 1:
		return "победа в Роял"
	case u.royal > 1:
		return strconv.Itoa(u.royal) + " победи в Роял"
	}
	return ""
}

func (w wardrobe) list(all []cosmetic) []Cosmetic {
	out := make([]Cosmetic, 0, len(all))
	for _, c := range all {
		x := Cosmetic{ID: c.id, Name: c.name}
		if !w.has(c.by) {
			x.Locked, x.How = true, c.by.how()
		}
		out = append(out, x)
	}
	return out
}

func (w wardrobe) owns(all []cosmetic, id string) bool {
	i := slices.IndexFunc(all, func(c cosmetic) bool { return c.id == id })
	return i >= 0 && w.has(all[i].by)
}

func (g *Game) wardrobeOf(ctx context.Context, userID int64) (wardrobe, error) {
	var w wardrobe
	total, err := g.totalXP(ctx, userID)
	if err != nil {
		return w, err
	}
	w.level, _, _ = LevelOf(total)
	if w.earned, err = g.earned(ctx, userID); err != nil {
		return w, err
	}
	if err = g.DB.Read.QueryRowContext(ctx, `SELECT count(*) FROM runs WHERE user_id = ? AND kind = 'day'
		AND finished_at IS NOT NULL`, userID).Scan(&w.days); err != nil {
		return w, err
	}
	var rated int
	if err = g.DB.Read.QueryRowContext(ctx, `SELECT peak, rated FROM users WHERE id = ?`, userID).Scan(&w.peak, &rated); err != nil {
		return w, err
	}
	if w.placed = Placed(rated); !w.placed {
		w.peak = 0 // no division while the rating is being set, nor what one unlocks
	}
	if w.royals, err = g.royalWins(ctx, userID); err != nil {
		return w, err
	}
	w.titles, w.topics = g.titles(), map[string]string{}
	for _, c := range g.Bank().Categories {
		w.topics[c.ID] = c.Name
	}
	mastery, err := g.MasteryOf(ctx, userID)
	w.mastery = map[string]int{}
	for _, m := range mastery {
		if m.Sure {
			w.mastery[m.Category] = m.Tier
		}
	}
	return w, err
}

// Unlock is something a player may wear, from what unlocked it: a title, a frame, a pattern or an avatar's shape.
type Unlock struct {
	Kind string `json:"kind"` // title, frame, backdrop or avatar
	ID   string `json:"id"`   // what to wear it by (an avatar's: its shape)
	Name string `json:"name"` // "" for an avatar: the client names its shapes
	Tier Tier   `json:"tier,omitempty"`
	// From is what unlocks it, as a phrase after „с“: „ниво 5“, „постижението „Цял месец““, „дивизия Злато“.
	From string `json:"from"`
	// byLevel is the level that unlocks it (0: none): told once XP has opened (unfold.go), but the first level's,
	// which everyone has from the start.
	byLevel int
}

// key is what's kept of an unlock once told.
func (u Unlock) key() string { return u.Kind + ":" + u.ID + ":" + u.Name }

// from says what unlocks something, as a phrase after „с“.
func (w wardrobe) from(u unlock) string {
	switch {
	case u.topic != "":
		return "„" + MasteryTiers[u.mastery].Name + "“ в „" + w.topics[u.topic] + "“"
	}
	return u.how()
}

// shapeFrom says what unlocks an avatar's shape: the level (the crown), or the first achievement drawn with it — the
// one the player earned first, if they have.
func (w wardrobe) shapeFrom(shape string) string {
	if shape == "crown" {
		return "ниво " + strconv.Itoa(CrownLevel)
	}
	if id := w.first(func(a Achievement) bool { return a.Icon == shape }); id != "" {
		a, _ := achievementByID(id)
		return "постижението „" + a.Name + "“"
	}
	return ""
}

// first is the achievement, of those that pass, the player earned first ("" for none yet).
func (w wardrobe) first(pass func(Achievement) bool) string {
	id, at := "", int64(0)
	for _, a := range Achievements {
		if t, ok := w.earned[a.ID]; ok && pass(a) && (id == "" || t < at) {
			id, at = a.ID, t
		}
	}
	return id
}

// shapeOpen is whether a player has an avatar's shape.
func (w wardrobe) shapeOpen(shape string) bool {
	if shape == "crown" {
		return w.level >= CrownLevel
	}
	return w.first(func(a Achievement) bool { return a.Icon == shape }) != ""
}

// unlocks are everything a player has unlocked: titles, frames, patterns, shapes.
func (w wardrobe) unlocks() []Unlock {
	var out []Unlock
	for _, t := range w.titles {
		if w.has(t.by) {
			out = append(out, Unlock{Kind: "title", ID: t.ID, Name: t.Name, Tier: t.Tier, From: w.from(t.by),
				byLevel: t.by.level})
		}
	}
	for _, set := range []struct {
		kind string
		all  []cosmetic
	}{{"frame", Frames}, {"backdrop", Backdrops}} {
		for _, c := range set.all {
			if w.has(c.by) {
				out = append(out, Unlock{Kind: set.kind, ID: c.id, Name: c.name, From: w.from(c.by), byLevel: c.by.level})
			}
		}
	}
	for _, s := range Unlockable {
		if w.shapeOpen(s) {
			u := Unlock{Kind: "avatar", ID: s, From: w.shapeFrom(s)}
			if s == "crown" {
				u.byLevel = CrownLevel
			}
			out = append(out, u)
		}
	}
	return out
}

// unlocksBy are everything that unlocks with what passes (whether or not the player has it yet).
func (w wardrobe) unlocksBy(pass func(unlock) bool) []Unlock {
	var out []Unlock
	for _, t := range w.titles {
		if pass(t.by) {
			out = append(out, Unlock{Kind: "title", ID: t.ID, Name: t.Name, Tier: t.Tier, From: w.from(t.by)})
		}
	}
	for _, set := range []struct {
		kind string
		all  []cosmetic
	}{{"frame", Frames}, {"backdrop", Backdrops}} {
		for _, c := range set.all {
			if pass(c.by) {
				out = append(out, Unlock{Kind: set.kind, ID: c.id, Name: c.name, From: w.from(c.by)})
			}
		}
	}
	return out
}

// rewardsOf is what an achievement gives a player besides its XP. One not earned yet: what it would unlock that they
// don't have — an avatar shared by a few (a flame for every streak) is the reward of the first of them in the list
// only, and what the first of a tier unlocks is the tier's (tierUnlocks), not each one's. One earned: what came with
// it.
func (w wardrobe) rewardsOf(a Achievement) []Unlock {
	_, done := w.earned[a.ID]
	firstOf := func(pass func(Achievement) bool) bool {
		if done {
			return w.first(pass) == a.ID
		}
		if w.first(pass) != "" {
			return false
		}
		i := slices.IndexFunc(Achievements, pass)
		return i >= 0 && Achievements[i].ID == a.ID
	}
	var out []Unlock
	if a.Icon != "" && firstOf(func(x Achievement) bool { return x.Icon == a.Icon }) {
		out = append(out, Unlock{Kind: "avatar", ID: a.Icon, From: "постижението „" + a.Name + "“"})
	}
	tierFirst := done && w.first(func(x Achievement) bool { return x.Tier == a.Tier }) == a.ID
	return append(out, w.unlocksBy(func(u unlock) bool {
		return u.achieved == a.ID || (u.tier == a.Tier && tierFirst)
	})...)
}

// tierUnlocks are what the first achievement of each tier unlocks, of what the player doesn't have yet.
func (w wardrobe) tierUnlocks() map[Tier][]Unlock {
	out := map[Tier][]Unlock{}
	for _, t := range []Tier{Common, Rare, Epic, Legendary} {
		for _, u := range w.unlocksBy(func(u unlock) bool { return u.tier == t }) {
			if w.first(func(a Achievement) bool { return a.Tier == t }) == "" {
				out[t] = append(out[t], u)
			}
		}
	}
	return out
}

// Next is what comes next for a player: the next level that unlocks something, and what; the division above their
// rating (once it's set), and what reaching it first unlocks.
type Next struct {
	Level           int       `json:"level,omitempty"` // 0: no level ahead unlocks anything
	LevelUnlocks    []Unlock  `json:"levelUnlocks"`
	Division        *Division `json:"division,omitempty"` // nil at the top
	DivisionUnlocks []Unlock  `json:"divisionUnlocks"`
	// Days is the next title of the days' (nil once all are the player's): what it is, how many days it takes, and
	// how many the player has.
	Days *NextDays `json:"days,omitempty"`
}

// NextDays is the next title the days on which the day's questions were played unlock.
type NextDays struct {
	Title Unlock `json:"title"`
	Days  int    `json:"days"`
	Have  int    `json:"have"`
}

// next is what comes next for a player with this rating.
func (w wardrobe) next(rating int) Next {
	n := Next{LevelUnlocks: []Unlock{}, DivisionUnlocks: []Unlock{}}
	for l := w.level + 1; l <= w.level+100 && n.Level == 0; l++ {
		at := w.unlocksBy(func(u unlock) bool { return u.level == l })
		if l == CrownLevel {
			at = append(at, Unlock{Kind: "avatar", ID: "crown", From: "ниво " + strconv.Itoa(CrownLevel)})
		}
		if len(at) > 0 {
			n.Level, n.LevelUnlocks = l, at
		}
	}
	for _, t := range w.titles {
		if t.by.days > w.days {
			n.Days = &NextDays{Title: Unlock{Kind: "title", ID: t.ID, Name: t.Name, Tier: t.Tier, From: t.by.how()},
				Days: t.by.days, Have: w.days}
			break
		}
	}
	if _, from := DivisionOf(rating); from > 0 && w.placed {
		d, _ := DivisionOf(from)
		n.Division = &d
		for _, u := range w.unlocksBy(func(u unlock) bool { return u.division == d.ID }) {
			if w.peak < d.From {
				n.DivisionUnlocks = append(n.DivisionUnlocks, u)
			}
		}
	}
	return n
}

// numberWords are the numbers to ten, as a phrase says them before „теми“.
var numberWords = []string{"", "една", "две", "три", "четири", "пет", "шест", "седем", "осем", "девет", "десет"}

// inWords is a number in words, past ten in digits.
func inWords(n int) string {
	if n > 0 && n < len(numberWords) {
		return numberWords[n]
	}
	return strconv.Itoa(n)
}
