package play

import (
	"encoding/json"
	"strings"
	"testing"
)

// kept gives a player ranks as the ranks table keeps them, with nothing in their book under them: what shows beside
// a name is read from the ranks kept, never counted from ink on view.
func (w *world) kept(user int64, ranks ...ChapterRank) {
	w.t.Helper()
	for _, r := range ranks {
		day := r.Day
		if day == "" {
			day = "2026-01-01"
		}
		if _, err := w.db.Write.Exec(`INSERT INTO ranks (user_id, chapter, level, quarter, ink, day, told)
			VALUES (?, ?, ?, 0, ?, ?, ?) ON CONFLICT (user_id, chapter) DO UPDATE SET level = excluded.level,
			ink = excluded.ink, day = excluded.day`, user, r.Chapter, r.Level, r.Ink, day, r.Level); err != nil {
			w.t.Fatal(err)
		}
	}
}

// wears is the seal a player wears, as SealOf has it: chapter and level.
func (w *world) wears(user int64) *Worn {
	w.t.Helper()
	s, err := w.g.SealOf(w.t.Context(), user)
	if err != nil {
		w.t.Fatal(err)
	}
	if s == nil {
		return nil
	}
	return &Worn{Chapter: s.Chapter, Level: s.Level}
}

func sameSeal(a, b *Worn) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }

// The seal shows beside a player's name wherever others see it — their friends' list, the day's boards, a friend
// request, a duel, their profile — and it's the one they wear (SealOf's rule: their best, never chosen), read from the
// ranks kept.
func TestSealBesideTheName(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy := w.user(), w.user(), w.user()
	w.befriend(ana, bo)
	w.kept(ana, ChapterRank{Chapter: "geography", Level: 2, Ink: 6}, ChapterRank{Chapter: "history", Level: 2, Ink: 7},
		ChapterRank{Chapter: "music", Level: 1, Ink: 1})

	friendOf := func(viewer, id int64) Friend {
		t.Helper()
		list, err := w.g.FriendsOf(ctx, viewer)
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range list {
			if f.ID == id {
				return f
			}
		}
		t.Fatalf("%d isn't %d's friend: %+v", id, viewer, list)
		return Friend{}
	}
	want := &Worn{Chapter: "history", Level: 2}
	if f := friendOf(bo, ana); !sameSeal(f.Seal, want) || !sameSeal(f.Seal, w.wears(ana)) {
		t.Fatalf("Ana in Bo's friends: %+v, want her best %+v", f.Seal, want)
	}
	if f := friendOf(ana, bo); f.Seal != nil {
		t.Fatalf("Bo has no rank, and no seal: %+v", f.Seal)
	}
	// The friend's row says it beside the name, as the client reads it: "seal" on the row itself.
	data, _ := json.Marshal(friendOf(bo, ana))
	if !strings.Contains(string(data), `"seal":{"chapter":"history","level":2}`) {
		t.Fatalf("a friend's row: %s", data)
	}

	if l, err := w.g.LookOf(ctx, ana); err != nil || !sameSeal(l.Seal, want) {
		t.Fatalf("Ana's look: %+v %v", l, err)
	}

	// The day's boards, everyone's and the friends': each row with the seal its player wears (playing the day
	// writes ink, and Bo has a rank of his own now).
	today := w.g.Today()
	w.dayGame(ana, nil)
	w.dayGame(bo, nil)
	byTag := func(tag string) int64 {
		t.Helper()
		var id int64
		if err := w.db.Read.QueryRow(`SELECT id FROM users WHERE tag = ?`, tag).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	b, err := w.g.BoardOf(ctx, today, bo)
	if err != nil || len(b.Top) != 2 || b.Mine == nil || !sameSeal(b.Mine.Seal, w.wears(bo)) {
		t.Fatalf("the day's board: %+v %v", b, err)
	}
	fb, err := w.g.FriendsBoard(ctx, today, bo)
	if err != nil || len(fb) != 2 {
		t.Fatalf("the friends' board: %+v %v", fb, err)
	}
	for _, s := range append(b.Top, fb...) {
		if s.Seal == nil || !sameSeal(s.Seal, w.wears(byTag(s.Tag))) {
			t.Fatalf("a board's row: %+v (%+v), wears %+v", s, s.Seal, w.wears(byTag(s.Tag)))
		}
	}
	want = w.wears(ana)

	// A friend request: who asks, with their seal.
	w.kept(cy, ChapterRank{Chapter: "sports", Level: 3, Ink: 20})
	var boTag string
	if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, bo).Scan(&boTag); err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.Request(ctx, cy, boTag, false); err != nil {
		t.Fatal(err)
	}
	in, _, err := w.g.Requests(ctx, bo)
	if err != nil || len(in) != 1 || in[0].Look == nil || !sameSeal(in[0].Look.Seal, &Worn{"sports", 3}) {
		t.Fatalf("Cy's request to Bo: %+v %v", in, err)
	}

	// A duel: the other side, with their seal.
	duel := w.duel(ana, bo, repeat(w.right, Length), repeat(w.wrong, Length))
	d, err := w.g.DuelOf(ctx, bo, duel)
	if err != nil || d.Opponent == nil || d.Opponent.Look == nil || !sameSeal(d.Opponent.Look.Seal, want) {
		t.Fatalf("Ana in Bo's duel: %+v %v", d.Opponent, err)
	}

	// The profile: the seal worn, whole (its name, the way to the next), as the profile's own.
	var anaTag string
	if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, ana).Scan(&anaTag); err != nil {
		t.Fatal(err)
	}
	p, err := w.g.ProfileOf(ctx, anaTag, bo)
	if err != nil || p.Seal == nil || !sameSeal(&Worn{p.Seal.Chapter, p.Seal.Level}, want) || p.Seal.Name == "" {
		t.Fatalf("Ana's profile: %+v %v, want %+v", p.Seal, err, want)
	}
	data, _ = json.Marshal(p)
	if !strings.Contains(string(data), `"seal":{"chapter":"`+want.Chapter+`","level":`) {
		t.Fatalf("the profile says the seal whole: %s", data)
	}

	// A tie on level and ink, nothing chosen: both read the same, by the bank's order.
	dee := w.user()
	w.kept(dee, ChapterRank{Chapter: "music", Level: 2, Ink: 6}, ChapterRank{Chapter: "geography", Level: 2, Ink: 6},
		ChapterRank{Chapter: "history", Level: 2, Ink: 6})
	if l, err := w.g.LookOf(ctx, dee); err != nil || l.Seal == nil || !sameSeal(l.Seal, w.wears(dee)) {
		t.Fatalf("a tie: the look %+v, the seal worn %+v (%v)", l.Seal, w.wears(dee), err)
	}
	// A chapter the bank no longer has is worn by nobody.
	eve := w.user()
	w.kept(eve, ChapterRank{Chapter: "gone", Level: 4, Ink: 50})
	if l, err := w.g.LookOf(ctx, eve); err != nil || l.Seal != nil || w.wears(eve) != nil {
		t.Fatalf("a chapter the bank hasn't: %+v %v", l.Seal, err)
	}
}
