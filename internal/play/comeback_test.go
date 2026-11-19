package play

import (
	"testing"
	"time"
)

// dayPlayed puts a finished game of a day's ten straight in the database, with its right answers, ended at 10:00 in
// Bulgaria on its day.
func (w *world) dayPlayed(user int64, day string, rights int) int64 {
	w.t.Helper()
	at, _ := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	at = at.Add(10 * time.Hour)
	res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, rights, points, ms, started_at, finished_at)
		VALUES (?, 'day', ?, '[{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""},{"id":""}]',
		?, ?, 60000, ?, ?)`, user, day, rights, 100*rights, at.Add(-3*time.Minute).UnixMilli(), at.UnixMilli())
	if err != nil {
		w.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

// Yesterday ends for the player who played it: their right answers and final place, once its last games can't be
// played on any more; never for one who didn't play it.
func TestYesterdayEnds(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.now = time.Date(2026, 11, 20, 0, 10, 0, 0, Bulgaria)
	yesterday := "2026-11-19"
	ana, bo, cy, dee := w.user(), w.user(), w.user(), w.user()
	w.dayPlayed(ana, yesterday, 7)
	w.dayPlayed(bo, yesterday, 9)
	w.dayPlayed(cy, yesterday, 3)
	if w.g.DaySettled(yesterday) {
		t.Fatal("settled ten minutes after midnight: a game begun before it may still be played on")
	}
	if y, err := w.g.YesterdayOf(ctx, ana); err != nil || y != nil {
		t.Fatalf("before it's final: %+v, %v", y, err)
	}
	w.now = time.Date(2026, 11, 20, 8, 0, 0, 0, Bulgaria)
	y, err := w.g.YesterdayOf(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if want := (Yesterday{Day: yesterday, Issue: Issue(yesterday), Rights: 7, Place: 2, Players: 3}); y == nil || *y != want {
		t.Fatalf("yesterday: %+v, want %+v", y, want)
	}
	if y, err := w.g.YesterdayOf(ctx, dee); err != nil || y != nil {
		t.Fatalf("not played: %+v, %v", y, err)
	}
	// Its board, counted once settled, is final: kept a while, not counted on every look.
	d, err := w.g.dayBoard(ctx, yesterday)
	if err != nil || !d.final || d.due() {
		t.Fatalf("yesterday's board: final %v, due %v, %v", d != nil && d.final, d != nil && d.due(), err)
	}
}

// A player back after days away is welcomed by the last day they played; one who played yesterday isn't away.
func TestAway(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.now = time.Date(2026, 11, 20, 12, 0, 0, 0, Bulgaria)
	ana, bo, cy := w.user(), w.user(), w.user()
	w.dayPlayed(ana, "2026-11-14", 5)
	w.dayPlayed(ana, "2026-11-17", 5)
	w.dayPlayed(ana, "2026-11-20", 5) // today's doesn't count: the last before today is what's said
	w.dayPlayed(bo, "2026-11-19", 5)
	for _, c := range []struct {
		who  int64
		last string
		away bool
	}{{ana, "2026-11-17", true}, {bo, "2026-11-19", false}, {cy, "", false}} {
		last, err := w.g.LastDay(ctx, c.who)
		if err != nil || last != c.last || w.g.Away(last) != c.away {
			t.Fatalf("player %d: last %q (want %q), away %v (want %v), %v", c.who, last, c.last, w.g.Away(last), c.away, err)
		}
	}
}

// All of a player's games, a page at a time, newest first, of a kind or all; and the day's ten spread by right answers.
func TestGamesPaged(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.now = time.Date(2026, 12, 31, 12, 0, 0, 0, Bulgaria)
	ana, bo := w.user(), w.user()
	start := time.Date(2026, 11, 20, 0, 0, 0, 0, Bulgaria)
	days := 0
	for i := range 35 {
		day := start.AddDate(0, 0, i)
		switch i % 3 {
		case 0:
			w.dayPlayed(ana, day.Format(time.DateOnly), i%11)
			days++
		default:
			if _, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, category, questions, started_at, finished_at)
				VALUES (?, ?, 'history', '[]', ?, ?)`, ana, []string{"", "topic", "duel"}[i%3], day.UnixMilli(),
				day.Add(time.Hour).UnixMilli()); err != nil {
				t.Fatal(err)
			}
		}
	}
	w.dayPlayed(bo, "2026-12-01", 10) // someone else's: never in the list
	w.dayPlayed(ana, w.g.Today(), 8)
	days++
	first, err := w.g.GamesOf(ctx, ana, "", "", GamesPage)
	if err != nil || len(first.Games) != GamesPage || first.Next == "" {
		t.Fatalf("the first page: %d games, next %q, %v", len(first.Games), first.Next, err)
	}
	second, err := w.g.GamesOf(ctx, ana, "", first.Next, GamesPage)
	if err != nil || len(second.Games) != 36-GamesPage || second.Next != "" {
		t.Fatalf("the second page: %d games, next %q, %v", len(second.Games), second.Next, err)
	}
	all := append(first.Games, second.Games...)
	for i := 1; i < len(all); i++ {
		if all[i].At > all[i-1].At || all[i].ID == all[i-1].ID {
			t.Fatalf("not newest first, or twice: %+v then %+v", all[i-1], all[i])
		}
	}
	if all[0].Kind != "day" || all[0].Issue != Issue(w.g.Today()) {
		t.Fatalf("the newest, today's ten with its issue: %+v", all[0])
	}
	dayOnly, err := w.g.GamesOf(ctx, ana, "day", "", GamesPage)
	if err != nil || len(dayOnly.Games) != days {
		t.Fatalf("the day's ten alone: %d, want %d, %v", len(dayOnly.Games), days, err)
	}
	for _, p := range dayOnly.Games {
		if p.Kind != "day" {
			t.Fatalf("not the day's: %+v", p)
		}
	}
	if others, _ := w.g.GamesOf(ctx, ana, "others", "", GamesPage); len(others.Games) != 11 {
		t.Fatalf("with others: %d, want 11", len(others.Games))
	}
	s, err := w.g.StatsOf(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	sum := 0
	for _, n := range s.Spread {
		sum += n
	}
	if sum != days || s.Today != 8 || s.Spread[0] != 2 || s.Spread[8] != 1+1 {
		t.Fatalf("the spread: %v (%d days, want %d), today %d", s.Spread, sum, days, s.Today)
	}
	if len(s.Recent) != RecentGames {
		t.Fatalf("Профил's latest: %d", len(s.Recent))
	}
}

// What will come to a second chance, and when: the questions got wrong lately, each a few days after.
func TestComingToSecondChance(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.now = time.Date(2026, 11, 20, 12, 0, 0, 0, Bulgaria)
	ana := w.user()
	res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at, finished_at) VALUES (?, 'topic', '[]', 0, 0)`, ana)
	if err != nil {
		t.Fatal(err)
	}
	run, _ := res.LastInsertId()
	live := w.b.Live("", "")
	wrong := func(n int, at time.Time) {
		if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, given, score, points, is_right, ms, at)
			VALUES (?, ?, ?, '{}', 0, 0, 0, 3000, ?)`, run, n, live[n].Base().ID, at.UnixMilli()); err != nil {
			t.Fatal(err)
		}
	}
	wrong(0, w.now.Add(-4*24*time.Hour)) // waiting already
	wrong(1, w.now.Add(-24*time.Hour))   // in two days
	wrong(2, w.now.Add(-24*time.Hour))
	wrong(3, w.now.Add(-time.Hour)) // in three
	c, err := w.g.ComingOf(ctx, ana)
	if err != nil || c != (Coming{N: 3, First: 2, Last: 3}) {
		t.Fatalf("coming: %+v, %v", c, err)
	}
	if n, _ := w.g.Mistakes(ctx, ana); n != 1 {
		t.Fatalf("waiting: %d", n)
	}
}
