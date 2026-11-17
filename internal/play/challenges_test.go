package play

import (
	"context"
	"errors"
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
	if _, err := w.g.Challenge(ctx, ana, s.ID); !errors.Is(err, ErrNoChallengeRun) {
		t.Fatalf("a game under way: %v", err)
	}
	half := append(repeat(w.right, Length/2), repeat(w.wrong, Length/2)...)
	w.play(ana, s.ID, half...)
	if _, err := w.g.Challenge(ctx, bo, s.ID); !errors.Is(err, ErrNoChallengeRun) {
		t.Fatalf("someone else's game: %v", err)
	}
	code, err := w.g.Challenge(ctx, ana, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := w.g.Challenge(ctx, ana, s.ID); again != code {
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

	// A week on, it's over: Di can't take it; Bo still sees his result.
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
	if again, _ := w.g.Challenge(ctx, ana, s.ID); again != code {
		t.Fatal("a new code")
	}
	if _, _, err := w.g.TakeChallenge(ctx, di, code); err != nil {
		t.Fatalf("sent again: %v", err)
	}
	if _, err := w.g.ChallengeOf(ctx, "nothing1", 0); !errors.Is(err, ErrNoChallenge) {
		t.Fatalf("no such: %v", err)
	}
}

// A friend's duel is sent by its challenger's game: its link brings the friend to their duel, anyone else to a
// challenge.
func TestFriendDuelLink(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, vi, cy := w.user(), w.user(), w.user()
	w.befriend(ana, vi)
	s, id, err := w.g.ChallengeFriend(ctx, ana, vi)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, repeat(w.right, Length)...)
	code, err := w.g.Challenge(ctx, ana, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v, _ := w.g.ChallengeOf(ctx, code, vi); v.Duel != id {
		t.Fatalf("Vi opens it: %+v", v)
	}
	if st, d, err := w.g.TakeChallenge(ctx, vi, code); err != nil || d != id || st.ID != 0 {
		t.Fatalf("Vi takes it: %d %v", d, err)
	}
	if _, d, err := w.g.TakeChallenge(ctx, cy, code); err != nil || d == id || d == 0 {
		t.Fatalf("Cy takes it: %d %v", d, err)
	}
	// Taking challenges never counts against the challenges one may have waiting on friends.
	if n, _ := w.g.Challenges(ctx, vi); len(n) != 1 {
		t.Fatalf("Vi's turn: %+v", n)
	}
}
