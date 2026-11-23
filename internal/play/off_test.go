package play

import (
	"slices"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// „Подсказки“ are off (bank.Off, the owner, 2026-11-23): the bank keeps them, but no game deals one: not the day's
// issue nor the days drawn ahead, not a chapter's game, not a duel. A day drawn before with clues in it has a split of
// its topic and difficulty in their place, the rest of it as drawn; today's, being played, stays as it is.
func TestCluesNeverDealt(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	b := w.inPlay.Load()
	clues := map[string]bool{}
	for _, q := range b.Questions {
		if q.Base().Type == "clues" && !q.Extra().Retired {
			clues[q.Base().ID] = true
		}
	}
	if len(clues) == 0 || bank.KindOn("clues") {
		t.Fatal("the sample has no clues, or they're on: nothing to tell")
	}
	dealt := func(where string, picks []Pick) {
		t.Helper()
		for _, p := range picks {
			if clues[p.ID] {
				t.Errorf("%s deals clues: %s", where, p.ID)
			}
		}
	}
	stored := func() map[string][]Pick {
		t.Helper()
		days := map[string][]Pick{}
		rows, err := w.db.Read.Query(`SELECT day, questions FROM days`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var day, s string
			_ = rows.Scan(&day, &s)
			days[day] = mustPicks(t, s)
		}
		return days
	}

	// The day's issue and the days ahead.
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	days := stored()
	if len(days) < 2 {
		t.Fatalf("%d days drawn", len(days))
	}
	for day, picks := range days {
		dealt("the day "+day, picks)
		if !slices.ContainsFunc(picks, func(p Pick) bool { q, _ := b.Get(p.ID); return q.Base().Type == "split" }) {
			t.Errorf("the day %s has no split in the place clues shared", day)
		}
	}
	// A chapter's game, in every chapter, for players new to it and for those who know it well.
	for _, c := range b.Categories {
		for range 4 {
			s, err := w.g.StartTopic(ctx, w.user(), c.ID)
			if err != nil {
				t.Fatal(err)
			}
			dealt("a game of "+c.ID, w.picks(s.ID))
		}
	}
	// A duel.
	for range 10 {
		a, o := w.user(), w.user()
		w.befriend(a, o)
		id, err := w.g.DuelFriend(ctx, a, o)
		if err != nil {
			t.Fatal(err)
		}
		dealt("a duel", w.picks(w.playSide(a, id, nil)))
	}

	// Tomorrow, drawn while clues were dealt, has one in its split's place: a split of its topic and difficulty takes
	// it, the rest of the day stays.
	today := w.g.Today()
	tomorrow := DayShift(today, 1)
	was := days[tomorrow]
	i := slices.IndexFunc(was, func(p Pick) bool { q, _ := b.Get(p.ID); return q.Base().Type == "split" })
	split, _ := b.Get(was[i].ID)
	var clue bank.Question
	for _, q := range b.InCategory(split.Base().Category) {
		if clues[q.Base().ID] {
			clue = q
			break
		}
	}
	clue.Base().Difficulty = split.Base().Difficulty
	then := slices.Clone(was)
	then[i] = Pick{ID: clue.Base().ID, Seed: 7}
	if _, err := w.db.Write.Exec(`UPDATE days SET questions = ? WHERE day = ?`, string(mustJSON(t, then)), tomorrow); err != nil {
		t.Fatal(err)
	}
	w.swap(bank.Of(b.Categories, b.Questions)) // the bank reloaded: the days are kept up with it
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	now := stored()[tomorrow]
	for n, p := range now {
		q, _ := b.Get(p.ID)
		switch {
		case n != i && p != was[n]:
			t.Errorf("tomorrow's question %d changed: %v, was %v", n, p, was[n])
		case n == i && (q.Base().Type != "split" || q.Base().Category != split.Base().Category ||
			q.Base().Difficulty != split.Base().Difficulty):
			t.Errorf("tomorrow's clues are %s (%s, %s, %s) in a split's place", p.ID, q.Base().Category,
				q.Base().Type, q.Base().Difficulty)
		}
	}
	if !slices.Equal(stored()[today], days[today]) {
		t.Error("today's issue changed")
	}
}

// A day ahead whose question changed its kind since it was drawn (a choice made a match again) is drawn again after
// tomorrow, by the day's shape; tomorrow, and today, stay as drawn.
func TestDayShapeKeptAhead(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	b := w.inPlay.Load()
	read := func(day string) []Pick {
		var s string
		if err := w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, day).Scan(&s); err != nil {
			t.Fatalf("%s: %v", day, err)
		}
		return mustPicks(t, s)
	}
	today := w.g.Today()
	tomorrow, after := DayShift(today, 1), DayShift(today, 2)
	before := map[string][]Pick{tomorrow: read(tomorrow), after: read(after)}
	for _, day := range []string{tomorrow, after} {
		if !shaped(b, before[day]) {
			t.Fatalf("%s isn't of the day's kinds as drawn", day)
		}
	}
	// A choice of each day turns into a true-or-not: the day's kinds aren't its shape any more.
	turned := map[string]string{}
	for _, day := range []string{tomorrow, after} {
		for _, p := range before[day] {
			if q, _ := b.Get(p.ID); q.Base().Type == "choice" && !bank.HasPictures(q) {
				turned[day] = p.ID
				break
			}
		}
	}
	qs := slices.Clone(b.Questions)
	for i, q := range qs {
		for _, id := range turned {
			if q.Base().ID == id {
				c := q.(*bank.Choice)
				qs[i] = &bank.TrueFalse{Head: bank.Head{ID: id, Type: "truefalse", Difficulty: c.Difficulty,
					Text: "Твърдение.", Category: c.Category}, Answer: true, Tail: c.Tail}
			}
		}
	}
	changed := bank.Of(b.Categories, qs)
	if shaped(changed, before[after]) {
		t.Fatal("a day with a choice turned into a true-or-not still has the day's kinds")
	}
	w.swap(changed)
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(read(tomorrow), before[tomorrow]) {
		t.Error("tomorrow was drawn again")
	}
	if again := read(after); slices.Equal(again, before[after]) || !shaped(changed, again) {
		t.Errorf("the day after tomorrow, misshapen, wasn't drawn again by the day's kinds: %v", again)
	}
}
