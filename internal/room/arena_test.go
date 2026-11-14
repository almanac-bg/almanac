package room

import (
	"errors"
	"testing"
	"testing/synctest"
	"time"
)

func players(n int) []Player {
	out := make([]Player, n)
	for i := range out {
		out[i] = Player{ID: int64(i + 1), Name: "Играч"}
	}
	return out
}

func TestArenaFillsAtFive(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		var tickets []*Ticket
		for _, p := range players(ArenaMax + 1) {
			tk, err := hub.Enqueue(p)
			if err != nil {
				t.Fatal(err)
			}
			tickets = append(tickets, tk)
		}
		// The first five play at once; the sixth waits.
		code := tickets[0].Code()
		for _, tk := range tickets[:ArenaMax] {
			select {
			case <-tk.Done:
			default:
				t.Fatal("a full arena didn't start")
			}
			if tk.Code() != code {
				t.Fatalf("not one arena: %q %q", tk.Code(), code)
			}
		}
		if q := hub.Queue(); q.Waiting != 1 || q.StartsMs != 0 {
			t.Fatalf("the queue after: %+v", q)
		}
		r, _ := hub.Get(code)
		// Nobody else gets in, nobody leads, and it starts by itself.
		if err := r.Join(Player{ID: 99, Name: "Чужд"}); !errors.Is(err, ErrNoRoom) {
			t.Fatalf("a stranger in an arena: %v", err)
		}
		if err := r.Start(1); !errors.Is(err, ErrNotYours) {
			t.Fatalf("a player started an arena: %v", err)
		}
		if v := r.View(1); !v.Arena || v.Phase != Lobby || len(v.Players) != ArenaMax || v.StartsMs <= 0 {
			t.Fatalf("the arena's lobby: %+v", v)
		}
		// Coming back to the queue mid-game is coming back to the arena.
		again, _ := hub.Enqueue(Player{ID: 2, Name: "Играч"})
		if again.Code() != code {
			t.Fatalf("back in the queue mid-game: %q", again.Code())
		}
		time.Sleep(ArenaCountdown + time.Millisecond)
		synctest.Wait()
		if v := r.View(1); v.Phase != Question || v.N != 0 {
			t.Fatalf("the arena didn't start: %+v", v)
		}
		hub.Leave(tickets[ArenaMax])
		r.mu.Lock()
		r.close()
		r.mu.Unlock()
	})
}

func TestArenaOfThreeAfterAWait(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		var ended []Placed
		hub.OnArena = func(r *Room, p []Placed) {
			ended = p
			r.Settled(map[int64]int{1: 12, 2: -3, 3: -9})
		}
		ps := players(ArenaMin)
		a, _ := hub.Enqueue(ps[0])
		b, _ := hub.Enqueue(ps[1])
		if q := hub.Queue(); q.Waiting != 2 || q.StartsMs != 0 {
			t.Fatalf("two waiting: %+v", q)
		}
		// One leaves and comes back from another tab: still two.
		b2, _ := hub.Enqueue(ps[1])
		select {
		case <-b.Done:
		default:
			t.Fatal("the old tab still waits")
		}
		if b.Code() != "" || hub.Queue().Waiting != 2 {
			t.Fatalf("after a second tab: %+v", hub.Queue())
		}
		c, _ := hub.Enqueue(ps[2])
		if q := hub.Queue(); q.StartsMs <= 0 || q.StartsMs > ArenaWait.Milliseconds() {
			t.Fatalf("three waiting: %+v", q)
		}
		time.Sleep(ArenaWait + time.Millisecond)
		synctest.Wait()
		for _, tk := range []*Ticket{a, b2, c} {
			if tk.Code() == "" || tk.Code() != a.Code() {
				t.Fatal("three who waited don't play together")
			}
		}
		r, _ := hub.Get(a.Code())
		var subs []*Sub
		for _, p := range ps {
			s, err := r.Follow(p.ID)
			if err != nil {
				t.Fatal(err)
			}
			subs = append(subs, s)
		}
		time.Sleep(ArenaCountdown + time.Millisecond)
		synctest.Wait()
		// Player 1 is always right, 2 sometimes, 3 never.
		for r.View(1).Phase != End {
			if v := r.View(1); v.Phase == Question {
				_ = r.Answer(1, v.N, answer(r, true))
				_ = r.Answer(2, v.N, answer(r, v.N%2 == 0))
				_ = r.Answer(3, v.N, answer(r, false))
			}
			time.Sleep(Pause + time.Millisecond)
			synctest.Wait()
		}
		synctest.Wait()
		if len(ended) != ArenaMin || ended[0].ID != 1 || ended[0].Place != 1 || ended[2].ID != 3 {
			t.Fatalf("the places: %+v", ended)
		}
		v := r.View(3)
		if v.Players[0].Place != 1 || v.Players[0].Delta == nil || *v.Players[0].Delta != 12 || v.Players[2].Place != 3 {
			t.Fatalf("the end as Vi sees it: %+v", v.Players)
		}
		// Once it's over, the queue is a new arena.
		if tk, _ := hub.Enqueue(ps[0]); tk.Code() != "" {
			t.Fatal("back into an arena that ended")
		}
		hub.Leave(hub.queue[0])
		for _, s := range subs {
			r.Unfollow(s)
		}
	})
}
