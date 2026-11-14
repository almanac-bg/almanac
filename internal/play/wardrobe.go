package play

import (
	"context"
	"slices"
	"strconv"
)

// The wardrobe: besides the avatar's shape and tone and the title (titles.go), a frame around the avatar and a pattern behind
// it. Each is unlocked by something the player has done — a level, an achievement, a division reached, a place on a
// season's podium — and shows wherever they do. Every unlock, of any of them, is an Unlock: what NewsOf tells once, an
// achievement lists as its reward, and Next shows ahead. The art is drawn in the client (web/src/art).

// Cosmetic is a frame or a pattern as a player may pick it: free, unlocked, or locked with what unlocks it.
type Cosmetic struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Locked bool   `json:"locked,omitempty"`
	How    string `json:"how,omitempty"`
}

// unlock is what makes a cosmetic or a title a player's: a level, an achievement of a tier (any one), one
// achievement, a division reached (by the highest rating), a season ended in a place (1–3) or better, Роял won some
// times, or a mastery tier (or higher) in a topic.
type unlock struct {
	level    int
	tier     Tier
	achieved string
	division string
	podium   int
	royal    int
	topic    string
	mastery  int
}

type cosmetic struct {
	id, name string
	by       unlock
}

// Frames, from the plainest.
var Frames = []cosmetic{
	{"ring", "Пръстен", unlock{level: 2}},
	{"double", "Двоен пръстен", unlock{level: 5}},
	{"dots", "Точки", unlock{level: 8}},
	{"flames", "Пламъци", unlock{achieved: "streak30"}},
	{"laurel", "Лавров венец", unlock{tier: Legendary}},
	{"gem", "Кристал", unlock{division: "diamond"}},
	{"halo", "Ореол", unlock{division: "legend"}},
	{"podium3", "Бронзова", unlock{podium: 3}},
	{"podium2", "Сребърна", unlock{podium: 2}},
	{"podium1", "Шампионска", unlock{podium: 1}},
}

// Backdrops, the patterns behind the avatar's shape, from the plainest.
var Backdrops = []cosmetic{
	{"dots", "Точици", unlock{level: 3}},
	{"stripes", "Ивици", unlock{level: 6}},
	{"grid", "Мрежа", unlock{level: 12}},
	{"rays", "Лъчи", unlock{tier: Epic}},
	{"stars", "Звезди", unlock{division: "gold"}},
}

// wardrobe is what a player has done that unlocks things: their level, achievements, highest rating, their places
// on seasons' podiums, the Роял tournaments they've won, and their mastery tier in each topic they're sure in.
type wardrobe struct {
	level   int
	earned  map[string]int64
	peak    int
	podium  Podium
	royals  int
	mastery map[string]int
	titles  []Title           // every title there is (the game's: topics come from the bank)
	topics  map[string]string // the bank's topics' names, by id
}

func (w wardrobe) has(u unlock) bool {
	switch {
	case u.level > 0:
		return w.level >= u.level
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
	case u.podium > 0:
		best := w.podium.best()
		return best > 0 && best <= u.podium
	case u.royal > 0:
		return w.royals >= u.royal
	case u.topic != "":
		tier, ok := w.mastery[u.topic]
		return ok && tier >= u.mastery
	}
	return true
}

// how says what unlocks a cosmetic, for whoever hasn't yet.
func (u unlock) how() string {
	switch {
	case u.level > 0:
		return "ниво " + strconv.Itoa(u.level)
	case u.achieved != "":
		a, _ := achievementByID(u.achieved)
		return "постижението „" + a.Name + "“"
	case u.tier != "":
		return map[Tier]string{Common: "обикновено", Rare: "рядко", Epic: "епично", Legendary: "легендарно"}[u.tier] +
			" постижение"
	case u.division != "":
		for _, d := range Divisions {
			if d.ID == u.division {
				return "дивизия " + d.Name
			}
		}
	case u.podium > 0:
		return map[int]string{1: "първо място в сезон", 2: "първо или второ място в сезон",
			3: "място в първите трима на сезон"}[u.podium]
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
	if err = g.DB.Read.QueryRowContext(ctx, `SELECT peak FROM users WHERE id = ?`, userID).Scan(&w.peak); err != nil {
		return w, err
	}
	if w.podium, err = g.podiumOf(ctx, userID); err != nil {
		return w, err
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
}

// key is what's kept of an unlock once told. A podium's title is told again with each place won, by its new name.
func (u Unlock) key() string { return u.Kind + ":" + u.ID + ":" + u.Name }

// from says what unlocks something, as a phrase after „с“.
func (w wardrobe) from(u unlock) string {
	switch {
	case u.topic != "":
		return "„" + MasteryTiers[u.mastery].Name + "“ в „" + w.topics[u.topic] + "“"
	case u.tier != "":
		return "първото си " + u.how()
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

// unlocks are everything a player has unlocked: titles (the podium's by how many times), frames, patterns, shapes.
func (w wardrobe) unlocks() []Unlock {
	var out []Unlock
	for i, won := range w.podium {
		if won > 0 {
			name, tier := PodiumTitle(i+1, won)
			out = append(out, Unlock{Kind: "title", ID: podiumTitleID(i + 1), Name: name, Tier: tier, From: podiumHow[i]})
		}
	}
	for _, t := range w.titles {
		if w.has(t.by) {
			out = append(out, Unlock{Kind: "title", ID: t.ID, Name: t.Name, Tier: t.Tier, From: w.from(t.by)})
		}
	}
	for _, set := range []struct {
		kind string
		all  []cosmetic
	}{{"frame", Frames}, {"backdrop", Backdrops}} {
		for _, c := range set.all {
			if w.has(c.by) {
				out = append(out, Unlock{Kind: set.kind, ID: c.id, Name: c.name, From: w.from(c.by)})
			}
		}
	}
	for _, s := range Unlockable {
		if w.shapeOpen(s) {
			out = append(out, Unlock{Kind: "avatar", ID: s, From: w.shapeFrom(s)})
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
// rating, what reaching it first unlocks, and what a season ended in it pays.
type Next struct {
	Level           int       `json:"level,omitempty"` // 0: no level ahead unlocks anything
	LevelUnlocks    []Unlock  `json:"levelUnlocks"`
	Division        *Division `json:"division,omitempty"` // nil at the top
	DivisionUnlocks []Unlock  `json:"divisionUnlocks"`
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
	if _, from := DivisionOf(rating); from > 0 {
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
