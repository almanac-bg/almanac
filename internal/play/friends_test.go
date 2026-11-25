package play

import (
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// The dot on Приятели is news since the player last looked there (owner, 2026-11-21): a friend request, a duel sent
// to them, a result of one of their duels, each arriving after the look; and it's off after a look, whatever still
// waits there. Each case on its own, in a world of its own.
func TestFriendsNews(t *testing.T) {
	// news says whether the player has news; looks keeps that they've looked at Приятели, a minute on.
	news := func(w *world, user int64) bool {
		t.Helper()
		n, err := w.g.FriendsNews(t.Context(), user)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	looks := func(w *world, user int64) {
		t.Helper()
		if err := w.g.SawFriends(t.Context(), user); err != nil {
			t.Fatal(err)
		}
		w.wait(time.Minute)
	}
	// sent is a duel ana played first and sent bo, each having looked at Приятели just before.
	sent := func(w *world) (ana, bo, id int64) {
		t.Helper()
		ana, bo = w.user(), w.user()
		w.befriend(ana, bo)
		looks(w, ana)
		looks(w, bo)
		id, err := w.g.DuelFriend(t.Context(), ana, bo)
		if err != nil {
			t.Fatal(err)
		}
		w.playSide(ana, id, repeat(w.right, Length))
		return ana, bo, id
	}

	t.Run("nothing", func(t *testing.T) {
		w := setup(t)
		ana := w.user()
		if news(w, ana) {
			t.Fatal("news for a new player")
		}
		if news(w, 999_999) {
			t.Fatal("news for nobody")
		}
	})

	t.Run("a request", func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		looks(w, ana)
		if _, err := w.g.Request(t.Context(), bo, "player1", false); err != nil {
			t.Fatal(err)
		}
		if !news(w, ana) {
			t.Fatal("no news of a friend request")
		}
		if news(w, bo) {
			t.Fatal("news for the one who asked")
		}
		looks(w, ana)
		if news(w, ana) {
			t.Fatal("news after a look, the request still waiting")
		}
	})

	t.Run("a request called off", func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		looks(w, ana)
		if _, err := w.g.Request(t.Context(), bo, "player1", false); err != nil {
			t.Fatal(err)
		}
		_, out, _ := w.g.Requests(t.Context(), bo)
		if err := w.g.Withdraw(t.Context(), bo, out[0].ID); err != nil {
			t.Fatal(err)
		}
		if news(w, ana) {
			t.Fatal("news of a request called off")
		}
	})

	t.Run("a request by email said no to", func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		if _, err := w.db.Write.Exec(`UPDATE users SET email = 'ana@example.com' WHERE id = ?`, ana); err != nil {
			t.Fatal(err)
		}
		if _, err := w.g.Request(t.Context(), bo, "ana@example.com", true); err != nil {
			t.Fatal(err)
		}
		if !news(w, ana) {
			t.Fatal("no news of a request by email")
		}
		in, _, _ := w.g.Requests(t.Context(), ana)
		if err := w.g.Withdraw(t.Context(), ana, in[0].ID); err != nil {
			t.Fatal(err)
		}
		w.wait(time.Minute)
		if _, err := w.g.Request(t.Context(), bo, "ana@example.com", true); err != nil {
			t.Fatal(err)
		}
		if news(w, ana) {
			t.Fatal("news of a request said no to, asked again")
		}
	})

	t.Run("a duel sent", func(t *testing.T) {
		w := setup(t)
		ana, bo, _ := sent(w)
		if !news(w, bo) {
			t.Fatal("no news of a duel sent")
		}
		if news(w, ana) {
			t.Fatal("news for the one who sent it")
		}
		looks(w, bo)
		if news(w, bo) {
			t.Fatal("news after a look, the duel still to play")
		}
	})

	t.Run("a duel not sent yet", func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		w.befriend(ana, bo)
		looks(w, bo)
		id, err := w.g.DuelFriend(t.Context(), ana, bo)
		if err != nil {
			t.Fatal(err)
		}
		w.playSide(ana, id, repeat(w.right, 3))
		if news(w, bo) {
			t.Fatal("news of a duel the friend is still playing first")
		}
	})

	t.Run("a result", func(t *testing.T) {
		w := setup(t)
		ana, bo, id := sent(w)
		looks(w, ana)
		if news(w, ana) {
			t.Fatal("news before the result")
		}
		w.playSide(bo, id, repeat(w.wrong, Length))
		if !news(w, ana) {
			t.Fatal("no news of the friend's result")
		}
		if news(w, bo) {
			t.Fatal("news for the one who played it back")
		}
		looks(w, ana)
		if news(w, ana) {
			t.Fatal("news after a look at the result")
		}
	})

	t.Run("a duel begun", func(t *testing.T) {
		w := setup(t)
		_, bo, id := sent(w)
		w.playSide(bo, id, repeat(w.right, 2))
		if news(w, bo) {
			t.Fatal("news of a duel the player has begun")
		}
	})

	t.Run("a duel lapsed", func(t *testing.T) {
		w := setup(t)
		ana, bo, _ := sent(w)
		looks(w, ana)
		looks(w, bo)
		w.wait(DuelFor + time.Minute)
		if err := w.g.SettleDue(t.Context()); err != nil {
			t.Fatal(err)
		}
		w.g.AftersDone(t.Context())
		if !news(w, ana) {
			t.Fatal("no news for the sender of a duel run out of time")
		}
		if !news(w, bo) {
			t.Fatal("no news for the friend of a duel run out of time")
		}
		looks(w, ana)
		looks(w, bo)
		if news(w, ana) || news(w, bo) {
			t.Fatal("news after a look at the lapsed duel")
		}
	})

}

// Beside each of the day's questions gone over, how the player's friends did with it (FriendsOn): every friend who
// finished the run's day, best first as the friends' board has them, past the board's first rows too; never a
// stranger, a game played at a script's speed, or anything before the player has finished; on the run's own day.
func TestFriendsOnTheDaysQuestions(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.at(15, 20, 0, 0)
	ana, stranger, bot := w.user(), w.user(), w.user()
	// More friends than the board shows the squares of, each with a few right: the i-th gets the first i%(Length+1).
	friends := make([]int64, BoardTop+3)
	for i := range friends {
		friends[i] = w.user()
		w.befriend(ana, friends[i])
		k := i % (Length + 1)
		w.dayGame(friends[i], nil, append(repeat(w.right, k), repeat(w.wrong, Length-k)...)...)
	}
	w.befriend(ana, bot)
	w.dayGame(bot, scriptPace)
	w.dayGame(stranger, nil)

	// Before Ana has finished (she plays just before midnight): nothing of anyone's.
	w.at(15, 23, 55, 0)
	s, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.FriendsOn(ctx, ana, s.ID); !errors.Is(err, ErrOutOfStep) {
		t.Fatalf("before the day is finished: %v", err)
	}
	w.play(ana, s.ID, repeat(w.wrong, Length)...)
	// Nobody else's game.
	if _, err := w.g.FriendsOn(ctx, stranger, s.ID); !errors.Is(err, ErrNoRun) {
		t.Fatalf("another's game: %v", err)
	}

	on, err := w.g.FriendsOn(ctx, ana, s.ID)
	if err != nil {
		t.Fatal(err)
	}
	board, err := w.g.FriendsBoard(ctx, w.g.Today(), ana)
	if err != nil {
		t.Fatal(err)
	}
	// Every friend who finished, the script's and the stranger's games left out, in the board's order.
	if len(on) != len(friends) {
		t.Fatalf("%d friends beside the questions, want %d", len(on), len(friends))
	}
	var order []Score
	for _, s := range board {
		if !s.Me {
			order = append(order, s)
		}
	}
	for i, f := range on {
		if f.Name != order[i].Name {
			t.Fatalf("friend %d is %q, the board has %q", i, f.Name, order[i].Name)
		}
		if len(f.Marks) != Length || strings.Trim(f.Marks, "01") != "" || f.Avatar == "" {
			t.Fatalf("friend %d: %+v", i, f)
		}
		// Each one's marks as they played: right answers first, as many as their score.
		k := strings.Count(f.Marks, "1")
		if f.Marks != strings.Repeat("1", k)+strings.Repeat("0", Length-k) || k != order[i].Rights {
			t.Fatalf("friend %d's marks %q", i, f.Marks)
		}
	}
	if on[len(on)-1].Marks != strings.Repeat("0", Length) {
		t.Fatalf("the last friend's marks: %q", on[len(on)-1].Marks)
	}

	// Past midnight, the game is still gone over beside its own day's friends, not today's (where none played).
	w.at(16, 0, 1, 0)
	if again, err := w.g.FriendsOn(ctx, ana, s.ID); err != nil || len(again) != len(friends) {
		t.Fatalf("just after midnight: %d %v", len(again), err)
	}
	// The next day, as the questions themselves, not at all.
	w.at(16, 12, 0, 0)
	if _, err := w.g.FriendsOn(ctx, ana, s.ID); !errors.Is(err, ErrReviewOver) {
		t.Fatalf("the day after: %v", err)
	}
	// A chapter's game: nobody beside its questions.
	chapter, err := w.g.StartChapter(ctx, ana, "history")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, chapter.ID, repeat(w.right, len(w.picks(chapter.ID)))...)
	if on, err := w.g.FriendsOn(ctx, ana, chapter.ID); err != nil || len(on) != 0 {
		t.Fatalf("a chapter's game: %+v %v", on, err)
	}
}

// A request said yes to as its sender calls it off: one of the two wins, never both (audit 2026-11-24, C-17: the yes
// read the request outside the write, so a withdrawn one still made the two friends).
func TestAcceptAsTheRequestIsWithdrawn(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	var tag string
	for range 30 {
		ana, bo := w.user(), w.user()
		if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, bo).Scan(&tag); err != nil {
			t.Fatal(err)
		}
		if _, err := w.g.Request(ctx, ana, tag, false); err != nil {
			t.Fatal(err)
		}
		var id int64
		if err := w.db.Read.QueryRow(`SELECT id FROM friend_requests WHERE from_id = ?`, ana).Scan(&id); err != nil {
			t.Fatal(err)
		}
		var accepted, withdrawn error
		var wg sync.WaitGroup
		wg.Go(func() { _, accepted = w.g.Accept(ctx, bo, id) })
		wg.Go(func() { withdrawn = w.g.Withdraw(ctx, ana, id) })
		wg.Wait()
		_, notFriends := w.g.Friend(ctx, ana, bo)
		switch {
		case accepted == nil && withdrawn == nil:
			t.Fatal("a request both said yes to and called off")
		case accepted == nil && notFriends != nil, accepted != nil && notFriends == nil:
			t.Fatalf("said yes: %v; friends: %v", accepted, notFriends)
		case accepted != nil && !errors.Is(accepted, ErrNoRequest), withdrawn != nil && !errors.Is(withdrawn, ErrNoRequest):
			t.Fatalf("yes: %v; called off: %v", accepted, withdrawn)
		}
	}
}

// Requests made at the same moment to someone with one place left take one place: the cap on what waits for one
// player is counted in the write that makes the request, not before it (#751 had it in the server, outside it).
func TestWaitingCappedAtOnce(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	var tag string
	if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, ana).Scan(&tag); err != nil {
		t.Fatal(err)
	}
	for range MaxWaiting - 1 {
		if _, err := w.g.Request(ctx, w.user(), tag, false); err != nil {
			t.Fatal(err)
		}
	}
	askers := make([]int64, 8)
	for i := range askers {
		askers[i] = w.user()
	}
	errs := make([]error, len(askers))
	var wg sync.WaitGroup
	for i, from := range askers {
		wg.Go(func() { _, errs[i] = w.g.Request(ctx, from, tag, false) })
	}
	wg.Wait()
	sent := 0
	for _, err := range errs {
		switch {
		case err == nil:
			sent++
		case !errors.Is(err, ErrManyWaiting):
			t.Fatal(err)
		}
	}
	if n := w.requestsIn(ana); sent != 1 || n != MaxWaiting {
		t.Fatalf("%d of %d asking at once sent, %d waiting; want 1 and %d", sent, len(askers), n, MaxWaiting)
	}
	// Asked again, one waiting already isn't refused.
	if _, err := w.g.Request(ctx, askers[slices.IndexFunc(errs, func(err error) bool { return err == nil })], tag, false); err != nil {
		t.Fatalf("asking again, the list full: %v", err)
	}
}

// Two players asking each other at the same moment are friends, as when one asked first: never each left with a
// request in and one out (bug hunt 2026-11-23: 1 race in 6, the check that the other asked was outside the write).
func TestFriendsAskingAtOnce(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	tag := func(id int64) string {
		var s string
		if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, id).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	for range 20 {
		ana, bo := w.user(), w.user()
		var wg sync.WaitGroup
		for _, p := range [][2]int64{{ana, bo}, {bo, ana}} {
			to := tag(p[1])
			wg.Go(func() {
				if _, err := w.g.Request(ctx, p[0], to, false); err != nil {
					t.Error(err)
				}
			})
		}
		wg.Wait()
		if _, err := w.g.Friend(ctx, ana, bo); err != nil {
			t.Fatalf("asked each other at once, and not friends: %v", err)
		}
		if n := w.count(`SELECT count(*) FROM friend_requests WHERE from_id IN (?1, ?2)`, ana, bo); n != 0 {
			t.Fatalf("%d requests left between friends", n)
		}
	}
}

// The one who asked hears once that the other said yes to their request: not the one who said yes, nor once it's old
// news; and again after the two parted and became friends again.
func TestAccepted(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy, di := w.user(), w.user(), w.user(), w.user()

	// Bo says yes to Ana: Ana hears of it, Bo doesn't.
	w.befriend(ana, bo)
	a, err := w.g.AcceptedOf(ctx, ana)
	if err != nil || a == nil || a.ID != bo {
		t.Fatalf("Ana: %+v (%v)", a, err)
	}
	if a, _ := w.g.AcceptedOf(ctx, bo); a != nil {
		t.Fatalf("Bo said yes, he isn't told: %+v", a)
	}
	if err := w.g.ToldAccepted(ctx, ana, bo); err != nil {
		t.Fatal(err)
	}
	if a, _ := w.g.AcceptedOf(ctx, ana); a != nil {
		t.Fatalf("told twice: %+v", a)
	}

	// Cy asks Ana by her tag, and she says yes: Cy hears of it.
	if _, err := w.g.Request(ctx, cy, "player1", false); err != nil {
		t.Fatal(err)
	}
	in, _, err := w.g.Requests(ctx, ana)
	if err != nil || len(in) != 1 {
		t.Fatalf("Ana's requests: %+v (%v)", in, err)
	}
	if _, err := w.g.Accept(ctx, ana, in[0].ID); err != nil {
		t.Fatal(err)
	}
	if a, _ := w.g.AcceptedOf(ctx, cy); a == nil || a.ID != ana {
		t.Fatalf("Cy: %+v", a)
	}
	if a, _ := w.g.AcceptedOf(ctx, ana); a != nil {
		t.Fatalf("Ana said yes to Cy: %+v", a)
	}

	// Ana and Bo part, and Bo says yes to her again: she hears of it again.
	if err := w.g.Unfriend(ctx, bo, ana); err != nil {
		t.Fatal(err)
	}
	w.wait(time.Minute)
	w.befriend(ana, bo)
	if a, _ := w.g.AcceptedOf(ctx, ana); a == nil || a.ID != bo {
		t.Fatalf("Ana, friends again: %+v", a)
	}

	// Di says yes to Bo; a week later it's old news.
	w.befriend(bo, di)
	w.wait(AcceptedRecent + time.Hour)
	if a, _ := w.g.AcceptedOf(ctx, bo); a != nil {
		t.Fatalf("old news: %+v", a)
	}

	// Told of someone not a friend: nothing to keep.
	if err := w.g.ToldAccepted(ctx, ana, w.user()); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("a stranger: %v", err)
	}
}
