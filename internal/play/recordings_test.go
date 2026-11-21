package play

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// A duel against a recording takes a game over all the topics before one in a single topic, at every step of the
// fallback, and says which topic it was when it isn't.
func TestRecordingsOverAllTopicsFirst(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	one, other, ana := w.user(), w.user(), w.user()
	game := func(user int64, category string) int64 {
		s, err := w.g.StartTopic(ctx, user, category)
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, append(repeat(w.right, 7), repeat(w.wrong, Length-7)...)...)
		w.wait(time.Minute)
		return s.ID
	}
	pick := func(seen map[string]bool) *recorded {
		t.Helper()
		var rec *recorded
		if err := w.db.Tx(ctx, func(tx *sql.Tx) error {
			var err error
			rec, err = w.g.recordedRun(tx, ana, seen, nil)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return rec
	}
	all := func(runID int64) map[string]bool {
		seen := map[string]bool{}
		for _, p := range w.picks(runID) {
			seen[p.ID] = true
		}
		return seen
	}

	// A history game alone: it's the one, and the duel says its topic.
	history := game(one, "history")
	if rec := pick(nil); rec == nil || rec.id != history || rec.topic != "history" {
		t.Fatalf("got %+v, want the history game %d", rec, history)
	}
	duel, err := w.g.DuelRecording(ctx, ana, Even)
	if err != nil {
		t.Fatal(err)
	}
	if d, err := w.g.DuelOf(ctx, ana, duel); err != nil || d.Topic != "history" {
		t.Fatalf("the duel against the history game: %+v %v", d, err)
	}
	if _, err := w.db.Write.Exec(`DELETE FROM duels WHERE id = ?`, duel); err != nil {
		t.Fatal(err)
	}

	// A game over all the topics: it comes before the history game while she hasn't seen it.
	mix := game(other, MixTopic)
	if rec := pick(nil); rec == nil || rec.id != mix || rec.topic != "" {
		t.Fatalf("got %+v, want the game over all topics %d (history %d)", rec, mix, history)
	}
	// With every one of its questions seen (the same ten again), it comes after every game she hasn't: the history
	// game.
	if rec := pick(all(mix)); rec == nil || rec.id != history {
		t.Fatalf("got %+v, want the history game %d, not the ten she has seen (%d)", rec, history, mix)
	}
	// Only seen games left: the one with the fewest seen still plays, rather than nobody.
	seen := all(mix)
	for id := range all(history) {
		seen[id] = true
	}
	if rec := pick(seen); rec == nil {
		t.Fatal("every game seen: still one to play, got none")
	}
}

// A game whose ten the player has just played (a duel's other side, say) is no recording for them: the same ten
// questions again. Another real game comes first.
func TestRecordingsNotTheSameTenAgain(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	friend, far, ana := w.user(), w.user(), w.user()
	game := func(user int64) int64 {
		s, err := w.g.StartTopic(ctx, user, MixTopic)
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, append(repeat(w.right, 6), repeat(w.wrong, Length-6)...)...)
		w.wait(time.Minute)
		return s.ID
	}
	other := game(far)
	friends := game(friend)
	// Ana has seen the friend's ten (she played them in a duel against him).
	seen := map[string]bool{}
	for _, p := range w.picks(friends) {
		seen[p.ID] = true
	}
	var rec *recorded
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		rec, err = w.g.recordedRun(tx, ana, seen, nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if rec == nil || rec.id != other {
		t.Fatalf("got %+v, want the game she hasn't seen %d, not the friend's ten again %d", rec, other, friends)
	}
}

// A game left halfway (the tab closed: the rest of its questions not answered) isn't a real game to play against,
// however many it got right before. A real game comes first, the latest of them.
func TestRecordingsLeaveOutGamesLeft(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	near, far, ana := w.user(), w.user(), w.user()
	none := func(int64, int) json.RawMessage { return nil }
	game := func(user int64, answers ...func(int64, int) json.RawMessage) int64 {
		s, err := w.g.StartTopic(ctx, user, MixTopic)
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, answers...)
		w.wait(time.Minute)
		return s.ID
	}
	real := game(far, append(repeat(w.right, 5), repeat(w.wrong, Length-5)...)...)
	// Two not answered: still a real game, and the latest.
	missedTwo := game(near, append(append(repeat(w.right, 5), repeat(none, 2)...), repeat(w.wrong, Length-7)...)...)
	pick := func() int64 {
		t.Helper()
		var rec *recorded
		if err := w.db.Tx(ctx, func(tx *sql.Tx) error {
			var err error
			rec, err = w.g.recordedRun(tx, ana, nil, nil)
			return err
		}); err != nil || rec == nil {
			t.Fatalf("no recording: %v", err)
		}
		return rec.id
	}
	if got := pick(); got != missedTwo {
		t.Fatalf("got %d, want the game with two not answered %d", got, missedTwo)
	}
	// Left at the sixth: five right, the rest not answered. The real games come first, however late it is.
	_ = game(near, append(repeat(w.right, 5), repeat(none, Length-5)...)...)
	if got := pick(); got != missedTwo {
		t.Fatalf("got %d, want %d (the other real one: %d)", got, missedTwo, real)
	}
	_, _ = w.db.Write.Exec(`DELETE FROM runs WHERE id = ?`, missedTwo)
	if got := pick(); got != real {
		t.Fatalf("got %d, want the other real game %d", got, real)
	}
}

// A duel against a recording keeps the level it was chosen at, „равен“ or „по-силен“ (anything else is „равен“), and
// says it (DuelView.Level): „По-силен запис · Краси“; played to its end, another follows, a new one. A friend's duel
// has none.
func TestRecordingLevel(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	one, two, ana, bo := w.user(), w.user(), w.user(), w.user()
	// A game stronger than Ana (all right), and one as strong: as many right as she'd get on its ten.
	w.game(one, nil)
	w.wait(time.Minute)
	s, err := w.g.StartTopic(ctx, two, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	fit, err := w.g.recordingFit(ctx, ana, Even)
	if err != nil {
		t.Fatal(err)
	}
	even, nearest := -1, float64(Length)
	for r := RecordingRights; r <= Length; r++ {
		if off, meets := fit(w.b, w.picks(s.ID), r); meets && off < nearest {
			even, nearest = r, off
		}
	}
	if even < 0 {
		t.Fatal("no score of that game is „равен“ to Ana")
	}
	w.play(two, s.ID, append(repeat(w.right, even), repeat(w.wrong, Length-even)...)...)
	w.wait(time.Minute)
	for i, c := range []struct{ chosen, level string }{{Stronger, Stronger}, {Even, Even}, {"", Even}, {"hard", Even}} {
		// Each chosen by a new player as Ana was (no answers yet: her level); Ana herself the first.
		ana := ana
		if i > 0 {
			ana = w.user()
		}
		id, err := w.g.DuelRecording(ctx, ana, c.chosen)
		if err != nil {
			t.Fatal(err)
		}
		d, err := w.g.DuelOf(ctx, ana, id)
		if err != nil || !d.Recorded || d.Level != c.level {
			t.Fatalf("chosen %q: %+v %v, want the level %q", c.chosen, d, err, c.level)
		}
		data, _ := json.Marshal(d)
		if !strings.Contains(string(data), `"level":"`+c.level+`"`) {
			t.Fatalf("chosen %q: %s", c.chosen, data)
		}
		// Listed once its first question has shown (made and left before, it isn't: TestUnbegunDuelGoes).
		w.show(ana, w.playSide(ana, id, nil))
		list, err := w.g.DuelsOf(ctx, ana)
		if err != nil || len(list.Yours) == 0 || list.Yours[0].Level != c.level {
			t.Fatalf("chosen %q, in the list: %+v %v", c.chosen, list.Yours, err)
		}
		// Asked again before it's played: the same one, gone on with.
		if again, err := w.g.DuelRecording(ctx, ana, c.chosen); err != nil || again != id {
			t.Fatalf("chosen %q again while it's open: %d %v, want %d", c.chosen, again, err, id)
		}
		// Played to its end: the next is a new one, not this one.
		w.playSide(ana, id, repeat(w.wrong, Length))
		if d, err := w.g.DuelOf(ctx, ana, id); err != nil || d.State == DuelYours {
			t.Fatalf("chosen %q, played to its end: %+v %v", c.chosen, d, err)
		}
		next, err := w.g.DuelRecording(ctx, ana, c.chosen)
		if err != nil || next == id {
			t.Fatalf("chosen %q after one played: %d %v, want a new one (not %d)", c.chosen, next, err, id)
		}
		if d, err := w.g.DuelOf(ctx, ana, next); err != nil || d.State != DuelYours {
			t.Fatalf("chosen %q, the one after: %+v %v", c.chosen, d, err)
		}
	}
	friendly := w.duel(ana, bo, repeat(w.right, Length), repeat(w.wrong, Length))
	if d, err := w.g.DuelOf(ctx, bo, friendly); err != nil || d.Level != "" {
		t.Fatalf("a friend's duel has no level: %+v %v", d, err)
	}
}
