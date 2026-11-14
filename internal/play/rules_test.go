package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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
	topic, err := w.g.StartTopic(ctx, bo, "")
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

	// No draw deals them: topics, duels, Роял.
	for range 20 {
		for _, c := range []string{"", "science"} {
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
		picks, err := w.g.DrawRoyal(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if n := overlap(picks, today); n != 0 {
			t.Fatalf("Роял dealt %d of today's questions", n)
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
	var told []DuelNews
	w.g.DuelNews = func(_ context.Context, n DuelNews) { told = append(told, n) }
	w.befriend(ana, vi)
	// lastRunsOut plays a run to its last question, shows it and lets its time run out; the next look ends the run.
	lastRunsOut := func(user, runID int64, answer func(int64, int) json.RawMessage) {
		w.play(user, runID, repeat(answer, Length-1)...)
		if _, err := w.g.Show(ctx, user, runID); err != nil {
			t.Fatal(err)
		}
		w.wait(time.Minute)
		if s, err := w.g.State(ctx, user, runID); err != nil || !s.Done {
			t.Fatalf("the run after its time ran out: %+v %v", s, err)
		}
	}

	// Ana's challenge ends on the clock: Vi hears of it, and the game counts for Ana's week.
	s, id, err := w.g.ChallengeFriend(ctx, ana, vi)
	if err != nil {
		t.Fatal(err)
	}
	lastRunsOut(ana, s.ID, w.right)
	if len(told) != 1 || told[0].To != vi || told[0].Kind != "asked" {
		t.Fatalf("Vi wasn't told: %+v", told)
	}
	if v, _ := w.g.LeagueOf(ctx, ana); !v.In {
		t.Fatal("a game ended by the clock earned nothing")
	}
	// So does Vi's: the duel has its result, told to both.
	vs, err := w.g.PlayDuel(ctx, vi, id)
	if err != nil {
		t.Fatal(err)
	}
	lastRunsOut(vi, vs.ID, w.wrong)
	if d, _ := w.g.DuelsOf(ctx, vi); d[0].State != "lost" || len(told) != 3 {
		t.Fatalf("Vi's duel: %+v, told %+v", d[0], told)
	}
	// Settled again (both sides at once): nothing more, and no error.
	if err := w.g.settleDuel(ctx, id, false); err != nil || len(told) != 3 {
		t.Fatalf("a duel settled twice: %v, told %d", err, len(told))
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
	guest, owner, friend := w.user(), w.user(), w.user()
	merge := func(from, to int64) {
		t.Helper()
		if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, from, to) }); err != nil {
			t.Fatal(err)
		}
		_, _ = w.db.Write.Exec(`DELETE FROM users WHERE id = ?`, from) // as signing in does
	}

	// The guest: a better rating, a higher league, a week's result, an evening of Роял won, a challenge waiting on
	// a friend, and goals: today's (the account has its own) and yesterday's (it has none).
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1180, rated = 12, peak = 1200, league = 3 WHERE id = ?`, guest)
	_, _ = w.db.Write.Exec(`UPDATE users SET league = 1 WHERE id = ?`, owner)
	_, _ = w.db.Write.Exec(`INSERT INTO league_results (week, user_id, tier, place, of, points, moved, xp)
		VALUES ('2026-11-02', ?, 2, 1, 8, 900, 1, 300)`, guest)
	royal, err := w.g.NewRoyal(ctx, w.now, w.picks(mustStart(t, w, guest)))
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.db.Write.Exec(`INSERT INTO royal_players (royal_id, user_id, joined_at, place) VALUES (?, ?, 0, 1)`, royal, guest)
	w.befriend(guest, friend)
	s, duel, err := w.g.ChallengeFriend(ctx, guest, friend)
	if err != nil {
		t.Fatal(err)
	}
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

	var rating, rated, peak, league, results, royals, aID int
	_ = w.db.Read.QueryRow(`SELECT rating, rated, peak, league,
			(SELECT count(*) FROM league_results WHERE user_id = u.id),
			(SELECT count(*) FROM royal_players WHERE user_id = u.id AND place = 1),
			(SELECT a_id FROM duels WHERE id = ?)
		FROM users u WHERE id = ?`, duel, owner).Scan(&rating, &rated, &peak, &league, &results, &royals, &aID)
	if rating != 1180 || rated != 12 || peak != 1200 || league != 3 || results != 1 || royals != 1 || aID != int(owner) {
		t.Fatalf("the account after: rating %d (%d games, peak %d), league %d, %d weeks, %d evenings won, duel's %d",
			rating, rated, peak, league, results, royals, aID)
	}
	// The challenge is the account's to finish, and its friend's to play then.
	w.play(owner, s.ID, repeat(w.right, Length)...)
	if c, _ := w.g.Challenges(ctx, friend); len(c) != 1 || c[0].ID != duel {
		t.Fatalf("the friend's challenge: %+v", c)
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
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 900, rated = 30, peak = 1000, league = 0 WHERE id = ?`, worse)
	merge(worse, owner)
	_ = w.db.Read.QueryRow(`SELECT rating, rated, peak, league FROM users WHERE id = ?`, owner).Scan(&rating, &rated, &peak, &league)
	if rating != 1180 || rated != 12 || peak != 1200 || league != 3 {
		t.Fatalf("a worse guest's rating: %d (%d games, peak %d), league %d", rating, rated, peak, league)
	}
}

// mustStart starts a topic run for a player, its id.
func mustStart(t *testing.T, w *world, user int64) int64 {
	t.Helper()
	s, err := w.g.StartTopic(t.Context(), user, "")
	if err != nil {
		t.Fatal(err)
	}
	return s.ID
}
