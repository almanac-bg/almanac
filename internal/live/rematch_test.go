package live

import (
	"errors"
	"testing"
	"testing/synctest"
	"time"
)

// toEnd plays the duel to its end, each of those named answering every question (the first right, the rest wrong).
func toEnd(m *Match, viewer int64, players ...int64) View {
	for {
		v := next(m, viewer)
		if v.Phase == PhaseEnd || v.Phase == PhaseOff {
			return v
		}
		if v.Phase == PhaseQuestion {
			time.Sleep(2500 * time.Millisecond) // a person's pace, or the game is no recording (play.Floor)
			for i, p := range players {
				_ = m.Answer(p, v.N, answer(m, i == 0))
			}
		}
	}
}

// One who leaves under way and never comes back is named on the result (after which question), and told on Начало.
func TestLeftIsNamed(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		defer m.Unfollow(fa)
		fb, _ := m.Follow(bo.ID)
		// Both play three questions; Bo leaves as the fourth shows, and the duel goes on without him.
		for range 3 {
			v := next(m, ana.ID) // both answered, the answer shows at once: this is the next question
			_ = m.Answer(ana.ID, v.N, answer(m, true))
			_ = m.Answer(bo.ID, v.N, answer(m, true))
		}
		v := next(m, ana.ID)
		if v.Phase != PhaseQuestion || v.N != 3 {
			t.Fatalf("the fourth question: %+v", v)
		}
		m.Unfollow(fb)
		if v := toEnd(m, ana.ID, ana.ID); v.Phase != PhaseEnd {
			t.Fatalf("the end: %+v", v)
		}
		d, err := w.g.DuelOf(t.Context(), ana.ID, m.ID())
		if err != nil || d.TheyLeft == nil || *d.TheyLeft != 3 || d.YouLeft != nil || d.State != "won" {
			t.Fatalf("Ana's result: %+v (%v)", d, err)
		}
		if d, _ := w.g.DuelOf(t.Context(), bo.ID, m.ID()); d.YouLeft == nil || *d.YouLeft != 3 {
			t.Fatalf("Bo's result: %+v", d)
		}
		// Bo hears what came of it on Начало, once.
		l, err := w.g.LeftOf(t.Context(), bo.ID)
		if err != nil || l == nil || l.DuelID != m.ID() || l.After != 3 || l.State != "lost" || l.Them != "Играч" {
			t.Fatalf("Bo's line: %+v (%v)", l, err)
		}
		if l, _ := w.g.LeftOf(t.Context(), ana.ID); l != nil {
			t.Fatalf("Ana didn't leave: %+v", l)
		}
		if err := w.g.Told(t.Context(), bo.ID, l.Line); err != nil {
			t.Fatal(err)
		}
		if l, _ := w.g.LeftOf(t.Context(), bo.ID); l != nil {
			t.Fatalf("told twice: %+v", l)
		}
	})
}

// A duel just over: one asks for a rematch, the other sees it and asks too, and they're in a new duel together.
func TestRematch(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		defer m.Unfollow(fa)
		defer m.Unfollow(fb)
		// Under way, there's none to have.
		if s := w.hub.Rematch(ana, m.ID()); !errors.Is(s.Err, ErrNoRematch) {
			t.Fatalf("a rematch under way: %v", s.Err)
		}
		toEnd(m, ana.ID, ana.ID, bo.ID)

		ra := w.hub.Rematch(ana, m.ID())
		select {
		case <-ra.Done():
			t.Fatalf("settled alone: %v", ra.Err)
		default:
		}
		if ra.Left() != RematchFor {
			t.Fatalf("Ana waits %v", ra.Left())
		}
		if v := m.View(bo.ID); !v.Them.Rematch {
			t.Fatalf("Bo doesn't see that Ana asks: %+v", v.Them)
		}
		time.Sleep(5 * time.Second)
		rb := w.hub.Rematch(bo, m.ID())
		<-ra.Done()
		<-rb.Done()
		if ra.Err != nil || rb.Err != nil || ra.Match == nil || ra.Match != rb.Match || ra.Match == m {
			t.Fatalf("no rematch: %v %v", ra.Err, rb.Err)
		}
		n := ra.Match
		if v := n.View(ana.ID); v.Them.Name != bo.Name || v.Recorded {
			t.Fatalf("the rematch: %+v", v)
		}
		ra.Leave()
		rb.Leave()
		f2a, _ := n.Follow(ana.ID)
		f2b, _ := n.Follow(bo.ID)
		defer n.Unfollow(f2a)
		defer n.Unfollow(f2b)
		toEnd(n, ana.ID, bo.ID, ana.ID)

		// After that one, Bo asks and Ana doesn't: called off after RematchFor, and Ana's screen stops saying so.
		rb = w.hub.Rematch(bo, n.ID())
		synctest.Wait()
		if v := n.View(ana.ID); !v.Them.Rematch {
			t.Fatal("Ana doesn't see that Bo asks")
		}
		<-rb.Done()
		synctest.Wait()
		if !errors.Is(rb.Err, ErrNoRematch) {
			t.Fatalf("not asked back: %v", rb.Err)
		}
		if v := n.View(ana.ID); v.Them.Rematch {
			t.Fatal("still says Bo asks")
		}
		// Bo asks, then closes his screen: he isn't waited for.
		rb = w.hub.Rematch(bo, n.ID())
		synctest.Wait()
		rb.Leave()
		synctest.Wait()
		if v := n.View(ana.ID); v.Them.Rematch {
			t.Fatal("Bo left, still asks")
		}
		// Asked as the server is about to restart: called off at once, told so.
		rb = w.hub.Rematch(bo, n.ID())
		w.hub.Pause()
		<-rb.Done()
		if !errors.Is(rb.Err, ErrPaused) {
			t.Fatalf("paused: %v", rb.Err)
		}
		if s := w.hub.Rematch(ana, n.ID()); !errors.Is(s.Err, ErrPaused) {
			t.Fatalf("asked while paused: %v", s.Err)
		}
		w.hub.Resume()
	})
}

// Against a recording there's nobody to ask.
func TestNoRematchWithARecording(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		// Ana and Bo play: then Cy, alone, plays against a recording of one of them.
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		toEnd(m, ana.ID, ana.ID, bo.ID)
		m.Unfollow(fa)
		m.Unfollow(fb)
		cy := w.user()
		s := w.hub.Seek(cy)
		<-s.Done()
		if s.Err != nil {
			t.Fatal(s.Err)
		}
		r := s.Match
		fc, _ := r.Follow(cy.ID)
		defer r.Unfollow(fc)
		if v := toEnd(r, cy.ID, cy.ID); !v.Recorded {
			t.Fatalf("not a recording: %+v", v)
		}
		if s := w.hub.Rematch(cy, r.ID()); !errors.Is(s.Err, ErrNoRematch) {
			t.Fatalf("a rematch against a recording: %v", s.Err)
		}
	})
}
