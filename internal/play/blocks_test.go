package play

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

// An invite link opened is a request its owner accepts, never a friendship by itself: not the first time, and not
// again after the owner ends it. A new link leaves the old one nobody's.
func TestInviteNeedsConsent(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	code, _ := w.g.InviteCode(ctx, ana)
	accept := func() {
		t.Helper()
		in, _, err := w.g.Requests(ctx, ana)
		if err != nil || len(in) != 1 {
			t.Fatalf("Ana's requests: %+v %v", in, err)
		}
		if _, err := w.g.Accept(ctx, ana, in[0].ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, _, err := w.g.AskByInvite(ctx, bo, code); err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.Friend(ctx, ana, bo); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("friends by opening a link: %v", err)
	}
	accept()
	if _, err := w.g.Friend(ctx, ana, bo); err != nil {
		t.Fatalf("Ana said yes: %v", err)
	}
	// Ana ends it; Bo opens her link again: a request again, not the friendship back.
	if err := w.g.Unfriend(ctx, ana, bo); err != nil {
		t.Fatal(err)
	}
	if _, _, sent, err := w.g.AskByInvite(ctx, bo, code); err != nil || sent.Friends || !sent.New {
		t.Fatalf("Bo again: %+v %v", sent, err)
	}
	if _, err := w.g.Friend(ctx, ana, bo); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("back by the link after an unfriend: %v", err)
	}
	// Ana declines; asked again, it's a new request (the server caps how often she hears of it).
	in, _, _ := w.g.Requests(ctx, ana)
	if err := w.g.Withdraw(ctx, ana, in[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, _, sent, _ := w.g.AskByInvite(ctx, bo, code); !sent.New {
		t.Fatalf("asked after a no: %+v", sent)
	}
	// Had Ana asked Bo first (by his tag), his opening her link is the yes to it.
	vi := w.user()
	var viTag string
	if err := w.g.DB.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, vi).Scan(&viTag); err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.Request(ctx, ana, viTag, false); err != nil {
		t.Fatal(err)
	}
	if _, _, sent, err := w.g.AskByInvite(ctx, vi, code); err != nil || !sent.Friends {
		t.Fatalf("Vi, asked by Ana first: %+v %v", sent, err)
	}

	// A new link: the old one is nobody's.
	fresh, err := w.g.NewInviteCode(ctx, ana)
	if err != nil || fresh == code || len(fresh) != 8 {
		t.Fatalf("a new link: %q %v", fresh, err)
	}
	if _, _, _, err := w.g.AskByInvite(ctx, w.user(), code); !errors.Is(err, ErrNoInvite) {
		t.Fatalf("the old link: %v", err)
	}
	if again, _ := w.g.InviteCode(ctx, ana); again != fresh {
		t.Fatalf("Ana's link after: %q", again)
	}
}

// A block keeps two players apart: no longer friends, no request either way (though its sender is told it went), no
// challenge either way, nothing on the friends' board, and it ends what waited between them.
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
	var told []DuelNews
	w.g.DuelNews = func(_ context.Context, n DuelNews) { told = append(told, n) }
	// Bo's challenge waits on Ana; Bo has played the day.
	s, _ := w.g.StartTopic(ctx, bo, "")
	w.play(bo, s.ID, repeat(w.right, Length)...)
	code, reached, err := w.g.Challenge(ctx, bo, s.ID, []int64{ana})
	if err != nil || len(reached) != 1 {
		t.Fatalf("Bo's challenge: %v %v", reached, err)
	}
	if told[len(told)-1].FromID != bo {
		t.Fatalf("the news isn't from Bo: %+v", told)
	}
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
	if c, _ := w.g.AskedOf(ctx, ana); len(c) != 0 {
		t.Fatalf("Bo's challenge still waits on Ana: %+v", c)
	}
	if _, err := w.g.ChallengeOf(ctx, code, ana); !errors.Is(err, ErrNoChallenge) {
		t.Fatalf("Ana sees Bo's challenge: %v", err)
	}
	if _, _, err := w.g.TakeChallenge(ctx, ana, code); !errors.Is(err, ErrNoChallenge) {
		t.Fatalf("Ana takes Bo's challenge: %v", err)
	}
	if _, _, err := w.g.ChallengeFriend(ctx, bo, ana); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("Bo challenges Ana: %v", err)
	}
	// Bo asks again, by tag and by her link: told it went, and nothing reaches Ana.
	if sent, err := w.g.Request(ctx, bo, tag(ana), false); err != nil || sent.New || sent.Friends {
		t.Fatalf("Bo's request: %+v %v", sent, err)
	}
	link, _ := w.g.InviteCode(ctx, ana)
	if _, _, sent, err := w.g.AskByInvite(ctx, bo, link); err != nil || sent.New || sent.Friends {
		t.Fatalf("Bo by Ana's link: %+v %v", sent, err)
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
