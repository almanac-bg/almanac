package play

import (
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A day's board is counted once for a while, for everyone; the viewer's own game is in it at once, finished since or
// not.
func TestBoardKeptAWhile(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	patience, stale := boardPatience, boardStale
	t.Cleanup(func() { boardPatience, boardStale = patience, stale })
	boardPatience, boardStale = 1<<30, time.Hour

	ana, bo, vi := w.user(), w.user(), w.user()
	day := func(user int64, rights int) {
		s, err := w.g.StartDay(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		w.play(user, s.ID, append(repeat(w.right, rights), repeat(w.wrong, Length-rights)...)...)
	}
	today := w.g.Today()
	day(ana, 5)
	if b, err := w.g.BoardOf(ctx, today, vi); err != nil || b.Players != 1 || len(b.Top) != 1 || b.Place != 0 {
		t.Fatalf("the first count: %+v %v", b, err)
	}
	// Bo finishes ahead of Ana after the count: Bo sees their game first, and their place, at once.
	day(bo, 9)
	b, err := w.g.BoardOf(ctx, today, bo)
	if err != nil || b.Players != 2 || len(b.Top) != 2 || !b.Top[0].Me || b.Top[0].Rights != 9 || b.Place != 1 ||
		b.Mine == nil || b.Top[1].Me {
		t.Fatalf("the day as Bo sees it, just played: %+v %v", b, err)
	}
	if b, _ := w.g.BoardOf(ctx, today, ana); b.Players != 1 || b.Place != 1 || !b.Top[0].Me {
		t.Fatalf("the day as Ana sees it, from the count kept: %+v", b)
	}
	// Once it's due, it's counted again, for all.
	boardStale = 0
	if b, _ := w.g.BoardOf(ctx, today, ana); b.Players != 2 || b.Place != 2 || !b.Top[1].Me || b.Top[0].Me {
		t.Fatalf("the day as Ana sees it, counted again: %+v", b)
	}
	if b, _ := w.g.BoardOf(ctx, today, bo); b.Players != 2 || b.Place != 1 || !b.Top[0].Me || len(b.Top) != 2 {
		t.Fatalf("the day as Bo sees it, counted again: %+v", b)
	}
}

// A day's crowd kept is shown fresh for a while; then one answer at a time counts it again, the others shown the
// last count meanwhile; one too old, or of another version of its question, isn't shown. With none kept, the first
// answer counts it, and the others wait for that count.
func TestDayCrowdCountedByOne(t *testing.T) {
	var d dayCrowdCache
	now, c := time.Date(2026, 11, 12, 10, 0, 0, 0, Bulgaria), &bank.Crowd{Answers: 300}
	d.put("k", "v1", c, now)
	if k, lead, again := d.look("k", "v1", now.Add(time.Second)); d.crowd(k) != c || lead || again {
		t.Fatalf("fresh: %v %v %v", k, lead, again)
	}
	later := now.Add(dayCrowdFresh)
	if k, _, again := d.look("k", "v1", later); d.crowd(k) != c || !again {
		t.Fatalf("due, the first: %v", again)
	}
	if k, _, again := d.look("k", "v1", later); d.crowd(k) != c || again {
		t.Fatalf("due, while it's counted: %v", again)
	}
	d.put("k", "v1", c, later)
	if _, _, again := d.look("k", "v1", later.Add(time.Second)); again {
		t.Fatal("counted again, still due")
	}
	if k, lead, _ := d.look("k", "v1", later.Add(dayCrowdUsable)); d.crowd(k) != nil || !lead {
		t.Fatal("shown too old")
	}
	d.put("k", "v1", c, later)
	if k, lead, _ := d.look("k", "v2", later); d.crowd(k) != nil || !lead {
		t.Fatal("shown for another version")
	}
	d.drop("k")
	// None kept: the first counts, those meanwhile wait for it; a crowd too small to keep is for each to count.
	k, lead, _ := d.look("k", "v1", later)
	if !lead {
		t.Fatal("nobody counts the first")
	}
	other, again, _ := d.look("k", "v1", later)
	if again || other != k {
		t.Fatal("two count the first")
	}
	select {
	case <-other.ready:
		t.Fatal("ready before its count")
	default:
	}
	d.first("k", k, &bank.Crowd{Answers: 12}, 12, nil)
	<-other.ready
	if d.crowd(other) != nil {
		t.Fatal("a crowd too small to keep, kept")
	}
	if _, lead, _ := d.look("k", "v1", later.Add(time.Second)); lead {
		t.Fatal("counted first again, while the small one stands")
	}
	d.drop("k")
	k, _, _ = d.look("k", "v1", later)
	d.first("k", k, c, dayCrowdKeep, nil)
	if k, lead, _ := d.look("k", "v1", later.Add(time.Second)); lead || d.crowd(k) != c {
		t.Fatal("a first count big enough isn't kept")
	}
}

// A day's boards rank by right answers, then by how close the hard number came: nine right are never under eight,
// however close an eight's number came; among as many right, the closer number goes first. The same on the day's
// board, its places, the friends' board and the friends' list.
func TestDayBoardsRankRightsFirst(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	stale := boardStale
	t.Cleanup(func() { boardStale = stale })
	boardStale = 0

	nine, quick, slow := w.user(), w.user(), w.user()
	w.befriend(nine, quick)
	w.befriend(nine, slow)
	// Each finishes the day, then their game is set to the case: Bo's eight right came closer on the number than
	// Ana's nine, and than Vi's eight.
	set := map[int64][2]int{nine: {9, 100}, quick: {8, 700}, slow: {8, 400}}
	for _, user := range []int64{slow, quick, nine} {
		s, err := w.g.StartDay(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		c := set[user]
		w.play(user, s.ID, append(repeat(w.right, c[0]), repeat(w.wrong, Length-c[0])...)...)
		if _, err := w.db.Write.ExecContext(ctx, `UPDATE runs SET closeness = ? WHERE id = ?`, c[1], s.ID); err != nil {
			t.Fatal(err)
		}
	}
	today := w.g.Today()
	tags := map[string]int64{}
	for _, id := range []int64{nine, quick, slow} {
		var tag string
		if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, id).Scan(&tag); err != nil {
			t.Fatal(err)
		}
		tags[tag] = id
	}
	order := func(scores []Score) []int64 {
		var out []int64
		for _, s := range scores {
			out = append(out, tags[s.Tag])
		}
		return out
	}
	want := []int64{nine, quick, slow}
	b, err := w.g.BoardOf(ctx, today, quick)
	if err != nil || !slices.Equal(order(b.Top), want) || b.Place != 2 || !b.Top[1].Me {
		t.Fatalf("the day's board, as Bo sees it: %v place %d %v", order(b.Top), b.Place, err)
	}
	for user, place := range map[int64]int{nine: 1, quick: 2, slow: 3} {
		if b, _ := w.g.BoardOf(ctx, today, user); b.Place != place {
			t.Fatalf("player %d's place: %d, not %d", user, b.Place, place)
		}
	}
	f, err := w.g.FriendsBoard(ctx, today, slow)
	if err != nil || !slices.Equal(order(f), []int64{nine, slow}) {
		t.Fatalf("the friends' board, as Vi sees it: %v %v", order(f), err)
	}
	if f, _ := w.g.FriendsBoard(ctx, today, nine); !slices.Equal(order(f), want) || !f[0].Me {
		t.Fatalf("the friends' board, as Ana sees it: %v", order(f))
	}
	list, err := w.g.FriendsOf(ctx, nine)
	if err != nil || len(list) != 2 || list[0].ID != quick || list[1].ID != slow {
		t.Fatalf("Ana's friends: %+v %v", list, err)
	}
}

// The friends' board shows how each of a friend's ten went once the viewer has finished the day, never before.
func TestFriendsBoardTrails(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	w.befriend(ana, bo)
	today := w.g.Today()
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, append(repeat(w.right, 4), repeat(w.wrong, Length-4)...)...)
	b, err := w.g.FriendsBoard(ctx, today, bo)
	if err != nil || len(b) != 1 || b[0].Trail != nil {
		t.Fatalf("the friends' board before Bo played: %+v %v", b, err)
	}
	s, _ = w.g.StartDay(ctx, bo)
	w.play(bo, s.ID, repeat(w.right, Length)...)
	b, err = w.g.FriendsBoard(ctx, today, bo)
	if err != nil || len(b) != 2 || !b[0].Me || len(b[0].Trail) != Length || len(b[1].Trail) != Length {
		t.Fatalf("the friends' board once Bo played: %+v %v", b, err)
	}
	rights := 0
	for _, m := range b[1].Trail {
		if m.Right {
			rights++
		}
	}
	if rights != 4 || !b[1].Trail[0].Right || b[1].Trail[Length-1].Right {
		t.Fatalf("Ana's trail: %+v", b[1].Trail)
	}
}

// A player's day as a board tells it: nothing before it's finished; its right answers after, to anyone; a game
// played at a script's speed to its player alone.
func TestDayRights(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	today := w.g.Today()
	if _, played, err := w.g.DayRights(ctx, ana, today, bo); err != nil || played {
		t.Fatalf("before: %v %v", played, err)
	}
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, append(repeat(w.right, 6), repeat(w.wrong, Length-6)...)...)
	for _, viewer := range []int64{0, ana, bo} {
		if n, played, err := w.g.DayRights(ctx, ana, today, viewer); err != nil || !played || n != 6 {
			t.Fatalf("as %d sees it: %d %v %v", viewer, n, played, err)
		}
	}
	if _, err := w.db.Write.ExecContext(ctx, `UPDATE runs SET shadow = 1 WHERE id = ?`, s.ID); err != nil {
		t.Fatal(err)
	}
	if _, played, _ := w.g.DayRights(ctx, ana, today, bo); played {
		t.Fatal("a script's game, told to another")
	}
	if n, played, _ := w.g.DayRights(ctx, ana, today, ana); !played || n != 6 {
		t.Fatal("a script's game, kept from its player")
	}
}

// The day's average shows once DayCrowdFrom have finished the day, to a tenth, and how many got each count of right
// answers with it.
func TestBoardAverage(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	stale := boardStale
	t.Cleanup(func() { boardStale = stale })
	boardStale = 0
	today := w.g.Today()
	for i := range DayCrowdFrom {
		user := w.user()
		s, err := w.g.StartDay(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		rights := i % 8 // 0…7, 0, 1: 29 in all
		w.play(user, s.ID, append(repeat(w.right, rights), repeat(w.wrong, Length-rights)...)...)
		b, err := w.g.BoardOf(ctx, today, 0)
		if err != nil {
			t.Fatal(err)
		}
		if i < DayCrowdFrom-1 && b.Average != 0 {
			t.Fatalf("an average of %d players: %v", i+1, b.Average)
		}
		if i < DayCrowdFrom-1 && b.Spread != nil {
			t.Fatalf("the spread of %d players: %v", i+1, b.Spread)
		}
		if i == DayCrowdFrom-1 && b.Average != 2.9 {
			t.Fatalf("the average of %d players: %v", i+1, b.Average)
		}
		if want := []int{2, 2, 1, 1, 1, 1, 1, 1, 0, 0, 0}; i == DayCrowdFrom-1 && !slices.Equal(b.Spread, want) {
			t.Fatalf("the spread: %v, want %v", b.Spread, want)
		}
	}
}

// A game not yet counted takes its place among those counted as the count would put it: right answers first, then
// how close the hard number came, then time, then the earlier started.
func TestBoardRunAhead(t *testing.T) {
	nine := boardRun{id: 2, rights: 9, tie: tiebreak{closeness: 0}, ms: 90_000}
	eight := boardRun{id: 1, rights: 8, tie: tiebreak{closeness: 700}, ms: 60_000}
	closer := boardRun{id: 5, rights: 8, tie: tiebreak{closeness: 750}, ms: 90_000}
	quicker := boardRun{id: 3, rights: 8, tie: eight.tie, ms: 50_000}
	later := boardRun{id: 4, rights: 8, tie: eight.tie, ms: 60_000}
	if !nine.ahead(eight) || eight.ahead(nine) || !quicker.ahead(eight) || eight.ahead(quicker) || nine.ahead(nine) ||
		!eight.ahead(later) || later.ahead(eight) || !nine.ahead(closer) {
		t.Fatal("ahead")
	}
	if !closer.ahead(eight) || eight.ahead(closer) || !closer.ahead(quicker) {
		t.Fatal("the closer number isn't ahead")
	}
}

// What breaks a tie is counted answer by answer: the number's score, in thousandths; nothing else.
func TestTiebreakAdds(t *testing.T) {
	var a, b tiebreak
	for range Length - 1 {
		a.add(1, false)
	}
	a.add(0.62, true) // the number close
	b.add(1, true)    // the number right on
	if a.closeness != 620 || b.closeness != 1000 {
		t.Fatalf("%+v %+v", a, b)
	}
	if b.cmp(a) != -1 || a.cmp(b) != 1 || a.cmp(a) != 0 {
		t.Fatal("the closer number doesn't break the tie")
	}
}

// A run counts right answers in a row, for the climb's feel only: a wrong one starts the row again, and the score is
// the right answers, however they fell.
func TestRowsInARun(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	bo := w.user()
	answer := func(runID int64, n int, how func(int64, int) json.RawMessage) Result {
		t.Helper()
		w.show(bo, runID)
		w.wait(time.Second)
		res, err := w.g.Answer(ctx, bo, runID, n, how(runID, n))
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	s, _ := w.g.StartTopic(ctx, bo, MixTopic)
	for n, c := range []struct {
		how   func(int64, int) json.RawMessage
		inRow int
	}{{w.right, 0}, {w.right, 2}, {w.right, 3}, {w.wrong, 0}, {w.right, 0}, {w.right, 2}} {
		if res := answer(s.ID, n, c.how); res.InRow != c.inRow {
			t.Fatalf("answer %d: %d in a row; want %d", n, res.InRow, c.inRow)
		}
	}
	var last Result
	for n := 6; n < Length; n++ {
		last = answer(s.ID, n, w.right)
	}
	if !last.State.Done || last.State.Rights != Length-1 || last.InRow != 6 {
		t.Fatalf("the game's end: %+v, %d in a row", last.State, last.InRow)
	}
}

// The issue played a second time in one browser (runs.pencil: SecondPlay) is its player's alone, as a shadow is: on
// nobody else's board, count or friends' board; its player sees it with the others.
func TestSecondPlayOffOthersBoards(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	stale := boardStale
	t.Cleanup(func() { boardStale = stale })
	boardStale = 0
	ana, bo := w.user(), w.user()
	w.befriend(ana, bo)
	s, err := w.g.StartDay(SecondPlay(ctx, ana), ana)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, repeat(w.right, Length)...)
	w.dayGame(bo, nil)
	today := w.g.Today()
	if b, _ := w.g.BoardOf(ctx, today, bo); b.Players != 1 || len(b.Top) != 1 || !b.Top[0].Me {
		t.Fatalf("the board, as Bo sees it: %+v", b)
	}
	if b, _ := w.g.BoardOf(ctx, today, ana); b.Place != 1 || b.Mine == nil {
		t.Fatalf("the board, as Ana sees it: %+v", b)
	}
	if f, _ := w.g.FriendsBoard(ctx, today, bo); len(f) != 0 {
		t.Fatalf("Bo's friends' board: %+v", f)
	}
	if list, _ := w.g.FriendsOf(ctx, bo); len(list) != 1 || list[0].Today != nil {
		t.Fatalf("Bo's friends: %+v", list)
	}
}
