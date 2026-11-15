package play

import (
	"os"
	"slices"
	"testing"
)

// The level's titles name devotion; intellect is mastery's: „Всезнание“ for „Експерт“ in every topic, „Оракул“ for
// „Светило“ in three, and „Гениален ум“ is gone.
func TestTitlesOfDevotion(t *testing.T) {
	w := setup(t)
	byLevel := map[int]string{}
	for _, x := range Titles {
		if x.Group == TitleLevel {
			byLevel[x.by.level] = x.Name
		}
	}
	for level, name := range map[int]string{8: "Постоянство", 12: "Ненаситно любопитство", 16: "Всеотдайност",
		25: "Вярност към Алманаха"} {
		if byLevel[level] != name {
			t.Fatalf("level %d's title: %q, want %q", level, byLevel[level], name)
		}
	}
	all := w.g.titles()
	for _, gone := range []string{"Ерудиция", "Гениален ум"} {
		if slices.ContainsFunc(all, func(x Title) bool { return x.Name == gone }) {
			t.Fatalf("%q is still a title", gone)
		}
	}

	topics := map[string]string{}
	for _, c := range w.b.Categories {
		topics[c.ID] = c.Name
	}
	at := func(tier int, n int) map[string]int {
		m := map[string]int{}
		for _, c := range w.b.Categories[:n] {
			m[c.ID] = tier
		}
		return m
	}
	expert, luminary := MasterTier-1, MasterTier+1
	for _, c := range []struct {
		mastery             map[string]int
		omniscience, oracle bool
	}{
		{map[string]int{}, false, false},
		{at(expert, len(topics)-1), false, false}, // one topic short
		{at(expert, len(topics)), true, false},
		{at(luminary, 2), false, false},
		{at(luminary, 3), false, true},
		{at(luminary, len(topics)), true, true}, // Светило is past Експерт
	} {
		wr := wardrobe{mastery: c.mastery, titles: all, topics: topics}
		if wr.wears(all, "omniscience") != c.omniscience || wr.wears(all, "oracle") != c.oracle {
			t.Fatalf("mastery %v: omniscience %v, oracle %v", c.mastery, wr.wears(all, "omniscience"),
				wr.wears(all, "oracle"))
		}
	}

	// Locked, each says what unlocks it, in the mastery group.
	views := wardrobe{topics: topics}.titleViews(all)
	for id, how := range map[string]string{"omniscience": "„Експерт“ във всички теми", "oracle": "„Светило“ в три теми"} {
		i := slices.IndexFunc(views, func(v TitleView) bool { return v.ID == id })
		if i < 0 || !views[i].Locked || views[i].How != how || views[i].Group != TitleTopic || views[i].Tier != Legendary {
			t.Fatalf("%s, locked: %+v", id, views[max(i, 0)])
		}
	}
}

// Whoever wore an old level title wears its level's new one, and what they were told of the old ones is told of the
// new: nothing comes again as news, and a mastery title of an old name comes as news when it's earned.
func TestDevotionMigration(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	oracle, genius, plain := w.user(), w.user(), w.user()
	w.played(oracle, XPFromDay) // XP open: what a level unlocks is news
	// Level 25 and more, as their XP was.
	for _, u := range []int64{oracle, genius, plain} {
		if _, err := w.db.Write.Exec(`INSERT INTO achievements (user_id, id, at, xp, seen) VALUES (?, 'streak3', 1, 60000, 1)`,
			u); err != nil {
			t.Fatal(err)
		}
	}
	if l, _, _ := LevelOf(60000); l < 25 {
		t.Fatalf("level %d", l)
	}
	for u, title := range map[int64]string{oracle: "oracle", genius: "genius", plain: "spark"} {
		if _, err := w.db.Write.Exec(`UPDATE users SET title = ? WHERE id = ?`, title, u); err != nil {
			t.Fatal(err)
		}
	}
	for _, key := range []string{"title:erudition:Ерудиция", "title:omniscience:Всезнание", "title:genius:Гениален ум",
		"title:oracle:Оракул", "title:spark:Нова искра"} {
		if _, err := w.db.Write.Exec(`INSERT INTO unlocks_told (user_id, id) VALUES (?, ?)`, oracle, key); err != nil {
			t.Fatal(err)
		}
	}
	body, err := os.ReadFile("../store/migrations/0043_devotion_titles.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(string(body)); err != nil {
		t.Fatal(err)
	}
	for u, want := range map[int64]string{oracle: "Вярност към Алманаха", genius: "Всеотдайност", plain: "Нова искра"} {
		look, err := w.g.LookOf(ctx, u)
		if err != nil || look.Title != want {
			t.Fatalf("wears %q after the migration, want %q (%v)", look.Title, want, err)
		}
	}
	var old int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM unlocks_told WHERE id IN ('title:oracle:Оракул', 'title:omniscience:Всезнание',
		'title:erudition:Ерудиция', 'title:genius:Гениален ум')`).Scan(&old)
	if old != 0 {
		t.Fatalf("%d old names still told", old)
	}
	n, err := w.g.NewsOf(ctx, oracle, 0)
	if err != nil {
		t.Fatal(err)
	}
	told := func(id string) bool {
		return slices.ContainsFunc(n.Unlocks, func(u Unlock) bool { return u.Kind == "title" && u.ID == id })
	}
	for _, id := range []string{"persistence", "insatiable", "devotion", "loyalty", "spark"} {
		if told(id) {
			t.Fatalf("%s told again: %+v", id, n.Unlocks)
		}
	}
	if !told("well") || told("oracle") || told("omniscience") {
		t.Fatalf("news after the migration: %+v", n.Unlocks)
	}
}
