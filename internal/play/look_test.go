package play

import (
	"encoding/json"
	"strings"
	"testing"
)

// kept gives a player ranks as the ranks table keeps them, with nothing in their book under them.
func (w *world) kept(user int64, ranks ...ChapterRank) {
	w.t.Helper()
	for _, r := range ranks {
		if _, err := w.db.Write.Exec(`INSERT INTO ranks (user_id, chapter, level, ink, told)
			VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, chapter) DO UPDATE SET level = excluded.level,
			ink = excluded.ink`, user, r.Chapter, r.Level, r.Ink, r.Level); err != nil {
			w.t.Fatal(err)
		}
	}
}

// A player's face is their avatar alone, wherever others see their name — their friends' list, the day's boards, a
// friend request, a duel, their profile: no seal on it, whatever their ranks (the owner, 2026-11-22). Their seals are
// on their profile, as its ranks.
func TestNoSealOnTheFace(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy := w.user(), w.user(), w.user()
	w.befriend(ana, bo)
	w.kept(ana, ChapterRank{Chapter: "history", Level: 3, Ink: 20})
	w.kept(cy, ChapterRank{Chapter: "sports", Level: 3, Ink: 20})
	w.dayGame(ana, nil)
	w.dayGame(bo, nil)
	faceless := func(what string, v any) {
		t.Helper()
		data, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), `"seal"`) {
			t.Errorf("%s says a seal: %s", what, data)
		}
	}

	friends, err := w.g.FriendsOf(ctx, bo)
	if err != nil || len(friends) != 1 || friends[0].Avatar == "" {
		t.Fatalf("Bo's friends: %+v %v", friends, err)
	}
	faceless("a friend's row", friends)
	today := w.g.Today()
	b, err := w.g.BoardOf(ctx, today, bo)
	if err != nil || len(b.Top) != 2 {
		t.Fatalf("the day's board: %+v %v", b, err)
	}
	faceless("the day's board", b)
	fb, err := w.g.FriendsBoard(ctx, today, bo)
	if err != nil || len(fb) != 2 {
		t.Fatalf("the friends' board: %+v %v", fb, err)
	}
	faceless("the friends' board", fb)

	var boTag, anaTag string
	if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, bo).Scan(&boTag); err != nil {
		t.Fatal(err)
	}
	if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, ana).Scan(&anaTag); err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.Request(ctx, cy, boTag, false); err != nil {
		t.Fatal(err)
	}
	in, _, err := w.g.Requests(ctx, bo)
	if err != nil || len(in) != 1 || in[0].Look == nil {
		t.Fatalf("Cy's request to Bo: %+v %v", in, err)
	}
	faceless("a request", in)

	duel := w.duel(ana, bo, repeat(w.right, Length), repeat(w.wrong, Length))
	d, err := w.g.DuelOf(ctx, bo, duel)
	if err != nil || d.Opponent == nil || d.Opponent.Look == nil {
		t.Fatalf("Ana in Bo's duel: %+v %v", d.Opponent, err)
	}
	faceless("a duel", d)

	p, err := w.g.ProfileOf(ctx, anaTag, bo)
	if err != nil {
		t.Fatal(err)
	}
	faceless("a profile", p)
	for _, r := range p.Ranks {
		if r.Chapter == "history" && r.Level != 3 {
			t.Fatalf("the profile's ranks: %+v", p.Ranks)
		}
	}
}
