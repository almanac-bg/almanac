package account

import (
	"database/sql"
	"errors"
	"testing"
)

// The phone the tests make their links on, and somewhere else.
var (
	phone     = Origin{Net: []byte("net-a"), OS: "android"}
	elsewhere = Origin{Net: []byte("net-b"), OS: "android"}
	desktop   = Origin{Net: []byte("net-a"), OS: "windows"}
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
	link, err := a.Handoff(ctx, guest.ID, phone)
	if err != nil || len(link.Token) != 43 || link.Number < 10 || link.Number > 99 || !link.Fresh {
		t.Fatalf("the link: %+v %v", link, err)
	}
	another, _ := a.Handoff(ctx, guest.ID, phone)
	u, session, err := a.TakeHandoff(ctx, link.Token, "", phone, 0)
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
	if _, _, err := a.TakeHandoff(ctx, link.Token, "", phone, 0); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link used twice: %v", err)
	}
	if u, s, err := a.TakeHandoff(ctx, another.Token, "", phone, 0); err != nil || u.ID != guest.ID || s == "" {
		t.Fatalf("another link: %+v %v", u, err)
	}

	// The last few links work, the ones before them not; out of time, none.
	var links []string
	for range HandoffsKept + 1 {
		l, _ := a.Handoff(ctx, guest.ID, phone)
		links = append(links, l.Token)
	}
	if _, _, err := a.TakeHandoff(ctx, links[0], "", phone, 0); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link past the last %d: %v", HandoffsKept, err)
	}
	_, _ = db.Write.Exec(`UPDATE handoffs SET expires_at = 0 WHERE token_hash = ?`, hashToken(links[1]))
	if _, _, err := a.TakeHandoff(ctx, links[1], "", phone, 0); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link out of time: %v", err)
	}
	// Opened in the browser it was made in (its page reloaded, the link in its address): nothing changes, and the
	// link stays good for the browser it's meant for.
	if u, s, err := a.TakeHandoff(ctx, links[2], before, elsewhere, 0); err != nil || u.ID != guest.ID || s != "" {
		t.Fatalf("a link opened where it was made: %+v %q %v", u, s, err)
	}
	if h, err := a.LookHandoff(ctx, links[2], before, elsewhere); err != nil || h.Number {
		t.Fatalf("looked at where it was made: %+v %v", h, err)
	}
	if u, moved, err := a.TakeHandoff(ctx, links[2], "", phone, 0); err != nil || u.ID != guest.ID || moved == "" {
		t.Fatalf("the link after it was opened where it was made: %+v %v", u, err)
	}

	// The page says whose game a link brings, and on how many days it was played, before anything is taken.
	if _, err := db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?1, '2026-11-16'), (?1, '2026-11-17')`,
		guest.ID); err != nil {
		t.Fatal(err)
	}
	link, _ = a.Handoff(ctx, guest.ID, phone)
	if h, err := a.LookHandoff(ctx, link.Token, "", phone); err != nil || h != (Handing{Name: guest.Name, Days: 2}) {
		t.Fatalf("what the link brings: %+v %v", h, err)
	}

	// A guest brought to a browser with a guest who has nothing yet: the browser becomes the guest brought, with its
	// own notifications, and the guest it was goes. Nothing is joined.
	here, hereSession, _ := a.Guest(ctx)
	notified(t, db, here.ID, hereSession, "here")
	u, session, err = a.TakeHandoff(ctx, link.Token, hereSession, phone, 0)
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
	link, _ = a.Handoff(ctx, guest.ID, phone)
	if _, err := a.LookHandoff(ctx, link.Token, otherSession, phone); !errors.Is(err, ErrHandoffHere) {
		t.Fatalf("what the link brings to a game: %v", err)
	}
	if _, _, err = a.TakeHandoff(ctx, link.Token, otherSession, phone, 0); !errors.Is(err, ErrHandoffHere) || !exists(other.ID) {
		t.Fatalf("a guest to a guest's game: %v", err)
	}
	if s, _, _ := a.Session(ctx, otherSession); s == nil || s.ID != other.ID {
		t.Fatalf("the browser with a game is %+v", s)
	}

	// A guest brought to a profile: not joined (only signing in by email joins them), and the link still works for
	// the browser it was meant for.
	owner, ownerSession, _ := a.Verify(ctx, code(t, a, out, in, "h@example.com"), "")
	if _, err := a.LookHandoff(ctx, link.Token, ownerSession, phone); !errors.Is(err, ErrHandoffSignedIn) {
		t.Fatalf("what the link brings to a profile: %v", err)
	}
	if _, _, err = a.TakeHandoff(ctx, link.Token, ownerSession, phone, 0); !errors.Is(err, ErrHandoffSignedIn) || !exists(guest.ID) {
		t.Fatalf("a guest to a profile: %v", err)
	}
	if u, _, err := a.TakeHandoff(ctx, link.Token, "", phone, 0); err != nil || u.ID != guest.ID {
		t.Fatalf("the link after: %+v %v", u, err)
	}
	if _, err := a.LookHandoff(ctx, link.Token, "", phone); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link taken, looked at: %v", err)
	}

	// A profile makes no link: one would sign in whoever it reached.
	if _, err := a.Handoff(ctx, owner.ID, phone); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a profile's link: %v", err)
	}
}

// A page that holds a link is given it again while it works for HandoffRotate more, and a new one after: the link in
// an address isn't changed while it's being opened, nor left to die.
func TestHandoffRotates(t *testing.T) {
	a, db, _, _ := setup(t)
	ctx := t.Context()
	guest, _, _ := a.Guest(ctx)
	other, _, _ := a.Guest(ctx)
	link, _ := a.Handoff(ctx, guest.ID, phone)
	if held, ok, err := a.HeldHandoff(ctx, guest.ID, link.Token); err != nil || !ok || held.Token != link.Token ||
		held.Number != link.Number || held.Fresh {
		t.Fatalf("held with 30 minutes left: %+v %v %v", held, ok, err)
	}
	if _, ok, _ := a.HeldHandoff(ctx, other.ID, link.Token); ok {
		t.Fatal("someone else's link held")
	}
	if _, ok, _ := a.HeldHandoff(ctx, guest.ID, ""); ok {
		t.Fatal("no link held")
	}
	_, _ = db.Write.Exec(`UPDATE handoffs SET expires_at = expires_at - ? WHERE token_hash = ?`,
		(HandoffTTL - HandoffRotate + 1).Milliseconds(), hashToken(link.Token))
	if _, ok, _ := a.HeldHandoff(ctx, guest.ID, link.Token); ok {
		t.Fatal("held with under 10 minutes left")
	}
	// Still taken while it works.
	if _, _, err := a.TakeHandoff(ctx, link.Token, "", phone, 0); err != nil {
		t.Fatalf("a link with under 10 minutes left: %v", err)
	}
}

// A browser that isn't plainly the phone the link was made on — another network, or another family of system — is
// asked for the link's number; a wrong one counts against the link, which stops working after HandoffMisses.
func TestHandoffNumber(t *testing.T) {
	a, _, _, _ := setup(t)
	ctx := t.Context()
	guest, _, _ := a.Guest(ctx)
	for _, at := range []Origin{elsewhere, desktop, {OS: "android"}} {
		link, _ := a.Handoff(ctx, guest.ID, phone)
		if h, err := a.LookHandoff(ctx, link.Token, "", at); err != nil || !h.Number {
			t.Fatalf("looked at from %+v: %+v %v", at, h, err)
		}
		if _, _, err := a.TakeHandoff(ctx, link.Token, "", at, 0); !errors.Is(err, ErrHandoffNumber) {
			t.Fatalf("taken from %+v without the number: %v", at, err)
		}
		wrong := link.Number%90 + 10
		var w WrongNumber
		if _, _, err := a.TakeHandoff(ctx, link.Token, "", at, wrong); !errors.As(err, &w) || w.Left != HandoffMisses-1 {
			t.Fatalf("a wrong number: %v", err)
		}
		u, s, err := a.TakeHandoff(ctx, link.Token, "", at, link.Number)
		if err != nil || u.ID != guest.ID || s == "" {
			t.Fatalf("the right number from %+v: %+v %v", at, u, err)
		}
	}
	// The same phone isn't asked.
	link, _ := a.Handoff(ctx, guest.ID, phone)
	if h, _ := a.LookHandoff(ctx, link.Token, "", phone); h.Number {
		t.Fatal("the same phone asked for the number")
	}
	// Wrong numbers to the last: the link is dead, the right number too late.
	link, _ = a.Handoff(ctx, guest.ID, phone)
	wrong := link.Number%90 + 10
	for i := range HandoffMisses {
		_, _, err := a.TakeHandoff(ctx, link.Token, "", elsewhere, wrong)
		if last := i == HandoffMisses-1; last != errors.Is(err, ErrNoHandoff) || !last && !errors.Is(err, ErrHandoffNumber) {
			t.Fatalf("wrong number %d: %v", i+1, err)
		}
	}
	if _, _, err := a.TakeHandoff(ctx, link.Token, "", elsewhere, link.Number); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("the right number after %d wrong: %v", HandoffMisses, err)
	}
}

// The takeover a handoff once let through (review 2026-11-17, S1): someone makes a link and sends it; it's opened in
// a browser with nobody in it (the number given), which plays on and later gives its email. Whoever made the link has
// no way into that profile: not by the session they had (a guest becoming a profile ends its other sessions), not by
// another link they kept, and their phone gets none of its notifications.
func TestHandoffTakeover(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	maker, makerSession, _ := a.Guest(ctx)
	notified(t, db, maker.ID, makerSession, "maker")
	link, _ := a.Handoff(ctx, maker.ID, phone)
	spare, _ := a.Handoff(ctx, maker.ID, phone)

	_, opened, err := a.TakeHandoff(ctx, link.Token, "", elsewhere, link.Number)
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
	if _, _, err := a.TakeHandoff(ctx, spare.Token, "", phone, 0); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("the link's maker came back by another link: %v", err)
	}
	if d := devices(t, db, u.ID); d != "opened" {
		t.Fatalf("the profile's notifications go to %s", d)
	}
	if s, _, _ := a.Session(ctx, profile); s == nil || s.Email != "victim@example.com" {
		t.Fatalf("the browser that gave the email is %+v", s)
	}
}
