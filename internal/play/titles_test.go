package play

import (
	"maps"
	"os"
	"slices"
	"strings"
	"testing"
)

// The level's titles name zeal and stamina; loyalty is the days' (on which the day's questions were played); intellect
// is mastery's: „Всезнание“ for „Експерт“ in every topic, „Оракул“ for „Светило“ in three, and „Гениален ум“ is gone.
func TestTitlesOfDevotion(t *testing.T) {
	w := setup(t)
	byLevel, byDays := map[int]string{}, map[int]string{}
	for _, x := range Titles {
		switch x.Group {
		case TitleLevel:
			byLevel[x.by.level] = x.Name
		case TitleDays:
			byDays[x.by.days] = x.Name
		}
	}
	for level, name := range map[int]string{1: "Нова искра", 12: "Ненаситно любопитство", 16: "Жажда за знание",
		20: "Упоритост", 30: "Маратон на въпросите", 35: "Издръжливост", 50: "Вечна искра"} {
		if byLevel[level] != name {
			t.Fatalf("level %d's title: %q, want %q", level, byLevel[level], name)
		}
	}
	for days, name := range map[int]string{14: "Постоянство", 30: "Всеотдайност", 100: "Вярност към Алманаха",
		365: "Стълб на Алманаха", 1000: "Жив алманах"} {
		if byDays[days] != name {
			t.Fatalf("%d days' title: %q, want %q", days, byDays[days], name)
		}
	}
	// Locked, a title of the days says how many it takes, and how many the player has.
	ten := wardrobe{days: 10}.titleViews(Titles)
	if i := slices.IndexFunc(ten, func(v TitleView) bool { return v.ID == "persistence" }); i < 0 || !ten[i].Locked ||
		ten[i].How != "14 дни с въпросите на деня, засега 10" || ten[i].Group != TitleDays {
		t.Fatalf("„Постоянство“ at 10 days: %+v", ten[max(i, 0)])
	}
	if !(wardrobe{days: 14}).wears(Titles, "persistence") || (wardrobe{level: 50}).wears(Titles, "persistence") {
		t.Fatal("„Постоянство“ isn't the days'")
	}
	all := w.g.titles()
	for _, gone := range []string{"Ерудиция", "Гениален ум", "Извор на знания", "Жива библиотека", "Вековна мъдрост"} {
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
	if !told("grit") || told("oracle") || told("omniscience") {
		t.Fatalf("news after the migration: %+v", n.Unlocks)
	}
}

// The titles past level 16 name devotion too: whoever wears an old one wears its level's new one, and what was told of
// the old names isn't told again under the new ones.
func TestDevotionMigrationOn(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	well, wisdom := w.user(), w.user()
	for u, title := range map[int64]string{well: "well", wisdom: "wisdom"} {
		if _, err := w.db.Write.Exec(`UPDATE users SET title = ? WHERE id = ?`, title, u); err != nil {
			t.Fatal(err)
		}
		if _, err := w.db.Write.Exec(`INSERT INTO achievements (user_id, id, at, xp, seen) VALUES (?, 'streak3', 1, 200000, 1)`,
			u); err != nil {
			t.Fatal(err)
		}
	}
	for _, key := range []string{"title:well:Извор на знания", "title:keeper:Пазител на знанието"} {
		if _, err := w.db.Write.Exec(`INSERT INTO unlocks_told (user_id, id) VALUES (?, ?)`, well, key); err != nil {
			t.Fatal(err)
		}
	}
	body, err := os.ReadFile("../store/migrations/0045_devotion_titles_on.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(string(body)); err != nil {
		t.Fatal(err)
	}
	for u, want := range map[int64]string{well: "Упоритост", wisdom: "Издръжливост"} {
		if look, err := w.g.LookOf(ctx, u); err != nil || look.Title != want {
			t.Fatalf("wears %q after the migration, want %q (%v)", look.Title, want, err)
		}
	}
	var n int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM unlocks_told WHERE user_id = ? AND id IN
		('title:grit:Упоритост', 'title:keeper:Пазител на Алманаха')`, well).Scan(&n)
	if n != 2 {
		t.Fatalf("%d of the new names told", n)
	}
}

// The avatars the game gives: players who sign up one after another differ in tone as well as shape, the first ones
// aren't all one tone, and every shape comes in every tone.
func TestDefaultAvatars(t *testing.T) {
	pairs := map[string]bool{}
	n := int64(len(FreeShapes) * len(tinted))
	for id := int64(1); id <= n; id++ {
		a, b := DefaultAvatar(id), DefaultAvatar(id+1)
		pairs[a] = true
		_, toneA, _ := strings.Cut(a, "-")
		_, toneB, _ := strings.Cut(b, "-")
		if toneA == toneB {
			t.Fatalf("players %d and %d share the tone %s", id, id+1, toneA)
		}
	}
	if len(pairs) != int(n) {
		t.Fatalf("%d of %d shapes and tones given", len(pairs), n)
	}
}

// Past level 12 the ladder never goes quiet for long: every few levels unlock something, to level 50 (review
// 2026-11-18, E8).
func TestLevelLadderNeverQuiet(t *testing.T) {
	w := wardrobe{titles: Titles}
	last := 12
	for level := 13; level <= 50; level++ {
		if len(w.unlocksBy(func(u unlock) bool { return u.level == level })) > 0 || slices.Contains(slices.Collect(maps.Values(ShapeLevels)), level) {
			if level-last > 3 {
				t.Errorf("nothing unlocks between levels %d and %d", last, level)
			}
			last = level
		}
	}
	if last != 50 {
		t.Errorf("the ladder ends at %d", last)
	}
}

// Whoever wore a title of the days by the level, without the days, wears the level's again, and is told of it once
// the days unlock it; with the days, they keep it.
func TestDaysTitlesMigration(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	short, enough := w.user(), w.user()
	w.daysPlayed(enough, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)
	w.daysPlayed(short, 1, 2, 3)
	for _, u := range []int64{short, enough} {
		if _, err := w.db.Write.Exec(`UPDATE users SET title = 'persistence' WHERE id = ?`, u); err != nil {
			t.Fatal(err)
		}
		if _, err := w.db.Write.Exec(`INSERT INTO unlocks_told (user_id, id) VALUES (?, 'title:persistence:Постоянство')`,
			u); err != nil {
			t.Fatal(err)
		}
	}
	body, err := os.ReadFile("../store/migrations/0071_days_titles.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(string(body)); err != nil {
		t.Fatal(err)
	}
	for u, want := range map[int64]string{short: "", enough: "Постоянство"} {
		if look, err := w.g.LookOf(ctx, u); err != nil || look.Title != want {
			t.Fatalf("wears %q after the migration, want %q (%v)", look.Title, want, err)
		}
	}
	var told int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM unlocks_told WHERE id = 'title:persistence:Постоянство'`).Scan(&told)
	if told != 1 {
		t.Fatalf("%d told of „Постоянство“", told)
	}
}

// Every avatar that unlocks does so one way: at a level, or with the one achievement drawn with it; every
// achievement's emblem is one of them; and a locked one says what it takes, for the wardrobe to say how far along.
func TestAvatarsUnlockOneWay(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range append(slices.Clone(FreeShapes), Unlockable...) {
		if seen[s] {
			t.Errorf("%s twice", s)
		}
		seen[s] = true
	}
	for _, s := range Unlockable {
		n := 0
		for _, a := range Achievements {
			if a.Icon == s {
				n++
			}
		}
		if _, byLevel := ShapeLevels[s]; (byLevel && n > 0) || (!byLevel && n != 1) {
			t.Errorf("%s: by level %v, by %d achievements", s, byLevel, n)
		}
	}
	for _, a := range Achievements {
		if a.Icon != "" && !slices.Contains(Unlockable, a.Icon) {
			t.Errorf("%s unlocks %s, not an avatar that unlocks", a.ID, a.Icon)
		}
	}
	for s := range ShapeLevels {
		if !slices.Contains(Unlockable, s) {
			t.Errorf("level shape %s isn't unlockable", s)
		}
	}

	list := shapes(map[string]int64{"streak3": 1}, 4)
	at := func(s string) Shape { return list[slices.IndexFunc(list, func(x Shape) bool { return x.Shape == s })] }
	for s, want := range map[string]Shape{
		"fox":      {Shape: "fox"},
		"flame":    {Shape: "flame"},
		"mouse":    {Shape: "mouse"},
		"squirrel": {Shape: "squirrel", Locked: true, How: "ниво 7", Level: 7},
		"torch":    {Shape: "torch", Locked: true, How: "постижението „Цяла седмица“", Achievement: "streak7"},
		"owl":      {Shape: "owl", Locked: true, How: "скрито постижение", Achievement: "nightOwl"},
	} {
		if got := at(s); got != want {
			t.Errorf("%s: %+v, want %+v", s, got, want)
		}
	}
	w := wardrobe{level: 5, earned: map[string]int64{"streak3": 1}}
	if n := w.next(0); n.Level != 6 || slices.ContainsFunc(n.LevelUnlocks, func(u Unlock) bool { return u.Kind == "avatar" }) {
		t.Errorf("next from level 5: %+v", n)
	}
	if n := (wardrobe{level: 6}).next(0); n.Level != 7 || !slices.Contains(n.LevelUnlocks,
		Unlock{Kind: "avatar", ID: "squirrel", From: "ниво 7"}) {
		t.Errorf("next from level 6: %+v", n)
	}
}

// Whoever wore the cup by „Майстор“ alone wears the scholar's cap, its own emblem now; with „Сто игри“, the cup stays.
func TestOwnEmblemsMigration(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	master, both, plain := w.user(), w.user(), w.user()
	for u, ids := range map[int64][]string{master: {"master"}, both: {"master", "games100"}, plain: {"streak3"}} {
		for _, id := range ids {
			if _, err := w.db.Write.Exec(`INSERT INTO achievements (user_id, id, at, xp, seen) VALUES (?, ?, 1, 0, 1)`,
				u, id); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := w.db.Write.Exec(`UPDATE users SET avatar = 'trophy-rose' WHERE id = ?`, u); err != nil {
			t.Fatal(err)
		}
	}
	body, err := os.ReadFile("../store/migrations/0083_own_emblems.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(string(body)); err != nil {
		t.Fatal(err)
	}
	for u, want := range map[int64]string{master: "cap-rose", both: "trophy-rose", plain: "trophy-rose"} {
		if look, err := w.g.LookOf(ctx, u); err != nil || !strings.HasPrefix(look.Avatar, want) {
			t.Fatalf("wears %q after the migration, want %q (%v)", look.Avatar, want, err)
		}
	}
}

// A title once earned stays the player's though what unlocked it goes down: a master of history who then gets history
// wrong keeps „Майстор · История“, worn, to wear, and told only the once.
func TestTitlesStayEarned(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	for range MasteryFrom / Length {
		run, _ := w.g.StartTopic(ctx, ana, "history")
		w.play(ana, run.ID, repeat(w.right, Length)...)
	}
	if err := w.g.SetLook(ctx, ana, nil, ptr("master-history")); err != nil {
		t.Fatal(err)
	}
	for _, again := range []bool{false, true} {
		n, err := w.g.NewsOf(ctx, ana, 0)
		if err != nil {
			t.Fatal(err)
		}
		if told := slices.ContainsFunc(n.Unlocks, func(u Unlock) bool { return u.ID == "master-history" }); again && told {
			t.Fatal("a title told twice")
		}
	}
	tier := func() int {
		m, _ := w.g.MasteryOf(ctx, ana)
		return m[slices.IndexFunc(m, func(x Mastery) bool { return x.Category == "history" })].Tier
	}
	for i := 0; tier() >= MasterTier; i++ {
		if i == 20 {
			t.Fatalf("history's mastery stays at %d", tier())
		}
		run, _ := w.g.StartTopic(ctx, ana, "history")
		w.play(ana, run.ID, repeat(w.wrong, Length)...)
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Title != "Майстор · История" {
		t.Fatalf("worn after the mastery went down: %+v", look)
	}
	if err := w.g.SetLook(ctx, ana, nil, ptr("")); err != nil {
		t.Fatal(err)
	}
	if err := w.g.SetLook(ctx, ana, nil, ptr("master-history")); err != nil {
		t.Fatalf("put on again after the mastery went down: %v", err)
	}
	p, _ := w.g.ProgressOf(ctx, ana)
	if i := slices.IndexFunc(p.Titles, func(v TitleView) bool { return v.ID == "master-history" }); i < 0 || p.Titles[i].Locked {
		t.Fatal("locked after the mastery went down")
	}
	if n, _ := w.g.NewsOf(ctx, ana, 0); slices.ContainsFunc(n.Unlocks, func(u Unlock) bool { return u.ID == "master-history" }) {
		t.Fatal("told again")
	}
	// Another, who never had it, may not wear it.
	if err := w.g.SetLook(ctx, w.user(), nil, ptr("master-history")); err == nil {
		t.Fatal("worn by one who never had it")
	}
}
