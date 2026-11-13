package room

import (
	"encoding/json"
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
)

func sample(t *testing.T) func() *bank.Bank {
	t.Helper()
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	return func() *bank.Bank { return b }
}

// answer is the right (or a wrong) answer to the room's question now, as a player would give it.
func answer(r *Room, right bool) json.RawMessage {
	r.mu.Lock()
	d := r.dealt[r.n]
	r.mu.Unlock()
	raw, _ := json.Marshal(d.Reveal())
	var rv struct {
		Pick  *int     `json:"pick"`
		Value *float64 `json:"value"`
		Order []int    `json:"order"`
		Truth *bool    `json:"truth"`
		Pairs []int    `json:"pairs"`
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
		r, err := hub.Open(ana, "")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := hub.Get(r.Code()); err != nil || len(r.Code()) != 6 {
			t.Fatalf("code %q: %v", r.Code(), err)
		}
		_ = r.Join(bo)
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

		// Ana answers at once and right; the answer waits for Bo, then shows.
		time.Sleep(time.Second)
		if err := r.Answer(ana.ID, 0, answer(r, true)); err != nil {
			t.Fatal(err)
		}
		if err := r.Answer(ana.ID, 0, answer(r, true)); !errors.Is(err, ErrNotNow) {
			t.Fatalf("a second answer: %v", err)
		}
		if r.View(ana.ID).Phase != Question {
			t.Fatal("the answer showed before Bo answered")
		}
		time.Sleep(5 * time.Second)
		_ = r.Answer(bo.ID, 0, answer(r, false))
		v = r.View(ana.ID)
		if v.Phase != Reveal || v.Players[0].Name != "Ана" || !v.Players[0].Right || v.Question.Reveal.Points < 90 {
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
		time.Sleep(play.Limit(r.dealt[1].Question()) + Grace + time.Millisecond)
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
		r, _ := hub.Open(Player{ID: 1, Name: "Ана"}, "history")
		s, _ := r.Follow(1)
		<-s.C // following is a change
		_ = r.Join(Player{ID: 2, Name: "Бо"})
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
	if _, err := hub.Open(Player{ID: 1, Name: "Ана"}, "astrology"); !errors.Is(err, play.ErrNoTopic) {
		t.Fatalf("an unknown topic: %v", err)
	}
	r, _ := hub.Open(Player{ID: 1, Name: "Ана"}, "")
	for i := range MaxPlayers - 1 {
		if err := r.Join(Player{ID: int64(i + 2), Name: "Играч"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Join(Player{ID: 999, Name: "Още един"}); !errors.Is(err, ErrFull) {
		t.Fatalf("player %d: %v", MaxPlayers+1, err)
	}
	if err := r.Answer(1, 0, json.RawMessage(`{"pick":0}`)); !errors.Is(err, ErrNotNow) {
		t.Fatalf("an answer in the lobby: %v", err)
	}
}
