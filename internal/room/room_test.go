package room

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"slices"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/bank/banktest"
	"github.com/almanac-bg/almanac/internal/play"
)

func sample(t *testing.T) func() *bank.Bank {
	t.Helper()
	b := banktest.Sample(t)
	return func() *bank.Bank { return b }
}

// answer is the right (or a wrong) answer to the room's question now, as a player would give it.
func answer(r *Room, right bool) json.RawMessage {
	r.mu.Lock()
	d := r.dealt[r.n]
	r.mu.Unlock()
	raw, _ := json.Marshal(d.Reveal(nil))
	var rv struct {
		Pick  *int     `json:"pick"`
		Value *float64 `json:"value"`
		Order []int    `json:"order"`
		Truth *bool    `json:"truth"`
		Pairs []int    `json:"pairs"`
		Sides []int    `json:"sides"`
	}
	_ = json.Unmarshal(raw, &rv)
	var a any
	switch {
	case rv.Pick != nil:
		p := *rv.Pick
		if !right {
			p = (p + 1) % bank.ChoiceOptions
		}
		a = map[string]int{"pick": p}
	case rv.Value != nil:
		v := *rv.Value
		if !right {
			n := d.Question().(*bank.Number)
			v = n.Answer + 10*n.Tolerance*n.Answer // far off on either scale
		}
		a = map[string]float64{"value": v}
	case rv.Truth != nil:
		a = map[string]bool{"truth": *rv.Truth == right}
	case rv.Sides != nil:
		sides := slices.Clone(rv.Sides)
		if !right {
			for i := range sides {
				sides[i] = 1 - sides[i]
			}
		}
		a = map[string][]int{"sides": sides}
	case rv.Pairs != nil:
		p := rv.Pairs
		if !right {
			p = append(p[1:], p[0])
		}
		a = map[string][]int{"pairs": p}
	default:
		o := rv.Order
		if !right {
			o = []int{o[3], o[2], o[1], o[0]}
		}
		a = map[string][]int{"order": o}
	}
	out, _ := json.Marshal(a)
	return out
}

func TestAGamePlayedTogether(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		r, err := hub.Open(ana, "", Settings{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := hub.Get(r.Code()); err != nil || len(r.Code()) != 6 {
			t.Fatalf("code %q: %v", r.Code(), err)
		}
		_ = r.Join(bo, "")
		sa, _ := r.Follow(ana.ID)
		sb, _ := r.Follow(bo.ID)
		if v := r.View(bo.ID); v.Phase != Lobby || len(v.Players) != 2 || v.CanLead || !r.View(ana.ID).CanLead {
			t.Fatalf("the lobby: %+v", v)
		}
		if err := r.Start(bo.ID); !errors.Is(err, ErrNotYours) {
			t.Fatalf("a guest started the game: %v", err)
		}
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		v := r.View(bo.ID)
		if v.Phase != Question || v.Total != play.Length || v.Question == nil || v.Question.Reveal != nil {
			t.Fatalf("the first question: %+v", v)
		}
		if hub.Playing(bo.ID) != r.Code() || hub.Playing(3) != "" {
			t.Fatalf("the game under way: %q", hub.Playing(bo.ID))
		}

		// Ana answers at once and right; the answer waits for Bo, then shows.
		time.Sleep(time.Second)
		if err := r.Answer(ana.ID, 0, answer(r, true)); err != nil {
			t.Fatal(err)
		}
		// Sent again (its reply lost on the way), it's taken as the first, and changes nothing (review 2026-11-18, A20).
		points := r.View(ana.ID).Players[0].Points
		if err := r.Answer(ana.ID, 0, answer(r, false)); err != nil || r.View(ana.ID).Players[0].Points != points {
			t.Fatalf("an answer sent again: %v", err)
		}
		if err := r.Answer(ana.ID, 1, answer(r, true)); !errors.Is(err, ErrNotNow) {
			t.Fatalf("an answer to a question not up: %v", err)
		}
		if r.View(ana.ID).Phase != Question {
			t.Fatal("the answer showed before Bo answered")
		}
		time.Sleep(5 * time.Second)
		_ = r.Answer(bo.ID, 0, answer(r, false))
		v = r.View(ana.ID)
		if v.Phase != Reveal || v.Players[0].Name != "Ана" || !v.Players[0].Right ||
			v.Question.Reveal.Points != play.WorthOf(r.dealt[0].Question(), 1, time.Second, 1).Points {
			t.Fatalf("after both answered: %+v %+v", v.Players, v.Question.Reveal)
		}
		if r.View(bo.ID).Question.Reveal.Right {
			t.Fatal("Bo's wrong answer counted")
		}

		// The room moves on by itself; nobody answers the next question, and its time runs out.
		time.Sleep(Pause + time.Millisecond)
		synctest.Wait()
		if v := r.View(bo.ID); v.Phase != Question || v.N != 1 {
			t.Fatalf("the room didn't move on by itself: %+v", v)
		}
		// Cy comes now (by the room's link: mid-game, the code alone isn't enough), answers this one and goes: their
		// review has it in its place, nothing before it.
		cy := Player{ID: 3, Name: "Цв"}
		if err := r.Join(cy, r.Key()); err != nil {
			t.Fatal(err)
		}
		sc, _ := r.Follow(cy.ID)
		if err := r.Answer(cy.ID, 1, answer(r, true)); err != nil {
			t.Fatal(err)
		}
		r.Unfollow(sc)
		time.Sleep(play.Limit(r.dealt[1].Question()) + play.Grace + time.Millisecond)
		synctest.Wait()
		if v := r.View(bo.ID); v.Phase != Reveal || !v.Question.Reveal.Missed {
			t.Fatalf("after the time ran out: %+v", v)
		}

		// The host leaves: the game goes on, to the end.
		r.Unfollow(sa)
		for r.View(bo.ID).Phase != End {
			time.Sleep(Pause + time.Millisecond)
			synctest.Wait()
			if v := r.View(bo.ID); v.Phase == Question {
				_ = r.Answer(bo.ID, v.N, answer(r, true)) // the only one online: shows at once
			}
		}
		end := r.View(bo.ID)
		if end.Players[0].Name != "Бо" || end.Players[0].Rights != play.Length-2 {
			t.Fatalf("the end: %+v", end.Players)
		}
		// Once it's over, each sees the questions with their own answers.
		if rv := end.Review; len(rv) != play.Length || rv[0].Right || !rv[2].Right || string(rv[1].Given) != "null" {
			t.Fatalf("Bo's review: %+v", rv)
		}
		if rv := r.View(cy.ID).Review; !rv[1].Right || string(rv[0].Given) != "null" {
			t.Fatalf("the review of one who came late: %+v", rv[:2])
		}
		// Again: new questions, everyone from nought.
		if err := r.Start(bo.ID); err != nil || r.View(bo.ID).Players[0].Points != 0 {
			t.Fatalf("again: %v %+v", err, r.View(bo.ID).Players)
		}
		r.Unfollow(sb)
		synctest.Wait()
	})
}

func TestScreensHearOfChanges(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		r, _ := hub.Open(Player{ID: 1, Name: "Ана"}, "", Settings{Category: "history"})
		s, _ := r.Follow(1)
		<-s.C // following is a change
		_ = r.Join(Player{ID: 2, Name: "Бо"}, "")
		select {
		case <-s.C:
		default:
			t.Fatal("no word of a new player")
		}
		// An idle room nobody is in closes, and its screens hear so.
		r.Unfollow(s)
		time.Sleep(16 * time.Minute)
		hub.Sweep()
		if _, err := hub.Get(r.Code()); !errors.Is(err, ErrNoRoom) {
			t.Fatal("an idle room stayed open")
		}
	})
}

func TestRoomsLimits(t *testing.T) {
	hub := NewHub(sample(t))
	if _, err := hub.Open(Player{ID: 1, Name: "Ана"}, "", Settings{Category: "astrology"}); !errors.Is(err, play.ErrNoTopic) {
		t.Fatalf("an unknown topic: %v", err)
	}
	r, _ := hub.Open(Player{ID: 1, Name: "Ана"}, "", Settings{})
	for i := range MaxPlayers - 1 {
		if err := r.Join(Player{ID: int64(i + 2), Name: "Играч"}, ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Join(Player{ID: 999, Name: "Още един"}, ""); !errors.Is(err, ErrFull) {
		t.Fatalf("player %d: %v", MaxPlayers+1, err)
	}
	if err := r.Answer(1, 0, json.RawMessage(`{"pick":0}`)); !errors.Is(err, ErrNotNow) {
		t.Fatalf("an answer in the lobby: %v", err)
	}
}

// A room deals none of the questions barred (the day's), and takes an answer as late as any game does (play.Grace).
func TestBarredAndLate(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := sample(t)
		hub := NewHub(b)
		barred := map[string]bool{}
		for _, q := range b().Live("", "") {
			barred[q.Base().ID] = q.Base().Category != "science"
		}
		hub.Barred = func(context.Context) (map[string]bool, error) { return barred, nil }
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		r, _ := hub.Open(ana, "", Settings{})
		_ = r.Join(bo, "")
		sa, _ := r.Follow(ana.ID)
		sb, _ := r.Follow(bo.ID)
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		for _, p := range r.picks {
			if barred[p.ID] {
				t.Fatalf("a barred question dealt: %s", p.ID)
			}
		}
		if len(r.picks) != play.Length {
			t.Fatalf("%d questions", len(r.picks))
		}
		time.Sleep(play.Limit(r.dealt[0].Question()) + play.Grace - 100*time.Millisecond)
		if err := r.Answer(ana.ID, 0, answer(r, true)); err != nil {
			t.Fatalf("an answer within the grace: %v", err)
		}
		r.Unfollow(sa)
		r.Unfollow(sb)
		synctest.Wait()
	})
}

// A clues question's clues reach the screens as their time comes, and not before.
func TestCluesComeInTime(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := sample(t)
		hub := NewHub(b)
		ana := Player{ID: 1, Name: "Ана"}
		r, _ := hub.Open(ana, "", Settings{})
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		q := b().Live("", "clues")[0]
		r.mu.Lock()
		r.dealt[0] = q.Deal(1)
		r.show(0)
		r.mu.Unlock()
		sub, _ := r.Follow(ana.ID)
		out := func() int {
			var v struct{ Clues []string }
			_ = json.Unmarshal(mustJSON(t, r.View(ana.ID).Question.View), &v)
			return len(v.Clues)
		}
		drain := func() bool {
			select {
			case <-sub.C:
				return true
			default:
				return false
			}
		}
		drain()
		if out() != 1 {
			t.Fatalf("%d clues at the start", out())
		}
		time.Sleep(bank.ClueEvery - time.Second)
		synctest.Wait()
		if drain() || out() != 1 {
			t.Fatal("a clue before its time")
		}
		time.Sleep(time.Second)
		synctest.Wait()
		if !drain() || out() != 2 {
			t.Fatalf("the second clue: told %v, %d out", false, out())
		}
		time.Sleep(bank.ClueEvery)
		synctest.Wait()
		if !drain() || out() != 3 {
			t.Fatalf("the third clue: %d out", out())
		}
	})
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Paused for a restart, no game starts in a room, and a game under way counts until it's over.
func TestPausedRooms(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana := Player{ID: 1, Name: "Ана"}
		r, _ := hub.Open(ana, "", Settings{})
		other, _ := hub.Open(Player{ID: 2, Name: "Бо"}, "", Settings{})
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		if n := hub.UnderWay(); n != 1 {
			t.Fatalf("under way: %d", n)
		}
		hub.Pause()
		if err := other.Start(2); !errors.Is(err, ErrPaused) {
			t.Fatalf("a game started while paused: %v", err)
		}
		// Nobody answers: the game still runs to its end.
		time.Sleep(time.Hour)
		synctest.Wait()
		if v := r.View(ana.ID); v.Phase != End {
			t.Fatalf("the game under way: %s", v.Phase)
		}
		if n := hub.UnderWay(); n != 0 {
			t.Fatalf("under way at the end: %d", n)
		}
		if err := r.Start(ana.ID); !errors.Is(err, ErrPaused) {
			t.Fatalf("another game started while paused: %v", err)
		}
		hub.Resume()
		if err := other.Start(2); err != nil {
			t.Fatalf("resumed: %v", err)
		}
	})
}

// Rooms are kept over a restart: a lobby as it was, a game just over with its standings and review, and a game
// still being played as its lobby.
func TestRoomsKeptOverARestart(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		bank := sample(t)
		hub := NewHub(bank)
		ana, bo, cy := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}, Player{ID: 3, Name: "Цви"}
		lobby, _ := hub.Open(ana, "", Settings{})
		_ = lobby.Join(bo, "")
		over, _ := hub.Open(bo, "", Settings{})
		_ = over.Join(cy, "")
		playing, _ := hub.Open(cy, "", Settings{})
		_ = over.Start(bo.ID)
		sb, _ := over.Follow(bo.ID)
		for over.View(bo.ID).Phase != End {
			if v := over.View(bo.ID); v.Phase == Question && !v.Players[0].Answered && !v.Players[1].Answered {
				_ = over.Answer(bo.ID, v.N, answer(over, true))
			}
			time.Sleep(time.Second)
			synctest.Wait()
		}
		over.Unfollow(sb)
		// The game being played: Цви has answered the first question, Ана (on screen too) not yet.
		_ = playing.Join(ana, "")
		sc, _ := playing.Follow(cy.ID)
		sa, _ := playing.Follow(ana.ID)
		_ = playing.Start(cy.ID)
		time.Sleep(3 * time.Second)
		if err := playing.Answer(cy.ID, 0, answer(playing, true)); err != nil {
			t.Fatal(err)
		}
		playingBefore := playing.View(cy.ID)
		playing.Unfollow(sc)
		playing.Unfollow(sa)
		before := over.View(bo.ID)

		var saved bytes.Buffer
		if err := hub.Save(&saved); err != nil {
			t.Fatal(err)
		}
		next := NewHub(bank)
		if n, err := next.Restore(&saved); err != nil || n != 3 {
			t.Fatalf("restored %d: %v", n, err)
		}

		r, err := next.Get(lobby.Code())
		if err != nil {
			t.Fatal(err)
		}
		if v := r.View(bo.ID); v.Phase != Lobby || len(v.Players) != 2 || v.Host != "Ана" || v.IsHost {
			t.Fatalf("the lobby, restored: %+v", v)
		}
		if err := r.Start(ana.ID); err != nil {
			t.Fatalf("a game in the restored lobby: %v", err)
		}

		r, _ = next.Get(over.Code())
		after := r.View(bo.ID)
		if after.Phase != End || after.Total != before.Total || len(after.Review) != len(before.Review) ||
			after.Players[0].Points != before.Players[0].Points || after.Players[0].Points == 0 ||
			after.Review[0].Points != before.Review[0].Points || !after.Review[0].Right {
			t.Fatalf("the game just over, restored:\n%+v\nwas\n%+v", after, before)
		}
		if err := r.Start(bo.ID); err != nil {
			t.Fatalf("another game after the restored end: %v", err)
		}

		// The game being played goes on where it was: Цви's answer and points kept, the question showing with its time
		// from the start for Ана, who hadn't answered it.
		r, _ = next.Get(playing.Code())
		v := r.View(cy.ID)
		if v.Phase != Question || v.N != 0 || len(v.Players) != 2 || !v.IsHost || v.Question.Given == nil ||
			v.Players[0].Name != "Цви" || !v.Players[0].Answered || v.Players[0].Points != playingBefore.Players[0].Points ||
			v.Players[0].Points == 0 || v.Players[1].Answered || v.Question.LeftMs != v.Question.LimitMs-3000 {
			t.Fatalf("the game being played, restored:\n%+v\nwas\n%+v", v, playingBefore)
		}
		if _, err := r.Follow(ana.ID); err != nil {
			t.Fatal(err)
		}
		if err := r.Answer(ana.ID, 0, answer(r, false)); err != nil {
			t.Fatal(err)
		}
		if v := r.View(cy.ID); v.Phase != Reveal || v.Question.Reveal == nil || !v.Question.Reveal.Right {
			t.Fatalf("its answer, once both have: %+v", v)
		}
		// Saved again as the answer shows, it shows again for its pause, then the game goes on.
		saved.Reset()
		if err := next.Save(&saved); err != nil {
			t.Fatal(err)
		}
		again := NewHub(bank)
		if _, err := again.Restore(&saved); err != nil {
			t.Fatal(err)
		}
		r, _ = again.Get(playing.Code())
		if v := r.View(cy.ID); v.Phase != Reveal || v.Players[0].Points != playingBefore.Players[0].Points {
			t.Fatalf("the answer showing, restored: %+v", v)
		}
		time.Sleep(Pause + time.Second)
		synctest.Wait()
		if v := r.View(cy.ID); v.Phase != Question || v.N != 1 {
			t.Fatalf("after the restored answer's pause: %+v", v)
		}
	})
}

// A game's clock that panics ends the game where it is, the players' games kept, and the process goes on.
func TestABrokenClockEndsTheGame(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		var mu sync.Mutex
		kept := 0
		hub.Record = func(_ context.Context, user int64, p play.RoomPlay) (int64, error) {
			mu.Lock()
			defer mu.Unlock()
			kept++
			if kept == 1 {
				panic("keeping the first player's game") // stopped: the others' are kept still
			}
			return 7, nil
		}
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		r, _ := hub.Open(ana, "", Settings{})
		_ = r.Join(bo, "")
		sa, _ := r.Follow(ana.ID)
		sb, _ := r.Follow(bo.ID)
		defer r.Unfollow(sa)
		defer r.Unfollow(sb)
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		_ = r.Answer(ana.ID, 0, answer(r, true))
		_ = r.Answer(bo.ID, 0, answer(r, true))
		r.mu.Lock()
		r.after(time.Second, func() { panic("the clock broke") })
		r.mu.Unlock()
		time.Sleep(2 * time.Second)
		synctest.Wait()
		v := r.View(ana.ID)
		if v.Phase != End || v.Total != 1 || len(v.Review) != 1 || !v.Review[0].Right {
			t.Fatalf("the broken game: %+v", v)
		}
		mu.Lock()
		defer mu.Unlock()
		if kept != 2 {
			t.Fatalf("%d games kept", kept)
		}
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.recording != 0 {
			t.Fatalf("still keeping: %d", r.recording)
		}
	})
}

// The host sends a player out: their screen hears so, they can't come back (after a restart either), and a question
// waiting on them goes on without them.
func TestRemove(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo, cy := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}, Player{ID: 3, Name: "Цви"}
		r, _ := hub.Open(ana, "", Settings{})
		_ = r.Join(bo, "")
		_ = r.Join(cy, "")
		sa, _ := r.Follow(ana.ID)
		sb, _ := r.Follow(bo.ID)
		sc, _ := r.Follow(cy.ID)
		keyOf := func(name string) int {
			for _, p := range r.View(ana.ID).Players {
				if p.Name == name {
					return p.Key
				}
			}
			t.Fatalf("no %s in the room", name)
			return -1
		}
		if err := r.Remove(bo.ID, keyOf("Цви")); !errors.Is(err, ErrNotYours) {
			t.Fatalf("a player sent another out: %v", err)
		}
		if err := r.Remove(ana.ID, keyOf("Ана")); !errors.Is(err, ErrNotNow) {
			t.Fatalf("the host sent themself out: %v", err)
		}
		cyKey := keyOf("Цви")
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		_ = r.Answer(ana.ID, 0, answer(r, true))
		_ = r.Answer(bo.ID, 0, answer(r, true))
		if r.View(ana.ID).Phase != Question {
			t.Fatal("the answer showed before Цви answered")
		}
		if err := r.Remove(ana.ID, keyOf("Цви")); err != nil {
			t.Fatal(err)
		}
		select {
		case <-sc.Done:
			if !sc.Removed() {
				t.Fatal("Цви's screen wasn't told why")
			}
		default:
			t.Fatal("Цви's screen still follows the room")
		}
		if v := r.View(ana.ID); v.Phase != Reveal || len(v.Players) != 2 {
			t.Fatalf("after Цви went: %+v", v)
		}
		if err := r.Join(cy, ""); !errors.Is(err, ErrRemoved) {
			t.Fatalf("Цви came back: %v", err)
		}
		// The others keep their keys.
		if keyOf("Бо") != 1 || cyKey != 2 {
			t.Fatalf("keys: Бо %d, Цви %d", keyOf("Бо"), cyKey)
		}
		r.Unfollow(sc) // the stream ends after
		r.Unfollow(sa)
		r.Unfollow(sb)

		var saved bytes.Buffer
		if err := hub.Save(&saved); err != nil {
			t.Fatal(err)
		}
		next := NewHub(sample(t))
		if _, err := next.Restore(&saved); err != nil {
			t.Fatal(err)
		}
		again, _ := next.Get(r.Code())
		if err := again.Join(cy, ""); !errors.Is(err, ErrRemoved) {
			t.Fatalf("Цви came back after a restart: %v", err)
		}
		// Keys stay as the screens know them, the gap Цви left included: a host's „Махни“ on a key shown before the
		// restart sends out the same player after it.
		before := r.Players()
		if after := again.Players(); len(after) != len(before) || after[1] != before[1] || after[2] != 0 {
			t.Fatalf("keys after a restart: %v, before %v", after, before)
		}
		// A game under way: someone new comes in by the room's link, not by its code alone.
		if err := again.Join(Player{ID: 4, Name: "Дея"}, ""); !errors.Is(err, ErrStarted) {
			t.Fatalf("by the code alone, mid-game: %v", err)
		}
		if err := again.Join(Player{ID: 4, Name: "Дея"}, r.Key()); err != nil {
			t.Fatal(err)
		}
		if after := again.Players(); after[3] != 4 || after[2] != 0 {
			t.Fatalf("one who joins after the restart takes Цви's key: %v", after)
		}
		synctest.Wait()
	})
}

// A room plays the length and the mix its host chose, never deals a question twice, and keeps each player's game as
// it ends (only theirs, and only if they answered), telling their screen which run it is.
func TestSettingsAndRecords(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := sample(t)
		hub := NewHub(b)
		if _, err := hub.Open(Player{ID: 1}, "", Settings{Length: 7}); !errors.Is(err, play.ErrRoomGame) {
			t.Fatalf("seven questions: %v", err)
		}
		if _, err := hub.Open(Player{ID: 1}, "", Settings{Mix: "brutal"}); !errors.Is(err, play.ErrRoomGame) {
			t.Fatalf("an unknown mix: %v", err)
		}
		type record struct {
			user int64
			play play.RoomPlay
		}
		var mu sync.Mutex
		var kept []record
		hub.Record = func(_ context.Context, user int64, p play.RoomPlay) (int64, error) {
			mu.Lock()
			defer mu.Unlock()
			kept = append(kept, record{user, p})
			return 100 + int64(len(kept)), nil
		}
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		r, err := hub.Open(ana, "", Settings{Length: 5, Mix: play.MixEasy})
		if err != nil {
			t.Fatal(err)
		}
		_ = r.Join(bo, "")
		sa, _ := r.Follow(ana.ID)
		sb, _ := r.Follow(bo.ID)
		if v := r.View(bo.ID); v.Length != 5 || v.Mix != play.MixEasy {
			t.Fatalf("the lobby's settings: %+v", v.Settings)
		}
		dealt := map[string]bool{}
		for game := range 2 {
			if err := r.Start(ana.ID); err != nil {
				t.Fatal(err)
			}
			if len(r.picks) != 5 {
				t.Fatalf("game %d: %d questions", game, len(r.picks))
			}
			for _, p := range r.picks {
				q, _ := b().Get(p.ID)
				if dealt[p.ID] || q.Base().Difficulty == bank.Hard {
					t.Fatalf("game %d dealt %s (%s), again or hard", game, p.ID, q.Base().Difficulty)
				}
				dealt[p.ID] = true
			}
			// Only Ana answers, the first two questions; Bo lets the time run out on all.
			for r.View(ana.ID).Phase != End {
				if v := r.View(ana.ID); v.Phase == Question && v.N < 2 && !v.Players[0].Answered && !v.Players[1].Answered {
					_ = r.Answer(ana.ID, v.N, answer(r, true))
				}
				time.Sleep(time.Second)
				synctest.Wait()
			}
			synctest.Wait()
			mu.Lock()
			if len(kept) != game+1 || kept[game].user != ana.ID {
				t.Fatalf("game %d kept: %+v", game, kept)
			}
			k := kept[game].play
			if len(k.Picks) != 5 || len(k.Answers) != 5 || k.Answers[0].Given == nil || !k.Answers[0].Right ||
				k.Answers[2].Given != nil || k.Answers[4].N != 4 || k.Points != r.View(ana.ID).Players[0].Points {
				t.Fatalf("Ana's game, kept: %+v", k)
			}
			mu.Unlock()
			if v := r.View(ana.ID); v.Run != int64(100+game+1) {
				t.Fatalf("Ana's run: %d", v.Run)
			}
			if r.View(bo.ID).Run != 0 {
				t.Fatal("Bo, who answered nothing, has a run")
			}
			if hub.UnderWay() != 0 {
				t.Fatal("a game kept counts as under way")
			}
		}
		r.Unfollow(sa)
		r.Unfollow(sb)
	})
}

// A room just opened waits for its host on their way in (choosing a name for it): the first guest in doesn't take the
// lead meanwhile. Once the host's screen has come and gone, or the wait is over with no screen of theirs, whoever's
// there leads (review 2026-11-18, B3).
func TestTheHostIsWaitedFor(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		for _, lead := range []bool{false, true} {
			r, _ := hub.Open(ana, "", Settings{Lead: lead})
			_ = r.Join(bo, "")
			sb, _ := r.Follow(bo.ID)
			<-sb.C
			if v := r.View(bo.ID); v.CanLead {
				t.Fatalf("lead %v: a guest leads while the host is on their way in", lead)
			}
			if !lead && !r.View(bo.ID).Players[0].Online {
				t.Fatal("the host on their way in shows as away")
			}
			if err := r.Start(bo.ID); !errors.Is(err, ErrNotYours) {
				t.Fatalf("lead %v: a guest started the game: %v", lead, err)
			}
			// In and out again: away at once, the wait over.
			sa, _ := r.Follow(ana.ID)
			r.Unfollow(sa)
			if !r.View(bo.ID).CanLead {
				t.Fatalf("lead %v: the host gone, nobody else leads", lead)
			}
			r.Unfollow(sb)
		}
		// A host who never comes: the guests' screens hear when the wait is over, and may lead.
		r, _ := hub.Open(ana, "", Settings{})
		_ = r.Join(bo, "")
		sb, _ := r.Follow(bo.ID)
		<-sb.C
		time.Sleep(hostWait)
		synctest.Wait()
		select {
		case <-sb.C:
		default:
			t.Fatal("no word as the host's wait ended")
		}
		if !r.View(bo.ID).CanLead {
			t.Fatal("the host never came: nobody else leads")
		}
		r.Unfollow(sb)
	})
}

// A host leading from a big screen isn't a player, and sets the pace: an answer now, an answer held, the end.
func TestLeadingHost(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo := Player{ID: 1, Name: "Учител"}, Player{ID: 2, Name: "Бо"}
		r, _ := hub.Open(ana, "", Settings{Lead: true})
		sa, err := r.Follow(ana.ID)
		if err != nil {
			t.Fatalf("the host's screen: %v", err)
		}
		if !r.View(ana.ID).Held {
			t.Fatal("a led room doesn't hold its answers from the start")
		}
		_ = r.Join(ana, "") // the host's screen joining again changes nothing
		_ = r.Join(bo, "")
		sb, _ := r.Follow(bo.ID)
		if v := r.View(ana.ID); len(v.Players) != 1 || !v.IsHost || !v.Lead || v.Host != "Учител" {
			t.Fatalf("the host's lobby: %+v", v)
		}
		if v := r.View(bo.ID); v.CanLead || v.Host != "Учител" {
			t.Fatalf("Bo's lobby: %+v", v)
		}
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		// Bo answers: the answer shows at once, with the answer (and its fact) on the host's screen.
		_ = r.Answer(bo.ID, 0, answer(r, true))
		if v := r.View(ana.ID); v.Phase != Reveal || v.Question.Reveal == nil || v.Question.Reveal.Answer == nil {
			t.Fatalf("the answer on the big screen: %+v", v.Question)
		}
		// Held, the answer stays up past Pause until the host moves on.
		if err := r.Hold(bo.ID, true); !errors.Is(err, ErrNotYours) {
			t.Fatalf("a player held: %v", err)
		}
		_ = r.Hold(ana.ID, true)
		time.Sleep(2 * Pause)
		synctest.Wait()
		if v := r.View(bo.ID); v.Phase != Reveal || !v.Held || v.Question.NextMs != 0 {
			t.Fatalf("held: %+v", v)
		}
		_ = r.Next(ana.ID)
		if v := r.View(bo.ID); v.Phase != Question || v.N != 1 {
			t.Fatalf("after Напред: %s %d", v.Phase, v.N)
		}
		// Напред on a question shows its answer now; let go, the room moves on by itself again.
		_ = r.Next(ana.ID)
		_ = r.Hold(ana.ID, false)
		time.Sleep(Pause + time.Millisecond)
		synctest.Wait()
		if v := r.View(bo.ID); v.Phase != Question || v.N != 2 {
			t.Fatalf("let go: %s %d", v.Phase, v.N)
		}
		// Away, the host leaves the pace to whoever's there.
		r.Unfollow(sa)
		if !r.View(bo.ID).CanLead {
			t.Fatal("nobody may lead while the host is away")
		}
		sa, _ = r.Follow(ana.ID)
		if err := r.Finish(ana.ID); err != nil {
			t.Fatal(err)
		}
		if v := r.View(bo.ID); v.Phase != End || v.Total != 3 || len(v.Review) != 3 {
			t.Fatalf("ended on the third question: %s, %d questions", v.Phase, v.Total)
		}
		// Kept over a restart, the host still leading.
		var saved bytes.Buffer
		_ = hub.Save(&saved)
		next := NewHub(sample(t))
		if n, _ := next.Restore(&saved); n != 1 {
			t.Fatalf("restored %d", n)
		}
		again, _ := next.Get(r.Code())
		if v := again.View(ana.ID); !v.Lead || !v.IsHost || len(v.Players) != 1 || v.Host != "Учител" {
			t.Fatalf("restored: %+v", v)
		}
		r.Unfollow(sa)
		r.Unfollow(sb)
	})
}

// A led room plays with no phones in it: everyone answers aloud, each question runs its time (or „Напред“ shows the
// answer), and each answer waits for the host.
func TestLeadNoPhones(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		host := Player{ID: 1, Name: "Водещ"}
		r, _ := hub.Open(host, "", Settings{Lead: true, Length: 5})
		s, _ := r.Follow(host.ID)
		if err := r.Start(host.ID); err != nil {
			t.Fatalf("a game with no phones: %v", err)
		}
		v := r.View(host.ID)
		if v.Phase != Question || len(v.Players) != 0 {
			t.Fatalf("the first question: %+v", v)
		}
		time.Sleep(time.Duration(v.Question.LimitMs)*time.Millisecond + play.Grace + time.Millisecond)
		synctest.Wait()
		if v := r.View(host.ID); v.Phase != Reveal || v.Question.Reveal == nil || v.Question.NextMs != 0 {
			t.Fatalf("the time ran out: %+v", v)
		}
		time.Sleep(3 * Pause)
		synctest.Wait()
		if v := r.View(host.ID); v.Phase != Reveal || v.N != 0 {
			t.Fatalf("the answer didn't wait for the host: %s %d", v.Phase, v.N)
		}
		_ = r.Next(host.ID)
		_ = r.Next(host.ID)
		if v := r.View(host.ID); v.Phase != Reveal || v.N != 1 {
			t.Fatalf("„Напред“ twice: %s %d", v.Phase, v.N)
		}
		if err := r.Finish(host.ID); err != nil {
			t.Fatal(err)
		}
		if v := r.View(host.ID); v.Phase != End || len(v.Players) != 0 {
			t.Fatalf("the end: %+v", v)
		}
		r.Unfollow(s)
	})
}

// The host undoes a slip: a player sent out comes back as they were (into a locked room too); and asks a player for
// another name: theirs goes back to a drawn one, they're told, and the name taken away isn't taken again, over a
// restart either.
func TestReturnAndAskName(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Грубиян", RoomName: true}
		r, _ := hub.Open(ana, "", Settings{})
		_ = r.Join(bo, "")
		boKey := r.View(bo.ID).Players[1].Key
		if err := r.Remove(ana.ID, boKey); err != nil {
			t.Fatal(err)
		}
		_ = r.SetLocked(ana.ID, true)
		if v := r.View(ana.ID); len(v.Out) != 1 || v.Out[0].Name != "Грубиян" || v.Out[0].Key != boKey {
			t.Fatalf("the host's list of those sent out: %+v", v.Out)
		}
		if v := r.View(bo.ID); v.Out != nil {
			t.Fatal("a player sees who was sent out")
		}
		if err := r.Return(bo.ID, boKey); !errors.Is(err, ErrNotYours) {
			t.Fatalf("a player brought someone back: %v", err)
		}
		if err := r.Return(ana.ID, boKey); err != nil {
			t.Fatal(err)
		}
		if err := r.Join(Player{ID: bo.ID, Name: "Бо"}, ""); err != nil {
			t.Fatalf("brought back into a locked room: %v", err)
		}
		if v := r.View(ana.ID); len(v.Out) != 0 || len(v.Players) != 2 || v.Players[1].Key != boKey ||
			v.Players[1].Name != "Грубиян" {
			t.Fatalf("back as they were: %+v", v)
		}
		// Asked for another name.
		if err := r.AskName(bo.ID, boKey, "Мечка"); !errors.Is(err, ErrNotYours) {
			t.Fatalf("a player asked for a name: %v", err)
		}
		if err := r.AskName(ana.ID, boKey, "Мечка"); err != nil {
			t.Fatal(err)
		}
		if v := r.View(bo.ID); !v.AskName || v.Players[1].Name != "Мечка" {
			t.Fatalf("Bo asked: %+v", v)
		}
		if r.View(ana.ID).AskName {
			t.Fatal("the host asked")
		}
		// Back without a name (a reload), the drawn one stays; with the name taken away, it's refused.
		_ = r.Join(Player{ID: bo.ID, Name: "Бо"}, "")
		if err := r.Join(Player{ID: bo.ID, Name: "грубиян", RoomName: true}, ""); !errors.Is(err, ErrNameAgain) {
			t.Fatalf("the name taken away, again: %v", err)
		}
		var saved bytes.Buffer
		_ = hub.Save(&saved)
		next := NewHub(sample(t))
		_, _ = next.Restore(&saved)
		again, _ := next.Get(r.Code())
		if v := again.View(bo.ID); !v.AskName || v.Players[1].Name != "Мечка" {
			t.Fatalf("asked, after a restart: %+v", v)
		}
		if err := again.Join(Player{ID: bo.ID, Name: "Грубиян", RoomName: true}, ""); !errors.Is(err, ErrNameAgain) {
			t.Fatalf("the name taken away, after a restart: %v", err)
		}
		if err := again.Join(Player{ID: bo.ID, Name: "Боби", RoomName: true}, ""); err != nil {
			t.Fatal(err)
		}
		if v := again.View(bo.ID); v.AskName || v.Players[1].Name != "Боби" {
			t.Fatalf("a new name: %+v", v)
		}
		// Not during a game.
		if err := again.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		if err := again.AskName(ana.ID, boKey, "Мечка"); !errors.Is(err, ErrNotNow) {
			t.Fatalf("asked mid-game: %v", err)
		}
		// Sent out mid-game and brought back, still sent out after a restart until then.
		_ = again.Remove(ana.ID, boKey)
		saved.Reset()
		_ = next.Save(&saved)
		third := NewHub(sample(t))
		_, _ = third.Restore(&saved)
		last, _ := third.Get(r.Code())
		if err := last.Join(Player{ID: bo.ID, Name: "Бо"}, ""); !errors.Is(err, ErrRemoved) {
			t.Fatalf("sent out, after a restart: %v", err)
		}
		if err := last.Return(ana.ID, boKey); err != nil {
			t.Fatalf("brought back after a restart: %v", err)
		}
		synctest.Wait()
	})
}
