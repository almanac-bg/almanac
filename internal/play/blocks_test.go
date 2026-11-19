package play

import (
	"database/sql"
	"errors"
	"testing"
)

// A block keeps two players apart: no longer friends, no request either way (though its sender is told it went),
// nothing on the friends' board, and it ends what waited between them.
func TestBlocks(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy := w.user(), w.user(), w.user()
	tag := func(id int64) string {
		var t2 string
		if err := w.g.DB.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, id).Scan(&t2); err != nil {
			t.Fatal(err)
		}
		return t2
	}
	w.befriend(bo, ana)
	// Bo has played the day.
	day, _ := w.g.StartDay(ctx, bo)
	w.play(bo, day.ID, repeat(w.right, Length)...)
	if b, _ := w.g.FriendsBoard(ctx, w.g.Today(), ana); len(b) != 1 {
		t.Fatalf("Ana's friends' board: %+v", b)
	}

	// Ana blocks Bo.
	if _, err := w.g.Block(ctx, ana, tag(ana)); !errors.Is(err, ErrNoPlayer) {
		t.Fatalf("Ana blocked herself: %v", err)
	}
	if name, err := w.g.Block(ctx, ana, tag(bo)); err != nil || name == "" {
		t.Fatalf("block: %q %v", name, err)
	}
	if blocked, _ := w.g.Blocked(ctx, bo, ana); !blocked {
		t.Fatal("not blocked, as Bo sees it")
	}
	if _, err := w.g.Friend(ctx, ana, bo); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("still friends: %v", err)
	}
	if b, _ := w.g.FriendsBoard(ctx, w.g.Today(), ana); len(b) != 0 {
		t.Fatalf("Bo on Ana's friends' board: %+v", b)
	}
	// Bo asks again: told it went, and nothing reaches Ana.
	if sent, err := w.g.Request(ctx, bo, tag(ana), false); err != nil || sent.New || sent.Friends {
		t.Fatalf("Bo's request: %+v %v", sent, err)
	}
	if in, _, _ := w.g.Requests(ctx, ana); len(in) != 0 {
		t.Fatalf("Ana's requests: %+v", in)
	}
	if n, _ := w.g.RequestsWaiting(ctx, ana); n != 0 {
		t.Fatalf("%d waiting", n)
	}
	// Nor can Ana ask Bo while she blocks him (a block is lifted first).
	if sent, _ := w.g.Request(ctx, ana, tag(bo), false); sent.New {
		t.Fatalf("Ana's request to Bo went: %+v", sent)
	}
	if err := w.g.befriend(ctx, ana, bo); !errors.Is(err, ErrBlocked) {
		t.Fatalf("befriended while blocked: %v", err)
	}
	// Ana's own profile of Bo says she blocked him; Bo's of Ana says nothing.
	if p, _ := w.g.ProfileOf(ctx, tag(bo), ana); p.Friend != "blocked" {
		t.Fatalf("Bo as Ana sees him: %q", p.Friend)
	}
	if p, _ := w.g.ProfileOf(ctx, tag(ana), bo); p.Friend != "" {
		t.Fatalf("Ana as Bo sees her: %q", p.Friend)
	}
	if list, _ := w.g.BlockedOf(ctx, ana); len(list) != 1 || list[0].Tag != tag(bo) {
		t.Fatalf("Ana's blocked: %+v", list)
	}
	// Cy, nobody's block, is untouched.
	if sent, err := w.g.Request(ctx, cy, tag(ana), false); err != nil || !sent.New {
		t.Fatalf("Cy's request: %+v %v", sent, err)
	}

	// Lifted: strangers again, who may ask.
	if err := w.g.Unblock(ctx, bo, tag(ana)); !errors.Is(err, ErrNoPlayer) {
		t.Fatalf("Bo lifted Ana's block: %v", err)
	}
	if err := w.g.Unblock(ctx, ana, tag(bo)); err != nil {
		t.Fatal(err)
	}
	if sent, err := w.g.Request(ctx, bo, tag(ana), false); err != nil || !sent.New {
		t.Fatalf("Bo's request after: %+v %v", sent, err)
	}
}

// A guest's blocks come to the account they sign in to, both ways: the same person.
func TestMergeCarriesBlocks(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner, x, y := w.user(), w.user(), w.user(), w.user()
	w.befriend(owner, x)
	for _, q := range []string{
		`INSERT INTO blocks (user_id, blocked_id, at) VALUES (?1, ?2, 1)`, // the guest blocked x
		`INSERT INTO blocks (user_id, blocked_id, at) VALUES (?3, ?1, 1)`, // y blocked the guest
	} {
		if _, err := w.db.Write.Exec(q, guest, x, y); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, guest, owner) }); err != nil {
		t.Fatal(err)
	}
	for _, p := range [][2]int64{{owner, x}, {owner, y}} {
		if blocked, _ := w.g.Blocked(ctx, p[0], p[1]); !blocked {
			t.Errorf("%d and %d not blocked after the merge", p[0], p[1])
		}
	}
	if _, err := w.g.Friend(ctx, owner, x); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("still friends with one the guest blocked: %v", err)
	}
	var left int
	if err := w.db.Read.QueryRow(`SELECT count(*) FROM blocks WHERE ?1 IN (user_id, blocked_id)`, guest).Scan(&left); err != nil || left != 0 {
		t.Fatalf("%d of the guest's blocks left: %v", left, err)
	}
}
