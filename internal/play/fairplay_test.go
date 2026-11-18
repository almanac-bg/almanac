package play

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Fair play by network, by newcomers, and in a pair's challenge (review 2026-11-18, S4, S18, S20).

// netDay is a player's day's ten, played from a network (fair.go, FromNet): all right, or all wrong.
func (w *world) netDay(user int64, net string, right bool) int64 {
	w.t.Helper()
	s, err := w.g.StartDay(FromNet(w.t.Context(), user, []byte(net)), user)
	if err != nil {
		w.t.Fatal(err)
	}
	answer := w.wrong
	if right {
		answer = w.right
	}
	w.play(user, s.ID, repeat(answer, Length)...)
	return s.ID
}

// fresh makes a guest made just now (a throwaway one, if it plays only the day).
func (w *world) fresh() int64 {
	id := w.user()
	w.since(id, 0)
	return id
}

// The day played as throwaway guests from one network before a player plays it there: the guests' days leave the
// others' boards, the player's is a signal for /admin, never a shadow. A guest who comes back is let out; a crowd
// (a class) and a single guest are left alone; so are guests who play after the player.
func TestThrowawayGuestsBeforeAPlayer(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	day := w.g.Today()
	owner := w.user() // an account from before today
	if _, err := w.db.Write.Exec(`UPDATE users SET email = 'ana@example.com' WHERE id = ?`, owner); err != nil {
		t.Fatal(err)
	}
	scout, second := w.fresh(), w.fresh()
	a := w.netDay(scout, "home", false)
	w.wait(time.Minute)
	b := w.netDay(second, "home", false)
	w.wait(time.Minute)
	mine := w.netDay(owner, "home", true)
	other := w.user() // someone elsewhere, to see the board as others do
	w.netDay(other, "away", true)

	n, err := w.g.JudgeNets(ctx)
	if err != nil || n != 1 {
		t.Fatalf("signals: %d %v", n, err)
	}
	if w.shadow(a) != ShadowThrowaway || w.shadow(b) != ShadowThrowaway || w.shadow(mine) != 0 {
		t.Fatalf("shadows: scout %d, second %d, the player %d", w.shadow(a), w.shadow(b), w.shadow(mine))
	}
	if board, err := w.g.BoardOf(ctx, day, other); err != nil || board.Players != 2 {
		t.Fatalf("the board as others see it: %+v %v", board, err)
	}
	if board, err := w.g.BoardOf(ctx, day, scout); err != nil || board.Mine == nil {
		t.Fatalf("the board as the guest sees it: %+v %v", board, err)
	}
	signals, err := w.g.FairSignals(ctx, 10)
	if err != nil || len(signals) != 1 || signals[0].Guests != 2 || signals[0].Best != 0 || signals[0].Rights != Length ||
		signals[0].Shadow || signals[0].Day != day {
		t.Fatalf("the signal: %+v %v", signals, err)
	}
	if n, _ := w.g.JudgeNets(ctx); n != 0 {
		t.Fatalf("told again: %d", n)
	}

	// The scout comes back and plays a topic: a player now, out of the shadow; the second guest alone is no pattern.
	s, err := w.g.StartTopic(ctx, scout, "")
	if err != nil {
		t.Fatal(err)
	}
	w.play(scout, s.ID, repeat(w.wrong, Length)...)
	if _, err := w.g.JudgeNets(ctx); err != nil {
		t.Fatal(err)
	}
	if w.shadow(a) != 0 || w.shadow(b) != ShadowThrowaway {
		t.Fatalf("after the scout came back: %d, %d", w.shadow(a), w.shadow(b))
	}

	// A class: more than ThrowawayMost new guests on the school's network, then the teacher. Nobody is touched.
	teacher := w.user()
	var class []int64
	for range ThrowawayMost + 1 {
		class = append(class, w.netDay(w.fresh(), "school", false))
	}
	w.wait(time.Minute)
	w.netDay(teacher, "school", true)
	// One guest on a friend's wifi, then the friend; and two guests who play after the player who lives there.
	w.netDay(w.fresh(), "visit", false)
	w.netDay(w.user(), "visit", true)
	w.netDay(w.user(), "flat", true)
	w.wait(time.Minute)
	later := []int64{w.netDay(w.fresh(), "flat", false), w.netDay(w.fresh(), "flat", false)}
	if n, err := w.g.JudgeNets(ctx); err != nil || n != 0 {
		t.Fatalf("signals for ordinary play: %d %v", n, err)
	}
	for _, run := range append(class, later...) {
		if w.shadow(run) != 0 {
			t.Fatalf("an ordinary guest's day is a shadow: run %d", run)
		}
	}

	// A throwaway guest's day brought into an account that hasn't played it (signing in from the guest) is the
	// account's shadow (ShadowGuest), not let out as a guest's who came back.
	elsewhere := w.user()
	w.fold(second, elsewhere)
	if _, err := w.g.JudgeNets(ctx); err != nil {
		t.Fatal(err)
	}
	if w.shadow(b) != ShadowGuest {
		t.Fatalf("folded: %d", w.shadow(b))
	}

	// The networks go after NetsKept.
	w.wait(NetsKept + time.Hour)
	if _, err := w.g.JudgeNets(ctx); err != nil {
		t.Fatal(err)
	}
	if n := w.count(`SELECT count(*) FROM run_nets`); n != 0 {
		t.Fatalf("%d networks kept past their time", n)
	}
}

// A pair's challenge is held for the friend it was drawn for: nobody else takes it, by its link or sent to them,
// until the friend has played it or said no. Then anyone may; and if anyone did before the friend's game (sent to
// them again), that game moves no rating (S18).
func TestPairChallengeHeldForTheFriend(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy, di := w.user(), w.user(), w.user(), w.user()
	w.befriend(ana, bo)
	w.befriend(ana, di)
	as, duel, err := w.g.ChallengeFriend(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, as.ID, append(repeat(w.right, Length/2), repeat(w.wrong, Length-Length/2)...)...)
	code := w.code(duel)
	if v, err := w.g.ChallengeOf(ctx, code, cy); err != nil || !v.Held {
		t.Fatalf("as a stranger sees it: %+v %v", v, err)
	}
	if v, err := w.g.ChallengeOf(ctx, code, 0); err != nil || !v.Held {
		t.Fatalf("as nobody signed in sees it: %+v %v", v, err)
	}
	if v, err := w.g.ChallengeOf(ctx, code, bo); err != nil || v.Held || v.Duel != duel {
		t.Fatalf("as the friend sees it: %+v %v", v, err)
	}
	if _, _, err := w.g.TakeChallenge(ctx, cy, code); !errors.Is(err, ErrChallengeHeld) {
		t.Fatalf("a stranger took it: %v", err)
	}
	if _, sent, err := w.g.Challenge(ctx, ana, as.ID, []int64{di}); err != nil || len(sent) != 0 {
		t.Fatalf("sent on to another friend while held: %v %v", sent, err)
	}

	// Bo says no: anyone may take it now. Cy does, and plays it.
	if err := w.g.Decline(ctx, bo, duel); err != nil {
		t.Fatal(err)
	}
	cs, _, err := w.g.TakeChallenge(ctx, cy, code)
	if err != nil {
		t.Fatalf("after Bo said no: %v", err)
	}
	w.play(cy, cs.ID, repeat(w.right, Length)...)

	// Sent to Bo again, it's held for him again (not from Cy, who has his game); he plays it, and it moves no rating:
	// Cy could have told him every answer.
	if _, sent, err := w.g.Challenge(ctx, ana, as.ID, []int64{bo}); err != nil || len(sent) != 1 {
		t.Fatalf("sent again: %v %v", sent, err)
	}
	if v, _ := w.g.ChallengeOf(ctx, code, di); !v.Held {
		t.Fatal("not held again")
	}
	if v, _ := w.g.ChallengeOf(ctx, code, cy); v.Held || v.Duel == 0 {
		t.Fatalf("held from Cy, who played it: %+v", v)
	}
	bs, err := w.take(bo, duel)
	if err != nil {
		t.Fatal(err)
	}
	w.play(bo, bs.ID, repeat(w.right, Length)...)
	d, err := w.g.DuelOf(ctx, bo, duel)
	if err != nil || d.State != "won" || !d.Friendly || d.Unrated != "known" || d.Rating != nil {
		t.Fatalf("Bo's game after Cy's: %+v %v", d, err)
	}

	// A pair's challenge the friend plays first moves ratings, and is anyone's after.
	w.wait(24 * time.Hour)
	as, duel, err = w.g.ChallengeFriend(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, as.ID, repeat(w.wrong, Length)...)
	bs, err = w.take(bo, duel)
	if err != nil {
		t.Fatal(err)
	}
	w.play(bo, bs.ID, repeat(w.right, Length)...)
	if d, err := w.g.DuelOf(ctx, bo, duel); err != nil || d.Friendly || d.Rating == nil {
		t.Fatalf("Bo's game, first: %+v %v", d, err)
	}
	if _, _, err := w.g.TakeChallenge(ctx, cy, w.code(duel)); err != nil {
		t.Fatalf("after Bo played: %v", err)
	}
}

// pairDuel is a challenge between two friends, a's from netA and b's from netB ("": none), b winning it: b's duel.
func (w *world) pairDuel(a, b int64, netA, netB string) DuelView {
	w.t.Helper()
	ctx := w.t.Context()
	as, duel, err := w.g.ChallengeFriend(FromNet(ctx, a, []byte(netA)), a, b)
	if err != nil {
		w.t.Fatal(err)
	}
	w.play(a, as.ID, repeat(w.wrong, Length)...)
	bs, _, err := w.g.TakeChallenge(FromNet(ctx, b, []byte(netB)), b, w.code(duel))
	if err != nil {
		w.t.Fatal(err)
	}
	w.play(b, bs.ID, repeat(w.right, Length)...)
	d, err := w.g.DuelOf(ctx, b, duel)
	if err != nil {
		w.t.Fatal(err)
	}
	return d
}

// Two who play from one network move no rating between them, and are told why; from two networks, they do. A
// network a day old no longer joins them (S20).
func TestNoRatingFromOneNetwork(t *testing.T) {
	w := setup(t)
	ana, bo := w.user(), w.user()
	w.befriend(ana, bo)
	var told []DuelNews
	w.g.DuelNews = func(_ context.Context, n DuelNews) {
		if n.Kind == "result" {
			told = append(told, n)
		}
	}
	d := w.pairDuel(ana, bo, "home", "home")
	if !d.Friendly || d.Unrated != "network" || d.Rating != nil || w.count(`SELECT rating FROM users WHERE id = ?`, bo) != StartRating {
		t.Fatalf("from one network: %+v", d)
	}
	if len(told) != 2 || told[0].Unrated != "network" || !told[0].Friendly {
		t.Fatalf("told: %+v", told)
	}
	// The next day, Bo from his phone's network: the home network of yesterday is past SameNetFor.
	w.wait(SameNetFor + time.Hour)
	if d := w.pairDuel(ana, bo, "home", "phone"); d.Friendly || d.Rating == nil {
		t.Fatalf("from two networks: %+v", d)
	}
	// Ana's game from home, Bo's from his phone, but Bo played at home the same day: one network still.
	w.wait(SameNetFor + time.Hour)
	w.netDay(bo, "home", true)
	if d := w.pairDuel(ana, bo, "home", "phone"); !d.Friendly || d.Unrated != "network" {
		t.Fatalf("Bo at home earlier today: %+v", d)
	}
}

// Against a new player, an established one's rating moves half as far, NewcomersRatedPerDay times a day; the new
// one's as any (S20).
func TestNewcomersMoveRatingLess(t *testing.T) {
	w := setup(t)
	ana := w.user()
	if _, err := w.db.Write.Exec(`UPDATE users SET rated = 30 WHERE id = ?`, ana); err != nil {
		t.Fatal(err)
	}
	rating := func(id int64) int { return w.count(`SELECT rating FROM users WHERE id = ?`, id) }
	for i := range NewcomersRatedPerDay + 1 {
		alt := w.user()
		w.befriend(ana, alt)
		before := rating(ana)
		d := w.pairDuel(alt, ana, "", "")
		if i == NewcomersRatedPerDay {
			if !d.Friendly || d.Unrated != "newcomers" || rating(ana) != before {
				t.Fatalf("past the day's duels against new players: %+v", d)
			}
			break
		}
		if d.Friendly || d.Delta != eloDelta(before, StartRating, 30, 1)/2 {
			t.Fatalf("against a new player, duel %d: %+v (from %d)", i, d, before)
		}
		if lost := StartRating - rating(alt); lost != -eloDelta(StartRating, before, 0, 0) {
			t.Fatalf("the new player lost %d", lost)
		}
	}
	// An account three days old with ten rated duels is no newcomer.
	vet := w.user()
	if _, err := w.db.Write.Exec(`UPDATE users SET rated = 10 WHERE id = ?`, vet); err != nil {
		t.Fatal(err)
	}
	w.since(vet, NewcomerFor+time.Hour)
	w.befriend(ana, vet)
	before := rating(ana)
	if d := w.pairDuel(vet, ana, "", ""); d.Friendly || d.Delta != eloDelta(before, StartRating, 30, 1) {
		t.Fatalf("against an established player: %+v (from %d)", d, before)
	}
	// One made today is new, however many rated duels it has had.
	young := w.user()
	w.since(young, time.Hour)
	if !w.g.Newcomer(50, int64(w.count(`SELECT created_at FROM users WHERE id = ?`, young))) || w.g.Newcomer(10, 0) {
		t.Fatal("Newcomer")
	}
}

// A guest signing in brings their rating only to an account that has none: never a higher one over the account's
// own, which a guest pumped up on throwaway guests would otherwise give any account (S20).
func TestMergeKeepsTheAccountsRating(t *testing.T) {
	w := setup(t)
	account, guest := w.user(), w.user()
	if _, err := w.db.Write.Exec(`UPDATE users SET rating = CASE id WHEN ?1 THEN 1050 ELSE 1500 END,
		rated = CASE id WHEN ?1 THEN 12 ELSE 40 END, peak = CASE id WHEN ?1 THEN 1080 ELSE 1550 END
		WHERE id IN (?1, ?2)`, account, guest); err != nil {
		t.Fatal(err)
	}
	w.fold(guest, account)
	if r, n, p := w.count(`SELECT rating FROM users WHERE id = ?`, account), w.count(`SELECT rated FROM users WHERE id = ?`, account),
		w.count(`SELECT peak FROM users WHERE id = ?`, account); r != 1050 || n != 12 || p != 1080 {
		t.Fatalf("the account's rating: %d of %d, peak %d", r, n, p)
	}
	// An account with no rating of its own takes the guest's: the player's only one.
	fresh, played := w.user(), w.user()
	if _, err := w.db.Write.Exec(`UPDATE users SET rating = 1200, rated = 15, peak = 1210 WHERE id = ?`, played); err != nil {
		t.Fatal(err)
	}
	w.fold(played, fresh)
	if r, p := w.count(`SELECT rating FROM users WHERE id = ?`, fresh), w.count(`SELECT peak FROM users WHERE id = ?`, fresh); r != 1200 || p != 1210 {
		t.Fatalf("an unrated account's rating: %d, peak %d", r, p)
	}
}
