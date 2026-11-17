package play

import (
	"database/sql"
	"encoding/json"
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

	// A game over all the topics by a player near her: it comes before the history game, even with every one of its
	// questions seen and none of the other's.
	nearAll := game(near, "")
	if rec := pick(all(nearAll)); rec == nil || rec.id != nearAll || rec.topic != "" {
		t.Fatalf("got %+v, want the game over all topics %d (history %d, far %d)", rec, nearAll, history, farAll)
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
	if r == nil || r.Text != "Днес 2 души играха срещу записи на твои игри. Записите ти спечелиха всички дуели." ||
		len(r.Players) != 2 || r.Players[0].Tag == "" {
		t.Fatalf("the recordings' news: %+v", r)
	}
	if r := news(); r != nil {
		t.Fatalf("told twice in a day: %+v", r)
	}
	// Later the same day Bo wins: told the next day, as yesterday's.
	w.wait(8 * time.Hour)
	duel(bo, w.right)
	w.wait(16 * time.Hour)
	if r := news(); r == nil || r.Text != "Вчера 1 човек игра срещу запис на твоя игра." {
		t.Fatalf("yesterday's evening, the next day: %+v", r)
	}
}

func TestRecordingsWords(t *testing.T) {
	for _, c := range []struct {
		firstToday, lastToday bool
		people, games, won    int
		want                  string
	}{
		{true, true, 3, 3, 2, "Днес 3 души играха срещу записи на твои игри. Записите ти спечелиха 2 от дуелите."},
		{true, true, 1, 1, 1, "Днес 1 човек игра срещу запис на твоя игра. Записът ти спечели дуела."},
		{false, false, 1, 2, 2, "Вчера 1 човек игра срещу записи на твои игри. Записите ти спечелиха всички дуели."},
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

// A friend who plays the duel the player started is told on the player's Начало, for a while; the duel knows who
// the friend is, for a rematch.
func TestFriendPlayed(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, vi := w.user(), w.user()
	w.befriend(ana, vi)
	s, id, err := w.g.ChallengeFriend(ctx, ana, vi)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if p, _ := w.g.FriendPlayedOf(ctx, ana); p != nil {
		t.Fatalf("told before Vi played: %+v", p)
	}
	vs, err := w.take(vi, id)
	if err != nil {
		t.Fatal(err)
	}
	w.play(vi, vs.ID, repeat(w.wrong, Length)...)
	p, err := w.g.FriendPlayedOf(ctx, ana)
	if err != nil || p == nil || p.DuelID != id || p.State != "won" || p.You <= p.Them || p.From != "Играч" {
		t.Fatalf("Ana's Начало: %+v %v", p, err)
	}
	if p, _ := w.g.FriendPlayedOf(ctx, vi); p != nil {
		t.Fatalf("Vi, who played second, told: %+v", p)
	}
	if d, _ := w.g.DuelsOf(ctx, ana); d[0].Friend != vi {
		t.Fatalf("Ana's duel doesn't know Vi: %+v", d[0])
	}
	if d, _ := w.g.DuelsOf(ctx, vi); d[0].Friend != ana {
		t.Fatalf("Vi's duel doesn't know Ana: %+v", d[0])
	}
	w.wait(PlayedRecent + time.Minute)
	if p, _ := w.g.FriendPlayedOf(ctx, ana); p != nil {
		t.Fatalf("still told after %v: %+v", PlayedRecent, p)
	}
}
