package live

import (
	"testing"
	"testing/synctest"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// A player's time runs from when their own screen showed the question (Seen), within bounds: a phone that shows it a
// second late isn't a second slower; a screen that says it far too late gains play.LagOf at most; one that never says
// is timed from the duel's moment, with time to answer to the latest it could have seen it; and one whose own time is
// up can't answer while the other's still runs (review 2026-11-18, M1).
func TestTimedFromTheScreen(t *testing.T) {
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
		ms := func(p Player, n int) int64 {
			var ms int64
			run := m.sides[0].run
			if m.sides[1].ID == p.ID {
				run = m.sides[1].run
			}
			if err := w.db.Read.QueryRow(`SELECT ms FROM answers WHERE run_id = ? AND n = ?`, run, n).Scan(&ms); err != nil {
				t.Fatal(err)
			}
			return ms
		}
		question := func(n int) (lag, limit time.Duration) {
			if v := next(m, ana.ID); v.Phase != PhaseQuestion || v.N != n {
				t.Fatalf("question %d: %+v", n, v)
			}
			q := m.dealt[n].Question()
			return play.LagOf(q), play.Limit(q)
		}

		// Bo's screen shows the first question at once, Ana's a second later (a slow line): both answer three seconds
		// after the duel showed it.
		question(0)
		_ = m.Seen(bo.ID, 0)
		time.Sleep(time.Second)
		_ = m.Seen(ana.ID, 0)
		if v := m.View(ana.ID); v.Question.LeftMs != v.Question.LimitMs {
			t.Fatalf("Ana's time left as her screen shows it: %+v", v.Question)
		}
		time.Sleep(time.Second)
		_ = m.Seen(ana.ID, 0) // said again, later: only the first word counts
		time.Sleep(time.Second)
		if err := m.Answer(ana.ID, 0, answer(m, true)); err != nil {
			t.Fatal(err)
		}
		if err := m.Answer(bo.ID, 0, answer(m, true)); err != nil {
			t.Fatal(err)
		}
		if v := m.View(ana.ID); v.Phase != PhaseReveal || v.You.TookMs != 2000 || v.Them.TookMs != 3000 {
			t.Fatalf("Ana's two seconds, Bo's three: %+v / %+v", v.You, v.Them)
		}
		if ms(ana, 0) != 2000 || ms(bo, 0) != 3000 {
			t.Fatalf("as kept: Ana %d ms, Bo %d ms", ms(ana, 0), ms(bo, 0))
		}

		// Ana's screen says it shows the second ten seconds late: it gains LagOf, no more. Bo's never says: timed
		// from the duel's moment, but his time to answer runs to the latest his screen could have shown it.
		lag, limit := question(1)
		time.Sleep(10 * time.Second)
		_ = m.Seen(ana.ID, 1)
		time.Sleep(time.Second)
		if err := m.Answer(ana.ID, 1, answer(m, true)); err != nil {
			t.Fatal(err)
		}
		time.Sleep(lag + limit + play.Grace - 11*time.Second - 100*time.Millisecond)
		synctest.Wait()
		if err := m.Answer(bo.ID, 1, answer(m, true)); err != nil {
			t.Fatalf("Bo's answer, in his time: %v", err)
		}
		v := m.View(ana.ID)
		if v.Phase != PhaseReveal || v.You.TookMs != (11*time.Second-lag).Milliseconds() || !v.Them.Right {
			t.Fatalf("Ana's eleven seconds less LagOf, Bo's answer taken: %+v / %+v", v.You, v.Them)
		}
		if ms(bo, 1) != limit.Milliseconds() {
			t.Fatalf("Bo's time, from the duel's moment: %d ms", ms(bo, 1))
		}

		// Ana's screen shows the third at once, Bo's LagOf later. Ana's time is up first: her answer then is too late,
		// while the question waits for Bo's.
		lag, limit = question(2)
		_ = m.Seen(ana.ID, 2)
		time.Sleep(lag)
		_ = m.Seen(bo.ID, 2)
		time.Sleep(limit - lag + play.Grace + lag/2)
		synctest.Wait()
		if err := m.Answer(ana.ID, 2, answer(m, true)); err != ErrNotNow {
			t.Fatalf("Ana's answer after her time: %v", err)
		}
		if v := m.View(bo.ID); v.Phase != PhaseQuestion {
			t.Fatalf("the question gone before Bo's time is up: %+v", v)
		}
		if err := m.Answer(bo.ID, 2, answer(m, true)); err != nil {
			t.Fatalf("Bo's answer, in his time: %v", err)
		}
		synctest.Wait()
		if v := m.View(bo.ID); v.Phase != PhaseReveal || !v.Question.Reveal.Right || !v.Them.Missed {
			t.Fatalf("the third answer: %+v / %+v", v.Question.Reveal, v.Them)
		}

		// Nobody says when the fourth showed, nor answers: its answer shows at the latest either could have seen it,
		// and their time run out, not before.
		lag, limit = question(3)
		time.Sleep(limit + play.Grace + 100*time.Millisecond)
		synctest.Wait()
		if v := m.View(ana.ID); v.Phase != PhaseQuestion {
			t.Fatalf("the fourth gone before LagOf: %+v", v)
		}
		time.Sleep(lag)
		synctest.Wait()
		if v := m.View(ana.ID); v.Phase != PhaseReveal || !v.Question.Reveal.Missed {
			t.Fatalf("the fourth, its time up: %+v", v)
		}
	})
}
