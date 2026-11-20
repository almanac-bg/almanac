package play

import (
	"testing"
	"time"
)

// Fair play by network and by newcomers (review 2026-11-18, S4, S20).

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
	s, err := w.g.StartTopic(ctx, scout, MixTopic)
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

// pairDuel is a live duel between two players, a's from netA and b's from netB ("": none), b winning it: b's duel.
func (w *world) pairDuel(a, b int64, netA, netB string) DuelView {
	w.t.Helper()
	ctx := w.t.Context()
	l, err := w.g.StartLive(FromNet(FromNet(ctx, a, []byte(netA)), b, []byte(netB)), a, b)
	if err != nil {
		w.t.Fatal(err)
	}
	w.play(a, l.Runs[0], repeat(w.wrong, Length)...)
	w.play(b, l.Runs[1], repeat(w.right, Length)...)
	d, err := w.g.DuelOf(ctx, b, l.DuelID)
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
	d := w.pairDuel(ana, bo, "home", "home")
	if !d.Friendly || d.Unrated != "network" || d.Rating != nil || w.count(`SELECT rating FROM users WHERE id = ?`, bo) != StartRating {
		t.Fatalf("from one network: %+v", d)
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
		rated = CASE id WHEN ?1 THEN 12 ELSE 40 END WHERE id IN (?1, ?2)`, account, guest); err != nil {
		t.Fatal(err)
	}
	w.fold(guest, account)
	if r, n := w.count(`SELECT rating FROM users WHERE id = ?`, account), w.count(`SELECT rated FROM users WHERE id = ?`, account); r != 1050 || n != 12 {
		t.Fatalf("the account's rating: %d of %d", r, n)
	}
	// An account with no rating of its own takes the guest's: the player's only one.
	fresh, played := w.user(), w.user()
	if _, err := w.db.Write.Exec(`UPDATE users SET rating = 1200, rated = 15 WHERE id = ?`, played); err != nil {
		t.Fatal(err)
	}
	w.fold(played, fresh)
	if r := w.count(`SELECT rating FROM users WHERE id = ?`, fresh); r != 1200 {
		t.Fatalf("an unrated account's rating: %d", r)
	}
}
