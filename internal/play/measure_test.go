package play

import (
	"testing"
	"time"
)

// stored puts a game straight in the database: begun at 10:00 in Bulgaria on its day, with a question answered.
func (w *world) stored(user int64, kind, day string, finished, scripted bool) {
	w.t.Helper()
	at, _ := time.ParseInLocation(time.DateOnly, day, Bulgaria)
	at = at.Add(10 * time.Hour)
	var end any
	if finished {
		end = at.Add(5 * time.Minute).UnixMilli()
	}
	var dayCol any
	if kind == "day" {
		dayCol = day
	}
	if _, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, at, started_at, finished_at, shadow)
		VALUES (?, ?, ?, '[]', 1, ?, ?, ?)`, user, kind, dayCol, at.UnixMilli(), end, scripted); err != nil {
		w.t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(`INSERT OR IGNORE INTO active_days (user_id, day) VALUES (?, ?)`, user, day); err != nil {
		w.t.Fatal(err)
	}
}

func TestTallies(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	for _, key := range []string{"share:day", "share:day", "visit:home"} {
		if err := w.g.Tally(ctx, key, 1); err != nil {
			t.Fatal(err)
		}
	}
	w.wait(24 * time.Hour)
	_ = w.g.Tally(ctx, "share:day", 3)
	if got, _ := w.g.Tallies(ctx, "2026-11-12", "2026-11-13"); got["share:day"] != 5 || got["visit:home"] != 1 {
		t.Fatalf("two days: %v", got)
	}
	if got, _ := w.g.Tallies(ctx, "2026-11-13", "2026-11-13"); got["share:day"] != 3 || got["visit:home"] != 0 {
		t.Fatalf("the second day: %v", got)
	}
}

// An answer to the day's questions counts, and apart, one to a question the player had answered in another game.
func TestDayAnswersSeenBefore(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	s, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	// Ana met the day's first question before, in a game of long ago (before the days were drawn ahead).
	res, _ := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, category, questions, started_at) VALUES (?, 'topic', '', '[]', 0)`, ana)
	old, _ := res.LastInsertId()
	if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, score, points, is_right, ms, at)
		VALUES (?, 0, ?, 1, 0, 1, 3000, 0)`, old, w.picks(s.ID)[0].ID); err != nil {
		t.Fatal(err)
	}
	// And the second one in a game this morning, which another player's day doesn't count for her.
	now := w.now.UnixMilli()
	res, _ = w.db.Write.Exec(`INSERT INTO runs (user_id, kind, category, questions, started_at) VALUES (?, 'topic', '', '[]', ?)`,
		ana, now)
	morning, _ := res.LastInsertId()
	if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, score, points, is_right, ms, at)
		VALUES (?, 0, ?, 1, 0, 1, 3000, ?)`, morning, w.picks(s.ID)[1].ID, now); err != nil {
		t.Fatal(err)
	}
	bo := w.user()
	b, _ := w.g.StartDay(ctx, bo)
	w.play(bo, b.ID, repeat(w.right, Length)...)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if got, _ := w.g.Tallies(ctx, w.g.Today(), w.g.Today()); got["day:answers"] != 2*Length || got["day:seen"] != 2 {
		t.Fatalf("the day's answers: %v", got)
	}
}

func TestNewcomers(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	old, ana, bo := w.user(), w.user(), w.user()
	w.stored(old, "day", "2026-11-01", true, false) // came before: not new
	w.stored(old, "day", "2026-11-12", true, false)
	// Ana: the day and a topic on her first day, the day again on the next, and a week later.
	w.stored(ana, "day", "2026-11-12", true, false)
	w.stored(ana, "topic", "2026-11-12", true, false)
	w.stored(ana, "day", "2026-11-13", true, false)
	w.stored(ana, "day", "2026-11-15", true, false)
	w.stored(ana, "topic", "2026-11-19", false, false)
	// Bo came by an invite, began with a topic, turned notifications on and made a friend the same day.
	w.stored(bo, "topic", "2026-11-13", false, false)
	_, _ = w.db.Write.Exec(`UPDATE users SET came_from = 'invite' WHERE id = ?`, bo)
	evening := time.Date(2026, 11, 13, 21, 0, 0, 0, Bulgaria).UnixMilli()
	_, _ = w.db.Write.Exec(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES ('e', ?, 'p', 'a', ?)`, bo, evening)
	_, _ = w.db.Write.Exec(`INSERT INTO friends (user_id, friend_id, since) VALUES (?, ?, ?)`, bo, ana, evening)
	// Ana's friend from the day after her first: not by the end of it.
	_, _ = w.db.Write.Exec(`INSERT INTO friends (user_id, friend_id, since) VALUES (?, ?, ?)`, ana, bo, evening)

	w.now = time.Date(2026, 11, 20, 10, 0, 0, 0, Bulgaria)
	act, err := w.g.Activity(ctx, "2026-10-01")
	if err != nil {
		t.Fatal(err)
	}
	news, err := w.g.Newcomers(ctx, act, "2026-11-10")
	if err != nil {
		t.Fatal(err)
	}
	if len(news) != 2 {
		t.Fatalf("newcomers: %+v", news)
	}
	a, b := news[0], news[1]
	if a.First != "2026-11-12" || a.Over != 8 || a.Games != 2 || a.FirstKind != "day" || a.CameFrom != "" ||
		!a.Played[0] || !a.Played[1] || a.Played[2] || !a.Played[7] || a.DayTens() != 3 || a.Push || a.Friend ||
		!a.FirstFinished || a.RoomOnly || !a.Kinds["topic"] || !a.DayTenAgain() {
		t.Fatalf("Ana: %+v", a)
	}
	if !a.Due(7) || a.Due(8) || !a.BackWithin(1, 7) || a.BackWithin(4, 6) {
		t.Fatalf("Ana's days: %+v", a)
	}
	if b.First != "2026-11-13" || b.Over != 7 || b.Games != 1 || b.FirstKind != "topic" || b.CameFrom != "invite" ||
		!b.Push || !b.Friend || b.DayTens() != 0 || b.Due(7) {
		t.Fatalf("Bo: %+v", b)
	}
}

func TestStreakHealth(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	days := func(user int64, from string, n int) {
		for d := range n {
			w.stored(user, "day", DayShift(from, d), true, false)
		}
	}
	ana, bo, cy := w.user(), w.user(), w.user()
	days(ana, "2026-11-12", 4) // to the 15th; the 16th spends her reserve day, the 17th ends a streak of 4
	days(bo, "2026-11-18", 2)  // 2 days, today not played yet
	days(cy, "2026-11-13", 7)  // 7 days, today with them
	w.now = time.Date(2026, 11, 19, 10, 0, 0, 0, Bulgaria)
	h, err := w.g.StreakHealth(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if h.Going[0] != 1 || h.Going[1] != 0 || h.Going[2] != 1 || h.Going[3] != 0 || h.Spent != 1 ||
		h.Ended[1] != 1 || h.Ended[0]+h.Ended[2]+h.Ended[3] != 0 {
		t.Fatalf("the streaks: %+v", h)
	}
	// Measured over two days (the 17th and 18th), Ana's streak ends in them and her spent day is before; over one, both
	// are.
	if h, _ := w.g.StreakHealth(ctx, 2); h.Spent != 0 || h.Ended[1] != 1 {
		t.Fatalf("over two days: %+v", h)
	}
	if h, _ := w.g.StreakHealth(ctx, 1); h.Spent != 0 || h.Ended[1] != 0 || h.Going[2] != 1 {
		t.Fatalf("over one day: %+v", h)
	}
	if StreakBand(1) != 0 || StreakBand(2) != 0 || StreakBand(6) != 1 || StreakBand(29) != 2 || StreakBand(400) != 3 {
		t.Fatal("the bands")
	}
}

func TestGames(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy := w.user(), w.user(), w.user()
	w.stored(ana, "day", "2026-11-12", true, false)
	w.stored(ana, "topic", "2026-11-12", true, false)
	w.stored(bo, "day", "2026-11-12", true, false)
	w.stored(cy, "duel", "2026-11-12", true, false)
	w.stored(cy, "topic", "2026-11-12", true, true) // a script's: not counted
	w.stored(bo, "day", "2026-11-11", true, false)
	days, err := w.g.Games(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(days) != 7 || days[0].Day != "2026-11-12" || days[1].Day != "2026-11-11" {
		t.Fatalf("the days: %+v", days)
	}
	if d := days[0]; d.Kinds["day"] != 2 || d.Kinds["topic"] != 1 || d.Kinds["duel"] != 1 || d.DayPlayers != 2 || d.OnlyDayPlayer != 1 {
		t.Fatalf("today: %+v", d)
	}
	if d := days[1]; d.Kinds["day"] != 1 || d.DayPlayers != 1 || d.OnlyDayPlayer != 1 {
		t.Fatalf("yesterday: %+v", d)
	}
}

// Speed is a pace, not one tap's luck: „Пет за миг“ takes five right answers in one game, each under three seconds.
func TestFastIsAPace(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	q := w.b.Questions[0].Base().ID
	game := func(answers ...int) {
		res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at, finished_at) VALUES (?, 'topic', '[]', 0, 1)`, ana)
		if err != nil {
			t.Fatal(err)
		}
		run, _ := res.LastInsertId()
		for i, ms := range answers {
			if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, score, points, is_right, ms, at)
				VALUES (?, ?, ?, 1, 0, 1, ?, ?)`, run, i, q, ms, i); err != nil {
				t.Fatal(err)
			}
		}
	}
	fast := func() int {
		m, err := w.g.measure(ctx, ana)
		if err != nil {
			t.Fatal(err)
		}
		return m["fast"]
	}
	game(900, 1200, 2500, 2900, FastMs) // four quick, the fifth on the line
	game(1000, 1000, 1000)
	if n := fast(); n != 4 {
		t.Fatalf("the best game's quick right answers: %d", n)
	}
	game(2000, 2000, 2000, 2000, 2999)
	if n := fast(); n != FastRights {
		t.Fatalf("five quick in a game: %d", n)
	}
}
