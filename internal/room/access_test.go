package room

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"testing/synctest"
	"time"
)

// Nobody can fill the hub: a host keeps two rooms at most (a new one closes their oldest, unless a game is under way
// in it), and an address opens maxFrom.
func TestRoomCaps(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana := Player{ID: 1, Name: "Ана"}
		first, _ := hub.Open(ana, "a", Settings{})
		time.Sleep(time.Second)
		second, _ := hub.Open(ana, "a", Settings{})
		time.Sleep(time.Second)
		sf, _ := first.Follow(ana.ID)
		third, err := hub.Open(ana, "a", Settings{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := hub.Get(first.Code()); !errors.Is(err, ErrNoRoom) {
			t.Fatalf("the host's oldest room is still open: %v", err)
		}
		select {
		case <-sf.Done:
		default:
			t.Fatal("the oldest room's screens weren't told it closed")
		}
		if first.In(ana.ID) || !second.In(ana.ID) || !third.In(ana.ID) {
			t.Fatal("the host's rooms")
		}
		// A game under way keeps its room: the other one goes, and with both under way there's no third.
		_ = second.Start(ana.ID)
		fourth, err := hub.Open(ana, "a", Settings{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := hub.Get(second.Code()); err != nil {
			t.Fatalf("the room with a game under way closed: %v", err)
		}
		if _, err := hub.Get(third.Code()); !errors.Is(err, ErrNoRoom) {
			t.Fatalf("the room the game skipped: %v", err)
		}
		_ = fourth.Start(ana.ID)
		if _, err := hub.Open(ana, "a", Settings{}); !errors.Is(err, ErrTooMany) {
			t.Fatalf("a third room beside two games: %v", err)
		}

		// One address, many hosts: maxFrom rooms, then no more from it; another address still opens.
		for id := range int64(maxFrom) - 2 {
			if _, err := hub.Open(Player{ID: 100 + id}, "a", Settings{}); err != nil {
				t.Fatalf("room %d from the address: %v", id, err)
			}
		}
		if _, err := hub.Open(Player{ID: 99}, "a", Settings{}); !errors.Is(err, ErrTooMany) {
			t.Fatalf("one room too many from the address: %v", err)
		}
		if _, err := hub.Open(Player{ID: 99}, "b", Settings{}); err != nil {
			t.Fatalf("a room from another address: %v", err)
		}
		// A host with two rooms elsewhere, at the full address: nothing opens, and nothing of theirs closes for it.
		cy := Player{ID: 3, Name: "Цви"}
		c1, _ := hub.Open(cy, "c", Settings{})
		time.Sleep(time.Second)
		c2, _ := hub.Open(cy, "c", Settings{})
		if _, err := hub.Open(cy, "a", Settings{}); !errors.Is(err, ErrTooMany) {
			t.Fatalf("a room from the full address: %v", err)
		}
		if !c1.In(cy.ID) || !c2.In(cy.ID) {
			t.Fatal("a room closed for one that didn't open")
		}
		// The games under way run out, so that nothing is left behind in the bubble.
		time.Sleep(time.Hour)
		synctest.Wait()
	})
}

// A locked room takes nobody new; whoever is in it comes back to it, and it stays locked over a restart.
func TestLockedRoom(t *testing.T) {
	hub := NewHub(sample(t))
	ana, bo, cy := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}, Player{ID: 3, Name: "Цви"}
	r, _ := hub.Open(ana, "", Settings{})
	_ = r.Join(bo, "")
	if err := r.SetLocked(bo.ID, true); !errors.Is(err, ErrNotYours) {
		t.Fatalf("a player locked the room: %v", err)
	}
	if err := r.SetLocked(ana.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := r.Join(cy, ""); !errors.Is(err, ErrLocked) || r.In(cy.ID) {
		t.Fatalf("someone new in a locked room: %v", err)
	}
	if err := r.Join(Player{ID: 2, Name: "Боян"}, ""); err != nil || !r.View(ana.ID).Locked {
		t.Fatalf("a player coming back to a locked room: %v", err)
	}
	var saved bytes.Buffer
	_ = hub.Save(&saved)
	next := NewHub(hub.bank)
	_, _ = next.Restore(&saved)
	again, _ := next.Get(r.Code())
	if err := again.Join(cy, ""); !errors.Is(err, ErrLocked) {
		t.Fatalf("the lock over a restart: %v", err)
	}
	_ = again.SetLocked(ana.ID, false)
	if err := again.Join(cy, ""); err != nil || !again.In(cy.ID) {
		t.Fatalf("someone new once it's open again: %v", err)
	}
}

// Starting a game reads the day's questions with no lock held: Playing (every Начало) and the room's screens don't
// wait on the database meanwhile.
func TestStartWaitsOnNobody(t *testing.T) {
	hub := NewHub(sample(t))
	reading, release := make(chan struct{}), make(chan struct{})
	hub.Barred = func(context.Context) (map[string]bool, error) {
		close(reading)
		<-release
		return nil, nil
	}
	ana := Player{ID: 1, Name: "Ана"}
	r, _ := hub.Open(ana, "", Settings{})
	started := make(chan error)
	go func() { started <- r.Start(ana.ID) }()
	<-reading
	done := make(chan struct{})
	go func() {
		hub.Playing(ana.ID)
		r.View(ana.ID)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Playing waited on a game starting")
	}
	close(release)
	if err := <-started; err != nil {
		t.Fatal(err)
	}
	if hub.Playing(ana.ID) != r.Code() {
		t.Fatal("the game didn't start")
	}
	r.mu.Lock()
	r.close()
	r.mu.Unlock()
}
