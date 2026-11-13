package account

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"regexp"
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

func TestCodesLimits(t *testing.T) {
	a, _, out, in := setup(t)
	ctx := t.Context()
	c := code(t, a, out, in, "y@example.com")
	if err := a.SendCode(ctx, "y@example.com"); !errors.Is(err, ErrTooSoon) {
		t.Fatalf("a second code at once: %v", err)
	}
	for range CodeTries {
		_, _, _ = a.Verify(ctx, "y@example.com", "x", nil)
	}
	if _, _, err := a.Verify(ctx, "y@example.com", c, nil); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("the right code after %d wrong tries: %v", CodeTries, err)
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
