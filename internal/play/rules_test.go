package play

import (
	"database/sql"
	"encoding/json"
	"slices"
	"testing"
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
	topic, err := w.g.startTopic(ctx, bo, MixTopic)
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

	w.play(ana, day.ID, repeat(w.right, Length)...)
	w.befriend(ana, bo)

	// No draw deals them: topics, duels.
	for range 20 {
		for _, c := range []string{MixTopic, "science"} {
			s, err := w.g.startTopic(ctx, bo, c)
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

	// One finished and not settled then (a restart in between) gets its result once its time is up.
	duel = w.duel(ana, gal, repeat(w.right, Length), repeat(w.wrong, Length))
	_, _ = w.db.Write.Exec(`UPDATE duels SET ended_at = NULL, outcome = NULL WHERE id = ?`, duel)
	w.wait(DuelFor)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	var outcome string
	_ = w.db.Read.QueryRow(`SELECT outcome FROM duels WHERE id = ?`, duel).Scan(&outcome)
	if outcome != "a" && outcome != "b" && outcome != "draw" {
		t.Fatalf("a duel played out left unsettled: %q", outcome)
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

	// The guest's ranks: the higher of the two in each chapter, as a rank never falls.
	for _, q := range []string{
		`INSERT INTO ranks (user_id, chapter, level, quarter, ink, told) VALUES
			(?1, 'geography', 3, 1, 18, 3), (?1, 'history', 1, 0, 2, 1)`,
		`INSERT INTO ranks (user_id, chapter, level, quarter, ink, told) VALUES (?2, 'history', 2, 0, 6, 2)`,
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
}

// mustStart starts a topic run for a player, its id.
func mustStart(t *testing.T, w *world, user int64) int64 {
	t.Helper()
	s, err := w.g.startTopic(t.Context(), user, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	return s.ID
}

// Each question has its own floor: three orders put down in a second each are no person's; three statements judged in
// a second each are.
func TestScriptPacedByFloor(t *testing.T) {
	w := setup(t)
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
