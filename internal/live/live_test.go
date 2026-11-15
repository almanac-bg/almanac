package live

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"testing"
	"testing/synctest"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

type world struct {
	t   *testing.T
	db  *store.DB
	g   *play.Game
	hub *Hub
	n   int
}

// setup is a game on a new database, with a hub over it; inside a synctest bubble, so time is the test's.
func setup(t *testing.T) *world {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	w := &world{t: t, db: db, g: play.New(db, func() *bank.Bank { return b })}
	w.hub = NewHub(w.g, func(_ context.Context, id int64) (Player, error) {
		return Player{ID: id, Name: fmt.Sprint("Играч ", id)}, nil
	})
	return w
}

func (w *world) user() Player {
	w.t.Helper()
	w.n++
	res, err := w.db.Write.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Играч', ?, 0, 0)`,
		fmt.Sprintf("player%d", w.n))
	if err != nil {
		w.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return Player{ID: id, Name: fmt.Sprint("Играч ", id)}
}

// answer is the right (or a wrong) answer to the duel's question now.
func answer(m *Match, right bool) json.RawMessage {
	m.mu.Lock()
	d := m.dealt[m.n]
	m.mu.Unlock()
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
			v = n.Answer + 10*n.Tolerance*n.Answer
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

// next waits for the duel to move on to its next phase.
func next(m *Match, viewer int64) View {
	before := m.View(viewer)
	for {
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if v := m.View(viewer); v.Phase != before.Phase || v.N != before.N {
			return v
		}
	}
}

// outcome is how the duel ended, as kept.
func (w *world) outcome(id int64) string {
	var o string
	_ = w.db.Read.QueryRow(`SELECT coalesce(outcome, '') FROM duels WHERE id = ?`, id).Scan(&o)
	return o
}

func TestTwoPlayLive(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()

		// Ana waits; Bo comes, and both are in the same duel.
		sa := w.hub.Seek(ana)
		select {
		case <-sa.Done():
			t.Fatal("Ana matched with nobody")
		default:
		}
		if sa.Left() != Wait {
			t.Fatalf("Ana waits %v", sa.Left())
		}
		sb := w.hub.Seek(bo)
		<-sa.Done()
		<-sb.Done()
		if sa.Err != nil || sa.Match == nil || sa.Match != sb.Match {
			t.Fatalf("not matched: %v %v", sa.Err, sb.Err)
		}
		m := sa.Match
		if again := w.hub.Seek(ana); again.Match != m { // a line that came back: the same duel
			t.Fatal("a second look found another duel")
		}
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		defer m.Unfollow(fa)
		defer m.Unfollow(fb)
		v := m.View(ana.ID)
		if v.Phase != PhaseIntro || v.Them.Name != bo.Name || v.Recorded {
			t.Fatalf("the start: %+v", v)
		}

		// The first question, for both; Ana answers right at once, and Bo sees that she has, not what.
		v = next(m, ana.ID)
		if v.Phase != PhaseQuestion || v.N != 0 || v.Question == nil || v.Question.Reveal != nil {
			t.Fatalf("the first question: %+v", v)
		}
		time.Sleep(time.Second)
		if err := m.Answer(ana.ID, 0, answer(m, true)); err != nil {
			t.Fatal(err)
		}
		// A second answer is the first sent again (its reply lost on the way): taken as it was, nothing changed.
		time.Sleep(time.Second)
		if err := m.Answer(ana.ID, 0, answer(m, false)); err != nil {
			t.Fatalf("a second answer: %v", err)
		}
		if vb := m.View(bo.ID); vb.Phase != PhaseQuestion || !vb.Them.Answered || vb.Them.TookMs != 1000 ||
			vb.Them.Given != nil || vb.Them.Gained != 0 {
			t.Fatalf("what Bo sees of Ana's answer: %+v", vb.Them)
		}
		// Bo answers wrong: both answers show.
		time.Sleep(2 * time.Second)
		if err := m.Answer(bo.ID, 0, answer(m, false)); err != nil {
			t.Fatal(err)
		}
		vb := m.View(bo.ID)
		if vb.Phase != PhaseReveal || vb.Question.Reveal.Right || !vb.Them.Right || vb.Them.Given == nil ||
			vb.Them.Gained != play.WorthOf(m.dealt[0].Question(), 1, time.Second, 1).Points || vb.Them.Points != vb.Them.Gained {
			t.Fatalf("after both answered: %+v / %+v", vb.Them, vb.Question.Reveal)
		}
		if err := m.Answer(ana.ID, 0, answer(m, true)); err != nil {
			t.Fatalf("Ana's answer sent again as the answers show: %v", err)
		}

		// The rest: Ana right, Bo wrong, to the end; the result is kept as they finish.
		for {
			v = next(m, ana.ID)
			if v.Phase == PhaseEnd {
				break
			}
			if v.Phase == PhaseQuestion {
				_ = m.Answer(ana.ID, v.N, answer(m, true))
				_ = m.Answer(bo.ID, v.N, answer(m, false))
			}
		}
		if v.You.Rights != play.Length || v.Them.Rights != 0 || len(v.You.Trail) != play.Length {
			t.Fatalf("the end: %+v", v)
		}
		// The score on screen is the one kept: every answer's, the row bonus, and the bonus for all of them right.
		for _, sd := range m.sides {
			var kept int
			_ = w.db.Read.QueryRow(`SELECT points FROM runs WHERE id = ?`, sd.run).Scan(&kept)
			if kept != sd.points {
				t.Fatalf("player %d: %d on screen, %d kept", sd.ID, sd.points, kept)
			}
		}
		if v.You.Points < play.AllRight {
			t.Fatalf("no bonus for all right: %d", v.You.Points)
		}
		if o := w.outcome(m.ID()); o != "a" && o != "b" {
			t.Fatalf("the duel's result: %q", o)
		}
		d, _ := w.g.DuelsOf(t.Context(), ana.ID)
		if len(d) != 1 || d[0].State != "won" || d[0].Delta <= 0 {
			t.Fatalf("Ana's duels: %+v", d)
		}
		// Over: each may look for another.
		if s := w.hub.Seek(ana); s.Match == m {
			t.Fatal("still in the duel that ended")
		} else {
			s.Leave()
		}
	})
}

func TestAgainstARecording(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo, gal := w.user(), w.user(), w.user()

		// Nothing played yet: after the wait, nobody to play.
		s := w.hub.Seek(gal)
		<-s.Done()
		if !errors.Is(s.Err, play.ErrNobody) {
			t.Fatalf("with nothing recorded: %v", s.Err)
		}
		s.Leave()

		// Ana and Bo play one; then Gal waits, nobody comes, and she plays a recording of one of theirs.
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		for v := next(m, ana.ID); v.Phase != PhaseEnd; v = next(m, ana.ID) {
			if v.Phase == PhaseQuestion {
				// At a person's pace for every kind of question, or their games aren't recordings (play.Floor).
				time.Sleep(2500 * time.Millisecond)
				_ = m.Answer(ana.ID, v.N, answer(m, true))
				_ = m.Answer(bo.ID, v.N, answer(m, true))
			}
		}
		m.Unfollow(fa)
		m.Unfollow(fb)

		s = w.hub.Seek(gal)
		<-s.Done()
		if s.Err != nil {
			t.Fatal(s.Err)
		}
		m = s.Match
		fg, _ := m.Follow(gal.ID)
		defer m.Unfollow(fg)
		v := next(m, gal.ID)
		// A duel's game: over all the topics, so no topic is named.
		if !v.Recorded || v.Topic != "" || v.Phase != PhaseQuestion || !v.Them.Online || v.Them.Answered {
			t.Fatalf("against a recording: %+v", v)
		}
		// The recording answers when its player did (2.5 s in), right.
		time.Sleep(2600 * time.Millisecond)
		synctest.Wait()
		if v = m.View(gal.ID); !v.Them.Answered || v.Them.TookMs != 2500 {
			t.Fatalf("the recording's answer: %+v", v.Them)
		}
		_ = m.Answer(gal.ID, 0, answer(m, false))
		if v = m.View(gal.ID); v.Phase != PhaseReveal || !v.Them.Right || v.Them.Gained == 0 {
			t.Fatalf("after Gal answered: %+v", v.Them)
		}
		for v = next(m, gal.ID); v.Phase != PhaseEnd; v = next(m, gal.ID) {
			if v.Phase == PhaseQuestion {
				_ = m.Answer(gal.ID, v.N, answer(m, false))
			}
		}
		if o := w.outcome(m.ID()); o != "ghost_lost" {
			t.Fatalf("Gal's duel: %q", o)
		}
	})
}

func TestOneLeaves(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		defer m.Unfollow(fa)
		fb, _ := m.Follow(bo.ID)
		next(m, ana.ID)

		// Bo's line drops: he's waited for a while, then the duel goes on without him.
		m.Unfollow(fb)
		_ = m.Answer(ana.ID, 0, answer(m, true))
		if v := m.View(ana.ID); v.Phase != PhaseQuestion || v.Them.Online {
			t.Fatalf("not waited for: %+v", v)
		}
		// He's back in time and answers.
		time.Sleep(5 * time.Second)
		fb, _ = m.Follow(bo.ID)
		_ = m.Answer(bo.ID, 0, answer(m, true))
		if m.View(ana.ID).Phase != PhaseReveal {
			t.Fatal("Bo's answer didn't count")
		}
		// He leaves for good: past Away, Ana's answers show at once, and his time runs out on every question.
		v := next(m, ana.ID)
		m.Unfollow(fb)
		time.Sleep(Away + time.Millisecond)
		synctest.Wait()
		for v = m.View(ana.ID); v.Phase != PhaseEnd; v = next(m, ana.ID) {
			if v.Phase == PhaseQuestion {
				_ = m.Answer(ana.ID, v.N, answer(m, true))
				if m.View(ana.ID).Phase != PhaseReveal {
					t.Fatalf("waited for Bo, gone: question %d", v.N)
				}
			}
		}
		d, _ := w.g.DuelsOf(t.Context(), bo.ID)
		if len(d) != 1 || d[0].State != "lost" || d[0].You.Rights != 1 {
			t.Fatalf("Bo's duel: %+v", d)
		}
	})
}

func TestNeverCame(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo, vi := w.user(), w.user(), w.user()

		// Vi waits and gives up: Ana, who comes after, waits too.
		sv := w.hub.Seek(vi)
		sv.Leave()
		sa := w.hub.Seek(ana)
		select {
		case <-sa.Done():
			t.Fatal("matched with Vi, gone")
		default:
		}

		// Bo comes, but his screen never follows the duel: it's called off, without a result.
		sb := w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		defer m.Unfollow(fa)
		time.Sleep(Arrive + time.Second)
		synctest.Wait()
		if v := m.View(ana.ID); v.Phase != PhaseOff {
			t.Fatalf("a duel Bo never came to: %+v", v)
		}
		if o := w.outcome(m.ID()); o != "expired" {
			t.Fatalf("its result: %q", o)
		}
		// Both may look again; the duel is forgotten after a while.
		if s := w.hub.Seek(ana); s.Match == m {
			t.Fatal("still in the duel called off")
		} else {
			s.Leave()
		}
		time.Sleep(Keep + time.Second)
		w.hub.Sweep()
		if _, err := w.hub.Get(m.ID()); !errors.Is(err, ErrNoMatch) {
			t.Fatalf("kept: %v", err)
		}
	})
}

// Paused for a restart, the hub starts no duel: those asking wait, held, past their Wait; the duel under way plays on,
// and counts as under way until it ends. Resumed, those held meet.
func TestPaused(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo, cy, di := w.user(), w.user(), w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		if n := w.hub.UnderWay(); n != 1 {
			t.Fatalf("under way: %d", n)
		}

		w.hub.Pause()
		sc := w.hub.Seek(cy)
		if !sc.Held() {
			t.Fatal("Cy isn't told the server is about to restart")
		}
		sd := w.hub.Seek(di)
		time.Sleep(2 * Wait)
		synctest.Wait()
		select {
		case <-sc.Done():
			t.Fatalf("Cy got a duel while paused: %v", sc.Err)
		case <-sd.Done():
			t.Fatalf("Di got a duel while paused: %v", sd.Err)
		default:
		}

		// The duel under way goes on to its end (nobody answers: it ends all the same).
		for v := next(m, ana.ID); v.Phase != PhaseEnd; v = next(m, ana.ID) {
			if v.Phase == PhaseOff {
				t.Fatal("the duel under way was called off")
			}
		}
		m.Unfollow(fa)
		m.Unfollow(fb)
		if n := w.hub.UnderWay(); n != 0 {
			t.Fatalf("under way after the end: %d", n)
		}

		w.hub.Resume()
		<-sc.Done()
		<-sd.Done()
		if sc.Err != nil || sc.Match == nil || sc.Match != sd.Match {
			t.Fatalf("Cy and Di, resumed: %v %v", sc.Err, sd.Err)
		}
		if sc.Held() {
			t.Fatal("still held after resuming")
		}
	})
}

// A player already waiting when the hub pauses is told so, and held there.
func TestPausedWhileWaiting(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		s := w.hub.Seek(w.user())
		defer s.Leave()
		if s.Held() {
			t.Fatal("held before any pause")
		}
		w.hub.Pause()
		select {
		case <-s.Changed():
		default:
			t.Fatal("not told of the pause")
		}
		if !s.Held() {
			t.Fatal("not held")
		}
		time.Sleep(2 * Wait)
		synctest.Wait()
		select {
		case <-s.Done():
			t.Fatalf("settled while paused: %v", s.Err)
		default:
		}
		// Resumed with its Wait long over: a recording at once (none here: nobody).
		w.hub.Resume()
		<-s.Done()
		if !errors.Is(s.Err, play.ErrNobody) {
			t.Fatalf("after resuming: %v", s.Err)
		}
	})
}
