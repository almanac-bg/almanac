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
	near, far, ana := w.user(), w.user(), w.user()
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1350 WHERE id IN (?, ?)`, near, ana)
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 900 WHERE id = ?`, far)
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
			rec, err = w.g.recordedRun(tx, ana, seen)
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

	// A history game by a player of Ana's rating, and one over all the topics by a player far below: being near her
	// comes first, so the history game it is, and the duel says so.
	history := game(near, "history")
	farAll := game(far, "")
	if rec := pick(nil); rec == nil || rec.id != history || rec.topic != "history" {
		t.Fatalf("got %+v, want the history game %d", rec, history)
	}
	l, err := w.g.StartRecorded(ctx, ana)
	if err != nil || l.Runs[1] != history || l.Topic != "history" {
		t.Fatalf("the duel against the history game: runs %v, topic %q, %v", l.Runs, l.Topic, err)
	}
	if err := w.g.CancelLive(ctx, l.DuelID); err != nil {
		t.Fatal(err)
	}

	// A game over all the topics by a player near her: it comes before the history game while she hasn't seen it.
	nearAll := game(near, "")
	if rec := pick(nil); rec == nil || rec.id != nearAll || rec.topic != "" {
		t.Fatalf("got %+v, want the game over all topics %d (history %d, far %d)", rec, nearAll, history, farAll)
	}
	// With every one of its questions seen (the same ten again), it comes after every game she hasn't: the history
	// game by the player near her.
	if rec := pick(all(nearAll)); rec == nil || rec.id != history {
		t.Fatalf("got %+v, want the history game %d, not the ten she has seen (%d)", rec, history, nearAll)
	}
	// Only seen games left: the one with the fewest seen still plays, rather than nobody.
	seen := all(nearAll)
	for id := range all(history) {
		seen[id] = true
	}
	for id := range all(farAll) {
		seen[id] = true
	}
	if rec := pick(seen); rec == nil {
		t.Fatal("every game seen: still one to play, got none")
	}
}

// A friend's challenge, once both have played it, is no recording for the one who took it: the same ten questions
// again. Another real game comes first, however far its player's rating.
func TestRecordingsNotTheSameTenAgain(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	friend, far, ana := w.user(), w.user(), w.user()
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1000 WHERE id IN (?, ?)`, friend, ana)
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1600 WHERE id = ?`, far)
	game := func(user int64) int64 {
		s, err := w.g.StartTopic(ctx, user, "")
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, append(repeat(w.right, 6), repeat(w.wrong, Length-6)...)...)
		w.wait(time.Minute)
		return s.ID
	}
	other := game(far)
	friends := game(friend)
	// Ana has seen the friend's ten (she played them as his challenge).
	seen := map[string]bool{}
	for _, p := range w.picks(friends) {
		seen[p.ID] = true
	}
	var rec *recorded
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		rec, err = w.g.recordedRun(tx, ana, seen)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if rec == nil || rec.id != other {
		t.Fatalf("got %+v, want the game she hasn't seen %d, not the friend's ten again %d", rec, other, friends)
	}
}

// A game left halfway (the tab closed: the rest of its questions not answered) isn't a real game to play against,
// however many it got right before: a duel waited out each missing answer. A real game by anyone comes first.
func TestRecordingsLeaveOutGamesLeft(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	near, far, ana := w.user(), w.user(), w.user()
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 1350 WHERE id IN (?, ?)`, near, ana)
	_, _ = w.db.Write.Exec(`UPDATE users SET rating = 900 WHERE id = ?`, far)
	none := func(int64, int) json.RawMessage { return nil }
	game := func(user int64, answers ...func(int64, int) json.RawMessage) int64 {
		s, err := w.g.StartTopic(ctx, user, "")
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, answers...)
		w.wait(time.Minute)
		return s.ID
	}
	real := game(far, append(repeat(w.right, 5), repeat(w.wrong, Length-5)...)...)
	// Near Ana's rating, two not answered: still a real game, and the nearer.
	missedTwo := game(near, append(append(repeat(w.right, 5), repeat(none, 2)...), repeat(w.wrong, Length-7)...)...)
	pick := func() int64 {
		t.Helper()
		var rec *recorded
		if err := w.db.Tx(ctx, func(tx *sql.Tx) error {
			var err error
			rec, err = w.g.recordedRun(tx, ana, nil)
			return err
		}); err != nil || rec == nil {
			t.Fatalf("no recording: %v", err)
		}
		return rec.id
	}
	if got := pick(); got != missedTwo {
		t.Fatalf("got %d, want the game near Ana with two not answered %d", got, missedTwo)
	}
	// Near her, left at the sixth: five right, the rest not answered. The real game far from her comes first.
	_ = game(near, append(repeat(w.right, 5), repeat(none, Length-5)...)...)
	if got := pick(); got != missedTwo {
		t.Fatalf("got %d, want %d (the real one far off: %d)", got, missedTwo, real)
	}
	_, _ = w.db.Write.Exec(`DELETE FROM runs WHERE id = ?`, missedTwo)
	if got := pick(); got != real {
		t.Fatalf("got %d, want the real game far off %d", got, real)
	}
}

// The recorded player hears, with a game's news and once a day, how others' duels against their recordings went.
func TestRecordingsNews(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	owner, gal, bo := w.user(), w.user(), w.user()
	news := func() *RecordingsNews {
		t.Helper()
		n, err := w.g.NewsOf(ctx, owner, 0)
		if err != nil {
			t.Fatal(err)
		}
		return n.Recordings
	}
	s, err := w.g.StartTopic(ctx, owner, "")
	if err != nil {
		t.Fatal(err)
	}
	w.play(owner, s.ID, repeat(w.right, Length)...)
	if r := news(); r != nil {
		t.Fatalf("news of recordings nobody has played: %+v", r)
	}
	duel := func(user int64, answer func(int64, int) json.RawMessage) {
		t.Helper()
		l, err := w.g.StartRecorded(ctx, user)
		if err != nil || l.Users[1] != owner {
			t.Fatalf("a duel against the owner's game: %+v %v", l, err)
		}
		w.play(user, l.Runs[0], repeat(answer, Length)...)
		w.wait(time.Minute)
	}

	// Gal loses twice to the owner's game, Bo once: the owner hears it, once today.
	duel(gal, w.wrong)
	duel(gal, w.wrong)
	duel(bo, w.wrong)
	r := news()
	if r == nil || r.Text != "Днес 2 души играха срещу записи на твои игри. Записите ти спечелиха всички дуели." {
		t.Fatalf("the recordings' news: %+v", r)
	}
	// Who played isn't told: the news is numbers only (S13).
	if b, _ := json.Marshal(r); strings.Contains(string(b), "players") {
		t.Fatalf("the recordings' news names who played: %s", b)
	}
	if r := news(); r != nil {
		t.Fatalf("told twice in a day: %+v", r)
	}
	// Later the same day Bo wins: told the next day, as yesterday's.
	w.wait(8 * time.Hour)
	duel(bo, w.right)
	w.wait(16 * time.Hour)
	if r := news(); r == nil || r.Text != "Вчера един човек игра срещу запис на твоя игра." {
		t.Fatalf("yesterday's evening, the next day: %+v", r)
	}
}

func TestRecordingsWords(t *testing.T) {
	for _, c := range []struct {
		firstToday, lastToday bool
		people, games, won    int
		want                  string
	}{
		{true, true, 3, 3, 2, "Днес 3 души играха срещу записи на твои игри. Записите ти спечелиха 2 от 3 дуела."},
		{true, true, 1, 1, 1, "Днес един човек игра срещу запис на твоя игра. Записът ти спечели дуела."},
		{false, false, 1, 2, 2, "Вчера един човек игра срещу записи на твои игри. Записите ти спечелиха всички дуели."},
		{false, true, 2, 2, 0, "Вчера и днес 2 души играха срещу записи на твои игри."},
	} {
		if got := recordingsWords(c.firstToday, c.lastToday, c.people, c.games, c.won); got != c.want {
			t.Errorf("%+v: %q", c, got)
		}
	}
}

// The recordings wait while a game's news fills its three cards.
func TestRecordingsWaitForACard(t *testing.T) {
	full := News{Goals: []DoneGoal{{}}, LevelUp: true, Unlocks: []Unlock{{}}}
	if full.cards() != NewsCards {
		t.Fatalf("a full news: %d cards", full.cards())
	}
	if (News{Mastery: []MasteryMove{{}}}).cards() != 1 || (News{}).cards() != 0 {
		t.Fatal("cards miscounted")
	}
}
