package play

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// A profile, anyone's to see, shows the seal and the ranks by chapter (DECISIONS.md, „The direction“), and the streak
// only as it is now (TestProfileShowsTheStreakNow): no lifetime totals and nothing of mastery. The ranks are kept as a
// day's issue finishes, so a game under way never shows; its time is a date (review 2026-11-18, S12).
func TestProfileShowsSealAndRanks(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	joined := time.Date(2026, 9, 17, 23, 30, 0, 0, Bulgaria)
	if _, err := w.db.Write.Exec(`UPDATE users SET created_at = ? WHERE id = ?`, joined.UnixMilli(), ana); err != nil {
		t.Fatal(err)
	}
	p, err := w.g.ProfileOf(ctx, "player1", 0)
	if err != nil || p.Seal != nil || len(p.Ranks) != len(w.b.Categories) {
		t.Fatalf("a newcomer's profile: %+v %v", p, err)
	}
	w.dayGame(ana, nil)
	w.g.AfterWait(ctx, ana)
	if p, err = w.g.ProfileOf(ctx, "player1", 0); err != nil || p.Seal == nil {
		t.Fatalf("after a day: %+v %v", p, err)
	}
	// A topic's game, under way: nothing of it shows.
	s, err := w.g.StartTopic(ctx, ana, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, w.right)
	if again, _ := w.g.ProfileOf(ctx, "player1", 0); again.Seal == nil || *again.Seal != *p.Seal {
		t.Fatalf("a game under way moved the profile: %+v, was %+v", again.Seal, p.Seal)
	}
	out, _ := json.Marshal(p)
	for _, total := range []string{`"days"`, `"games"`, `"answers"`, `"right"`, `"duels"`, `"won"`, `"mastery"`, `"best"`, `"ended"`, `"forgiven"`, `"spare"`, `"left"`} {
		if strings.Contains(string(out), total) {
			t.Errorf("the profile says %s: %s", total, out)
		}
	}
	if p.Since != "2026-09-17" { // the day in Bulgaria, never the moment
		t.Fatalf("since: %v", p.Since)
	}
}

// A profile shows the streak as it is now, to anyone (signed in or not, and its owner): its days and nothing more.
// Never an ended one's number, nor the longest, nor what the week has forgiven (the player's own); nothing while
// there's none (DECISIONS.md: an ended streak's number is never named).
func TestProfileShowsTheStreakNow(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, viewer := w.user(), w.user(), w.user()
	for d := 40; d >= 29; d-- { // twelve days, long ago: a streak that ended
		w.daysPlayed(ana, d)
		w.daysPlayed(bo, d)
	}
	w.daysPlayed(ana, 3, 2, 1)
	if s, err := w.g.StreakOf(ctx, ana); err != nil || s.Days != 3 || s.Ended == nil || s.Ended.Days != 12 {
		t.Fatalf("Ana's streak: %+v %v", s, err)
	}
	tag := func(id int64) string {
		var tag string
		if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, id).Scan(&tag); err != nil {
			t.Fatal(err)
		}
		return tag
	}
	for _, by := range []int64{0, viewer, ana} {
		p, err := w.g.ProfileOf(ctx, tag(ana), by)
		if err != nil || p.Streak != 3 {
			t.Fatalf("Ana's profile, seen by %d: streak %d (%v)", by, p.Streak, err)
		}
		out, _ := json.Marshal(p)
		var keys map[string]any
		if err := json.Unmarshal(out, &keys); err != nil || keys["streak"] != float64(3) {
			t.Fatalf("the profile's streak: %s", out)
		}
		for _, key := range []string{"best", "longest", "ended", "forgiven", "spare", "left"} {
			if _, has := keys[key]; has {
				t.Errorf("the profile says %s: %s", key, out)
			}
		}
	}
	// Bo's ended long ago, and none runs: nothing of it.
	p, err := w.g.ProfileOf(ctx, tag(bo), viewer)
	if err != nil || p.Streak != 0 {
		t.Fatalf("Bo's profile: %+v %v", p, err)
	}
	if out, _ := json.Marshal(p); strings.Contains(string(out), `"streak"`) {
		t.Fatalf("a profile with no streak names one: %s", out)
	}
}

// A no to a friend request by email leaves it waiting in its sender's list, as one to an address without a player
// does, so that the no tells nobody the address has one (review 2026-11-18, S29). The one asked sees it no more.
func TestDeclinedEmailRequestStaysWaiting(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	if _, err := w.db.Write.Exec(`UPDATE users SET email = 'ana@example.com' WHERE id = ?`, ana); err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.Request(ctx, bo, "ana@example.com", true); err != nil {
		t.Fatal(err)
	}
	in, _, err := w.g.Requests(ctx, ana)
	if err != nil || len(in) != 1 {
		t.Fatalf("Ana's requests: %+v %v", in, err)
	}
	if err := w.g.Withdraw(ctx, ana, in[0].ID); err != nil {
		t.Fatal(err)
	}
	if in, _, _ := w.g.Requests(ctx, ana); len(in) != 0 {
		t.Fatalf("Ana still sees the request she said no to: %+v", in)
	}
	if n := w.requestsIn(ana); n != 0 {
		t.Fatalf("waiting for Ana: %d", n)
	}
	if _, err := w.g.Accept(ctx, ana, in[0].ID); !errors.Is(err, ErrNoRequest) {
		t.Fatalf("accepting it after the no: %v", err)
	}
	if err := w.g.Withdraw(ctx, ana, in[0].ID); !errors.Is(err, ErrNoRequest) {
		t.Fatalf("saying no twice: %v", err)
	}
	if p, _ := w.g.ProfileOf(ctx, "player2", ana); p.Friend != "" {
		t.Fatalf("Bo, as Ana sees him: %q", p.Friend)
	}
	// Asked again, it stays declined: no new request for Ana.
	if _, err := w.g.Request(ctx, bo, "ana@example.com", true); err != nil {
		t.Fatal(err)
	}
	if n := w.requestsIn(ana); n != 0 {
		t.Fatalf("waiting for Ana after Bo asked again: %d", n)
	}
	_, out, err := w.g.Requests(ctx, bo)
	if err != nil || len(out) != 1 || out[0].Email != "ana@example.com" {
		t.Fatalf("Bo's requests: %+v %v", out, err)
	}
	// Bo can still call it off.
	if err := w.g.Withdraw(ctx, bo, out[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, out, _ := w.g.Requests(ctx, bo); len(out) != 0 {
		t.Fatalf("Bo's requests after calling it off: %+v", out)
	}
}
