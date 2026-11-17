package play

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"
	"time"
)

// One link, many takers: each plays the same ten against the sender's game, sees both, can't play it twice; no
// rating moves; the sender sees the takers, hears of them on Начало in one line, and by a push once a day at most;
// past its time it can't be taken.
func TestChallenges(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy, di := w.user(), w.user(), w.user(), w.user()
	var pushed []DuelNews
	w.g.DuelNews = func(_ context.Context, n DuelNews) {
		if n.Kind == "challenge" {
			pushed = append(pushed, n)
		}
	}

	// Ana's topic game: half right. A game not finished, or not hers, can't be a challenge.
	s, err := w.g.StartTopic(ctx, ana, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := w.g.Challenge(ctx, ana, s.ID, nil); !errors.Is(err, ErrNoChallengeRun) {
		t.Fatalf("a game under way: %v", err)
	}
	half := append(repeat(w.right, Length/2), repeat(w.wrong, Length/2)...)
	w.play(ana, s.ID, half...)
	if _, _, err := w.g.Challenge(ctx, bo, s.ID, nil); !errors.Is(err, ErrNoChallengeRun) {
		t.Fatalf("someone else's game: %v", err)
	}
	code, _, err := w.g.Challenge(ctx, ana, s.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if again, _, _ := w.g.Challenge(ctx, ana, s.ID, nil); again != code {
		t.Fatalf("a second link for the same game: %q, %q", again, code)
	}
	if _, _, err := w.g.TakeChallenge(ctx, ana, code); !errors.Is(err, ErrOwnChallenge) {
		t.Fatalf("Ana took her own: %v", err)
	}
	v, err := w.g.ChallengeOf(ctx, code, 0)
	if err != nil || v.By.Name == "" || v.Rights != Length/2 || v.Total != Length || v.Over || v.Own {
		t.Fatalf("as anyone sees it: %+v (%v)", v, err)
	}
	ratingOf := func(id int64) (r int) {
		_ = w.db.Read.QueryRow(`SELECT rating FROM users WHERE id = ?`, id).Scan(&r)
		return r
	}
	before := ratingOf(bo)

	// Bo takes it and gets every one right: he wins; the same questions as Ana's, in the same order.
	bs, duel, err := w.g.TakeChallenge(ctx, bo, code)
	if err != nil {
		t.Fatal(err)
	}
	if picks := w.picks(bs.ID); picks[0] != w.picks(s.ID)[0] || len(picks) != Length {
		t.Fatalf("other questions: %+v", picks)
	}
	if again, d2, _ := w.g.TakeChallenge(ctx, bo, code); d2 != duel || again.ID != bs.ID {
		t.Fatal("a second game of it")
	}
	w.play(bo, bs.ID, repeat(w.right, Length)...)
	d, err := w.g.DuelOf(ctx, bo, duel)
	if err != nil || d.Kind != "challenge" || d.Challenge != code || d.State != "won" || d.Recorded || d.Friendly ||
		d.Rating != nil || !d.Befriend || d.Opponent == nil || d.Opponent.Points == 0 {
		t.Fatalf("Bo's result: %+v (%v)", d, err)
	}
	if ratingOf(bo) != before {
		t.Fatal("a challenge moved the rating")
	}
	if v, _ := w.g.ChallengeOf(ctx, code, bo); v.Duel != duel {
		t.Fatalf("Bo opens it again: %+v", v)
	}
	if len(pushed) != 1 || pushed[0].To != ana || pushed[0].Outcome != "lost" || pushed[0].Code != code {
		t.Fatalf("Ana's push: %+v", pushed)
	}

	// Cy takes it the same day, all wrong: Ana wins this one, and isn't pushed again today.
	cs, _, err := w.g.TakeChallenge(ctx, cy, code)
	if err != nil {
		t.Fatal(err)
	}
	w.play(cy, cs.ID, repeat(w.wrong, Length)...)
	if len(pushed) != 1 {
		t.Fatalf("a second push the same day: %+v", pushed)
	}

	// Ana sees both on her link, and on Начало one line for the two of them, once.
	v, _ = w.g.ChallengeOf(ctx, code, ana)
	if !v.Own || len(v.Takers) != 2 || v.Takers[0].State != "won" || v.Takers[1].State != "lost" {
		t.Fatalf("Ana's takers: %+v", v.Takers)
	}
	n, err := w.g.ChallengeNewsOf(ctx, ana)
	if err != nil || n == nil || n.Played != 2 || n.Beat != 1 || n.Code != code {
		t.Fatalf("Ana's line: %+v (%v)", n, err)
	}
	if err := w.g.Told(ctx, ana, "challenges"); err != nil {
		t.Fatal(err)
	}
	if n, _ := w.g.ChallengeNewsOf(ctx, ana); n != nil {
		t.Fatalf("told twice: %+v", n)
	}
	// Recordings' news is of strangers' duels against a recording: not of these.
	if news, _ := w.g.DuelsOf(ctx, ana); len(news) != 0 {
		t.Fatalf("the takers' duels in Ana's list: %+v", news)
	}

	// Three days on, it's over: Di can't take it; Bo still sees his result.
	w.wait(ChallengeFor + time.Hour)
	if v, _ := w.g.ChallengeOf(ctx, code, di); !v.Over {
		t.Fatal("not over")
	}
	if _, _, err := w.g.TakeChallenge(ctx, di, code); !errors.Is(err, ErrChallengeOver) {
		t.Fatalf("taken past its time: %v", err)
	}
	if _, d2, err := w.g.TakeChallenge(ctx, bo, code); err != nil || d2 != duel {
		t.Fatalf("Bo's, past its time: %v", err)
	}
	// Sent again, it's open again.
	if again, _, _ := w.g.Challenge(ctx, ana, s.ID, nil); again != code {
		t.Fatal("a new code")
	}
	if _, _, err := w.g.TakeChallenge(ctx, di, code); err != nil {
		t.Fatalf("sent again: %v", err)
	}
	if _, err := w.g.ChallengeOf(ctx, "nothing1", 0); !errors.Is(err, ErrNoChallenge) {
		t.Fatalf("no such: %v", err)
	}
}

// A game played is sent to friends and by its link: the friends it's sent to are told and find it in the game; a friend
// who takes it, sent it or not, plays a duel between the two (in their record, its result told to both), never rated:
// the game was the sender's to choose; anyone else, a challenge as any (the line for strangers). Each plays it once;
// sent again to one whose turn ran out, it's theirs again.
func TestChallengeSentToFriends(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, vi, bo, di, cy := w.user(), w.user(), w.user(), w.user(), w.user()
	for _, f := range []int64{vi, bo, di} {
		w.befriend(ana, f)
	}
	var told []DuelNews
	w.g.DuelNews = func(_ context.Context, n DuelNews) { told = append(told, n) }
	s, err := w.g.StartTopic(ctx, ana, "")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, append(repeat(w.right, Length/2), repeat(w.wrong, Length/2)...)...)

	// Sent to Vi and Bo (Cy, not a friend, and Ana herself are left out): those two are told, at once.
	code, reached, err := w.g.Challenge(ctx, ana, s.ID, []int64{vi, bo, cy, ana, vi})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(reached, []int64{vi, bo}) && !slices.Equal(reached, []int64{bo, vi}) {
		t.Fatalf("reached: %v", reached)
	}
	asked := map[int64]int64{}
	for _, n := range told {
		if n.Kind == "asked" {
			asked[n.To] = n.DuelID
		}
	}
	if len(asked) != 2 || asked[vi] == 0 || asked[bo] == 0 {
		t.Fatalf("told: %+v", told)
	}
	if c, _ := w.g.AskedOf(ctx, vi); len(c) != 1 || c[0].ID != asked[vi] {
		t.Fatalf("Vi's: %+v", c)
	}
	if c, _ := w.g.AskedOf(ctx, cy); len(c) != 0 {
		t.Fatalf("Cy's: %+v", c)
	}
	// Sent again to Vi: nobody is told twice.
	told = nil
	if again, reached, _ := w.g.Challenge(ctx, ana, s.ID, []int64{vi}); again != code || len(told) != 0 || len(reached) != 0 {
		t.Fatalf("sent twice: %q %v %+v", again, reached, told)
	}

	// Vi opens the link: it's her duel of it, and her game the duel between the two.
	if v, _ := w.g.ChallengeOf(ctx, code, vi); v.Duel != asked[vi] {
		t.Fatalf("Vi's link: %+v", v)
	}
	vs, err := w.take(vi, asked[vi])
	if err != nil {
		t.Fatal(err)
	}
	w.play(vi, vs.ID, repeat(w.right, Length)...)
	if d, _ := w.g.DuelOf(ctx, vi, asked[vi]); d.State != "won" || d.Rating != nil || d.Delta != 0 || d.Friendly ||
		d.Friend != ana || d.Befriend {
		t.Fatalf("Vi's result: %+v", d)
	}

	// Di, a friend it wasn't sent to, takes it by the link: a duel between the two as well, not rated.
	ds, dd, err := w.g.TakeChallenge(ctx, di, code)
	if err != nil {
		t.Fatal(err)
	}
	w.play(di, ds.ID, repeat(w.wrong, Length)...)
	if d, _ := w.g.DuelOf(ctx, ana, dd); d.State != "won" || d.Rating != nil || d.Friend != di {
		t.Fatalf("Ana against Di: %+v", d)
	}

	// Cy, a stranger: no rating, no duel in Ana's list, and the line for anyone's.
	cs, cd, err := w.g.TakeChallenge(ctx, cy, code)
	if err != nil {
		t.Fatal(err)
	}
	w.play(cy, cs.ID, repeat(w.right, Length)...)
	if d, _ := w.g.DuelOf(ctx, cy, cd); d.State != "won" || d.Rating != nil || d.Friend != 0 || d.Friendly || !d.Befriend {
		t.Fatalf("Cy's result: %+v", d)
	}
	if _, err := w.g.DuelOf(ctx, ana, cd); !errors.Is(err, ErrNoDuel) {
		t.Fatalf("Cy's duel in Ana's: %v", err)
	}
	if n, _ := w.g.ChallengeNewsOf(ctx, ana); n == nil || n.Played != 1 || n.Beat != 1 {
		t.Fatalf("Ana's line: %+v", n)
	}
	// Ana's link: every taker but Bo, who hasn't started.
	if v, _ := w.g.ChallengeOf(ctx, code, ana); len(v.Takers) != 3 {
		t.Fatalf("Ana's takers: %+v", v.Takers)
	}
	// Her record: a loss to Vi, a win over Di; none against Cy, who isn't a friend.
	list, _ := w.g.FriendsOf(ctx, ana)
	rec := map[int64]Record{}
	for _, f := range list {
		rec[f.ID] = Record{Won: f.Won, Lost: f.Lost, Drawn: f.Drawn}
	}
	if rec[vi] != (Record{Lost: 1}) || rec[di] != (Record{Won: 1}) || rec[bo] != (Record{}) {
		t.Fatalf("Ana's records: %+v", rec)
	}
	if st, _ := w.g.StatsOf(ctx, ana); st.Duels != 2 || st.Won != 1 {
		t.Fatalf("Ana's stats: %+v", st)
	}

	// Bo's time is the challenge's: three days from when it was last sent; then it's over for him.
	w.wait(ChallengeFor + time.Minute)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	if d, _ := w.g.DuelOf(ctx, bo, asked[bo]); d.State != "expired" {
		t.Fatalf("Bo's, past its time: %+v", d)
	}
	if _, d, err := w.g.TakeChallenge(ctx, bo, code); err != nil || d != asked[bo] {
		t.Fatalf("Bo opens it after: %d %v", d, err)
	}
	// Sent to him again: his turn is open again, and he's told.
	told = nil
	if _, reached, err := w.g.Challenge(ctx, ana, s.ID, []int64{bo, vi}); err != nil || !slices.Equal(reached, []int64{bo}) {
		t.Fatalf("sent again: %v %v", reached, err)
	}
	if len(told) != 1 || told[0].To != bo || told[0].DuelID != asked[bo] {
		t.Fatalf("Bo told again: %+v", told)
	}
	if c, _ := w.g.AskedOf(ctx, bo); len(c) != 1 || c[0].ID != asked[bo] {
		t.Fatalf("Bo's again: %+v", c)
	}
	if rating := func() (r int) {
		_ = w.db.Read.QueryRow(`SELECT rated FROM users WHERE id = ?`, ana).Scan(&r)
		return r
	}(); rating != 0 {
		t.Fatalf("Ana's rated games: %d", rating)
	}
}

// At most MaxWaiting of a sender's challenges wait unstarted on one friend; a push tells of one only when none of the
// sender's waits on them already.
func TestChallengesWaitingOnAFriend(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, vi := w.user(), w.user()
	w.befriend(ana, vi)
	var pushed int
	w.g.DuelNews = func(_ context.Context, n DuelNews) {
		if n.Kind == "asked" {
			pushed++
		}
	}
	for i := range MaxWaiting {
		s, _, err := w.g.ChallengeFriend(ctx, ana, vi)
		if err != nil {
			t.Fatal(i, err)
		}
		w.play(ana, s.ID, repeat(w.right, Length)...)
	}
	if pushed != 1 {
		t.Fatalf("pushed %d times", pushed)
	}
	if c, _ := w.g.AskedOf(ctx, vi); len(c) != MaxWaiting {
		t.Fatalf("Vi's: %+v", c)
	}
	if _, _, err := w.g.ChallengeFriend(ctx, ana, vi); !errors.Is(err, ErrManyWaiting) {
		t.Fatalf("one too many: %v", err)
	}
	s, err := w.g.StartTopic(ctx, ana, "")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if _, reached, err := w.g.Challenge(ctx, ana, s.ID, []int64{vi}); err != nil || len(reached) != 0 {
		t.Fatalf("sent past the most: %v %v", reached, err)
	}
	// Vi plays one: room for one more, and still no second push while the others wait.
	c, _ := w.g.AskedOf(ctx, vi)
	vs, err := w.take(vi, c[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	w.play(vi, vs.ID, repeat(w.wrong, Length)...)
	if _, reached, _ := w.g.Challenge(ctx, ana, s.ID, []int64{vi}); len(reached) != 1 || pushed != 1 {
		t.Fatalf("after one played: %v, pushed %d", reached, pushed)
	}
}

// A guest's challenge is the account's once the guest signs in (Merge): its link still works, and the duels of those
// who took it stay theirs, though the guest is gone.
func TestChallengeKeptOverSignIn(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner, bo := w.user(), w.user(), w.user()
	s, err := w.g.StartTopic(ctx, guest, "")
	if err != nil {
		t.Fatal(err)
	}
	w.play(guest, s.ID, repeat(w.right, Length)...)
	code, _, err := w.g.Challenge(ctx, guest, s.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	bs, duel, err := w.g.TakeChallenge(ctx, bo, code)
	if err != nil {
		t.Fatal(err)
	}
	w.play(bo, bs.ID, repeat(w.wrong, Length)...)
	// Vi, a friend, sent the guest a challenge; Cy's the guest and the account have both taken.
	vi, cy := w.user(), w.user()
	w.befriend(vi, guest)
	vr, sent, err := w.g.ChallengeFriend(ctx, vi, guest)
	if err != nil {
		t.Fatal(err)
	}
	w.play(vi, vr.ID, repeat(w.right, Length)...)
	cr, err := w.g.StartTopic(ctx, cy, "")
	if err != nil {
		t.Fatal(err)
	}
	w.play(cy, cr.ID, repeat(w.right, Length)...)
	cyCode, _, _ := w.g.Challenge(ctx, cy, cr.ID, nil)
	_, theirs, _ := w.g.TakeChallenge(ctx, guest, cyCode)
	_, mine, _ := w.g.TakeChallenge(ctx, owner, cyCode)
	// The account took the guest's own challenge too: after, it would be the account's game of its own.
	os, self, err := w.g.TakeChallenge(ctx, owner, code)
	if err != nil {
		t.Fatal(err)
	}
	w.play(owner, os.ID, repeat(w.right, Length)...)
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, guest, owner) }); err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(`DELETE FROM users WHERE id = ?`, guest); err != nil { // as signing in does
		t.Fatal(err)
	}
	if v, err := w.g.ChallengeOf(ctx, code, owner); err != nil || !v.Own || len(v.Takers) != 1 {
		t.Fatalf("the account's challenge: %+v (%v)", v, err)
	}
	if _, err := w.g.DuelOf(ctx, owner, self); !errors.Is(err, ErrNoDuel) {
		t.Fatalf("a game of its own challenge kept: %v", err)
	}
	if st, _ := w.g.StatsOf(ctx, owner); st.Duels != 0 {
		t.Fatalf("a duel against itself counted: %+v", st)
	}
	if d, err := w.g.DuelOf(ctx, bo, duel); err != nil || d.State != "lost" {
		t.Fatalf("Bo's duel: %+v (%v)", d, err)
	}
	// Vi's waits for the account; of Cy's, the account keeps its own game, the guest's goes with the guest.
	if c, _ := w.g.AskedOf(ctx, owner); !slices.ContainsFunc(c, func(a Asked) bool { return a.ID == sent }) {
		t.Fatalf("the account's challenges: %+v", c)
	}
	if v, _ := w.g.ChallengeOf(ctx, cyCode, owner); v.Duel != mine {
		t.Fatalf("Cy's, the account's game: %d, not %d (the guest's %d)", v.Duel, mine, theirs)
	}
}
