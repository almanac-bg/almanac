package live

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"testing"
	"testing/synctest"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/bank/banktest"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/safe"
	"github.com/almanac-bg/almanac/internal/store"
	"github.com/almanac-bg/almanac/internal/store/storetest"
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
	db := storetest.Open(t)
	b := banktest.Sample(t)
	w := &world{t: t, db: db, g: play.New(db, func() *bank.Bank { return b })}
	w.hub = NewHub(w.g, func(_ context.Context, id int64) (Player, error) {
		return Player{ID: id, Name: fmt.Sprint("Играч ", id), Tag: fmt.Sprint("player", id)}, nil
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
		if !w.hub.Playing(ana.ID) || !w.hub.Playing(bo.ID) {
			t.Fatal("the duel isn't under way for its players")
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
			vb.Them.Gained != play.WorthOf(m.dealt[0].Question(), 1, time.Second).Points || vb.Them.Points != vb.Them.Gained {
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
		if w.hub.Playing(ana.ID) {
			t.Fatal("a duel over is still under way")
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
		// The recording shows who played it, as anyone shows: their name and tag (play/recordings.go).
		named := false
		for _, id := range []int64{ana.ID, bo.ID} {
			named = named || (v.Them.Name == fmt.Sprint("Играч ", id) && v.Them.Tag == fmt.Sprint("player", id))
		}
		if !named {
			t.Fatalf("the recording's player: %+v", v.Them)
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

// One who leaves for good is waited for Away, whatever question is up by then; after it, they show as gone.
func TestGoneForGood(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		defer m.Unfollow(fa)
		fb, _ := m.Follow(bo.ID)
		v := next(m, ana.ID)
		// Bo's tab closes a second before the first question's time is up; Ana answered it.
		_ = m.Answer(ana.ID, 0, answer(m, true))
		time.Sleep(time.Duration(v.Question.LimitMs-1000) * time.Millisecond)
		m.Unfollow(fb)
		left := time.Now()
		v = next(m, ana.ID)
		if v.Phase != PhaseReveal || v.Them.Gone {
			t.Fatalf("the first answer, Bo away a moment: %+v", v.Them)
		}
		// The second question comes well before Away: Ana answers it at once, and it waits for Bo only until Away.
		v = next(m, ana.ID)
		if v.Phase != PhaseQuestion || v.N != 1 || time.Since(left) >= Away/2 {
			t.Fatalf("the second question, %v after Bo left: %+v", time.Since(left), v)
		}
		_ = m.Answer(ana.ID, 1, answer(m, true))
		v = next(m, ana.ID)
		if v.Phase != PhaseReveal || time.Since(left) > Away+time.Second {
			t.Fatalf("the second answer, %v after Bo left: %+v", time.Since(left), v)
		}
		time.Sleep(max(0, Away-time.Since(left)) + time.Millisecond) // the question's time may have run out first
		synctest.Wait()
		if v := m.View(ana.ID); !v.Them.Gone || v.Them.Online {
			t.Fatalf("Bo, gone for good: %+v", v.Them)
		}
		// Back, he's no longer gone.
		fb, _ = m.Follow(bo.ID)
		defer m.Unfollow(fb)
		if v := m.View(ana.ID); v.Them.Gone || !v.Them.Online {
			t.Fatalf("Bo, back: %+v", v.Them)
		}
	})
}

// A recording that didn't answer a question isn't waited for once the player has answered it: its time ran out.
func TestRecordingMissed(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo, gal := w.user(), w.user(), w.user()
		// Ana and Bo play one; Bo answers only the first half.
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		for v := next(m, ana.ID); v.Phase != PhaseEnd; v = next(m, ana.ID) {
			if v.Phase == PhaseQuestion {
				time.Sleep(2500 * time.Millisecond)
				_ = m.Answer(ana.ID, v.N, answer(m, true))
				if v.N < 5 {
					_ = m.Answer(bo.ID, v.N, answer(m, true))
				}
			}
		}
		m.Unfollow(fa)
		m.Unfollow(fb)
		// Gal plays a recording: with only Ana's game real (Bo's has five not answered), it's hers. Leave it out, and
		// Bo's is all there is.
		_, _ = w.db.Write.Exec(`UPDATE runs SET finished_at = NULL WHERE user_id = ?`, ana.ID)
		s := w.hub.Seek(gal)
		<-s.Done()
		if s.Err != nil {
			t.Fatal(s.Err)
		}
		m = s.Match
		fg, _ := m.Follow(gal.ID)
		defer m.Unfollow(fg)
		for v := next(m, gal.ID); v.Phase != PhaseEnd; v = next(m, gal.ID) {
			if v.Phase != PhaseQuestion {
				continue
			}
			start := time.Now()
			time.Sleep(time.Second)
			_ = m.Answer(gal.ID, v.N, answer(m, false))
			if v.N >= 5 {
				// The recording has no answer here: the answer shows at once.
				if v := m.View(gal.ID); v.Phase != PhaseReveal || time.Since(start) > 2*time.Second || !v.Them.Missed {
					t.Fatalf("question %d, the recording without an answer: %+v", v.N+1, v.Them)
				}
			}
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
		// Nothing was played: it leaves nothing, neither the duel nor their runs.
		w.leftNothing(m.ID(), ana.ID, bo.ID)
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

// leftNothing says a duel called off before it began is gone, and so are the players' runs made for it.
func (w *world) leftNothing(duel int64, players ...int64) {
	w.t.Helper()
	var duels, runs int
	_ = w.db.Read.QueryRow(`SELECT count(*) FROM duels WHERE id = ?`, duel).Scan(&duels)
	for _, id := range players {
		var n int
		_ = w.db.Read.QueryRow(`SELECT count(*) FROM runs WHERE user_id = ? AND id NOT IN
			(SELECT a_run FROM duels WHERE a_run IS NOT NULL UNION SELECT b_run FROM duels WHERE b_run IS NOT NULL)`, id).Scan(&n)
		runs += n
	}
	if duels != 0 || runs != 0 {
		w.t.Fatalf("duel %d called off before it began: %d duels, %d runs left", duel, duels, runs)
	}
}

// One whose screen closed as their duel was found (the wait left in its last second, the recording found meanwhile)
// has followed it a moment, or not at all: it doesn't go on without them to a lost duel they never saw, but waits for
// them until Arrive, and is then called off, leaving nothing. A line that drops in the intro and comes back in time
// plays it.
func TestLeftAsFound(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo, gal := w.user(), w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		for v := next(m, ana.ID); v.Phase != PhaseEnd; v = next(m, ana.ID) {
			if v.Phase == PhaseQuestion {
				time.Sleep(2500 * time.Millisecond)
				_ = m.Answer(ana.ID, v.N, answer(m, true))
				_ = m.Answer(bo.ID, v.N, answer(m, true))
			}
		}
		m.Unfollow(fa)
		m.Unfollow(fb)
		var recordings int
		_ = w.db.Read.QueryRow(`SELECT count(*) FROM runs WHERE finished_at IS NOT NULL`).Scan(&recordings)

		// Gal's recording is found as her screen closes: it follows the duel a moment, and goes.
		s := w.hub.Seek(gal)
		<-s.Done()
		m = s.Match
		fg, _ := m.Follow(gal.ID)
		m.Unfollow(fg)
		s.Leave()
		time.Sleep(Arrive + time.Second)
		synctest.Wait()
		if v := m.View(gal.ID); v.Phase != PhaseOff || v.Question != nil {
			t.Fatalf("a duel Gal left as it was found: %+v", v)
		}
		w.leftNothing(m.ID(), gal.ID)
		if d, _ := w.g.DuelsOf(t.Context(), gal.ID); len(d) != 0 {
			t.Fatalf("Gal's duels: %+v", d)
		}
		if st, _ := w.g.StatsOf(t.Context(), gal.ID); st.Games != 0 || st.Duels != 0 {
			t.Fatalf("Gal's stats: %+v", st)
		}
		var after int
		_ = w.db.Read.QueryRow(`SELECT count(*) FROM runs WHERE finished_at IS NOT NULL`).Scan(&after)
		if after != recordings {
			t.Fatalf("the recordings: %d, were %d", after, recordings)
		}

		// Her next duel: the line drops in the intro and comes back in time; the duel begins once she's back.
		s = w.hub.Seek(gal)
		<-s.Done()
		m = s.Match
		fg, _ = m.Follow(gal.ID)
		m.Unfollow(fg)
		time.Sleep(Intro + 3*time.Second)
		synctest.Wait()
		if v := m.View(gal.ID); v.Phase != PhaseIntro {
			t.Fatalf("begun without Gal: %+v", v)
		}
		fg, _ = m.Follow(gal.ID)
		defer m.Unfollow(fg)
		if v := next(m, gal.ID); v.Phase != PhaseQuestion || v.N != 0 {
			t.Fatalf("Gal back: %+v", v)
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
		if n, _ := w.hub.UnderWay(); n != 1 {
			t.Fatalf("under way: %d", n)
		}
		// A duel busy at the moment (its lock held, as while it takes an answer in) doesn't hold up whoever asks: it
		// counts as under way, for all of a duel.
		m.mu.Lock()
		if n, left := w.hub.UnderWay(); n != 1 || left != Longest {
			m.mu.Unlock()
			t.Fatalf("a busy duel: %d under way, %v left", n, left)
		}
		m.mu.Unlock()

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
		if n, _ := w.hub.UnderWay(); n != 0 {
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

// A live duel's run moves on the duel's clock alone: its player can't show its next question early through their own
// run (in the intro, or while an answer shows), start it, or answer it outside the duel; each question's time on the
// run starts at the moment the duel shows it, so the time on the run is the time in the duel.
func TestNoPeekAhead(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ctx := context.Background()
		ana, bo := w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		defer m.Unfollow(fa)
		defer m.Unfollow(fb)
		run := m.sides[0].run
		if m.sides[0].ID != ana.ID {
			run = m.sides[1].run
		}
		shownAt := func() int64 {
			var at sql.NullInt64
			_ = w.db.Read.QueryRow(`SELECT shown_at FROM runs WHERE id = ?`, run).Scan(&at)
			return at.Int64
		}
		refused := func(when string, n int) {
			t.Helper()
			if s, err := w.g.Show(ctx, ana.ID, run); !errors.Is(err, play.ErrOutOfStep) {
				t.Fatalf("%s: the next question shown through the run: %+v %v", when, s.Question, err)
			}
			if _, err := w.g.Start(ctx, ana.ID, run, n); !errors.Is(err, play.ErrOutOfStep) {
				t.Fatalf("%s: a question started through the run: %v", when, err)
			}
			if _, err := w.g.Answer(ctx, ana.ID, run, n, answer(m, true)); !errors.Is(err, play.ErrOutOfStep) {
				t.Fatalf("%s: answered through the run: %v", when, err)
			}
			if n > 0 {
				if _, err := w.g.Answer(ctx, ana.ID, run, n-1, answer(m, true)); !errors.Is(err, play.ErrOutOfStep) {
					t.Fatalf("%s: the answer before sent again through the run: %v", when, err)
				}
			}
		}

		// The intro: nothing to see on the run, and nothing it can be made to show.
		refused("the intro", 0)
		if s, _ := w.g.State(ctx, ana.ID, run); s.Question != nil || shownAt() != 0 {
			t.Fatalf("the run shows a question in the intro: %+v", s.Question)
		}

		// The first question: on the run at the duel's moment; answered in the duel a second in, a second on the run.
		next(m, ana.ID)
		if shownAt() != m.shownAt.UnixMilli() {
			t.Fatalf("the run's question shown at %d, the duel's at %d", shownAt(), m.shownAt.UnixMilli())
		}
		refused("the question", 0)
		time.Sleep(time.Second)
		if err := m.Answer(ana.ID, 0, answer(m, true)); err != nil {
			t.Fatal(err)
		}
		if err := m.Answer(bo.ID, 0, answer(m, false)); err != nil {
			t.Fatal(err)
		}
		var ms int64
		_ = w.db.Read.QueryRow(`SELECT ms FROM answers WHERE run_id = ? AND n = 0`, run).Scan(&ms)
		if ms != 1000 {
			t.Fatalf("a second in the duel is %d ms on the run", ms)
		}

		// The answer shows: the next question isn't on the run yet, and can't be put there.
		if v := m.View(ana.ID); v.Phase != PhaseReveal {
			t.Fatalf("not the answer: %+v", v)
		}
		refused("the answer", 1)
		if s, _ := w.g.State(ctx, ana.ID, run); s.Question != nil || shownAt() != 0 {
			t.Fatalf("the next question on the run while the answer shows: %+v", s.Question)
		}
		v := next(m, ana.ID)
		if v.Phase != PhaseQuestion || v.N != 1 || shownAt() != m.shownAt.UnixMilli() {
			t.Fatalf("the second question: %+v, on the run at %d, in the duel at %d", v, shownAt(), m.shownAt.UnixMilli())
		}
	})
}

// A duel can tell how long it may still take, by its own clock: from its start, never less than it takes, however its
// questions go; it shrinks as it's played, and is nothing once it's over.
func TestLeft(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		if _, l := w.hub.UnderWay(); l != 0 {
			t.Fatalf("nothing under way, %v left", l)
		}
		ana, bo := w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		defer m.Unfollow(fa)
		defer m.Unfollow(fb)
		_, left := w.hub.UnderWay()
		if left <= 0 || left > Longest {
			t.Fatalf("a duel just made: %v left (Longest %v)", left, Longest)
		}
		end := time.Now().Add(left)
		// Nobody answers: each question takes all its time, and its answer shows after.
		for v := next(m, ana.ID); v.Phase != PhaseEnd; v = next(m, ana.ID) {
			_, now := w.hub.UnderWay()
			if now <= 0 || now > left || time.Now().Add(now).After(end) {
				t.Fatalf("question %d (%s): %v left, after %v", v.N, v.Phase, now, left)
			}
			left = now
		}
		if time.Now().After(end) {
			t.Fatalf("the duel ended %v after it said it would at the latest", time.Since(end))
		}
		if _, l := w.hub.UnderWay(); l != 0 {
			t.Fatalf("over, %v left", l)
		}
	})
}

// A duel's clock that panics (package safe stops it) calls the duel off, without a result, and frees its players; a
// wait for a duel whose clock panics ends, told so, and the player may ask again. The process goes on.
func TestABrokenClock(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo, vi := w.user(), w.user(), w.user()
		sa := w.hub.Seek(ana)
		sb := w.hub.Seek(bo)
		<-sa.Done()
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		defer m.Unfollow(fa)
		defer m.Unfollow(fb)
		if v := next(m, ana.ID); v.Phase != PhaseQuestion {
			t.Fatalf("the first question: %+v", v)
		}
		m.mu.Lock()
		m.after(time.Second, func() { panic("the clock broke") })
		m.mu.Unlock()
		time.Sleep(2 * time.Second)
		synctest.Wait()
		if v := m.View(ana.ID); v.Phase != PhaseOff {
			t.Fatalf("the broken duel: %+v", v)
		}
		if w.hub.Playing(ana.ID) || w.hub.Playing(bo.ID) {
			t.Fatal("its players are still in it")
		}
		if o := w.outcome(m.ID()); o != "expired" {
			t.Fatalf("kept as %q", o)
		}

		// Vi's wait breaks as it runs out: the seek ends, and Vi isn't left waiting or being matched.
		sv := w.hub.Seek(vi)
		w.hub.mu.Lock()
		sv.timer.Stop()
		sv.timer = safe.AfterFunc(time.Second, "live: a wait for a duel", func() { panic("the wait broke") }, sv.broken)
		w.hub.mu.Unlock()
		time.Sleep(2 * time.Second)
		synctest.Wait()
		select {
		case <-sv.Done():
		default:
			t.Fatal("the broken wait never ended")
		}
		if sv.Err == nil {
			t.Fatal("the broken wait ended without an error")
		}
		sv.settle(nil, nil) // a second settle changes nothing
		if sv.Err == nil {
			t.Fatal("settled twice")
		}
	})
}

// The duel's lock is never held across a write to the database: while the database is busy with something else, the
// screens, the other player and the server's drain go on; and an answer that came in time, still being kept as its
// question's time runs out, counts, the answer shown once it's in.
func TestAWriteHoldsNoScreen(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		ana, bo := w.user(), w.user()
		sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
		<-sa.Done()
		<-sb.Done()
		m := sa.Match
		fa, _ := m.Follow(ana.ID)
		fb, _ := m.Follow(bo.ID)
		defer m.Unfollow(fa)
		defer m.Unfollow(fb)
		v := next(m, ana.ID)
		if v.Phase != PhaseQuestion {
			t.Fatalf("the first question: %+v", v)
		}
		right := answer(m, true)

		// A second before the question's time is up, the database's one writer is busy: Ana's answer waits for it.
		time.Sleep(time.Duration(v.Question.LimitMs)*time.Millisecond - time.Second)
		ctx := context.Background()
		conn, err := w.db.Write.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		answered := make(chan error, 1)
		go func() { answered <- m.Answer(ana.ID, 0, right) }()
		synctest.Wait()
		if v := m.View(bo.ID); v.Phase != PhaseQuestion || v.Them.Answered { // Bo's screen isn't held up
			t.Fatalf("what Bo sees while Ana's answer is kept: %+v", v)
		}
		if n, left := w.hub.UnderWay(); n != 1 || left == Longest {
			t.Fatalf("%d duels under way, %v left", n, left)
		}
		// The question's time runs out meanwhile: its answer waits for Ana's.
		time.Sleep(time.Second + play.SeenLag + play.Grace + time.Second) // Ana's screen never said when it showed it
		synctest.Wait()
		if v := m.View(bo.ID); v.Phase != PhaseQuestion {
			t.Fatalf("the answer shown before Ana's was in: %+v", v)
		}

		if err := tx.Rollback(); err != nil {
			t.Fatal(err)
		}
		conn.Close()
		if err := <-answered; err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		v = m.View(bo.ID)
		if v.Phase != PhaseReveal || !v.Them.Right || v.Them.Gained == 0 || !v.Question.Reveal.Missed {
			t.Fatalf("the answer once Ana's was in: %+v / %+v", v.Them, v.Question.Reveal)
		}
	})
}
