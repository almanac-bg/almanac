package play

import (
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"
)

// overlap is how many of the picks are among the questions.
func overlap(picks []Pick, questions map[string]bool) int {
	n := 0
	for _, p := range picks {
		if questions[p.ID] {
			n++
		}
	}
	return n
}

func TestDayQuestionsKeptOut(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()

	// Before anyone plays the day, a topic run draws it, and keeps out of it.
	topic, err := w.g.StartTopic(ctx, bo, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	day, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	today, err := w.g.DayQuestions(ctx)
	if err != nil || len(today) != Length || overlap(w.picks(day.ID), today) != Length {
		t.Fatalf("today's questions: %v %v", today, err)
	}
	if n := overlap(w.picks(topic.ID), today); n != 0 {
		t.Fatalf("a topic run drawn before the day dealt %d of its questions", n)
	}

	// Ana plays the day: her run is no recording for Bo, who hasn't; nor is a run with one of today's questions in it.
	w.play(ana, day.ID, repeat(w.right, Length)...)
	data, _ := json.Marshal(w.picks(day.ID))
	_, _ = w.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at, finished_at) VALUES (?, 'topic', ?, 0, 1)`,
		ana, string(data))
	if l, err := w.g.StartRecorded(ctx, bo); !errors.Is(err, ErrNobody) {
		t.Fatalf("a recording with today's questions: %+v %v", l.Picks, err)
	}

	// No draw deals them: topics, duels.
	for range 20 {
		for _, c := range []string{MixTopic, "science"} {
			s, err := w.g.StartTopic(ctx, bo, c)
			if err != nil {
				t.Fatal(err)
			}
			if n := overlap(w.picks(s.ID), today); n != 0 {
				t.Fatalf("a topic run (%q) dealt %d of today's questions", c, n)
			}
		}
		l, err := w.g.StartLive(ctx, ana, bo)
		if err != nil {
			t.Fatal(err)
		}
		if n := overlap(l.Picks, today); n != 0 {
			t.Fatalf("a duel dealt %d of today's questions", n)
		}
	}

	// The next day, yesterday's questions are a recording like any other.
	w.wait(24 * time.Hour)
	l, err := w.g.StartRecorded(ctx, bo)
	if err != nil || l.Users[1] != ana || len(l.Recording) != Length {
		t.Fatalf("yesterday's recording: %+v %v", l, err)
	}
}

func TestRunEndedByTheClock(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, vi, gal := w.user(), w.user(), w.user()
	// lastRunsOut plays a run to its last question, shows it and lets its time run out; the next look ends the run.
	lastRunsOut := func(user, runID int64, answer func(int64, int) json.RawMessage) {
		w.play(user, runID, repeat(answer, Length-1)...)
		w.show(user, runID)
		w.wait(time.Minute)
		if s, err := w.g.State(ctx, user, runID); err != nil || !s.Done {
			t.Fatalf("the run after its time ran out: %+v %v", s, err)
		}
	}

	// Ana's day ends on the clock, and counts for her streak.
	day, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	lastRunsOut(ana, day.ID, w.right)
	if s, _ := w.g.StreakOf(ctx, ana); s.Days != 1 {
		t.Fatal("a day ended by the clock earned nothing")
	}

	// A live duel between Ana and Vi has its result; settled again (both sides at once): nothing more, and no error.
	live, err := w.g.StartLive(ctx, ana, vi)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, live.Runs[0], repeat(w.right, Length)...)
	w.play(vi, live.Runs[1], repeat(w.wrong, Length)...)
	if d, _ := w.g.DuelsOf(ctx, vi); len(d) != 1 || d[0].State != "lost" {
		t.Fatalf("Vi's duel: %+v", d)
	}
	if err := w.g.settleDuel(ctx, live.DuelID, false, 0); err != nil {
		t.Fatalf("a duel settled twice: %v", err)
	}
	if d, _ := w.g.DuelsOf(ctx, vi); len(d) != 1 || d[0].State != "lost" {
		t.Fatalf("Vi's duel, settled twice: %+v", d)
	}

	// Against a recording, too.
	l, err := w.g.StartRecorded(ctx, gal)
	if err != nil {
		t.Fatal(err)
	}
	lastRunsOut(gal, l.Runs[0], w.right)
	if d, _ := w.g.DuelsOf(ctx, gal); len(d) != 1 || !d[0].Recorded || d[0].State == "expired" {
		t.Fatalf("Gal's duel against a recording: %+v", d)
	}
	// A recording isn't its player: no record between the two.
	var against sql.NullInt64
	_ = w.db.Read.QueryRow(`SELECT opponent_id FROM runs WHERE id = ?`, l.Runs[0]).Scan(&against)
	if against.Valid {
		t.Fatalf("a duel against a recording counts against its player %d", against.Int64)
	}

	// One finished and not settled then (a restart in between) gets its result once its time is up.
	l, _ = w.g.StartRecorded(ctx, gal)
	w.play(gal, l.Runs[0], repeat(w.right, Length)...)
	_, _ = w.db.Write.Exec(`UPDATE duels SET ended_at = NULL, outcome = NULL WHERE id = ?`, l.DuelID)
	w.wait(LiveFor)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	var outcome string
	_ = w.db.Read.QueryRow(`SELECT outcome FROM duels WHERE id = ?`, l.DuelID).Scan(&outcome)
	if outcome != "ghost_won" && outcome != "ghost_lost" && outcome != "ghost_draw" {
		t.Fatalf("a recorded duel left unsettled: %q", outcome)
	}
}

func TestMergeBringsProgress(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner := w.user(), w.user()
	merge := func(from, to int64) {
		t.Helper()
		if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, from, to) }); err != nil {
			t.Fatal(err)
		}
		_, _ = w.db.Write.Exec(`DELETE FROM users WHERE id = ?`, from) // as signing in does
	}

	// The guest: a better rating, and goals: today's (the account has its own) and
	// yesterday's (it has none).
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1180, rated = 12, peak = 1200 WHERE id = ?`, guest)
	if _, err := w.g.GoalsOf(ctx, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.GoalsOf(ctx, guest); err != nil {
		t.Fatal(err)
	}
	for i, day := range []string{"2026-11-12", "2026-11-12", "2026-11-11"} {
		_, _ = w.db.Write.Exec(`INSERT INTO goals_done (user_id, day, goal, at, xp) VALUES (?, ?, ?, 0, 100)`,
			guest, day, []string{"a", "b", "c"}[i])
	}
	merge(guest, owner)

	var rating, rated, peak int
	_ = w.db.Read.QueryRow(`SELECT rating, rated, peak FROM users WHERE id = ?`, owner).Scan(&rating, &rated, &peak)
	if rating != 1180 || rated != 12 || peak != 1200 {
		t.Fatalf("the account after: rating %d (%d games, peak %d)", rating, rated, peak)
	}
	goals := func(day string) (n int) {
		_ = w.db.Read.QueryRow(`SELECT count(*) FROM goals_done WHERE user_id = ? AND day = ? AND goal IN ('a', 'b', 'c')`,
			owner, day).Scan(&n)
		return n
	}
	if goals("2026-11-12") != 0 || goals("2026-11-11") != 1 {
		t.Fatalf("goals: today's %d (the account had its own), yesterday's %d", goals("2026-11-12"), goals("2026-11-11"))
	}

	// A guest with a worse rating leaves the account's as it is.
	worse := w.user()
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 900, rated = 30, peak = 1000 WHERE id = ?`, worse)
	merge(worse, owner)
	_ = w.db.Read.QueryRow(`SELECT rating, rated, peak FROM users WHERE id = ?`, owner).Scan(&rating, &rated, &peak)
	if rating != 1180 || rated != 12 || peak != 1200 {
		t.Fatalf("a worse guest's rating: %d (%d games, peak %d)", rating, rated, peak)
	}
}

// mustStart starts a topic run for a player, its id.
func mustStart(t *testing.T, w *world, user int64) int64 {
	t.Helper()
	s, err := w.g.StartTopic(t.Context(), user, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	return s.ID
}

// A recording to play against is a real game by a player of about one's rating; past the day's rated ones, duels
// against recordings are friendlies, and each moves a rating half as far as a duel with a person.
func TestFairRecordings(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	weak, strong, far, ana := w.user(), w.user(), w.user(), w.user()
	topic := func(user int64, right int) int64 {
		s, err := w.g.StartTopic(ctx, user, MixTopic)
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, append(repeat(w.right, right), repeat(w.wrong, Length-right)...)...)
		return s.ID
	}
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1400 WHERE id = ?`, strong)
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 900 WHERE id = ?`, far)
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1350, rated = 30 WHERE id = ?`, ana)
	tapped := topic(weak, 1) // a tapped-through game: not a real one
	real := topic(strong, 7) // a real game by a player of about Ana's rating
	topic(far, 7)            // a real game, by a player far below
	w.wait(time.Minute)
	topic(weak, 0) // the latest, and still not real
	// A script's game, later still, all right, by a player of Ana's very rating: but every answer in 50 ms.
	bot := w.user()
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1350 WHERE id = ?`, bot)
	w.pace = func(int) time.Duration { return 50 * time.Millisecond }
	scripted := topic(bot, Length)
	w.pace = nil
	l, err := w.g.StartRecorded(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if l.Runs[1] != real {
		t.Fatalf("Ana got recording %d, not the real game in her band %d (the tapped one is %d, the script's %d)",
			l.Runs[1], real, tapped, scripted)
	}
	// Rated against recordings: half a duel's move, five a day; the sixth is a friendly.
	var moved []int
	for i := range RecordedRatedPerDay + 1 {
		l, err := w.g.StartRecorded(ctx, ana)
		if err != nil {
			t.Fatal(err)
		}
		before := 0
		_ = w.db.Read.QueryRow(`SELECT rating FROM users WHERE id = ?`, ana).Scan(&before)
		w.play(ana, l.Runs[0], repeat(w.right, Length)...)
		after := 0
		_ = w.db.Read.QueryRow(`SELECT rating FROM users WHERE id = ?`, ana).Scan(&after)
		moved = append(moved, after-before)
		if i == 0 {
			full := eloDelta(before, 1400, 30, 1)
			if after-before != full/2 {
				t.Fatalf("a win against a recording moved %d, want half of %d", after-before, full)
			}
		}
	}
	if moved[RecordedRatedPerDay] != 0 {
		t.Fatalf("rating moves against recordings in a day: %v", moved)
	}
	if d, _ := w.g.DuelsOf(ctx, ana); !d[0].Friendly || !d[0].Recorded {
		t.Fatalf("the sixth duel against a recording: %+v", d[0])
	}
}

// A quick person's game is still a recording; a game with more quick answers than a person gives is not, even when
// it's the only other one.
func TestRecordingsArePeoples(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	quick := func(n int) func(int) time.Duration { // the first n answers in 300 ms, the rest in 2.5 s each
		return func(i int) time.Duration {
			if i < n {
				return 300 * time.Millisecond
			}
			return 2500 * time.Millisecond
		}
	}
	game := func(pace func(int) time.Duration) int64 {
		user := w.user()
		s, err := w.g.StartTopic(ctx, user, MixTopic)
		if err != nil {
			t.Fatal(err)
		}
		w.pace = pace
		w.play(user, s.ID, repeat(w.right, Length)...)
		w.pace = nil
		w.wait(time.Minute)
		return s.ID
	}
	ana := w.user()
	scripted := game(quick(MostQuick + 1)) // one quick answer too many
	if _, err := w.g.StartRecorded(ctx, ana); !errors.Is(err, ErrNobody) {
		t.Fatalf("with only a script's game to play against: %v, want nobody", err)
	}
	person := game(quick(MostQuick)) // knew two at once
	l, err := w.g.StartRecorded(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if l.Runs[1] != person {
		t.Fatalf("got recording %d, not the quick person's %d (the script's is %d)", l.Runs[1], person, scripted)
	}
	// Each question has its own floor: three orders put down in a second each are no person's; three statements
	// judged in a second each are.
	of := func(typ string) []Pick {
		qs := w.b.Live("", typ)
		if len(qs) == 0 {
			t.Fatalf("no %s question in the sample bank", typ)
		}
		return slices.Repeat([]Pick{{ID: qs[0].Base().ID}}, MostQuick+1)
	}
	second := map[int]int64{0: 1000, 1: 1000, 2: 1000}
	if !scriptPaced(w.b, of("order"), second) {
		t.Fatal("three orders put down in a second each count as a person's")
	}
	if scriptPaced(w.b, of("truefalse"), second) {
		t.Fatal("three statements judged in a second each count as a script's")
	}
}
