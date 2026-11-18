package room

import (
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// A player's time runs from when their own screen showed the question (Seen), within bounds: a phone a second late
// isn't a second slower in the standings; a screen that says it far too late gains play.LagOf at most; one whose own
// time is up can't answer while another's still runs, and isn't waited for (review 2026-11-18, M1).
func TestTimedFromTheScreen(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo, cy := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}, Player{ID: 3, Name: "Цви"}
		r, _ := hub.Open(ana, "", Settings{})
		_ = r.Join(bo, "")
		_ = r.Join(cy, "")
		for _, p := range []Player{ana, bo, cy} {
			s, _ := r.Follow(p.ID)
			defer r.Unfollow(s)
		}
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		took := func(p Player) int64 {
			r.mu.Lock()
			defer r.mu.Unlock()
			return r.member(p.ID).log[r.n].ms
		}
		q := r.dealt[0].Question()
		lag, limit := play.LagOf(q), play.Limit(q)

		// Ana's screen shows the first question at once, Bo's a second later, Цви's says so ten seconds late (it
		// gains LagOf, no more). All three answer three seconds after the room showed it.
		_ = r.Seen(ana.ID, 0)
		time.Sleep(time.Second)
		_ = r.Seen(bo.ID, 0)
		if v := r.View(bo.ID); v.Question.LeftMs != v.Question.LimitMs {
			t.Fatalf("Bo's time left as his screen shows it: %+v", v.Question)
		}
		time.Sleep(2 * time.Second)
		for _, p := range []Player{ana, bo} {
			if err := r.Answer(p.ID, 0, answer(r, true)); err != nil {
				t.Fatal(err)
			}
		}
		time.Sleep(7 * time.Second)
		_ = r.Seen(cy.ID, 0)
		_ = r.Seen(bo.ID, 0) // a word after the answer changes nothing
		time.Sleep(time.Second)
		if err := r.Answer(cy.ID, 0, answer(r, true)); err != nil {
			t.Fatal(err)
		}
		if took(ana) != 3000 || took(bo) != 2000 || took(cy) != (11*time.Second-lag).Milliseconds() {
			t.Fatalf("their times: %d, %d, %d ms", took(ana), took(bo), took(cy))
		}
		if v := r.View(ana.ID); v.Phase != Reveal || v.Players[0].Name != "Бо" {
			t.Fatalf("the quicker on as many points first: %+v", v.Players)
		}

		// The second: Ana's screen shows it at once, Bo's LagOf later; Цви's never says. Ana's time is up first: her
		// answer then is too late, and the question waits for Bo's and Цви's.
		time.Sleep(Pause + time.Millisecond)
		synctest.Wait()
		q = r.dealt[1].Question()
		lag, limit = play.LagOf(q), play.Limit(q)
		_ = r.Seen(ana.ID, 1)
		time.Sleep(lag)
		_ = r.Seen(bo.ID, 1)
		time.Sleep(limit - lag + play.Grace + lag/2)
		synctest.Wait()
		if err := r.Answer(ana.ID, 1, answer(r, true)); !errors.Is(err, ErrNotNow) {
			t.Fatalf("Ana's answer after her time: %v", err)
		}
		if err := r.Answer(cy.ID, 1, answer(r, true)); err != nil {
			t.Fatalf("Цви's answer, in his time: %v", err)
		}
		if v := r.View(bo.ID); v.Phase != Question {
			t.Fatalf("the question gone before Bo's time is up: %+v", v)
		}
		if err := r.Answer(bo.ID, 1, answer(r, true)); err != nil {
			t.Fatalf("Bo's answer, in his time: %v", err)
		}
		synctest.Wait()
		if v := r.View(ana.ID); v.Phase != Reveal || !v.Question.Reveal.Missed {
			t.Fatalf("the second answer, Ana's time run out: %+v", v)
		}

		// The third: Bo answers at once; Ana's and Цви's screens never say, nor do they answer: the answer shows
		// once their time is up, from the latest their screens could have shown it.
		time.Sleep(Pause + time.Millisecond)
		synctest.Wait()
		q = r.dealt[2].Question()
		lag, limit = play.LagOf(q), play.Limit(q)
		_ = r.Seen(bo.ID, 2)
		if err := r.Answer(bo.ID, 2, answer(r, true)); err != nil {
			t.Fatal(err)
		}
		time.Sleep(limit + play.Grace + time.Millisecond)
		synctest.Wait()
		if v := r.View(bo.ID); v.Phase != Question {
			t.Fatalf("the third gone before LagOf: %+v", v)
		}
		time.Sleep(lag)
		synctest.Wait()
		if v := r.View(bo.ID); v.Phase != Reveal {
			t.Fatalf("the third, the time up: %+v", v)
		}
	})
}
