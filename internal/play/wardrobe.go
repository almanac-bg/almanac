package play

import (
	"context"
	"slices"
	"strconv"
)

// The wardrobe: besides the avatar's shape and tone and the title (titles.go), a frame around the avatar and a pattern behind
// it. Each is unlocked by something the player has done — a level, an achievement, a division reached, a place on a
// season's podium — and shows wherever they do. The art is drawn in the client (web/src/art/frame.ts, the .bd-* patterns).

// Cosmetic is a frame or a pattern as a player may pick it: free, unlocked, or locked with what unlocks it.
type Cosmetic struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Locked bool   `json:"locked,omitempty"`
	How    string `json:"how,omitempty"`
}

// unlock is what makes a cosmetic or a title a player's: a level, an achievement of a tier (any one), one
// achievement, a division reached (by the highest rating), a season ended in a place (1–3) or better, or Роял won
// some times.
type unlock struct {
	level    int
	tier     Tier
	achieved string
	division string
	podium   int
	royal    int
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
// on seasons' podiums, and the Роял tournaments they've won.
type wardrobe struct {
	level  int
	earned map[string]int64
	peak   int
	podium Podium
	royals int
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
	w.royals, err = g.royalWins(ctx, userID)
	return w, err
}
