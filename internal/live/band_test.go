package live

import (
	"errors"
	"testing"
	"testing/synctest"
	"time"
)

// settled says whether a seek has come out (a duel, or nothing) by now.
func settled(s *Seek) bool {
	synctest.Wait()
	select {
	case <-s.Done():
		return true
	default:
		return false
	}
}

// Two meet first if their ratings are close: within 100 at once, 250 after 3 s, anyone after 6 s; a player who came
// later but fits is met before one who doesn't.
func TestBands(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		rated := func(rating int) Player {
			p := w.user()
			p.Rating = rating
			return p
		}

		// Ana (1000) waits; Bo (1400) is too far from her, Cy (1050) isn't: Ana and Cy play, Bo waits on.
		ana, bo, cy := rated(1000), rated(1400), rated(1050)
		sa := w.hub.Seek(ana)
		time.Sleep(time.Second)
		sb := w.hub.Seek(bo)
		if settled(sa) || settled(sb) {
			t.Fatal("Ana and Bo, 400 apart, met at once")
		}
		sc := w.hub.Seek(cy)
		if !settled(sa) || !settled(sc) || sa.Err != nil || sa.Match == nil || sa.Match != sc.Match {
			t.Fatalf("Ana and Cy, 50 apart: %v %v", sa.Err, sc.Err)
		}
		if settled(sb) {
			t.Fatal("Bo met someone")
		}
		sb.Leave()

		// Di (1000) and Ed (1200): not at once, but once Di has waited 3 s.
		di, ed := rated(1000), rated(1200)
		sd := w.hub.Seek(di)
		time.Sleep(time.Second)
		se := w.hub.Seek(ed)
		time.Sleep(1900 * time.Millisecond)
		if settled(sd) {
			t.Fatal("200 apart, met before 3 s")
		}
		time.Sleep(200 * time.Millisecond)
		if !settled(sd) || !settled(se) || sd.Match == nil || sd.Match != se.Match {
			t.Fatalf("200 apart, after 3 s: %v %v", sd.Err, se.Err)
		}

		// Fa (1000) and Gu (2000): anyone, once Fa has waited 6 s; before Wait, so no recording.
		fa, gu := rated(1000), rated(2000)
		sf := w.hub.Seek(fa)
		time.Sleep(4 * time.Second)
		sg := w.hub.Seek(gu)
		time.Sleep(1900 * time.Millisecond)
		if settled(sf) {
			t.Fatal("1000 apart, met before 6 s")
		}
		time.Sleep(200 * time.Millisecond)
		if !settled(sf) || !settled(sg) || sf.Match == nil || sf.Match != sg.Match {
			t.Fatalf("1000 apart, after 6 s: %v %v", sf.Err, sg.Err)
		}
	})
}

// A rematch shows the other how long they have to ask too.
func TestRematchShowsTime(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		defer m.Unfollow(fa)
		fb, _ := m.Follow(bo.ID)
		defer m.Unfollow(fb)
		toEnd(m, ana.ID, ana.ID, bo.ID)
		ra := w.hub.Rematch(ana, m.ID())
		defer ra.Leave()
		time.Sleep(5 * time.Second)
		v := m.View(bo.ID)
		if !v.Them.Rematch || v.Them.RematchMs != (RematchFor-5*time.Second).Milliseconds() {
			t.Fatalf("what Bo sees of Ana's ask: %+v", v.Them)
		}
		<-ra.Done()
		if v := m.View(bo.ID); v.Them.Rematch || v.Them.RematchMs != 0 || !errors.Is(ra.Err, ErrNoRematch) {
			t.Fatalf("Ana's ask, run out: %+v (%v)", v.Them, ra.Err)
		}
	})
}

// One who leads while the other is gone takes the win at once: the rest unanswered by both, the leaver named on the
// result even if they come back meanwhile. Not while the other is here, nor without the lead.
func TestClaim(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		defer m.Unfollow(fa)
		fb, _ := m.Follow(bo.ID)
		// Two questions: Ana right on both, Bo wrong.
		for range 2 {
			v := next(m, ana.ID)
			time.Sleep(2500 * time.Millisecond)
			_ = m.Answer(ana.ID, v.N, answer(m, true))
			_ = m.Answer(bo.ID, v.N, answer(m, false))
		}
		if err := m.Claim(ana.ID); !errors.Is(err, ErrNotNow) {
			t.Fatalf("a claim with Bo here: %v", err)
		}
		v := next(m, ana.ID) // the third question
		if v.Phase != PhaseQuestion || v.N != 2 {
			t.Fatalf("the third question: %+v", v)
		}
		if err := m.Leave(bo.ID); err != nil {
			t.Fatal(err)
		}
		m.Unfollow(fb)
		if err := m.Claim(bo.ID); !errors.Is(err, ErrNotNow) {
			t.Fatalf("Bo, gone and behind, claims: %v", err)
		}
		if err := m.Claim(ana.ID); err != nil {
			t.Fatal(err)
		}
		if err := m.Claim(ana.ID); !errors.Is(err, ErrNotNow) {
			t.Fatalf("claimed twice: %v", err)
		}
		// Bo comes back as it's played out: it ends all the same, at once.
		fb, _ = m.Follow(bo.ID)
		defer m.Unfollow(fb)
		time.Sleep(time.Second)
		synctest.Wait()
		v = m.View(ana.ID)
		if v.Phase != PhaseEnd || v.You.Rights != 2 || len(v.You.Trail) != 10 || v.Them.Rights != 0 {
			t.Fatalf("the end, claimed: %+v", v)
		}
		d, err := w.g.DuelOf(t.Context(), ana.ID, m.ID())
		if err != nil || d.State != "won" || d.TheyLeft == nil || *d.TheyLeft != 2 || d.You.Rights != 2 {
			t.Fatalf("Ana's result: %+v (%v)", d, err)
		}
		if d, _ := w.g.DuelOf(t.Context(), bo.ID, m.ID()); d.State != "lost" || d.YouLeft == nil {
			t.Fatalf("Bo's result: %+v", d)
		}
	})
}
