package play

import (
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

// A player's link is one, made the first time it's asked for and the same after: its code ten random letters and
// digits, nothing of whose it is. Opened, it shows whose it is (name, tag, look), and whether the opener is them or a
// friend already.
func TestInviteLink(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	if _, err := w.db.Write.Exec(`UPDATE users SET name = 'Ана', avatar = 'lynx-mint' WHERE id = ?`, ana); err != nil {
		t.Fatal(err)
	}
	code, err := w.g.InviteOf(ctx, ana)
	if err != nil || len(code) != InviteCodeLength || strings.Trim(code, codeLetters) != "" {
		t.Fatalf("Ana's link: %q %v", code, err)
	}
	if again, _ := w.g.InviteOf(ctx, ana); again != code {
		t.Fatalf("asked again: %q, was %q", again, code)
	}
	if other, _ := w.g.InviteOf(ctx, bo); other == code {
		t.Fatal("two players, one link")
	}
	in, err := w.g.Invited(ctx, code, 0)
	if err != nil || in.Name != "Ана" || in.Tag != "player1" || in.Avatar != "lynx-mint" || in.Mine || in.Friends {
		t.Fatalf("opened by nobody: %+v %v", in, err)
	}
	if in, _ := w.g.Invited(ctx, code, ana); !in.Mine {
		t.Fatalf("opened by Ana: %+v", in)
	}
	for _, bad := range []string{"", "abc", code[:InviteCodeLength-1], strings.Repeat("a", InviteCodeLength)} {
		if _, err := w.g.Invited(ctx, bad, bo); !errors.Is(err, ErrNoInvite) {
			t.Errorf("%q: %v", bad, err)
		}
	}
}

// One tap makes the two friends, at once and both ways: the inviter as the one who asked, told of the yes (AcceptedOf);
// a request either had sent the other is settled with it. A friend already is told so; nobody takes their own.
func TestTakeInvite(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	code, err := w.g.InviteOf(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.TakeInvite(ctx, code, ana); !errors.Is(err, ErrSelf) {
		t.Fatalf("Ana takes her own: %v", err)
	}
	if _, err := w.g.Request(ctx, bo, "player1", false); err != nil {
		t.Fatal(err)
	}
	took, err := w.g.TakeInvite(ctx, code, bo)
	if err != nil || took.Name != "Играч" || took.ID != ana || took.Already {
		t.Fatalf("Bo takes it: %+v %v", took, err)
	}
	for _, pair := range [][2]int64{{ana, bo}, {bo, ana}} {
		if _, err := w.g.Friend(ctx, pair[0], pair[1]); err != nil {
			t.Fatalf("%d and %d: %v", pair[0], pair[1], err)
		}
	}
	if a, err := w.g.AcceptedOf(ctx, ana); err != nil || a == nil || a.ID != bo {
		t.Fatalf("Ana told of the yes: %+v %v", a, err)
	}
	if n, _ := w.g.RequestsWaiting(ctx, ana); n != 0 {
		t.Fatalf("Bo's request still waits: %d", n)
	}
	if in, _ := w.g.Invited(ctx, code, bo); !in.Friends {
		t.Fatalf("opened by a friend: %+v", in)
	}
	took, err = w.g.TakeInvite(ctx, code, bo)
	if err != nil || !took.Already {
		t.Fatalf("taken again: %+v %v", took, err)
	}
	if n := w.count(`SELECT took FROM invites WHERE user_id = ?`, ana); n != 1 {
		t.Fatalf("the link's count: %d, want 1 (a friend already counts nothing)", n)
	}
}

// A new link takes the old one's place, which ends; the day's count stays with the player, so a new link gives no
// budget back. A link makes InviteADay friends a day; a friend already is told so even then; the next day it makes
// more. Each list holds MaxFriends.
func TestInviteBounds(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	old, _ := w.g.InviteOf(ctx, ana)
	code, err := w.g.NewInvite(ctx, ana)
	if err != nil || code == old {
		t.Fatalf("a new link: %q %v", code, err)
	}
	if _, err := w.g.TakeInvite(ctx, old, w.user()); !errors.Is(err, ErrNoInvite) {
		t.Fatalf("the old link: %v", err)
	}
	var first int64
	for i := range InviteADay {
		if i == InviteADay/2 {
			if code, err = w.g.NewInvite(ctx, ana); err != nil {
				t.Fatal(err)
			}
		}
		who := w.user()
		if i == 0 {
			first = who
		}
		if _, err := w.g.TakeInvite(ctx, code, who); err != nil {
			t.Fatalf("friend %d: %v", i+1, err)
		}
	}
	late := w.user()
	if _, err := w.g.TakeInvite(ctx, code, late); !errors.Is(err, ErrInviteSpent) {
		t.Fatalf("one past the day's: %v", err)
	}
	if took, err := w.g.TakeInvite(ctx, code, first); err != nil || !took.Already {
		t.Fatalf("a friend already, the day spent: %+v %v", took, err)
	}
	if _, err := w.g.Friend(ctx, ana, late); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("friends past the day's: %v", err)
	}
	w.wait(24 * time.Hour)
	if _, err := w.g.TakeInvite(ctx, code, late); err != nil {
		t.Fatalf("the next day: %v", err)
	}

	// A list that's full takes no more, either side's.
	cy, full := w.user(), w.user()
	for range MaxFriends {
		other := w.user()
		if _, err := w.db.Write.Exec(`INSERT INTO friends (user_id, friend_id, since, asked) VALUES (?1, ?2, 0, 0), (?2, ?1, 0, 1)`,
			full, other); err != nil {
			t.Fatal(err)
		}
	}
	fullCode, _ := w.g.InviteOf(ctx, full)
	if _, err := w.g.TakeInvite(ctx, fullCode, cy); !errors.Is(err, ErrManyFriends) {
		t.Fatalf("into a full list: %v", err)
	}
	cyCode, _ := w.g.InviteOf(ctx, cy)
	if _, err := w.g.TakeInvite(ctx, cyCode, full); !errors.Is(err, ErrManyFriends) {
		t.Fatalf("from a full list: %v", err)
	}
	if n := w.count(`SELECT took FROM invites WHERE user_id = ?`, cy); n != 0 {
		t.Fatalf("a take refused, counted: %d", n)
	}
}

// A suspended player's link is no link while they are; a deleted player's goes with them.
func TestInviteGoesWithItsPlayer(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	code, _ := w.g.InviteOf(ctx, ana)
	if _, err := w.db.Write.Exec(`INSERT INTO suspensions (user_id, at) VALUES (?, 1)`, ana); err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.Invited(ctx, code, bo); !errors.Is(err, ErrNoInvite) {
		t.Fatalf("a suspended player's link opened: %v", err)
	}
	if _, err := w.g.TakeInvite(ctx, code, bo); !errors.Is(err, ErrNoInvite) {
		t.Fatalf("a suspended player's link taken: %v", err)
	}
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error {
		if err := Forget(tx, ana); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM users WHERE id = ?`, ana)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM invites WHERE code = ?`, code); n != 0 {
		t.Fatal("a deleted player's link stays")
	}
}

// A guest's link comes to the account they sign in to, unless it has one: then the account's stays, and the guest's
// ends.
func TestMergeCarriesTheInvite(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	merge := func(guest, owner int64) {
		t.Helper()
		if err := w.db.Tx(ctx, func(tx *sql.Tx) error {
			if err := w.g.Merge(tx, guest, owner); err != nil {
				return err
			}
			_, err := tx.Exec(`DELETE FROM users WHERE id = ?`, guest)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	guest, owner := w.user(), w.user()
	code, _ := w.g.InviteOf(ctx, guest)
	merge(guest, owner)
	if in, err := w.g.Invited(ctx, code, 0); err != nil || in.Tag != "player2" {
		t.Fatalf("the guest's link, signed in: %+v %v", in, err)
	}
	guest = w.user()
	theirs, _ := w.g.InviteOf(ctx, guest)
	merge(guest, owner)
	if mine, _ := w.g.InviteOf(ctx, owner); mine != code {
		t.Fatalf("the account's link: %q, was %q", mine, code)
	}
	if _, err := w.g.Invited(ctx, theirs, 0); !errors.Is(err, ErrNoInvite) {
		t.Fatalf("the guest's second link: %v", err)
	}
}
