package room

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
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
			v = n.Min
			if n.Answer-n.Min < n.Max-n.Answer {
				v = n.Max
			}
		}
		a = map[string]float64{"value": v}
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

		// The next question: nobody answers, and its time runs out by itself.
		if err := r.Next(bo.ID); !errors.Is(err, ErrNotYours) {
			t.Fatalf("a guest moved on while the host is here: %v", err)
		}
		_ = r.Next(ana.ID)
		time.Sleep(play.Limit(r.dealt[1].Question()) + Grace + time.Millisecond)
		synctest.Wait()
		if v := r.View(bo.ID); v.Phase != Reveal || !v.Question.Reveal.Missed {
			t.Fatalf("after the time ran out: %+v", v)
		}

		// The host leaves: anyone may carry on, to the end.
		r.Unfollow(sa)
		for i := 2; r.View(bo.ID).Phase != End; i++ {
			if err := r.Next(bo.ID); err != nil {
				t.Fatalf("question %d: %v", i, err)
			}
			if r.View(bo.ID).Phase == Question {
				_ = r.Answer(bo.ID, r.View(bo.ID).N, answer(r, true)) // the only one online: shows at once
			}
		}
		end := r.View(bo.ID)
		if end.Players[0].Name != "Бо" || end.Players[0].Rights != play.Length-2 {
			t.Fatalf("the end: %+v", end.Players)
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

func TestTwoPeopleDuel(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		var mu sync.Mutex
		var kept []play.Duel
		hub.Kept = func(d play.Duel) { mu.Lock(); kept = append(kept, d); mu.Unlock() }
		codes := make(chan string, 2)
		for _, p := range []Player{{ID: 1, Name: "Ана"}, {ID: 2, Name: "Бо"}} {
			go func() {
				code, err := hub.Match(t.Context(), p, 15*time.Second)
				if err != nil {
					t.Error(err)
				}
				codes <- code
			}()
		}
		a, b := <-codes, <-codes
		if a != b || a == "" {
			t.Fatalf("matched into %q and %q", a, b)
		}
		r, _ := hub.Get(a)
		if err := r.Join(Player{ID: 3, Name: "Трети"}); !errors.Is(err, ErrFull) {
			t.Fatalf("a third joined a duel: %v", err)
		}
		sa, _ := r.Follow(1)
		if r.View(1).Phase != Lobby {
			t.Fatal("started before both were there")
		}
		_, _ = r.Follow(2)
		if v := r.View(1); v.Phase != Question || !v.Duel || v.CanLead {
			t.Fatalf("the duel didn't start by itself: %+v", v)
		}
		if err := r.Next(1); !errors.Is(err, ErrNotYours) {
			t.Fatalf("someone led a duel: %v", err)
		}
		for n := range play.Length {
			_ = r.Answer(1, n, answer(r, true))
			_ = r.Answer(2, n, answer(r, n%2 == 0))
			if r.View(1).Phase != Reveal {
				t.Fatalf("question %d: no answer shown after both answered", n)
			}
			time.Sleep(Pause + time.Millisecond) // the duel moves on by itself
			synctest.Wait()
		}
		if v := r.View(1); v.Phase != End || v.Players[0].Name != "Ана" {
			t.Fatalf("the end: %+v", v)
		}
		synctest.Wait()
		mu.Lock()
		defer mu.Unlock()
		if len(kept) != 2 {
			t.Fatalf("%d duels kept", len(kept))
		}
		for _, d := range kept {
			want := map[int64]string{1: "won", 2: "lost"}[d.UserID]
			if d.Outcome != want || d.Recorded || len(d.Answers) != play.Length {
				t.Fatalf("kept %+v", d)
			}
		}
		r.Unfollow(sa)
	})
}

func TestADuelAgainstARecording(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := sample(t)
		hub := NewHub(b)
		// The recording: ten choices, each answered right (or not at all, for the third) after three seconds.
		rec := &play.Recording{Name: "Видра 412", Answers: map[int]play.Recorded{}}
		for i, q := range b().Live("", "choice")[:play.Length] {
			p := play.Pick{ID: q.Base().ID, Seed: uint64(i)}
			rec.Picks = append(rec.Picks, p)
			raw, _ := json.Marshal(q.Deal(p.Seed).Reveal())
			var rv struct{ Pick int }
			_ = json.Unmarshal(raw, &rv)
			if i != 2 {
				rec.Answers[i] = play.Recorded{Shown: json.RawMessage(fmt.Sprintf(`{"pick":%d}`, rv.Pick)), Ms: 3000}
			}
		}
		hub.Recording = func(context.Context, int64) (*play.Recording, error) { return rec, nil }
		var kept []play.Duel
		hub.Kept = func(d play.Duel) { kept = append(kept, d) }

		code, err := hub.Match(t.Context(), Player{ID: 1, Name: "Ана"}, 15*time.Second)
		if err != nil {
			t.Fatal(err)
		}
		r, _ := hub.Get(code)
		_, _ = r.Follow(1)
		v := r.View(1)
		if v.Phase != Question || len(v.Players) != 2 || !slices.ContainsFunc(v.Players, func(p PlayerView) bool { return p.Recording && p.Name == "Видра 412" }) {
			t.Fatalf("the duel against a recording: %+v", v)
		}
		for n := range play.Length {
			if n == 2 {
				// The recording didn't answer this one: answering doesn't wait for it.
				_ = r.Answer(1, n, answer(r, true))
				if r.View(1).Phase != Reveal {
					t.Fatal("waited for a recording that never answers")
				}
			} else {
				time.Sleep(3*time.Second + time.Millisecond) // the recording answers when it did
				synctest.Wait()
				_ = r.Answer(1, n, answer(r, false))
			}
			time.Sleep(Pause + time.Millisecond)
			synctest.Wait()
		}
		synctest.Wait()
		if len(kept) != 1 || kept[0].Outcome != "lost" || !kept[0].Recorded || kept[0].Opponent != "Видра 412" {
			t.Fatalf("kept %+v", kept)
		}
	})
}

func TestNobodyToDuel(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		hub.Recording = func(context.Context, int64) (*play.Recording, error) { return nil, nil }
		if _, err := hub.Match(t.Context(), Player{ID: 1, Name: "Ана"}, 15*time.Second); !errors.Is(err, ErrNobody) {
			t.Fatalf("with nobody about: %v", err)
		}
	})
}

func TestADuelBetweenFriends(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		var mu sync.Mutex
		var kept []play.Duel
		hub.Kept = func(d play.Duel) { mu.Lock(); kept = append(kept, d); mu.Unlock() }
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		r, err := hub.Invite(ana, bo)
		if err != nil {
			t.Fatal(err)
		}
		if len(hub.InvitesFor(2)) != 0 {
			t.Fatal("an invitation listed before whoever asked is waiting in it")
		}
		sa, _ := r.Follow(1)
		inv := hub.InvitesFor(2)
		if len(inv) != 1 || inv[0].Code != r.Code() || inv[0].From != "Ана" || len(hub.InvitesFor(1)) != 0 {
			t.Fatalf("invitations %+v", inv)
		}
		if again, _ := hub.Invite(ana, bo); again != r {
			t.Fatal("asking again opened a second duel")
		}
		if err := r.Join(Player{ID: 3, Name: "Трети"}); !errors.Is(err, ErrFull) {
			t.Fatalf("a third joined a friends' duel: %v", err)
		}
		if v := r.View(1); v.Phase != Lobby || !v.Invite || !v.Duel {
			t.Fatalf("waiting: %+v", v)
		}
		_ = r.Join(bo)
		_, _ = r.Follow(2)
		if r.View(2).Phase != Question {
			t.Fatal("the duel didn't start once the friend came")
		}
		if len(hub.InvitesFor(2)) != 0 {
			t.Fatal("a started duel still listed as an invitation")
		}
		for n := range play.Length {
			_ = r.Answer(1, n, answer(r, true))
			_ = r.Answer(2, n, answer(r, false))
			time.Sleep(Pause + time.Millisecond)
			synctest.Wait()
		}
		synctest.Wait()
		mu.Lock()
		if len(kept) != 2 {
			t.Fatalf("%d duels kept", len(kept))
		}
		for _, d := range kept {
			if want := map[int64]int64{1: 2, 2: 1}[d.UserID]; d.OpponentID != want || d.Recorded {
				t.Fatalf("kept %+v", d)
			}
		}
		mu.Unlock()
		r.Unfollow(sa)

		// Turned down: both screens hear why.
		r2, _ := hub.Invite(ana, bo)
		s2, _ := r2.Follow(1)
		if err := r2.Decline(3); !errors.Is(err, ErrNotNow) {
			t.Fatalf("a stranger declined: %v", err)
		}
		if err := r2.Decline(2); err != nil {
			t.Fatal(err)
		}
		<-s2.Done
		if r2.Ended() != Declined {
			t.Fatalf("ended %q", r2.Ended())
		}

		// Not answered in time: it expires.
		r3, _ := hub.Invite(ana, bo)
		s3, _ := r3.Follow(1)
		time.Sleep(InviteTime + time.Second)
		hub.Sweep()
		<-s3.Done
		if r3.Ended() != Expired || len(hub.InvitesFor(2)) != 0 {
			t.Fatalf("ended %q", r3.Ended())
		}
	})
}
