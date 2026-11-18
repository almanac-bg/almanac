package room

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// restart saves the hub's rooms and opens them again in a new hub, as the next run of the server does.
func restart(t *testing.T, hub *Hub) *Hub {
	t.Helper()
	var saved bytes.Buffer
	if err := hub.Save(&saved); err != nil {
		t.Fatal(err)
	}
	next := NewHub(hub.bank)
	next.Record = hub.Record
	if _, err := next.Restore(&saved); err != nil {
		t.Fatal(err)
	}
	return next
}

// A room restored after a restart plays on as if it hadn't stopped: the players whose screens were open as it stopped
// count as there while their screens come back, so that the first answer back doesn't end the question for them, and
// the question keeps the time it had left (review 2026-11-18, A8 and A15).
func TestARestoredQuestionWaitsForTheScreensComingBack(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo, cy, dee := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}, Player{ID: 3, Name: "Цви"},
			Player{ID: 4, Name: "Дея"}
		r, _ := hub.Open(ana, "", Settings{})
		for _, p := range []Player{bo, cy, dee} {
			_ = r.Join(p, "")
		}
		var subs []*Sub
		for _, p := range []Player{ana, bo, cy, dee} {
			s, _ := r.Follow(p.ID)
			subs = append(subs, s)
		}
		// Дея's screen went long before the restart: she isn't waited for after it, as she wasn't before.
		r.Unfollow(subs[3])
		time.Sleep(time.Minute)
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		time.Sleep(4 * time.Second)
		// The server stops: every screen closes, then the rooms are saved.
		for _, s := range subs[:3] {
			r.Unfollow(s)
		}
		next := restart(t, hub)
		back, _ := next.Get(r.Code())
		v := back.View(ana.ID)
		if v.Phase != Question || v.Question.LeftMs != v.Question.LimitMs-4000 {
			t.Fatalf("the question restored, with the time it had left: %+v", v.Question)
		}
		if !v.Players[0].Online || !v.Players[1].Online || !v.Players[2].Online || v.Players[3].Online {
			t.Fatalf("who's there, restored: %+v", v.Players)
		}
		// Ана's answer, sent again as the server came back, is the first: the question waits for Бо and Цви.
		if err := back.Answer(ana.ID, 0, answer(back, true)); err != nil {
			t.Fatal(err)
		}
		if back.View(ana.ID).Phase != Question {
			t.Fatal("the first answer back ended the question for everyone")
		}
		// Бо comes back and answers; Цви doesn't come back, and once comeBack is over, the answer shows.
		sb, _ := back.Follow(bo.ID)
		if err := back.Answer(bo.ID, 0, answer(back, false)); err != nil {
			t.Fatal(err)
		}
		if back.View(ana.ID).Phase != Question {
			t.Fatal("the answer showed while Цви was still coming back")
		}
		time.Sleep(comeBack)
		synctest.Wait()
		if v := back.View(ana.ID); v.Phase != Reveal || v.Players[0].Points == 0 {
			t.Fatalf("after comeBack, all who are there answered: %+v", v)
		}
		back.Unfollow(sb)

		// A question saved near its end keeps at least comeBack, for the screens to come back and answer it.
		time.Sleep(Pause + time.Millisecond)
		synctest.Wait()
		v = back.View(ana.ID)
		if v.Phase != Question || v.N != 1 {
			t.Fatalf("the next question: %+v", v)
		}
		time.Sleep(time.Duration(v.Question.LimitMs)*time.Millisecond - time.Second)
		again, _ := restart(t, next).Get(r.Code())
		if left := again.View(ana.ID).Question.LeftMs; left != comeBack.Milliseconds() {
			t.Fatalf("a question restored a second before its end: %d ms left", left)
		}
	})
}

// A host away when the room was saved isn't waited for, and one there is (mayLead): as before the restart.
func TestARestoredHostLeadsOn(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		r, _ := hub.Open(ana, "", Settings{})
		_ = r.Join(bo, "")
		sa, _ := r.Follow(ana.ID)
		r.Unfollow(sa)
		back, _ := restart(t, hub).Get(r.Code())
		if back.View(bo.ID).CanLead {
			t.Fatal("a player leads, the host's screen just gone over a restart")
		}
		time.Sleep(comeBack)
		if !back.View(bo.ID).CanLead {
			t.Fatal("the host away: nobody else leads")
		}
	})
}

// A host on their way in to a room just opened (hostWait) is waited for the rest of that wait over a restart, not only
// for comeBack; the others' screens hear as it ends, and may lead from then.
func TestARestoredRoomWaitsOutItsHostsWait(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		for _, lead := range []bool{false, true} {
			r, _ := hub.Open(ana, "", Settings{Lead: lead})
			_ = r.Join(bo, "")
			time.Sleep(hostWait / 2)
			back, _ := restart(t, hub).Get(r.Code())
			sb, _ := back.Follow(bo.ID)
			<-sb.C
			time.Sleep(hostWait/2 - time.Second)
			synctest.Wait()
			if back.View(bo.ID).CanLead {
				t.Fatalf("lead %v: the host's wait cut short by a restart", lead)
			}
			time.Sleep(2 * time.Second)
			synctest.Wait()
			select {
			case <-sb.C:
			default:
				t.Fatalf("lead %v: no word as the host's wait ended", lead)
			}
			if !back.View(bo.ID).CanLead {
				t.Fatalf("lead %v: the host never came: nobody else leads", lead)
			}
			back.Unfollow(sb)
		}
	})
}

// A room's game is kept once, by its id: a crash just after its end plays the end again from the room saved before it,
// and the game kept again has the same id (Hub.Record keeps it once); a game over whose players' games weren't kept
// as the room was saved is kept as it's restored (review 2026-11-18, A14).
func TestAGameKeptOnceOverACrash(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		var mu sync.Mutex
		kept := map[string]int{} // by the game's id and the player's
		hub.Record = func(_ context.Context, user int64, p play.RoomPlay) (int64, error) {
			mu.Lock()
			defer mu.Unlock()
			if p.Game == "" {
				t.Error("a game kept with no id")
			}
			kept[p.Game+string(rune('0'+user))]++
			return user * 100, nil
		}
		ana := Player{ID: 1, Name: "Ана"}
		r, _ := hub.Open(ana, "", Settings{Length: 5})
		sa, _ := r.Follow(ana.ID)
		_ = r.Start(ana.ID)
		for r.View(ana.ID).N < 4 || r.View(ana.ID).Phase != Question {
			if v := r.View(ana.ID); v.Phase == Question && !v.Players[0].Answered {
				_ = r.Answer(ana.ID, v.N, answer(r, true))
			}
			time.Sleep(time.Second)
			synctest.Wait()
		}
		before := restart(t, hub) // saved at the last question: the crash comes back to this
		_ = r.Answer(ana.ID, 4, answer(r, true))
		time.Sleep(Pause + time.Second)
		synctest.Wait()
		if v := r.View(ana.ID); v.Phase != End || v.Run != 100 {
			t.Fatalf("the game over, kept: %+v", v)
		}
		r.Unfollow(sa)
		// The crash: the room as saved before the end plays its end again.
		replay, _ := before.Get(r.Code())
		_ = replay.Answer(ana.ID, 4, answer(replay, true))
		time.Sleep(Pause + time.Second)
		synctest.Wait()
		mu.Lock()
		if len(kept) != 1 {
			t.Fatalf("the game kept as %d games: %v", len(kept), kept)
		}
		mu.Unlock()

		// A game over whose end wasn't kept yet as the room was saved (Hub.Record had no time to) is kept as it's
		// restored; and nothing more when it was.
		hub.Record = nil
		ended, _ := hub.Open(Player{ID: 2, Name: "Бо"}, "", Settings{Length: 5})
		_ = ended.Start(2)
		_ = ended.Answer(2, 0, answer(ended, true))
		_ = ended.Finish(2)
		next := NewHub(hub.bank)
		var saved bytes.Buffer
		_ = hub.Save(&saved)
		next.Record = before.Record
		_, _ = next.Restore(&saved)
		synctest.Wait()
		back, _ := next.Get(ended.Code())
		mu.Lock()
		games := len(kept)
		mu.Unlock()
		if v := back.View(2); v.Run != 200 || games != 2 {
			t.Fatalf("a game over kept as it's restored: run %d, %d games kept", v.Run, games)
		}
		if again, _ := restart(t, next).Get(r.Code()); again.View(ana.ID).Run != 100 {
			t.Fatal("a game kept lost its run over a restart")
		}
		synctest.Wait()
		mu.Lock()
		defer mu.Unlock()
		for game, n := range kept {
			if n > 2 { // a game kept again goes to Record, which keeps it once: twice at most here, no more
				t.Fatalf("game %s kept %d times", game, n)
			}
		}
	})
}

// A game its host ends early earns by the questions it was dealt: one question right of five isn't all right, and
// the game kept says it was dealt five (review 2026-11-18, S19).
func TestAGameCutShortIsNotAllRight(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		var mu sync.Mutex
		var got play.RoomPlay
		hub.Record = func(_ context.Context, _ int64, p play.RoomPlay) (int64, error) {
			mu.Lock()
			defer mu.Unlock()
			got = p
			return 1, nil
		}
		ana := Player{ID: 1, Name: "Ана"}
		r, _ := hub.Open(ana, "", Settings{Length: 5})
		_ = r.Start(ana.ID)
		_ = r.Answer(ana.ID, 0, answer(r, true))
		points := r.View(ana.ID).Players[0].Points
		if err := r.Finish(ana.ID); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		v := r.View(ana.ID)
		if v.Phase != End || v.Total != 1 || v.AllRight != 0 || v.Players[0].Points != points {
			t.Fatalf("a game of five ended at the first: %+v", v)
		}
		mu.Lock()
		defer mu.Unlock()
		if got.Length != 5 || len(got.Picks) != 1 || got.Points != points {
			t.Fatalf("kept as: %+v", got)
		}
	})
}

// A player's screens on a room are capped (the oldest makes way, told it moved), and so are the room's; only a
// player's first screen and last are news to the others (review 2026-11-18, S6).
func TestScreensCapped(t *testing.T) {
	hub := NewHub(sample(t))
	ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
	r, _ := hub.Open(ana, "", Settings{})
	_ = r.Join(bo, "")
	sa, _ := r.Follow(ana.ID)
	<-sa.C
	drained := func(s *Sub) bool {
		select {
		case <-s.C:
			return false
		default:
			return true
		}
	}
	var bos []*Sub
	for i := range maxScreensEach {
		s, err := r.Follow(bo.ID)
		if err != nil {
			t.Fatal(err)
		}
		if drained(s) {
			t.Fatalf("screen %d had no first look", i)
		}
		if heard := !drained(sa); heard != (i == 0) {
			t.Fatalf("Бо's screen %d heard of by Ана: %v", i, heard)
		}
		bos = append(bos, s)
	}
	extra, err := r.Follow(bo.ID)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-bos[0].Done:
		if !bos[0].Moved() || bos[0].Removed() {
			t.Fatal("the oldest screen wasn't told it moved")
		}
	default:
		t.Fatal("one screen more than a player's cap")
	}
	if len(r.subs) != maxScreensEach+1 || r.View(ana.ID).Players[1].Online != true || !drained(sa) {
		t.Fatalf("after the oldest made way: %d screens", len(r.subs))
	}
	for _, s := range append(bos[1:], extra) {
		r.Unfollow(s)
		if heard := !drained(sa); heard != (s == extra) {
			t.Fatal("a screen that wasn't Бо's last was news")
		}
	}
	r.Unfollow(bos[0]) // its stream ends after it's told: nothing more
	if r.View(ana.ID).Players[1].Online {
		t.Fatal("Бо still there with no screen")
	}

	// The room full of screens: someone with none comes in in place of the oldest of whoever has the most; someone
	// with one already waits.
	for i := range MaxPlayers - 2 {
		_ = r.Join(Player{ID: int64(10 + i), Name: "Играч"}, "")
	}
	for len(r.subs) < maxScreens {
		for _, m := range r.players {
			if len(r.subs) < maxScreens && m.ID != bo.ID && m.online < 3 {
				if _, err := r.Follow(m.ID); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	if _, err := r.Follow(ana.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("a screen more for someone with screens, the room full: %v", err)
	}
	if _, err := r.Follow(bo.ID); err != nil || len(r.subs) != maxScreens || !r.View(ana.ID).Players[1].Online {
		t.Fatalf("a first screen, the room full: %v", err)
	}
}

// A room led from a big screen (a class's) locks itself as its first game starts; someone new comes into a game
// under way only by the room's link (S3).
func TestComingInMidGame(t *testing.T) {
	hub := NewHub(sample(t))
	ana, bo, cy := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}, Player{ID: 3, Name: "Цви"}
	class, _ := hub.Open(ana, "", Settings{Lead: true})
	_ = class.Join(bo, "")
	if err := class.Start(ana.ID); err != nil {
		t.Fatal(err)
	}
	if err := class.Join(cy, class.Key()); !errors.Is(err, ErrLocked) || !class.View(ana.ID).Locked {
		t.Fatalf("a class's room once its game started: %v", err)
	}
	if err := class.Join(bo, ""); err != nil {
		t.Fatalf("a player back in a class's room: %v", err)
	}

	party, _ := hub.Open(bo, "", Settings{})
	if v := party.View(bo.ID); v.Key == "" || v.Key != party.Key() || party.View(cy.ID).Key != "" {
		t.Fatal("the room's key, to who's in it alone")
	}
	_ = party.Start(bo.ID)
	if err := party.Admits(0, ""); !errors.Is(err, ErrStarted) {
		t.Fatalf("someone new by the code alone, mid-game: %v", err)
	}
	if err := party.Join(cy, "WRONG"); !errors.Is(err, ErrStarted) {
		t.Fatalf("a key guessed: %v", err)
	}
	if err := party.Admits(bo.ID, ""); err != nil {
		t.Fatalf("the host, by the code: %v", err)
	}
	if err := party.Join(cy, party.Key()); err != nil {
		t.Fatalf("by the link: %v", err)
	}
	_ = party.Finish(bo.ID)
	if err := party.Admits(0, ""); err != nil {
		t.Fatalf("by the code between games: %v", err)
	}
}
