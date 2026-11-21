package play

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// A profile, anyone's to see, shows the seal and the ranks by chapter, never a streak (DECISIONS.md, „The
// direction“): no lifetime totals and nothing of mastery. The ranks are kept as a day's issue finishes, so a game
// under way never shows; its time is a date (review 2026-11-18, S12).
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
	for _, total := range []string{`"days"`, `"games"`, `"answers"`, `"right"`, `"duels"`, `"won"`, `"mastery"`, `"streak"`, `"best"`} {
		if strings.Contains(string(out), total) {
			t.Errorf("the profile says %s: %s", total, out)
		}
	}
	if since := time.UnixMilli(p.Since).In(Bulgaria); !since.Equal(time.Date(2026, 9, 1, 12, 0, 0, 0, Bulgaria)) {
		t.Fatalf("since: %v", since)
	}
}

// A recording shows who played it, as anyone shows anywhere in the game: their name, tag and look, during the duel
// and after it, labelled a recording (owner, 2026-11-19).
func TestRecordingsNamed(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	owner, gal := w.user(), w.user()
	if _, err := w.db.Write.Exec(`UPDATE users SET name = 'Мария', avatar = 'lynx' WHERE id = ?`,
		owner); err != nil {
		t.Fatal(err)
	}
	s, err := w.g.StartTopic(ctx, owner, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	w.play(owner, s.ID, repeat(w.right, Length)...)
	duel, err := w.g.DuelRecording(ctx, gal, Even)
	if err != nil {
		t.Fatal(err)
	}
	w.playSide(gal, duel, repeat(w.wrong, Length))
	w.wait(time.Minute)

	look, err := w.g.LookOf(ctx, owner)
	if err != nil || look.Avatar != "lynx" {
		t.Fatalf("the owner's look: %+v %v", look, err)
	}
	var ownerTag string
	if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, owner).Scan(&ownerTag); err != nil {
		t.Fatal(err)
	}
	duels, err := w.g.DuelsOf(ctx, gal)
	if err != nil || len(duels.Played) != 1 {
		t.Fatalf("Gal's duels: %+v %v", duels, err)
	}
	d := duels.Played[0]
	if !d.Recorded || d.Opponent == nil || d.Opponent.Name != "Мария" || d.Opponent.Tag != ownerTag ||
		d.Opponent.Look == nil || *d.Opponent.Look != look {
		t.Fatalf("the recording, as Gal's duels show it: %+v %+v", d, d.Opponent)
	}
	one, err := w.g.DuelOf(ctx, gal, d.ID)
	if err != nil || !one.Recorded || one.Opponent.Name != "Мария" || one.Opponent.Tag != ownerTag ||
		*one.Opponent.Look != look || one.Record != nil {
		t.Fatalf("the duel's result: %+v %v", one, err)
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
