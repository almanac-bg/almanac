package play

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"slices"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
)

// A profile, anyone's to see, doesn't follow a player as they play: its numbers are of the games they finished, and
// its times are dates (review 2026-11-18, S12). Their own stats count the game under way too.
func TestProfileShowsNoGameUnderWay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	joined := time.Date(2026, 9, 17, 23, 30, 0, 0, Bulgaria)
	if _, err := w.db.Write.Exec(`UPDATE users SET created_at = ? WHERE id = ?`, joined.UnixMilli(), ana); err != nil {
		t.Fatal(err)
	}
	s, err := w.g.StartTopic(ctx, ana, "")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, repeat(w.right, Length)...)
	before, err := w.g.ProfileOf(ctx, "player1", 0)
	if err != nil {
		t.Fatal(err)
	}
	known := func(p Profile) (n int) {
		for _, m := range p.Mastery {
			n += m.Answers
		}
		return n
	}
	if before.Answers != Length || before.Right != Length || known(before) != Length {
		t.Fatalf("after a finished game: %d answers, %d right, mastery of %d", before.Answers, before.Right, known(before))
	}

	// A second game, one answer in: nobody else sees it.
	w.wait(time.Minute)
	s, err = w.g.StartTopic(ctx, ana, "")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, w.right)
	p, err := w.g.ProfileOf(ctx, "player1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if p.Answers != before.Answers || p.Right != before.Right || known(p) != known(before) {
		t.Fatalf("a game under way shows on the profile: %d answers, %d right, mastery of %d", p.Answers, p.Right, known(p))
	}
	if st, _ := w.g.StatsOf(ctx, ana); st.Answers != Length+1 {
		t.Fatalf("the player's own stats: %d answers", st.Answers)
	}

	// Dates, not moments: the month they started (late on the 17th in Bulgaria is still September), each achievement's
	// day.
	if since := time.UnixMilli(p.Since).In(Bulgaria); !since.Equal(time.Date(2026, 9, 1, 12, 0, 0, 0, Bulgaria)) {
		t.Fatalf("since: %v", since)
	}
	if len(p.Achievements) == 0 {
		t.Fatal("no achievement after a game of ten right: the test needs one")
	}
	for _, a := range p.Achievements {
		at := time.UnixMilli(a.At).In(Bulgaria)
		if at.Hour() != 12 || at.Minute() != 0 || at.Second() != 0 || at.Nanosecond() != 0 ||
			at.YearDay() != w.now.In(Bulgaria).YearDay() {
			t.Fatalf("%s earned at %v", a.ID, at)
		}
	}
}

// A recording is a stranger's game: the one playing against it sees the animal its player started as, never their
// name or tag, during the duel and after it (review 2026-11-18, S13).
func TestRecordingsUnnamed(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	owner, gal := w.user(), w.user()
	s, err := w.g.StartTopic(ctx, owner, "")
	if err != nil {
		t.Fatal(err)
	}
	w.play(owner, s.ID, repeat(w.right, Length)...)
	l, err := w.g.StartRecorded(ctx, gal)
	if err != nil || l.Users[1] != owner {
		t.Fatalf("a duel against the owner's game: %+v %v", l, err)
	}
	w.play(gal, l.Runs[0], repeat(w.wrong, Length)...)
	w.wait(time.Minute)

	animal := account.AnimalOf(owner).Name
	duels, err := w.g.DuelsOf(ctx, gal)
	if err != nil || len(duels) != 1 {
		t.Fatalf("Gal's duels: %+v %v", duels, err)
	}
	d := duels[0]
	if !d.Recorded || d.Opponent == nil || d.Opponent.Name != animal || d.Opponent.Tag != "" ||
		d.Opponent.Look == nil || d.Opponent.Look.Avatar != DefaultAvatar(owner) || d.Opponent.Look.Title != "" {
		t.Fatalf("the recording, as Gal's duels show it: %+v %+v", d, d.Opponent)
	}
	one, err := w.g.DuelOf(ctx, gal, d.ID)
	if err != nil || one.Opponent.Name != animal || one.Opponent.Tag != "" || one.Befriend || one.Record != nil {
		t.Fatalf("the duel's result: %+v %v", one, err)
	}
	st, err := w.g.StatsOf(ctx, gal)
	if err != nil || len(st.Recent) == 0 || st.Recent[0].Opponent != animal || !st.Recent[0].Recorded {
		t.Fatalf("Gal's games: %+v %v", st.Recent, err)
	}

	// A duel played before kept the recorded player's name: the migration puts the animal in its place.
	if _, err := w.db.Write.Exec(`UPDATE runs SET opponent = 'Мария' WHERE id = ?`, l.Runs[0]); err != nil {
		t.Fatal(err)
	}
	sql, err := os.ReadFile("../store/migrations/0061_recordings_unnamed.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(string(sql)); err != nil {
		t.Fatal(err)
	}
	if st, _ := w.g.StatsOf(ctx, gal); st.Recent[0].Opponent != animal {
		t.Fatalf("after the migration: %q", st.Recent[0].Opponent)
	}
}

// The migration that takes the names off the duels played against recordings before names the animals as
// account.AnimalOf does.
func TestRecordingsUnnamedMigration(t *testing.T) {
	sql, err := os.ReadFile("../store/migrations/0061_recordings_unnamed.sql")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, m := range regexp.MustCompile(`WHEN (\d) THEN '([^']+)'|ELSE '([^']+)'`).FindAllStringSubmatch(string(sql), -1) {
		if m[1] != "" && m[1] != fmt.Sprint(len(names)) {
			t.Fatalf("the animals out of order at %s", m[0])
		}
		names = append(names, m[2]+m[3])
	}
	var want []string
	for _, a := range account.Animals {
		want = append(want, a.Name)
	}
	if !slices.Equal(names, want) || !regexp.MustCompile(`% `+fmt.Sprint(len(want))+`\b`).Match(sql) {
		t.Fatalf("the migration's animals %v, account.Animals %v", names, want)
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
	if n, _ := w.g.RequestsWaiting(ctx, ana); n != 0 {
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
	if n, _ := w.g.RequestsWaiting(ctx, ana); n != 0 {
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
