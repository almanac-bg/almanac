package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"testing"

	mailer "github.com/almanac-bg/almanac/internal/mail"
	"github.com/almanac-bg/almanac/internal/store"
	"github.com/almanac-bg/almanac/internal/store/storetest"
)

// inbox keeps what would have been sent.
type inbox struct{ got []mailer.Message }

func (i *inbox) Send(_ context.Context, _ string, m mailer.Message) error {
	i.got = append(i.got, m)
	return nil
}

func setup(t *testing.T) (*Accounts, *store.DB, *mailer.Outbox, *inbox) {
	t.Helper()
	db := storetest.Open(t)
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
	if _, _, err := a.Verify(ctx, "me@example.com", "000000", token); !errors.Is(err, ErrBadCode) && c != "000000" {
		t.Fatalf("a wrong code: %v", err)
	}
	u, token2, err := a.Verify(ctx, "ME@example.com", c, token)
	if err != nil || u.ID != guest.ID || u.Email != "me@example.com" {
		t.Fatalf("verified %+v, %v", u, err)
	}
	// A code works once.
	if _, _, err := a.Verify(ctx, "me@example.com", c, ""); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("a used code: %v", err)
	}
	if u, _ := a.Session(ctx, token2); u == nil || u.Email != "me@example.com" {
		t.Fatalf("the new session gave %v", u)
	}
	// The browser's session was replaced by the new one.
	if u, _ := a.Session(ctx, token); u != nil {
		t.Fatalf("the guest's session still signs in %+v", u)
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
	owner, _, _ := a.Verify(ctx, "x@example.com", code(t, a, out, in, "x@example.com"), "")
	guest, guestSession, _ := a.Guest(ctx)
	var merged [2]int64
	a.Merge = append(a.Merge, func(tx *sql.Tx, from, to int64) error {
		merged = [2]int64{from, to}
		return nil
	})
	in.got = nil
	_, _ = db.Write.Exec(`UPDATE email_codes SET sent_at = 0`) // past the wait between codes
	u, _, err := a.Verify(ctx, "x@example.com", code(t, a, out, in, "x@example.com"), guestSession)
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

// notified turns notifications on for a player in a browser (its session; "" for one turned on before they were
// tied to sessions), as a browser does and as the app does.
func notified(t *testing.T, db *store.DB, userID int64, session, name string) {
	t.Helper()
	var key any
	if session != "" {
		key = SessionKey(session)
	}
	if _, err := db.Write.Exec(`INSERT INTO push_subs (endpoint, user_id, session, p256dh, auth, created_at)
		VALUES (?, ?, ?, 'k', 'a', 0)`, "https://push.example/"+name, userID, key); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Write.Exec(`INSERT INTO phones (token, user_id, session, platform, created_at)
		VALUES (?, ?, ?, 'android', 0)`, name, userID, key); err != nil {
		t.Fatal(err)
	}
}

// devices are the names (notified) of the browsers and phones a player gets notifications on, each once if both.
func devices(t *testing.T, db *store.DB, userID int64) string {
	t.Helper()
	var s sql.NullString
	if err := db.Read.QueryRow(`SELECT group_concat(name, ' ') FROM (SELECT substr(endpoint, 22) AS name FROM push_subs
		WHERE user_id = ?1 UNION SELECT token FROM phones WHERE user_id = ?1 ORDER BY 1)`, userID).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s.String
}

// A handoff's link moves a guest's game to another browser, once: the browser it came from is signed out, with its
// notifications and its other links. What the browser it comes to had is kept, as a sign-in by email keeps it.
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
	// the link came from is signed out, its notifications and its other links gone.
	guest, before, _ := a.Guest(ctx)
	notified(t, db, guest.ID, before, "before")
	notified(t, db, guest.ID, "", "untied")
	token, err := a.Handoff(ctx, guest.ID)
	if err != nil {
		t.Fatal(err)
	}
	another, _ := a.Handoff(ctx, guest.ID)
	u, session, err := a.TakeHandoff(ctx, token, "")
	if err != nil || u.ID != guest.ID || session == "" {
		t.Fatalf("taken as %+v %q %v", u, session, err)
	}
	if s, _ := a.Session(ctx, session); s == nil || s.ID != guest.ID {
		t.Fatalf("the new session is %+v", s)
	}
	if s, _ := a.Session(ctx, before); s != nil {
		t.Fatalf("the browser the game left is still signed in as %+v", s)
	}
	if d := devices(t, db, guest.ID); d != "" {
		t.Fatalf("the notifications of the browser the game left stayed: %s", d)
	}
	if _, _, err := a.TakeHandoff(ctx, token, ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link used twice: %v", err)
	}
	if _, _, err := a.TakeHandoff(ctx, another, ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("another link to a game already moved: %v", err)
	}

	// The last few links work, the ones before them not; out of time, none.
	var links []string
	for range HandoffsKept + 1 {
		l, _ := a.Handoff(ctx, guest.ID)
		links = append(links, l)
	}
	if _, _, err := a.TakeHandoff(ctx, links[0], ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link past the last %d: %v", HandoffsKept, err)
	}
	_, _ = db.Write.Exec(`UPDATE handoffs SET expires_at = 0 WHERE token_hash = ?`, hashToken(links[1]))
	if _, _, err := a.TakeHandoff(ctx, links[1], ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link out of time: %v", err)
	}
	// Opened in the browser it was made in: nothing moves.
	if u, s, err := a.TakeHandoff(ctx, links[2], session); err != nil || u.ID != guest.ID || s != "" {
		t.Fatalf("a link opened where it was made: %+v %q %v", u, s, err)
	}
	if s, _ := a.Session(ctx, session); s == nil || s.ID != guest.ID {
		t.Fatalf("where the link was made, the session is %+v", s)
	}
	u, moved, err := a.TakeHandoff(ctx, links[3], "")
	if err != nil || u.ID != guest.ID || moved == "" {
		t.Fatalf("one of the last %d: %+v %v", HandoffsKept, u, err)
	}

	// A guest brought to a browser with a guest of its own: the one here keeps both games, but not the
	// notifications of the browser the link came from.
	here, hereSession, _ := a.Guest(ctx)
	notified(t, db, guest.ID, moved, "came")
	notified(t, db, here.ID, hereSession, "here")
	token, _ = a.Handoff(ctx, guest.ID)
	u, session, err = a.TakeHandoff(ctx, token, hereSession)
	if err != nil || u.ID != here.ID || session != "" || exists(guest.ID) ||
		merged[len(merged)-1] != [2]int64{guest.ID, here.ID} {
		t.Fatalf("a guest to a guest: %+v %q %v %v", u, session, err, merged)
	}
	if d := devices(t, db, here.ID); d != "here" {
		t.Fatalf("notified after a guest came to a guest: %s", d)
	}
	if s, _ := a.Session(ctx, hereSession); s == nil || s.ID != here.ID {
		t.Fatalf("the browser the game came to is %+v", s)
	}

	// A guest brought to a profile: not joined (only signing in by email joins them), and the link still works for
	// the browser it was meant for.
	owner, ownerSession, _ := a.Verify(ctx, "h@example.com", code(t, a, out, in, "h@example.com"), "")
	token, _ = a.Handoff(ctx, here.ID)
	if _, _, err = a.TakeHandoff(ctx, token, ownerSession); !errors.Is(err, ErrHandoffSignedIn) || !exists(here.ID) {
		t.Fatalf("a guest to a profile: %v", err)
	}
	if s, _ := a.Session(ctx, hereSession); s == nil {
		t.Fatal("a link refused still took the game from where it was")
	}
	if u, _, err := a.TakeHandoff(ctx, token, ""); err != nil || u.ID != here.ID {
		t.Fatalf("the link after: %+v %v", u, err)
	}

	// A profile makes no link: one would sign in whoever it reached.
	if _, err := a.Handoff(ctx, owner.ID); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a profile's link: %v", err)
	}
}

// The takeover a handoff once let through (review 2026-11-17, S1): someone makes a link and sends it; it's opened in
// a browser with nobody in it, which plays on and later gives its email. Whoever made the link has no way into that
// profile: not by the session they had, not by another link they kept, and their phone gets none of its notifications.
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
	u, profile, err := a.Verify(ctx, "victim@example.com", code(t, a, out, in, "victim@example.com"), opened)
	if err != nil || u.ID != maker.ID || u.Email != "victim@example.com" {
		t.Fatalf("the game given, kept with an email: %+v %v", u, err)
	}

	if s, _ := a.Session(ctx, makerSession); s != nil {
		t.Fatalf("the link's maker is in the profile: %+v", s)
	}
	if _, _, err := a.TakeHandoff(ctx, spare, ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("the link's maker came back by another link: %v", err)
	}
	if d := devices(t, db, u.ID); d != "opened" {
		t.Fatalf("the profile's notifications go to %s", d)
	}
	if s, _ := a.Session(ctx, profile); s == nil || s.Email != "victim@example.com" {
		t.Fatalf("the browser that gave the email is %+v", s)
	}
}

// A guest becoming a profile ends every other session the guest had (made anywhere else, before the email was
// proved), with the notifications of those browsers; the notifications of the browser that gave the email come along
// to its new session.
func TestProfileEndsOtherSessions(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	guest, here, _ := a.Guest(ctx)
	var elsewhere string
	if err := db.Tx(ctx, func(tx *sql.Tx) (err error) {
		elsewhere, err = startSession(tx, guest.ID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	notified(t, db, guest.ID, here, "here")
	notified(t, db, guest.ID, elsewhere, "elsewhere")
	notified(t, db, guest.ID, "", "untied")

	u, session, err := a.Verify(ctx, "me@example.com", code(t, a, out, in, "me@example.com"), here)
	if err != nil || u.ID != guest.ID {
		t.Fatalf("verified %+v %v", u, err)
	}
	for name, s := range map[string]string{"elsewhere": elsewhere, "the browser's old": here} {
		if got, _ := a.Session(ctx, s); got != nil {
			t.Fatalf("%s session signs in %+v", name, got)
		}
	}
	if d := devices(t, db, u.ID); d != "here" {
		t.Fatalf("notified: %s", d)
	}
	var tied int
	_ = db.Read.QueryRow(`SELECT count(*) FROM push_subs WHERE session = ?`, SessionKey(session)).Scan(&tied)
	if tied != 1 {
		t.Fatal("the browser's notifications aren't tied to its new session")
	}

	// Signing in to the profile elsewhere ends nothing: only a guest's sessions end, as the guest becomes a profile.
	_, other, _ := a.Verify(ctx, "me@example.com", code(t, a, out, in, "me@example.com"), "")
	if s, _ := a.Session(ctx, session); s == nil {
		t.Fatal("a sign-in elsewhere ended this session")
	}
	if s, _ := a.Session(ctx, other); s == nil || s.ID != u.ID {
		t.Fatalf("signed in elsewhere as %+v", s)
	}
}

// Signing out the other devices ends every session of the player but this one, with the notifications of those
// browsers and phones; signing out ends this one, with its own.
func TestSignOut(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	sessions := map[string]string{}
	var id int64
	for _, name := range []string{"phone", "laptop", "tablet"} {
		u, s, err := a.Verify(ctx, "me@example.com", code(t, a, out, in, "me@example.com"), "")
		if err != nil {
			t.Fatal(err)
		}
		id, sessions[name] = u.ID, s
		notified(t, db, u.ID, s, name)
	}
	if n, err := a.SignOutOthers(ctx, sessions["laptop"]); err != nil || n != 2 {
		t.Fatalf("signed out the others: %d %v", n, err)
	}
	for name, s := range sessions {
		if got, _ := a.Session(ctx, s); (got != nil) != (name == "laptop") {
			t.Fatalf("after signing out the others, %s is %+v", name, got)
		}
	}
	if d := devices(t, db, id); d != "laptop" {
		t.Fatalf("notified after signing out the others: %s", d)
	}
	if err := a.SignOut(ctx, sessions["laptop"]); err != nil {
		t.Fatal(err)
	}
	if d := devices(t, db, id); d != "" {
		t.Fatalf("notified after signing out: %s", d)
	}
	if n, err := a.SignOutOthers(ctx, sessions["laptop"]); err != nil || n != 0 {
		t.Fatalf("signed out the others of a session that ended: %d %v", n, err)
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
		_, _, err := a.Verify(ctx, "y@example.com", "x", "")
		var wrong WrongCode
		if i < CodeTries-1 {
			if !errors.Is(err, ErrBadCode) || !errors.As(err, &wrong) || wrong.Left != CodeTries-1-i {
				t.Fatalf("wrong try %d: %v", i+1, err)
			}
		} else if !errors.Is(err, ErrCodeTries) {
			t.Fatalf("the last wrong try: %v", err)
		}
	}
	if _, _, err := a.Verify(ctx, "y@example.com", c, ""); !errors.Is(err, ErrCodeTries) {
		t.Fatalf("the right code after %d wrong tries: %v", CodeTries, err)
	}
	// A dead code holds no new one back.
	c = code(t, a, out, in, "y@example.com")
	if _, _, err := a.Verify(ctx, "y@example.com", c, ""); err != nil {
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
