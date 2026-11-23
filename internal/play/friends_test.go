package play

import (
	"errors"
	"strings"
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
