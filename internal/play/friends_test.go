package play

import (
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

	t.Run("against a recording", func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		s, err := w.g.StartTopic(t.Context(), ana, "history")
		if err != nil {
			t.Fatal(err)
		}
		w.play(ana, s.ID, repeat(w.right, Length)...)
		w.wait(time.Minute)
		looks(w, ana)
		looks(w, bo)
		id, err := w.g.DuelRecording(t.Context(), bo, Even)
		if err != nil {
			t.Fatal(err)
		}
		w.playSide(bo, id, repeat(w.right, Length))
		if news(w, bo) || news(w, ana) {
			t.Fatal("news of a duel against a recording")
		}
	})
}
