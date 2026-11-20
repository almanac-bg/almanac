package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"regexp"
	"strings"
	"testing"
	"time"

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

// codePattern finds a code in a mail: six digits, or twelve in fours.
var codePattern = regexp.MustCompile(`\b(\d{4} \d{4} \d{4}|\d{6})\b`)

// code sends a code to email for a browser of its own, and reads it from the mail that went out: what that browser
// signs in with.
func code(t *testing.T, a *Accounts, out *mailer.Outbox, in *inbox, email string) Proof {
	t.Helper()
	asked, err := a.SendCode(t.Context(), email, "", "site")
	if err != nil {
		t.Fatal(err)
	}
	return Proof{Email: email, Code: read(t, out, in, email, asked.Digits), Asked: asked.Token}
}

// read is the code in the last mail to email, of so many digits.
func read(t *testing.T, out *mailer.Outbox, in *inbox, email string, digits int) string {
	t.Helper()
	out.Flush(t.Context())
	if len(in.got) == 0 {
		t.Fatal("no mail")
	}
	m := in.got[len(in.got)-1]
	in.got = nil
	found := codePattern.FindStringSubmatch(m.Text)
	if want, _ := NormalEmail(email); m.To != want || found == nil || len(onlyDigits(found[1])) != digits ||
		!strings.Contains(m.Subject, found[1]) {
		t.Fatalf("mail %+v", m)
	}
	return found[1]
}

// wrongFor is a code that isn't c.
func wrongFor(c string) string {
	if onlyDigits(c) == "000000" {
		return "111111"
	}
	return "000000"
}

func TestGuestKeepsAccountWithEmail(t *testing.T) {
	a, _, out, in := setup(t)
	ctx := t.Context()
	guest, token, err := a.Guest(ctx)
	if err != nil || !guest.Guest() {
		t.Fatal(guest, err)
	}
	if u, _, _ := a.Session(ctx, token); u == nil || u.ID != guest.ID {
		t.Fatalf("the guest's session gave %v", u)
	}
	c := code(t, a, out, in, " Me@Example.com ")
	wrong := c
	wrong.Code = wrongFor(c.Code)
	if _, _, err := a.Verify(ctx, wrong, token); !errors.Is(err, ErrBadCode) {
		t.Fatalf("a wrong code: %v", err)
	}
	c.Email = "ME@example.com"
	u, token2, err := a.Verify(ctx, c, token)
	if err != nil || u.ID != guest.ID || u.Email != "me@example.com" {
		t.Fatalf("verified %+v, %v", u, err)
	}
	// A code works once.
	if _, _, err := a.Verify(ctx, c, ""); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("a used code: %v", err)
	}
	if u, _, _ := a.Session(ctx, token2); u == nil || u.Email != "me@example.com" {
		t.Fatalf("the new session gave %v", u)
	}
	// The browser's session was replaced by the new one.
	if u, _, _ := a.Session(ctx, token); u != nil {
		t.Fatalf("the guest's session still signs in %+v", u)
	}
	if err := a.SignOut(ctx, token2); err != nil {
		t.Fatal(err)
	}
	if u, _, _ := a.Session(ctx, token2); u != nil {
		t.Fatal("still signed in after signing out")
	}
}

func TestGuestSigningInMergesIntoAccount(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	owner, _, _ := a.Verify(ctx, code(t, a, out, in, "x@example.com"), "")
	guest, guestSession, _ := a.Guest(ctx)
	var merged [2]int64
	a.Merge = append(a.Merge, func(tx *sql.Tx, from, to int64) error {
		merged = [2]int64{from, to}
		return nil
	})
	in.got = nil
	u, _, err := a.Verify(ctx, code(t, a, out, in, "x@example.com"), guestSession)
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
// tied to sessions), as a browser does.
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
}

// devices are the names (notified) of the browsers a player gets notifications on.
func devices(t *testing.T, db *store.DB, userID int64) string {
	t.Helper()
	var s sql.NullString
	if err := db.Read.QueryRow(`SELECT group_concat(name, ' ') FROM (SELECT substr(endpoint, 22) AS name FROM push_subs
		WHERE user_id = ?1 ORDER BY 1)`, userID).Scan(&s); err != nil {
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
	if s, _, _ := a.Session(ctx, session); s == nil || s.ID != guest.ID {
		t.Fatalf("the new session is %+v", s)
	}
	if s, _, _ := a.Session(ctx, before); s != nil {
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
	if s, _, _ := a.Session(ctx, session); s == nil || s.ID != guest.ID {
		t.Fatalf("where the link was made, the session is %+v", s)
	}
	u, moved, err := a.TakeHandoff(ctx, links[3], "")
	if err != nil || u.ID != guest.ID || moved == "" {
		t.Fatalf("one of the last %d: %+v %v", HandoffsKept, u, err)
	}

	// The page says whose game a link brings, and on how many days it was played, before anything is taken.
	if _, err := db.Write.Exec(`INSERT INTO active_days (user_id, day) VALUES (?1, '2026-11-16'), (?1, '2026-11-17')`,
		guest.ID); err != nil {
		t.Fatal(err)
	}
	token, _ = a.Handoff(ctx, guest.ID)
	if h, err := a.LookHandoff(ctx, token, ""); err != nil || h != (Handing{Name: guest.Name, Days: 2}) {
		t.Fatalf("what the link brings: %+v %v", h, err)
	}

	// A guest brought to a browser with a guest who has nothing yet: the browser becomes the guest brought, with its
	// own notifications (not those of the browser the link came from), and the guest it was goes. Nothing is joined.
	here, hereSession, _ := a.Guest(ctx)
	notified(t, db, guest.ID, moved, "came")
	notified(t, db, here.ID, hereSession, "here")
	if h, err := a.LookHandoff(ctx, token, hereSession); err != nil || h.Name != guest.Name {
		t.Fatalf("what the link brings to a guest with nothing: %+v %v", h, err)
	}
	u, session, err = a.TakeHandoff(ctx, token, hereSession)
	if err != nil || u.ID != guest.ID || session == "" || exists(here.ID) || len(merged) > 0 {
		t.Fatalf("a guest to a guest with nothing: %+v %q %v %v", u, session, err, merged)
	}
	if d := devices(t, db, guest.ID); d != "here" {
		t.Fatalf("notified after a guest came to a guest: %s", d)
	}
	if s, _, _ := a.Session(ctx, session); s == nil || s.ID != guest.ID {
		t.Fatalf("the browser the game came to is %+v", s)
	}

	// A guest brought to a browser with a game of its own: not joined (two games are, only by an email), so that a
	// link from someone else brings nothing of theirs (their friends) into it; the link still works where it was meant
	// to.
	other, otherSession, _ := a.Guest(ctx)
	if _, err := db.Write.Exec(`INSERT INTO runs (user_id, kind, questions, started_at) VALUES (?, 'topic', '[]', 0)`,
		other.ID); err != nil {
		t.Fatal(err)
	}
	token, _ = a.Handoff(ctx, guest.ID)
	if _, err := a.LookHandoff(ctx, token, otherSession); !errors.Is(err, ErrHandoffHere) {
		t.Fatalf("what the link brings to a game: %v", err)
	}
	if _, _, err = a.TakeHandoff(ctx, token, otherSession); !errors.Is(err, ErrHandoffHere) || !exists(other.ID) {
		t.Fatalf("a guest to a guest's game: %v", err)
	}
	if s, _, _ := a.Session(ctx, otherSession); s == nil || s.ID != other.ID {
		t.Fatalf("the browser with a game is %+v", s)
	}
	if s, _, _ := a.Session(ctx, session); s == nil || s.ID != guest.ID {
		t.Fatal("a link refused still took the game from where it was")
	}

	// A guest brought to a profile: not joined (only signing in by email joins them), and the link still works for
	// the browser it was meant for.
	owner, ownerSession, _ := a.Verify(ctx, code(t, a, out, in, "h@example.com"), "")
	if _, err := a.LookHandoff(ctx, token, ownerSession); !errors.Is(err, ErrHandoffSignedIn) {
		t.Fatalf("what the link brings to a profile: %v", err)
	}
	if _, _, err = a.TakeHandoff(ctx, token, ownerSession); !errors.Is(err, ErrHandoffSignedIn) || !exists(guest.ID) {
		t.Fatalf("a guest to a profile: %v", err)
	}
	if s, _, _ := a.Session(ctx, session); s == nil {
		t.Fatal("a link refused still took the game from where it was")
	}
	if u, _, err := a.TakeHandoff(ctx, token, ""); err != nil || u.ID != guest.ID {
		t.Fatalf("the link after: %+v %v", u, err)
	}
	if _, err := a.LookHandoff(ctx, token, ""); !errors.Is(err, ErrNoHandoff) {
		t.Fatalf("a link taken, looked at: %v", err)
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

	u, session, err := a.Verify(ctx, code(t, a, out, in, "me@example.com"), here)
	if err != nil || u.ID != guest.ID {
		t.Fatalf("verified %+v %v", u, err)
	}
	for name, s := range map[string]string{"elsewhere": elsewhere, "the browser's old": here} {
		if got, _, _ := a.Session(ctx, s); got != nil {
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
	_, other, _ := a.Verify(ctx, code(t, a, out, in, "me@example.com"), "")
	if s, _, _ := a.Session(ctx, session); s == nil {
		t.Fatal("a sign-in elsewhere ended this session")
	}
	if s, _, _ := a.Session(ctx, other); s == nil || s.ID != u.ID {
		t.Fatalf("signed in elsewhere as %+v", s)
	}
}

// Signing out the other devices ends every session of the player but this one, with the notifications of those
// browsers; signing out ends this one, with its own.
func TestSignOut(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	sessions := map[string]string{}
	var id int64
	for _, name := range []string{"phone", "laptop", "tablet"} {
		u, s, err := a.Verify(ctx, code(t, a, out, in, "me@example.com"), "")
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
		if got, _, _ := a.Session(ctx, s); (got != nil) != (name == "laptop") {
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
	if _, err := a.SendCode(ctx, "y@example.com", c.Asked, "site"); !errors.Is(err, ErrTooSoon) || !errors.As(err, &soon) ||
		soon.Wait <= 0 || soon.Wait > CodeEvery {
		t.Fatalf("a second code at once: %v", err)
	}
	// Each wrong try says how many are left; the last one says the code is dead.
	for i := range CodeTries {
		guess := c
		guess.Code = wrongFor(c.Code)
		_, _, err := a.Verify(ctx, guess, "")
		var wrong WrongCode
		if i < CodeTries-1 {
			if !errors.Is(err, ErrBadCode) || !errors.As(err, &wrong) || wrong.Left != CodeTries-1-i {
				t.Fatalf("wrong try %d: %v", i+1, err)
			}
		} else if !errors.Is(err, ErrCodeTries) {
			t.Fatalf("the last wrong try: %v", err)
		}
	}
	if _, _, err := a.Verify(ctx, c, ""); !errors.Is(err, ErrCodeTries) {
		t.Fatalf("the right code after %d wrong tries: %v", CodeTries, err)
	}
	// A dead code holds no new one back, in the same browser.
	asked, err := a.SendCode(ctx, "y@example.com", c.Asked, "site")
	if err != nil {
		t.Fatalf("a new code once the last is dead: %v", err)
	}
	c = Proof{Email: "y@example.com", Code: read(t, out, in, "y@example.com", CodeDigits), Asked: asked.Token}
	if _, _, err := a.Verify(ctx, c, ""); err != nil {
		t.Fatalf("the new code: %v", err)
	}
	// Nor does a live one to another address: an address mistyped is put right at once.
	typo, _ := a.SendCode(ctx, "z@exampel.com", "", "site")
	if _, err := a.SendCode(ctx, "z@example.com", typo.Token, "site"); err != nil {
		t.Fatalf("a code to the address put right: %v", err)
	}
	for _, bad := range []string{"", "no", "a@b", "a b@c.d", "<a@b.c>"} {
		if _, err := a.SendCode(ctx, bad, "", "site"); !errors.Is(err, ErrBadEmail) {
			t.Errorf("%q: %v", bad, err)
		}
	}
}

// The lock-out the codes once let through (review 2026-11-17, S3): someone else asks for codes with a player's
// address and guesses. The player's own code is neither replaced nor used up, and works only in the player's browser.
func TestCodeIsTheBrowsers(t *testing.T) {
	a, _, out, in := setup(t)
	ctx := t.Context()
	mine := code(t, a, out, in, "me@example.com")
	theirs := code(t, a, out, in, "me@example.com") // another browser, at once: no wait, nothing of mine touched
	for range CodeTries {
		guess := theirs
		guess.Code = mine.Code // even the right code, from the wrong browser
		if mine.Code == theirs.Code {
			guess.Code = wrongFor(mine.Code)
		}
		_, _, _ = a.Verify(ctx, guess, "")
	}
	for _, p := range []Proof{
		{Email: mine.Email, Code: mine.Code},                           // no token
		{Email: mine.Email, Code: mine.Code, Asked: "made-up"},         // a token never given
		{Email: "you@example.com", Code: mine.Code, Asked: mine.Asked}, // my token, another address
	} {
		if _, _, err := a.Verify(ctx, p, ""); !errors.Is(err, ErrCodeExpired) {
			t.Fatalf("%+v: %v", p, err)
		}
	}
	if u, _, err := a.Verify(ctx, mine, ""); err != nil || u.Email != "me@example.com" {
		t.Fatalf("my own code, after another's tries: %+v %v", u, err)
	}
}

// Past Misses wrong codes for an address, from any browser, its codes are long: nobody is locked out, and guessing
// gets nowhere. A short code alive then takes no more tries. The count is in the database: a restart keeps it.
func TestMissesLengthenCodes(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	mine := code(t, a, out, in, "me@example.com")
	for i := 0; i < Misses; {
		_, _ = db.Write.Exec(`DELETE FROM code_mails`) // as if over hours: not what's tried here (TestCodesPerAddress)
		theirs := code(t, a, out, in, "me@example.com")
		for range min(CodeTries, Misses-i) {
			guess := theirs
			guess.Code = wrongFor(theirs.Code)
			_, _, _ = a.Verify(ctx, guess, "")
			i++
		}
	}
	if _, _, err := a.Verify(ctx, mine, ""); !errors.Is(err, ErrCodeTries) {
		t.Fatalf("a short code past the misses: %v", err)
	}
	a = &Accounts{DB: db, Outbox: out, Secret: a.Secret} // as after a restart
	asked, err := a.SendCode(ctx, "me@example.com", mine.Asked, "site")
	if err != nil || asked.Digits != LongCodeDigits {
		t.Fatalf("the code after the misses: %+v %v", asked, err)
	}
	long := Proof{Email: "me@example.com", Code: read(t, out, in, "me@example.com", LongCodeDigits), Asked: asked.Token}
	guess := long
	guess.Code = "000000000000"
	if _, _, err := a.Verify(ctx, guess, ""); !errors.As(err, new(WrongCode)) {
		t.Fatalf("a wrong long code: %v", err)
	}
	if u, _, err := a.Verify(ctx, long, ""); err != nil || u.Email != "me@example.com" {
		t.Fatalf("the long code, spaced as the mail has it: %+v %v", u, err)
	}
	// Another address is as it was; this one's codes are short again once the stretch is over.
	if c := code(t, a, out, in, "you@example.com"); len(c.Code) != CodeDigits {
		t.Fatalf("another address's code: %q", c.Code)
	}
	if _, err := db.Write.Exec(`UPDATE code_misses SET since = ?`, store.Ms(time.Now().Add(-MissesKept))); err != nil {
		t.Fatal(err)
	}
	_, _ = db.Write.Exec(`DELETE FROM code_mails`)
	if c := code(t, a, out, in, "me@example.com"); len(c.Code) != CodeDigits {
		t.Fatalf("a code once the stretch is over: %q", c.Code)
	}
	if err := a.CleanUp(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = db.Read.QueryRow(`SELECT count(*) FROM code_misses`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d stretches over still kept", n)
	}
}

// A browser asking again replaces its code, and the mail of the last one goes no more if it hasn't gone yet.
func TestNewCodeDropsTheLastMail(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	first, err := a.SendCode(ctx, "me@example.com", "", "site")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = db.Write.Exec(`UPDATE sign_in_codes SET sent_at = 0`) // past the wait between codes
	second, err := a.SendCode(ctx, "me@example.com", first.Token, "site")
	if err != nil {
		t.Fatal(err)
	}
	c := read(t, out, in, "me@example.com", CodeDigits) // the only mail
	if _, _, err := a.Verify(ctx, Proof{Email: "me@example.com", Code: c, Asked: first.Token}, ""); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("the replaced code: %v", err)
	}
	if _, _, err := a.Verify(ctx, Proof{Email: "me@example.com", Code: c, Asked: second.Token}, ""); err != nil {
		t.Fatalf("the new code: %v", err)
	}
}

// At most CodesAMinute codes go a minute to new addresses, and apart to addresses with a profile: a flood to made-up
// addresses doesn't stop players with a profile signing in.
func TestCodesAMinute(t *testing.T) {
	a, _, out, in := setup(t)
	ctx := t.Context()
	if _, _, err := a.Verify(ctx, code(t, a, out, in, "me@example.com"), ""); err != nil {
		t.Fatal(err)
	}
	for {
		minute := time.Now().Unix() / 60
		a.mu.Lock()
		a.minute, a.mailed = minute, [2]minuteCount{{all: CodesAMinuteMost}, {all: 1}}
		a.mu.Unlock()
		_, flooded := a.SendCode(ctx, "new@example.com", "", "site")
		_, profile := a.SendCode(ctx, "me@example.com", "", "site")
		if time.Now().Unix()/60 != minute {
			continue // the minute turned meanwhile: again
		}
		if !errors.Is(flooded, ErrCodesBusy) || profile != nil {
			t.Fatalf("a new address past the most a minute: %v; one with a profile: %v", flooded, profile)
		}
		return
	}
}

// A minute's codes are shared fairly: a site takes SiteShare at most; once a few sites have filled the minute, every
// other site's first code still goes, up to CodesAMinuteMost; and each code's rank is how many its site had (review
// 2026-11-18, S5).
func TestCodesAMinuteShared(t *testing.T) {
	a := &Accounts{}
	now := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	for i := range SiteShare {
		if rank, ok := a.mailOne(false, "flood", now); !ok || rank != i+1 {
			t.Fatalf("code %d of a site: %d, %v", i+1, rank, ok)
		}
	}
	if _, ok := a.mailOne(false, "flood", now); ok {
		t.Fatal("a site took more than its share")
	}
	for i := SiteShare; i < CodesAMinute; i++ {
		a.mailOne(false, fmt.Sprint("flood", i/SiteShare), now)
	}
	if _, ok := a.mailOne(false, "flood1", now); ok {
		t.Fatal("past CodesAMinute, a site's second code went")
	}
	for i := CodesAMinute; i < CodesAMinuteMost; i++ {
		if rank, ok := a.mailOne(false, fmt.Sprint("player", i), now); !ok || rank != 1 {
			t.Fatalf("past CodesAMinute, a site's first code: %d, %v", rank, ok)
		}
	}
	if _, ok := a.mailOne(false, "late", now); ok {
		t.Fatal("past CodesAMinuteMost, a code went")
	}
	if _, ok := a.mailOne(true, "late", now); !ok {
		t.Fatal("the codes to addresses with a profile were held up by the new ones'")
	}
	if _, ok := a.mailOne(false, "flood", now.Add(time.Minute)); !ok {
		t.Fatal("the next minute didn't start anew")
	}
}

// An address gets at most CodesPerAddressHour codes an hour and CodesPerAddressDay a day, whoever asks for them and
// from wherever (review 2026-11-18, S5); they're counted in the database, forgotten a day after, and with the player.
func TestCodesPerAddress(t *testing.T) {
	a, db, _, _ := setup(t)
	ctx := t.Context()
	send := func() error {
		_, err := a.SendCode(ctx, "me@example.com", "", fmt.Sprint("site", rand.Int()))
		return err
	}
	for i := range CodesPerAddressHour {
		if err := send(); err != nil {
			t.Fatalf("code %d: %v", i+1, err)
		}
	}
	if err := send(); !errors.Is(err, ErrAddressBusy) {
		t.Fatalf("past the hour's: %v", err)
	}
	// An hour on, more go, until the day's are spent.
	for sent := CodesPerAddressHour; sent < CodesPerAddressDay; {
		_, _ = db.Write.Exec(`UPDATE code_mails SET at = at - ?`, time.Hour.Milliseconds())
		for i := 0; i < CodesPerAddressHour && sent < CodesPerAddressDay; i++ {
			if err := send(); err != nil {
				t.Fatalf("code %d of the day: %v", sent+1, err)
			}
			sent++
		}
	}
	_, _ = db.Write.Exec(`UPDATE code_mails SET at = at - ?`, time.Hour.Milliseconds())
	if err := send(); !errors.Is(err, ErrAddressBusy) {
		t.Fatalf("past the day's: %v", err)
	}
	if _, err := a.SendCode(ctx, "other@example.com", "", "site"); err != nil {
		t.Fatalf("another address: %v", err)
	}
	_, _ = db.Write.Exec(`UPDATE code_mails SET at = at - ?`, (24 * time.Hour).Milliseconds())
	if err := a.CleanUp(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = db.Read.QueryRow(`SELECT count(*) FROM code_mails`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d codes counted a day on", n)
	}
	if err := send(); err != nil {
		t.Fatalf("a day on: %v", err)
	}
}

// No code goes to an address the mail server refused: the player is told to check it.
func TestNoCodeToASuppressedAddress(t *testing.T) {
	a, db, _, _ := setup(t)
	_, _ = db.Write.Exec(`INSERT INTO mail_suppressed (email, until, times, reason) VALUES (?, ?, 1, '550 5.1.1')`,
		"gone@example.com", store.Ms(time.Now().Add(time.Hour)))
	if _, err := a.SendCode(t.Context(), "Gone@Example.com", "", "site"); !errors.Is(err, ErrNoMail) {
		t.Fatalf("to a suppressed address: %v", err)
	}
}

func TestNames(t *testing.T) {
	a, _, _, _ := setup(t)
	ctx := t.Context()
	one, _, _ := a.Guest(ctx)
	two, _, _ := a.Guest(ctx)
	if name, _, err := a.Rename(ctx, one.ID, new("  Иван   Петров "), nil); err != nil || name != "Иван Петров" {
		t.Fatalf("%q %v", name, err)
	}
	// Names may repeat: the tag tells players apart.
	if _, _, err := a.Rename(ctx, two.ID, new("Иван Петров"), nil); err != nil {
		t.Fatalf("a name someone else has: %v", err)
	}
	for _, bad := range []string{"А", "123", "<script>", "Иван!", "абвгдежзийклмнопрстуфхцчшщъьюяю",
		strings.Repeat("ﷺ", 3), "Ꙭꙮꙮ", "名前です", "Ἀλέξανδρος", "Иван​Петров"} {
		if _, err := normalName(bad); !errors.Is(err, ErrBadName) {
			t.Errorf("%q: %v", bad, err)
		}
	}
	// A word in two scripts is how a fake looks real; a dot between letters, a web address.
	for bad, want := range map[string]error{"АЛМAНAХ": ErrNameScripts, "Ивaн": ErrNameScripts,
		"almanac.bg": ErrNameLink, "free-coins.com": ErrNameLink, "Д.Петров": ErrNameLink} {
		if _, err := normalName(bad); !errors.Is(err, want) {
			t.Errorf("%q: %v, want %v", bad, err, want)
		}
	}
	for _, good := range []string{"Иван Петров", "Ана-Мария", "Д. Петров", "José Ivanov", "Петър 2", "Лисица 123",
		"Мечо_Пух", "Иван Ivanov", "Модерна", "Алма", "Хамлет"} {
		if _, err := normalName(good); err != nil || Reserved(good) {
			t.Errorf("%q: %v, reserved %v", good, err, Reserved(good))
		}
	}
	// Whatever reads as the game or its people, however it's written.
	for _, fake := range []string{"Алманах", "АЛМАНАХ", "Екипът на АЛМАНАХ", "ALMAHAX", "А Л М А Н А Х", "Allmanac",
		"4lm4n4h", "Almanakh", "Админ", "Adm1n", "Главен администратор", "Модератор", "Поддръжка", "support", "Help"} {
		if !Reserved(fake) {
			t.Errorf("%q isn't reserved", fake)
		}
		if _, _, err := a.Rename(ctx, one.ID, new(fake), nil); err == nil {
			t.Errorf("%q taken as a name", fake)
		}
	}
	// Whoever keeps the game may take such a name.
	if _, err := a.DB.Write.Exec(`UPDATE users SET admin = 1 WHERE id = ?`, two.ID); err != nil {
		t.Fatal(err)
	}
	if name, _, err := a.Rename(ctx, two.ID, new("АЛМАНАХ"), nil); err != nil || name != "АЛМАНАХ" {
		t.Fatalf("an admin's name: %q %v", name, err)
	}
}

// A name or tag that swears is refused however it's written: in Cyrillic or Latin letters, with chat's digits, spaced
// out, doubled; and the ordinary names a rude root sits inside pass.
func TestRudeNames(t *testing.T) {
	a, _, _, _ := setup(t)
	ctx := t.Context()
	u, _, _ := a.Guest(ctx)
	for _, rude := range []string{"Курва", "kurva", "KURRVA", "curva", "Путката", "putka", "П у т к а", "pi4ka",
		"Пичка", "6ibana", "Шибаняк", "Ебах ти", "ебало", "Мамка ти", "mamka mu", "хуйло", "fuck", "Fucker", "Педал",
		"Hitler 88", "Хитлер", "сука", "Гъз", "кур", "Pussy cat",
		// Spaced out, run together with another word, with an ending, and the rest of the bypasses found.
		"F U C K", "С У К А", "s h i t", "Fuckyou", "Fuckoff", "Shithead", "bitches", "Cunts", "Niggers", "Whores",
		"Курът", "Гъзът", "Сукин син", "Кучка", "Пачавра", "Мамицата", "Суката"} {
		if !Rude(rude) {
			t.Errorf("%q isn't rude", rude)
		}
		if _, err := normalName(rude); !errors.Is(err, ErrNameRude) {
			t.Errorf("%q as a name: %v", rude, err)
		}
	}
	for _, tag := range []string{"kurva_123", "pi4ka", "fuck_you", "the_hitler", "fuckyou", "shithead"} {
		if _, _, err := a.Rename(ctx, u.ID, nil, new(tag)); !errors.Is(err, ErrNameRude) {
			t.Errorf("@%s: %v", tag, err)
		}
	}
	for _, good := range []string{"Курт", "Куртев", "Курбан", "Хлебарка", "Ебру", "Шибил", "Пушкин", "Сукарова",
		"Педя", "Педро", "Fukuoka", "Пишков", "Гъзаров", "Ivan Kurtev", "Задников", "Мечо Пух", "Лиса 1234",
		"Петър 4", "Мамка", "Ana 6",
		// Clubs, names and words that sound like a rude one, or have one where a word ends and the next starts.
		"ФК Левски", "FC Barcelona", "Газ", "Gaz", "Фуксия", "Иван Фукс", "Huy", "Nguyen Huy", "Huynh", "Hu Yang",
		"Ebi", "Ebbe", "Hui", "Шибанов", "Иван Шибанов", "Cur", "Kunt", "Ebanks", "Кура", "Ебру Гюндеш", "Сукин",
		"Мамица", "Кучков", "Shitara", "Fuchs", "Ф У К С", "Курта"} {
		if Rude(good) {
			t.Errorf("%q is taken for rude", good)
		}
		if _, err := normalName(good); err != nil {
			t.Errorf("%q as a name: %v", good, err)
		}
	}
	for _, tag := range []string{"fc_levski", "gaz", "huy", "ebbe", "kunt"} {
		if _, _, err := a.Rename(ctx, u.ID, nil, new(tag)); err != nil {
			t.Errorf("@%s: %v", tag, err)
		}
	}
}

// No name or tag a player is drawn is rude, whatever its number (draw): a number on its own isn't letters written
// with digits („Лисица 381“ isn't „еби“).
func TestDrawnNamesArentRude(t *testing.T) {
	for _, an := range Animals {
		for n := 100; n <= 999; n++ {
			if name := fmt.Sprintf("%s %d", an.Name, n); Rude(name) {
				t.Errorf("the drawn name %q is rude", name)
			}
		}
		for n := 1000; n <= 9999; n++ {
			if tag := fmt.Sprintf("%s%d", an.Tag, n); Rude(tag) {
				t.Errorf("the drawn tag @%s is rude", tag)
			}
		}
	}
}

// Whoever keeps the game puts a name that pretends back to a drawn one, tag and all.
func TestResetName(t *testing.T) {
	a, _, _, _ := setup(t)
	ctx := t.Context()
	u, token, _ := a.Guest(ctx)
	if _, _, err := a.Rename(ctx, u.ID, new("Иван"), nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.Rename(ctx, u.ID, nil, new("ivan")); err != nil {
		t.Fatal(err)
	}
	name, tag, err := a.ResetName(ctx, u.ID)
	if err != nil || !strings.HasPrefix(name, AnimalOf(u.ID).Name+" ") || !strings.HasPrefix(tag, AnimalOf(u.ID).Tag) {
		t.Fatalf("reset: %q @%s %v", name, tag, err)
	}
	if s, _, _ := a.Session(ctx, token); s == nil || s.Name != name || s.Tag != tag || !s.Drawn() {
		t.Fatalf("the player after: %+v", s)
	}
	if _, _, err := a.ResetName(ctx, 1<<40); err == nil {
		t.Fatal("reset nobody")
	}
}

// A suspended player is signed out everywhere and can't sign in again until it's lifted.
func TestSuspend(t *testing.T) {
	a, _, out, in := setup(t)
	ctx := t.Context()
	u, token, _ := a.Guest(ctx)
	if _, _, err := a.Verify(ctx, code(t, a, out, in, "ana@example.com"), token); err != nil {
		t.Fatal(err)
	}
	signedIn, _, _ := a.Verify(ctx, code(t, a, out, in, "ana@example.com"), "")
	if signedIn.ID != u.ID {
		t.Fatalf("signed in as %d, not %d", signedIn.ID, u.ID)
	}
	if err := a.Suspend(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	if on, _, err := a.Suspended(ctx, u.ID); !on || err != nil {
		t.Fatalf("suspended: %v %v", on, err)
	}
	var sessions int
	if err := a.DB.Read.QueryRow(`SELECT count(*) FROM sessions WHERE user_id = ?`, u.ID).Scan(&sessions); err != nil || sessions != 0 {
		t.Fatalf("%d sessions left: %v", sessions, err)
	}
	if _, _, err := a.Verify(ctx, code(t, a, out, in, "ana@example.com"), ""); !errors.Is(err, ErrSuspended) {
		t.Fatalf("a suspended player signed in: %v", err)
	}
	if err := a.Suspend(ctx, 1<<40); err == nil {
		t.Fatal("suspended nobody")
	}
	if err := a.Unsuspend(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	if _, token, err := a.Verify(ctx, code(t, a, out, in, "ana@example.com"), ""); err != nil || token == "" {
		t.Fatalf("lifted, no sign-in: %v", err)
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
	if _, tag, err := a.Rename(ctx, one.ID, nil, new(" @Otsirh ")); err != nil || tag != "otsirh" {
		t.Fatalf("%q %v", tag, err)
	}
	if _, _, err := a.Rename(ctx, two.ID, nil, new("OTSIRH")); !errors.Is(err, ErrTagTaken) {
		t.Fatalf("a taken tag in other case: %v", err)
	}
	if _, _, err := a.Rename(ctx, one.ID, nil, new("otsirh")); err != nil {
		t.Fatalf("one's own tag again: %v", err)
	}
	for _, bad := range []string{"ab", "1abc", "иван", "a b c", "a.b.c", "abcdefghijklmnopqrstu"} {
		if _, err := NormalTag(bad); !errors.Is(err, ErrBadTag) {
			t.Errorf("%q passed", bad)
		}
	}
	for _, fake := range []string{"admin", "almanac_team", "almanakh", "the_admin1", "support"} {
		if _, _, err := a.Rename(ctx, two.ID, nil, new(fake)); !errors.Is(err, ErrNameReserved) {
			t.Errorf("%q: %v", fake, err)
		}
	}
	if u, _, _ := a.Session(ctx, token); u == nil || u.Tag != "otsirh" {
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
	if _, _, err := a.Rename(ctx, u.ID, new("Мария"), nil); err != nil {
		t.Fatal(err)
	}
	if s, _, _ := a.Session(ctx, token); s.Drawn() {
		t.Fatal("a chosen name is still drawn")
	}
}

// The clean-up clears guests who never played nor have a friend once unseen for IdleGuestDays, and keeps everyone
// else: guests seen lately, guests with a game or a friend (or a request), players with an email.
func TestCleanUpIdleGuests(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	old := store.Ms(time.Now().AddDate(0, 0, -IdleGuestDays-1))
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Write.ExecContext(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	guest := func(seen int64) int64 {
		t.Helper()
		u, _, err := a.Guest(ctx)
		if err != nil {
			t.Fatal(err)
		}
		exec(`UPDATE users SET seen_at = ?, created_at = ? WHERE id = ?`, seen, seen, u.ID)
		return u.ID
	}
	idle, recent := guest(old), guest(store.Now())
	played, friended, asked := guest(old), guest(old), guest(old)
	exec(`INSERT INTO runs (user_id, kind, questions, started_at) VALUES (?, 'topic', '[]', ?)`, played, old)
	exec(`INSERT INTO friends (user_id, friend_id, since) VALUES (?, ?, ?), (?, ?, ?)`, friended, recent, old, recent, friended, old)
	exec(`INSERT INTO friend_requests (from_id, to_email, at) VALUES (?, 'x@example.com', ?)`, asked, old)
	c := code(t, a, out, in, "kept@example.com")
	profile, _, err := a.Verify(ctx, c, "")
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE users SET seen_at = ?, created_at = ? WHERE id = ?`, old, old, profile.ID)

	if err := a.CleanUp(ctx); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[int64]bool{idle: false, recent: true, played: true, friended: true, asked: true, profile.ID: true} {
		var n int
		if err := db.Read.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE id = ?`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if (n == 1) != want {
			t.Errorf("player %d kept: %v, want %v", id, n == 1, want)
		}
	}
}

// A guest suspended has no session left, and stays all the same (their games, and the suspension, as Suspend says)
// for as long as a session would have lasted from then; and then goes, as one unused would.
func TestCleanUpKeepsTheSuspended(t *testing.T) {
	a, db, _, _ := setup(t)
	ctx := t.Context()
	u, _, err := a.Guest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Write.ExecContext(ctx, `INSERT INTO runs (user_id, kind, questions, started_at) VALUES (?, 'topic', '[]', ?)`,
		u.ID, store.Now()); err != nil {
		t.Fatal(err)
	}
	if err := a.Suspend(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	kept := func() bool {
		t.Helper()
		if err := a.CleanUp(ctx); err != nil {
			t.Fatal(err)
		}
		var n int
		if err := db.Read.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE id = ?`, u.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}
	if !kept() {
		t.Fatal("a suspended guest cleared")
	}
	if _, err := db.Write.ExecContext(ctx, `UPDATE suspensions SET at = ?`,
		store.Ms(time.Now().AddDate(0, 0, -SessionDays-1))); err != nil {
		t.Fatal(err)
	}
	if kept() {
		t.Fatal("a guest suspended for longer than a session lasts kept")
	}
}

// A flood of guests made and dropped goes, all of it, in batches.
func TestCleanUpManyGuests(t *testing.T) {
	a, db, _, _ := setup(t)
	ctx := t.Context()
	for range cleanBatch*2 + 7 {
		if _, _, err := a.Guest(ctx); err != nil {
			t.Fatal(err)
		}
	}
	old := store.Ms(time.Now().AddDate(0, 0, -IdleGuestDays-1))
	if _, err := db.Write.ExecContext(ctx, `UPDATE users SET seen_at = ?, created_at = ?`, old, old); err != nil {
		t.Fatal(err)
	}
	if err := a.CleanUp(ctx); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := db.Read.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&left); err != nil || left != 0 {
		t.Fatalf("guests left: %d (%v)", left, err)
	}
}

// Deleting a player tells the game first (Forget), and takes their address from wherever else it's kept: mail on its
// way, codes and wrong codes counted. Others' mail stays.
func TestDeleteForgetsTheAddress(t *testing.T) {
	a, db, out, in := setup(t)
	ctx := t.Context()
	var told []int64
	a.Forget = []func(*sql.Tx, int64) error{func(_ *sql.Tx, id int64) error {
		told = append(told, id)
		return nil
	}}
	profile, _, err := a.Verify(ctx, code(t, a, out, in, "gone@example.com"), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.SendCode(ctx, "gone@example.com", "", "site"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Write.ExecContext(ctx, `INSERT INTO code_misses (email, misses, since)
		VALUES ('gone@example.com', 2, ?)`, store.Now()); err != nil {
		t.Fatal(err)
	}
	err = db.Tx(ctx, func(tx *sql.Tx) error {
		for _, to := range []string{"gone@example.com", "other@example.com"} {
			if err := out.Enqueue(tx, mailer.Message{To: to, Subject: "Серия", Text: "Здравей"}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Delete(ctx, profile.ID); err != nil {
		t.Fatal(err)
	}
	var users, codes, misses, mailed int
	_ = db.Read.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM sign_in_codes),
		(SELECT count(*) FROM code_misses), (SELECT count(*) FROM code_mails)`).Scan(&users, &codes, &misses, &mailed)
	out.Flush(ctx)
	if users != 0 || codes != 0 || misses != 0 || mailed != 0 || len(told) != 1 || told[0] != profile.ID {
		t.Fatalf("after: %d players, %d codes, %d misses, %d codes mailed counted; the game told of %v", users, codes,
			misses, mailed, told)
	}
	if len(in.got) != 1 || in.got[0].To != "other@example.com" {
		t.Fatalf("mail sent after: %+v", in.got)
	}
}

// A player's id is never another's: the newest player deleted, the next to come gets a new one, so that nothing kept
// by the id (active_days, a limit's key) becomes theirs (review 2026-11-18, S15).
func TestIDsNeverReused(t *testing.T) {
	a, _, _, _ := setup(t)
	ctx := t.Context()
	first, _, _ := a.Guest(ctx)
	newest, _, _ := a.Guest(ctx)
	if err := a.Delete(ctx, newest.ID); err != nil {
		t.Fatal(err)
	}
	next, _, err := a.Guest(ctx)
	if err != nil || next.ID <= newest.ID || next.ID == first.ID {
		t.Fatalf("after %d and %d, %d gone: %d (%v)", first.ID, newest.ID, newest.ID, next.ID, err)
	}
}

// Friend requests to an address are kept EmailRequestDays; a guest cleared away is forgotten as a deleted player is.
func TestCleanUpForgets(t *testing.T) {
	a, db, _, _ := setup(t)
	ctx := t.Context()
	var told []int64
	a.Forget = []func(*sql.Tx, int64) error{func(_ *sql.Tx, id int64) error {
		told = append(told, id)
		return nil
	}}
	u, _, err := a.Guest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	sender, _, err := a.Guest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	old := store.Ms(time.Now().AddDate(0, 0, -EmailRequestDays-1))
	for _, q := range []string{
		`UPDATE users SET seen_at = ?2, created_at = ?2 WHERE id = ?1`,
		`INSERT INTO friend_requests (from_id, to_email, at) VALUES (?3, 'old@example.com', ?2),
			(?3, 'new@example.com', ?4)`,
	} {
		if _, err := db.Write.ExecContext(ctx, q, u.ID, old, sender.ID, store.Now()); err != nil {
			t.Fatal(q, err)
		}
	}
	if err := a.CleanUp(ctx); err != nil {
		t.Fatal(err)
	}
	var requests []string
	rows, err := db.Read.QueryContext(ctx, `SELECT to_email FROM friend_requests`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var e string
		_ = rows.Scan(&e)
		requests = append(requests, e)
	}
	rows.Close()
	if len(requests) != 1 || requests[0] != "new@example.com" || len(told) != 1 || told[0] != u.ID {
		t.Fatalf("requests kept %v; the game told of %v", requests, told)
	}
}

// A question's report (what a player wrote) is kept ReportDays once seen to, then dropped; one not seen to yet stays
// (the privacy page says so).
func TestCleanUpReports(t *testing.T) {
	a, db, _, _ := setup(t)
	ctx := t.Context()
	old, recent := store.Ms(time.Now().AddDate(0, 0, -ReportDays-1)), store.Ms(time.Now().AddDate(0, 0, -1))
	if _, err := db.Write.ExecContext(ctx, `INSERT INTO reports (question_id, text, at, resolved_at) VALUES
		('q1', 'seen to long ago', ?1, ?1), ('q2', 'seen to lately', ?1, ?2), ('q3', 'waiting', ?1, NULL)`,
		old, recent); err != nil {
		t.Fatal(err)
	}
	if err := a.CleanUp(ctx); err != nil {
		t.Fatal(err)
	}
	var left []string
	rows, err := db.Read.QueryContext(ctx, `SELECT question_id FROM reports ORDER BY question_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var q string
		_ = rows.Scan(&q)
		left = append(left, q)
	}
	if strings.Join(left, ",") != "q2,q3" {
		t.Fatalf("reports left: %v", left)
	}
}
