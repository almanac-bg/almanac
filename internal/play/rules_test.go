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
	_, _ = w.db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, at, started_at, finished_at)
		VALUES (?, 'topic', ?, ?, 0, 1)`, ana, string(data), Length)
	if _, err := w.g.DuelRecording(ctx, bo); !errors.Is(err, ErrNobody) {
		t.Fatalf("a recording with today's questions: %v", err)
	}
	w.befriend(ana, bo)

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
		duel, err := w.g.DuelFriend(ctx, ana, bo)
		if err != nil {
			t.Fatal(err)
		}
		if n := overlap(w.picks(w.playSide(ana, duel, nil)), today); n != 0 {
			t.Fatalf("a duel dealt %d of today's questions", n)
		}
		if _, err := w.db.Write.Exec(`DELETE FROM duels WHERE id = ?`, duel); err != nil {
			t.Fatal(err)
		}
	}

	// The next day, yesterday's questions are a recording like any other.
	w.wait(24 * time.Hour)
	duel, err := w.g.DuelRecording(ctx, bo)
	if d, _ := w.g.DuelOf(ctx, bo, duel); err != nil || d.Opponent == nil || d.Opponent.ID != ana {
		t.Fatalf("yesterday's recording: %+v %v", d, err)
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
		w.wait(pastLimit)
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

	// A duel between Ana and Vi, Vi's side ended by the clock, has its result; settled again (both sides at once):
	// nothing more, and no error.
	duel := w.duel(ana, vi, repeat(w.right, Length), nil)
	lastRunsOut(vi, w.playSide(vi, duel, nil), w.wrong)
	if d, _ := w.g.DuelsOf(ctx, vi); len(d.Played) != 1 || d.Played[0].State != DuelLost {
		t.Fatalf("Vi's duel: %+v", d)
	}
	if err := w.g.settleDuel(ctx, duel, 0); err != nil {
		t.Fatalf("a duel settled twice: %v", err)
	}
	if d, _ := w.g.DuelsOf(ctx, vi); len(d.Played) != 1 || d.Played[0].State != DuelLost {
		t.Fatalf("Vi's duel, settled twice: %+v", d)
	}

	// Against a recording, too.
	duel, err = w.g.DuelRecording(ctx, gal)
	if err != nil {
		t.Fatal(err)
	}
	run := w.playSide(gal, duel, nil)
	lastRunsOut(gal, run, w.right)
	if d, _ := w.g.DuelsOf(ctx, gal); len(d.Played) != 1 || !d.Played[0].Recorded || d.Played[0].State == DuelExpired {
		t.Fatalf("Gal's duel against a recording: %+v", d)
	}
	// A recording isn't its player: no record between the two.
	var owner int64
	_ = w.db.Read.QueryRow(`SELECT r.user_id FROM duels d JOIN runs r ON r.id = d.recording_run WHERE d.id = ?`, duel).
		Scan(&owner)
	if r, err := w.g.recordAgainst(ctx, gal, owner); err != nil || owner == 0 || r != (Record{}) {
		t.Fatalf("a duel against a recording counts against its player %d: %+v %v", owner, r, err)
	}

	// One finished and not settled then (a restart in between) gets its result once its time is up.
	duel, _ = w.g.DuelRecording(ctx, gal)
	w.playSide(gal, duel, repeat(w.right, Length))
	_, _ = w.db.Write.Exec(`UPDATE duels SET ended_at = NULL, outcome = NULL WHERE id = ?`, duel)
	w.wait(DuelFor)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	var outcome string
	_ = w.db.Read.QueryRow(`SELECT outcome FROM duels WHERE id = ?`, duel).Scan(&outcome)
	if outcome != "a" && outcome != "b" && outcome != "draw" {
		t.Fatalf("a recorded duel left unsettled: %q", outcome)
	}
}

func TestMergeBringsProgress(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner := w.user(), w.user()
	merge := func(from, to int64) {
		t.Helper()
		if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return w.g.Merge(tx, from, to) }); err != nil {
			t.Fatal(err)
		}
		_, _ = w.db.Write.Exec(`DELETE FROM users WHERE id = ?`, from) // as signing in does
	}

	// The guest's ranks: the higher of the two in each chapter, as a rank never falls; the seal worn their best.
	for _, q := range []string{
		`INSERT INTO ranks (user_id, chapter, level, quarter, ink, day, told) VALUES
			(?1, 'geography', 3, 1, 18, '2026-11-10', 3), (?1, 'history', 1, 0, 2, '2026-11-09', 1)`,
		`INSERT INTO ranks (user_id, chapter, level, quarter, ink, day, told) VALUES (?2, 'history', 2, 0, 6, '2026-11-11', 2)`,
	} {
		if _, err := w.db.Write.Exec(q, guest, owner); err != nil {
			t.Fatal(err)
		}
	}
	merge(guest, owner)
	ranks, _ := w.g.RanksOf(ctx, owner)
	for _, r := range ranks {
		want := map[string]int{"geography": 3, "history": 2}[r.Chapter]
		if r.Level != want {
			t.Errorf("%s after: %+v, want level %d", r.Chapter, r, want)
		}
	}
	if s, _ := w.g.SealOf(ctx, owner); s == nil || s.Chapter != "geography" {
		t.Fatalf("the seal after: %+v", s)
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

// A recording to play against is a real game, never one tapped through nor a script's, however late they came.
func TestFairRecordings(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	weak, strong, ana := w.user(), w.user(), w.user()
	topic := func(user int64, right int) int64 {
		s, err := w.g.StartTopic(ctx, user, MixTopic)
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, append(repeat(w.right, right), repeat(w.wrong, Length-right)...)...)
		return s.ID
	}
	tapped := topic(weak, 1) // a tapped-through game: not a real one
	real := topic(strong, 7) // a real game
	w.wait(time.Minute)
	topic(weak, 0) // the latest, and still not real
	// A script's game, later still, all right: but every answer in 50 ms.
	bot := w.user()
	w.pace = func(int) time.Duration { return 50 * time.Millisecond }
	scripted := topic(bot, Length)
	w.pace = nil
	duel, err := w.g.DuelRecording(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if got := w.recordingOf(duel); got != real {
		t.Fatalf("Ana got recording %d, not the real game %d (the tapped one is %d, the script's %d)",
			got, real, tapped, scripted)
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
	if _, err := w.g.DuelRecording(ctx, ana); !errors.Is(err, ErrNobody) {
		t.Fatalf("with only a script's game to play against: %v, want nobody", err)
	}
	person := game(quick(MostQuick)) // knew two at once
	duel, err := w.g.DuelRecording(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if got := w.recordingOf(duel); got != person {
		t.Fatalf("got recording %d, not the quick person's %d (the script's is %d)", got, person, scripted)
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
