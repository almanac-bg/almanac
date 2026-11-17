package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	mailer "github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/store"
)

// inbox keeps what would have been sent.
type inbox struct{ got []mailer.Message }

func (i *inbox) Send(_ context.Context, _ string, m mailer.Message) error {
	i.got = append(i.got, m)
	return nil
}

func setup(t *testing.T) (*Accounts, *store.DB, *mailer.Outbox, *inbox) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	in := &inbox{}
	out := mailer.NewOutbox(db, in, "АЛМАНАХ <no-reply@almanac.bg>")
	return &Accounts{DB: db, Outbox: out, Secret: []byte("test secret")}, db, out, in
}

var codePattern = regexp.MustCompile(`\b(\d{6})\b`)

// code sends a code to email and reads it from the mail that went out.
func code(t *testing.T, a *Accounts, out *mailer.Outbox, in *inbox, email string) string {
	t.Helper()
	if err := a.SendCode(t.Context(), email); err != nil {
		t.Fatal(err)
	}
	out.Flush(t.Context())
	m := in.got[len(in.got)-1]
	in.got = nil
	found := codePattern.FindStringSubmatch(m.Text)
	if want, _ := NormalEmail(email); m.To != want || found == nil {
		t.Fatalf("mail %+v", m)
	}
	return found[1]
}

func TestGuestKeepsAccountWithEmail(t *testing.T) {
	a, _, out, in := setup(t)
	ctx := t.Context()
	guest, token, err := a.Guest(ctx)
	if err != nil || !guest.Guest() {
		t.Fatal(guest, err)
	}
	if u, _ := a.Session(ctx, token); u == nil || u.ID != guest.ID {
		t.Fatalf("the guest's session gave %v", u)
	}
	c := code(t, a, out, in, " Me@Example.com ")
	if _, _, err := a.Verify(ctx, "me@example.com", "000000", &guest); !errors.Is(err, ErrBadCode) && c != "000000" {
		t.Fatalf("a wrong code: %v", err)
	}
	u, token2, err := a.Verify(ctx, "ME@example.com", c, &guest)
	if err != nil || u.ID != guest.ID || u.Email != "me@example.com" {
		t.Fatalf("verified %+v, %v", u, err)
	}
	// A code works once.
	if _, _, err := a.Verify(ctx, "me@example.com", c, nil); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("a used code: %v", err)
	}
	if u, _ := a.Session(ctx, token2); u == nil || u.Email != "me@example.com" {
		t.Fatalf("the new session gave %v", u)
	}
	if err := a.SignOut(ctx, token2); err != nil {
		t.Fatal(err)
	}
	if u, _ := a.Session(ctx, token2); u != nil {
		t.Fatal("still signed in after signing out")
	}
}

func TestGuestSigningInMergesIntoAccount(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	owner, _, _ := a.Verify(ctx, "x@example.com", code(t, a, out, in, "x@example.com"), nil)
	guest, _, _ := a.Guest(ctx)
	var merged [2]int64
	a.Merge = append(a.Merge, func(tx *sql.Tx, from, to int64) error {
		merged = [2]int64{from, to}
		return nil
	})
	in.got = nil
	_, _ = db.Write.Exec(`UPDATE email_codes SET sent_at = 0`) // past the wait between codes
	u, _, err := a.Verify(ctx, "x@example.com", code(t, a, out, in, "x@example.com"), &guest)
	if err != nil || u.ID != owner.ID {
		t.Fatalf("signed in as %+v, %v", u, err)
	}
	if merged != [2]int64{guest.ID, owner.ID} {
		t.Fatalf("merged %v", merged)
	}
	var n int
	_ = db.Read.QueryRow(`SELECT count(*) FROM users WHERE id = ?`, guest.ID).Scan(&n)
	if n != 0 {
		t.Fatal("the guest is still there")
	}
}

// A handoff's link signs another browser in as the player who made it, once; what that browser had is kept, as a
// sign-in by email keeps it.
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

	// A browser with nobody in it: the guest who made the link, with a session of its own. Once only.
	guest, _, _ := a.Guest(ctx)
	token, err := a.Handoff(ctx, guest.ID)
	if err != nil {
		t.Fatal(err)
	}
	u, session, err := a.TakeHandoff(ctx, token, nil)
	if err != nil || u.ID != guest.ID || session == "" {
		t.Fatalf("taken as %+v %q %v", u, session, err)
	}
	if s, _ := a.Session(ctx, session); s == nil || s.ID != guest.ID {
		t.Fatalf("the new session is %+v", s)
	}
	if _, _, err := a.TakeHandoff(ctx, token, nil); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link used twice: %v", err)
	}

	// The last few links work, the ones before them not; out of time, none.
	var links []string
	for range HandoffsKept + 1 {
		l, _ := a.Handoff(ctx, guest.ID)
		links = append(links, l)
	}
	if _, _, err := a.TakeHandoff(ctx, links[0], nil); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link past the last %d: %v", HandoffsKept, err)
	}
	if u, _, err := a.TakeHandoff(ctx, links[1], nil); err != nil || u.ID != guest.ID {
		t.Fatalf("one of the last %d: %+v %v", HandoffsKept, u, err)
	}
	_, _ = db.Write.Exec(`UPDATE handoffs SET expires_at = 0`)
	if _, _, err := a.TakeHandoff(ctx, links[2], nil); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link out of time: %v", err)
	}

	// A guest brought to a browser with a guest of its own: the one here keeps both games, but not the
	// notifications of the browser the link came from.
	here, _, _ := a.Guest(ctx)
	if _, err := db.Write.Exec(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at)
		VALUES (?, 'https://push.example/1', 'k', 'a', 0)`, guest.ID); err != nil {
		t.Fatal(err)
	}
	token, _ = a.Handoff(ctx, guest.ID)
	u, session, err = a.TakeHandoff(ctx, token, &here)
	if err != nil || u.ID != here.ID || session != "" || exists(guest.ID) ||
		merged[len(merged)-1] != [2]int64{guest.ID, here.ID} {
		t.Fatalf("a guest to a guest: %+v %q %v %v", u, session, err, merged)
	}
	var subs int
	_ = db.Read.QueryRow(`SELECT count(*) FROM push_subs`).Scan(&subs)
	if subs != 0 {
		t.Fatalf("the notifications of the browser the link came from came along: %d", subs)
	}

	// A guest brought to a profile: not joined (only signing in by email joins them), and the link still works for
	// the browser it was meant for.
	owner, _, _ := a.Verify(ctx, "h@example.com", code(t, a, out, in, "h@example.com"), nil)
	token, _ = a.Handoff(ctx, here.ID)
	if _, _, err = a.TakeHandoff(ctx, token, &owner); !errors.Is(err, ErrHandoffSignedIn) || !exists(here.ID) {
		t.Fatalf("a guest to a profile: %v", err)
	}
	if u, _, err := a.TakeHandoff(ctx, token, nil); err != nil || u.ID != here.ID {
		t.Fatalf("the link after: %+v %v", u, err)
	}

	// A profile makes no link: one would sign in whoever it reached.
	if _, err := a.Handoff(ctx, owner.ID); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a profile's link: %v", err)
	}
}

func TestCodesLimits(t *testing.T) {
	a, _, out, in := setup(t)
	ctx := t.Context()
	c := code(t, a, out, in, "y@example.com")
	var soon TooSoon
	if err := a.SendCode(ctx, "y@example.com"); !errors.Is(err, ErrTooSoon) || !errors.As(err, &soon) ||
		soon.Wait <= 0 || soon.Wait > CodeEvery {
		t.Fatalf("a second code at once: %v", err)
	}
	// Each wrong try says how many are left; the last one says the code is dead.
	for i := range CodeTries {
		_, _, err := a.Verify(ctx, "y@example.com", "x", nil)
		var wrong WrongCode
		if i < CodeTries-1 {
			if !errors.Is(err, ErrBadCode) || !errors.As(err, &wrong) || wrong.Left != CodeTries-1-i {
				t.Fatalf("wrong try %d: %v", i+1, err)
			}
		} else if !errors.Is(err, ErrCodeTries) {
			t.Fatalf("the last wrong try: %v", err)
		}
	}
	if _, _, err := a.Verify(ctx, "y@example.com", c, nil); !errors.Is(err, ErrCodeTries) {
		t.Fatalf("the right code after %d wrong tries: %v", CodeTries, err)
	}
	// A dead code holds no new one back.
	c = code(t, a, out, in, "y@example.com")
	if _, _, err := a.Verify(ctx, "y@example.com", c, nil); err != nil {
		t.Fatalf("the new code: %v", err)
	}
	for _, bad := range []string{"", "no", "a@b", "a b@c.d", "<a@b.c>"} {
		if err := a.SendCode(ctx, bad); !errors.Is(err, ErrBadEmail) {
			t.Errorf("%q: %v", bad, err)
		}
	}
}

func TestNames(t *testing.T) {
	a, _, _, _ := setup(t)
	ctx := t.Context()
	one, _, _ := a.Guest(ctx)
	two, _, _ := a.Guest(ctx)
	if name, err := a.Rename(ctx, one.ID, "  Иван   Петров "); err != nil || name != "Иван Петров" {
		t.Fatalf("%q %v", name, err)
	}
	// Names may repeat: the tag tells players apart.
	if _, err := a.Rename(ctx, two.ID, "Иван Петров"); err != nil {
		t.Fatalf("a name someone else has: %v", err)
	}
	for _, bad := range []string{"А", "123", "Алманах", "<script>", "Иван!", "абвгдежзийклмнопрстуфхцчшщъьюяю"} {
		if _, err := NormalName(bad); !errors.Is(err, ErrBadName) {
			t.Errorf("%q passed", bad)
		}
	}
}

func TestTags(t *testing.T) {
	a, _, _, _ := setup(t)
	ctx := t.Context()
	one, token, _ := a.Guest(ctx)
	two, _, _ := a.Guest(ctx)
	if one.Tag == "" || one.Tag == two.Tag {
		t.Fatalf("drawn tags: %q %q", one.Tag, two.Tag)
	}
	if tag, err := a.Retag(ctx, one.ID, " @Otsirh "); err != nil || tag != "otsirh" {
		t.Fatalf("%q %v", tag, err)
	}
	if _, err := a.Retag(ctx, two.ID, "OTSIRH"); !errors.Is(err, ErrTagTaken) {
		t.Fatalf("a taken tag in other case: %v", err)
	}
	if _, err := a.Retag(ctx, one.ID, "otsirh"); err != nil {
		t.Fatalf("one's own tag again: %v", err)
	}
	for _, bad := range []string{"ab", "1abc", "иван", "a b c", "admin", "a.b.c", "abcdefghijklmnopqrstu"} {
		if _, err := NormalTag(bad); !errors.Is(err, ErrBadTag) {
			t.Errorf("%q passed", bad)
		}
	}
	if u, _ := a.Session(ctx, token); u == nil || u.Tag != "otsirh" {
		t.Fatalf("the session's user: %+v", u)
	}
}

// A player keeps the name drawn for them until they choose one, and their screen knows which it is.
func TestDrawnName(t *testing.T) {
	a, _, _, _ := setup(t)
	ctx := t.Context()
	u, token, _ := a.Guest(ctx)
	if !u.Drawn() {
		t.Fatalf("a new player's name %q isn't drawn", u.Name)
	}
	if data, _ := json.Marshal(u); !strings.Contains(string(data), `"drawn":true`) {
		t.Fatalf("sent as %s", data)
	}
	other := AnimalOf(u.ID+1).Name + " 123"
	for _, name := range []string{AnimalOf(u.ID).Name + " 12", AnimalOf(u.ID).Name + " 12а", other, "Мария"} {
		if (User{ID: u.ID, Name: name}).Drawn() {
			t.Errorf("%q is taken for drawn", name)
		}
	}
	if _, err := a.Rename(ctx, u.ID, "Мария"); err != nil {
		t.Fatal(err)
	}
	if s, _ := a.Session(ctx, token); s.Drawn() {
		t.Fatal("a chosen name is still drawn")
	}
}
