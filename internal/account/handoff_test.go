package account

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// A handoff's link shares a guest's game with another browser, once: the browser it came from stays signed in, as
// the same player, with its notifications; the one it comes to gets a session of its own. What the browser it comes
// to had is kept, as a sign-in by email keeps it.
func TestHandoff(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	var merged [][2]int64
	a.Merge = append(a.Merge, func(tx *sql.Tx, from, to int64) error {
		merged = append(merged, [2]int64{from, to})
		return nil
	})
	exists := func(id int64) bool {
		var n int
		_ = db.Read.QueryRow(`SELECT count(*) FROM users WHERE id = ?`, id).Scan(&n)
		return n == 1
	}

	// A browser with nobody in it: the guest who made the link, with a session of its own. Once only; and the browser
	// the link came from stays signed in, its notifications and its other links with it.
	guest, before, _ := a.Guest(ctx)
	notified(t, db, guest.ID, before, "before")
	link, err := a.Handoff(ctx, guest.ID)
	if err != nil || len(link) != 43 {
		t.Fatalf("the link: %q %v", link, err)
	}
	var expires int64
	_ = db.Read.QueryRow(`SELECT expires_at FROM handoffs WHERE token_hash = ?`, hashToken(link)).Scan(&expires)
	if left := time.Until(time.UnixMilli(expires)); left > HandoffTTL || left < HandoffTTL-time.Minute ||
		HandoffTTL != 30*time.Minute {
		t.Fatalf("the link works for %v", left)
	}
	another, _ := a.Handoff(ctx, guest.ID)
	u, session, err := a.TakeHandoff(ctx, link, "")
	if err != nil || u.ID != guest.ID || session == "" {
		t.Fatalf("taken as %+v %q %v", u, session, err)
	}
	if s, _, _ := a.Session(ctx, session); s == nil || s.ID != guest.ID {
		t.Fatalf("the new session is %+v", s)
	}
	if s, _, _ := a.Session(ctx, before); s == nil || s.ID != guest.ID {
		t.Fatalf("the browser the game came from is signed out: %+v", s)
	}
	if d := devices(t, db, guest.ID); d != "before" {
		t.Fatalf("the notifications of the browser the game came from: %q", d)
	}
	if _, _, err := a.TakeHandoff(ctx, link, ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link used twice: %v", err)
	}
	// A player's earlier link works on, while it's in time; out of time, none.
	if u, s, err := a.TakeHandoff(ctx, another, ""); err != nil || u.ID != guest.ID || s == "" {
		t.Fatalf("another link: %+v %v", u, err)
	}
	late, _ := a.Handoff(ctx, guest.ID)
	_, _ = db.Write.Exec(`UPDATE handoffs SET expires_at = ? WHERE token_hash = ?`, store.Now(), hashToken(late))
	if _, _, err := a.TakeHandoff(ctx, late, ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link out of time: %v", err)
	}
	if _, err := a.LookHandoff(ctx, late, ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link out of time, looked at: %v", err)
	}
	// Opened in the browser it was made in (its page reloaded, the link in its address): nothing changes, and the
	// link stays good for the browser it's meant for.
	link, _ = a.Handoff(ctx, guest.ID)
	if h, err := a.LookHandoff(ctx, link, before); err != nil || h != (Handing{Name: guest.Name, Mine: true}) {
		t.Fatalf("looked at where it was made: %+v %v", h, err)
	}
	if u, s, err := a.TakeHandoff(ctx, link, before); err != nil || u.ID != guest.ID || s != "" {
		t.Fatalf("a link opened where it was made: %+v %q %v", u, s, err)
	}
	// Anywhere else, the page says whose game the link brings before anything is taken.
	if h, err := a.LookHandoff(ctx, link, ""); err != nil || h != (Handing{Name: guest.Name}) {
		t.Fatalf("what the link brings: %+v %v", h, err)
	}

	// A guest brought to a browser with a guest who has nothing yet: the browser becomes the guest brought, with its
	// own notifications, and the guest it was goes. Nothing is joined.
	here, hereSession, _ := a.Guest(ctx)
	notified(t, db, here.ID, hereSession, "here")
	u, session, err = a.TakeHandoff(ctx, link, hereSession)
	if err != nil || u.ID != guest.ID || session == "" || exists(here.ID) || len(merged) > 0 {
		t.Fatalf("a guest to a guest with nothing: %+v %q %v %v", u, session, err, merged)
	}
	if d := devices(t, db, guest.ID); d != "before here" {
		t.Fatalf("notified after a guest came to a guest: %q", d)
	}

	// A guest brought to a browser with a game of its own: not joined (two games are, only by an email), so that a
	// link from someone else brings nothing of theirs (their friends) into it; the link still works where it was meant
	// to.
	other, otherSession, _ := a.Guest(ctx)
	if _, err := db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at) VALUES (?, 'topic', '[]', 0)`,
		other.ID); err != nil {
		t.Fatal(err)
	}
	link, _ = a.Handoff(ctx, guest.ID)
	if _, err := a.LookHandoff(ctx, link, otherSession); !errors.Is(err, ErrHandoffHere) {
		t.Fatalf("what the link brings to a game: %v", err)
	}
	if _, _, err = a.TakeHandoff(ctx, link, otherSession); !errors.Is(err, ErrHandoffHere) || !exists(other.ID) {
		t.Fatalf("a guest to a guest's game: %v", err)
	}
	if s, _, _ := a.Session(ctx, otherSession); s == nil || s.ID != other.ID {
		t.Fatalf("the browser with a game is %+v", s)
	}

	// A guest brought to a profile: not joined (only signing in by email joins them), and the link still works for
	// the browser it was meant for.
	owner, ownerSession, _ := a.Verify(ctx, code(t, a, out, in, "h@example.com"), "")
	if _, err := a.LookHandoff(ctx, link, ownerSession); !errors.Is(err, ErrHandoffSignedIn) {
		t.Fatalf("what the link brings to a profile: %v", err)
	}
	if _, _, err = a.TakeHandoff(ctx, link, ownerSession); !errors.Is(err, ErrHandoffSignedIn) || !exists(guest.ID) {
		t.Fatalf("a guest to a profile: %v", err)
	}
	if u, _, err := a.TakeHandoff(ctx, link, ""); err != nil || u.ID != guest.ID {
		t.Fatalf("the link after: %+v %v", u, err)
	}
	if _, err := a.LookHandoff(ctx, link, ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link taken, looked at: %v", err)
	}

	// A profile makes no link: one would sign in whoever it reached.
	if _, err := a.Handoff(ctx, owner.ID); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a profile's link: %v", err)
	}
}

// The takeover a handoff once let through (review 2026-11-17, S1): someone makes a link and sends it; it's opened in
// a browser with nobody in it, which plays on and later gives its email. Whoever made the link has
// no way into that profile: not by the session they had (a guest becoming a profile ends its other sessions), not by
// another link they kept, and their phone gets none of its notifications.
func TestHandoffTakeover(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	maker, makerSession, _ := a.Guest(ctx)
	notified(t, db, maker.ID, makerSession, "maker")
	link, _ := a.Handoff(ctx, maker.ID)
	spare, _ := a.Handoff(ctx, maker.ID)

	_, opened, err := a.TakeHandoff(ctx, link, "")
	if err != nil {
		t.Fatal(err)
	}
	notified(t, db, maker.ID, opened, "opened")
	u, profile, err := a.Verify(ctx, code(t, a, out, in, "victim@example.com"), opened)
	if err != nil || u.ID != maker.ID || u.Email != "victim@example.com" {
		t.Fatalf("the game given, kept with an email: %+v %v", u, err)
	}

	if s, _, _ := a.Session(ctx, makerSession); s != nil {
		t.Fatalf("the link's maker is in the profile: %+v", s)
	}
	if _, _, err := a.TakeHandoff(ctx, spare, ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("the link's maker came back by another link: %v", err)
	}
	if d := devices(t, db, u.ID); d != "opened" {
		t.Fatalf("the profile's notifications go to %s", d)
	}
	if s, _, _ := a.Session(ctx, profile); s == nil || s.Email != "victim@example.com" {
		t.Fatalf("the browser that gave the email is %+v", s)
	}
}
