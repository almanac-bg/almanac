package play

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

// The ladder: Бележка 1, Страница 5, Тетрадка 15, Книга 40, Том 100, Летопис 250, then „Летопис · N“ for each
// further 100; the seal fills in quarters between two ranks.
func TestRankLadder(t *testing.T) {
	for _, c := range []struct {
		ink, level int
		name       string
	}{
		{0, 0, ""}, {1, 1, "Бележка"}, {4, 1, "Бележка"}, {5, 2, "Страница"}, {14, 2, "Страница"}, {15, 3, "Тетрадка"},
		{39, 3, "Тетрадка"}, {40, 4, "Книга"}, {99, 4, "Книга"}, {100, 5, "Том"}, {249, 5, "Том"},
		{250, 6, "Летопис"}, {349, 6, "Летопис"}, {350, 7, "Летопис · 2"}, {450, 8, "Летопис · 3"},
	} {
		if l := RankAt(c.ink); l != c.level || RankName(l) != c.name {
			t.Errorf("%d ink: level %d %q, want %d %q", c.ink, l, RankName(l), c.level, c.name)
		}
		if c.level > 0 && RankAt(RankFrom(c.level)) != c.level {
			t.Errorf("level %d starts at %d, which makes %d", c.level, RankFrom(c.level), RankAt(RankFrom(c.level)))
		}
	}
	for _, c := range []struct{ level, ink, q int }{
		{2, 5, 0}, {2, 7, 0}, {2, 8, 1}, {2, 10, 2}, {2, 13, 3}, {2, 14, 3}, {2, 30, 3}, {6, 275, 1}, {7, 449, 3},
	} {
		if q := Quarter(c.level, c.ink); q != c.q {
			t.Errorf("level %d at %d ink: quarter %d, want %d", c.level, c.ink, q, c.q)
		}
	}
}

// answered is one answer of a player's issue (dayHistory).
type answered struct {
	id    string
	right bool
}

// dayHistory gives a player the day's issues these answers, ten to a day, long ago, and their book written from them.
func (w *world) dayHistory(user int64, all []answered) {
	w.t.Helper()
	for d := 0; d*Length < len(all); d++ {
		these := all[d*Length : min(len(all), (d+1)*Length)]
		picks := make([]Pick, len(these))
		for i, a := range these {
			picks[i] = Pick{ID: a.id}
		}
		data, _ := json.Marshal(picks)
		day := fmt.Sprintf("2025-%02d-%02d", 1+d/28, 1+d%28)
		res, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, at, started_at, finished_at)
			VALUES (?, 'day', ?, ?, ?, ?, ?)`, user, day, string(data), len(these), d*1000, d*1000+500)
		if err != nil {
			w.t.Fatal(err)
		}
		run, _ := res.LastInsertId()
		for n, a := range these {
			if _, err := w.db.Write.Exec(`INSERT INTO answers (run_id, n, question_id, given, score, is_right, ms, at)
				VALUES (?, ?, ?, '{"pick":0}', ?, ?, 3000, ?)`, run, n, a.id, b2i(a.right), a.right, d*1000+n); err != nil {
				w.t.Fatal(err)
			}
		}
	}
	w.rewrite(user)
}

// countRanks counts a player's ranks as a day's issue finishing would.
func (w *world) countRanks(user int64) {
	w.t.Helper()
	if err := w.g.countRanks(w.t.Context(), user, w.g.Today(), false); err != nil {
		w.t.Fatal(err)
	}
}

// rankIn is a player's kept rank in a chapter.
func (w *world) rankIn(user int64, chapter string) ChapterRank {
	w.t.Helper()
	ranks, err := w.g.RanksOf(w.t.Context(), user)
	if err != nil {
		w.t.Fatal(err)
	}
	for _, r := range ranks {
		if r.Chapter == chapter {
			return r
		}
	}
	w.t.Fatalf("no chapter %q", chapter)
	return ChapterRank{}
}

// guessed are a player's issues: 20 geography facts right, and 60 other questions, right or not.
func (w *world) guessed(othersRight int) []answered {
	var all []answered
	for _, q := range w.b.Live("geography", "") {
		if q.Extra().Fact != "" && len(all) < 20 {
			all = append(all, answered{q.Base().ID, true})
		}
	}
	others := 0
	for _, q := range w.b.Live("", "") {
		if q.Base().Category != "geography" && others < 60 {
			all = append(all, answered{q.Base().ID, others < othersRight})
			others++
		}
	}
	if len(all) != 80 {
		w.t.Fatalf("the sample has %d of the 80 answers", len(all))
	}
	return all
}

// A rank is kept when a day's issue finishes, from the chapter's ink; nothing on view. There's no check of guessing: a
// blind tapper climbs by their ink as anyone does, only slowly; a rank held never falls.
func TestRanksFromInk(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	tapper, reader := w.user(), w.user()
	w.dayHistory(tapper, w.guessed(0))
	w.dayHistory(reader, w.guessed(50))
	if r := w.rankIn(reader, "geography"); r.Level != 0 {
		t.Fatalf("a rank before any day's count: %+v", r)
	}
	if ink, _ := w.g.InkOf(ctx, reader); ink["geography"] != 20 {
		t.Fatalf("geography's ink: %d", ink["geography"])
	}
	for _, u := range []int64{tapper, reader} {
		w.countRanks(u)
	}
	for _, u := range []int64{tapper, reader} {
		if r := w.rankIn(u, "geography"); r.Level != 3 || r.Name != "Тетрадка" || r.Ink != 20 || r.Quarter != 0 ||
			r.Next != "Книга" || r.NextAt != 40 {
			t.Fatalf("player %d's geography: %+v", u, r)
		}
	}
	// The facts under a rank found untrue: the ink falls, the rank doesn't.
	var some []string
	for _, q := range w.b.Live("geography", "") {
		if q.Extra().Fact != "" && len(some) < 10 {
			some = append(some, q.Base().ID)
		}
	}
	for _, id := range some {
		q := mustQuestion(t, w, id)
		q.Extra().Retired, q.Extra().RetiredWhy = true, "wrong"
	}
	w.countRanks(reader)
	if r := w.rankIn(reader, "geography"); r.Level != 3 || r.Ink != 10 {
		t.Fatalf("a rank after its ink fell: %+v", r)
	}
}

// The day's issue finishing counts the ranks; a game of a chapter doesn't (it writes grey). A rank risen is told
// once, as one with any other, with the art Страница brings; Бележка alone is never told.
func TestRanksToldOnce(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	s := w.dayGame(ana, nil)
	w.g.AfterWait(ctx, ana)
	n, err := w.g.NewsOf(ctx, ana, s)
	if err != nil {
		t.Fatal(err)
	}
	if n.Rose != nil {
		t.Fatalf("Бележка told: %+v", n.Rose)
	}
	ranks, _ := w.g.RanksOf(ctx, ana)
	some := 0
	for _, r := range ranks {
		some += r.Level
	}
	if some == 0 || n.Step == nil || n.Step.Left < 1 || n.Step.Next != "Страница" {
		t.Fatalf("after a day: ranks %+v, step %+v", ranks, n.Step)
	}
	// Five facts of geography in ink, and seven of history: two chapters at Страница, told as one, both with art.
	var all []answered
	for _, topic := range []string{"geography", "history"} {
		k := 0
		for _, q := range w.b.Live(topic, "") {
			if q.Extra().Fact != "" && k < 7 {
				all, k = append(all, answered{q.Base().ID, true}), k+1
			}
		}
	}
	w.dayHistory(ana, all)
	w.countRanks(ana)
	n, _ = w.g.NewsOf(ctx, ana, 0)
	if n.Rose == nil || len(n.Rose.Ranks) != 2 || !n.Rose.Best || !n.Rose.Ranks[0].Art || n.Rose.Ranks[0].Name != "Страница" {
		t.Fatalf("two chapters risen: %+v", n.Rose)
	}
	if n, _ = w.g.NewsOf(ctx, ana, 0); n.Rose != nil {
		t.Fatalf("told twice: %+v", n.Rose)
	}
	// A chapter's game writes pencil: no rank moves.
	before, _ := w.g.RanksOf(ctx, ana)
	topic := w.game(ana, nil)
	w.g.AfterWait(ctx, ana)
	after, _ := w.g.RanksOf(ctx, ana)
	for i := range before {
		if before[i] != after[i] {
			t.Fatalf("a chapter's game (%d) moved a rank: %+v to %+v", topic, before[i], after[i])
		}
	}
}

// The seal worn is the chapter chosen, while there's a rank in it; else the best, the more ink on a tie. A chapter's
// art is an avatar from its Страница; the animals are everyone's.
func TestSealAndArt(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	if s, err := w.g.SealOf(ctx, ana); s != nil || err != nil {
		t.Fatalf("a seal of nothing: %+v %v", s, err)
	}
	if err := w.g.SetAvatar(ctx, ana, "geography-gold"); !errors.Is(err, ErrNoAvatar) {
		t.Fatalf("a chapter's art without its rank: %v", err)
	}
	var all []answered
	for topic, n := range map[string]int{"geography": 6, "history": 7, "music": 1} {
		k := 0
		for _, q := range w.b.Live(topic, "") {
			if q.Extra().Fact != "" && k < n {
				all, k = append(all, answered{q.Base().ID, true}), k+1
			}
		}
	}
	w.dayHistory(ana, all)
	w.countRanks(ana)
	if s, _ := w.g.SealOf(ctx, ana); s == nil || s.Chapter != "history" || s.Name != "Страница" {
		t.Fatalf("the best seal, on a tie the more ink: %+v", s)
	}
	if err := w.g.SetSeal(ctx, ana, "music"); err != nil {
		t.Fatal(err)
	}
	if s, _ := w.g.SealOf(ctx, ana); s == nil || s.Chapter != "music" || s.Name != "Бележка" {
		t.Fatalf("the seal chosen: %+v", s)
	}
	if err := w.g.SetSeal(ctx, ana, "sports"); !errors.Is(err, ErrNoSeal) {
		t.Fatalf("a seal without a rank: %v", err)
	}
	if err := w.g.SetSeal(ctx, ana, ""); err != nil {
		t.Fatal(err)
	}
	if s, _ := w.g.SealOf(ctx, ana); s == nil || s.Chapter != "history" {
		t.Fatalf("the best again: %+v", s)
	}
	if err := w.g.SetAvatar(ctx, ana, "geography-natural"); err != nil {
		t.Fatalf("a chapter's art at its Страница: %v", err)
	}
	if err := w.g.SetAvatar(ctx, ana, "music-natural"); !errors.Is(err, ErrNoAvatar) {
		t.Fatalf("a chapter's art at Бележка: %v", err)
	}
	if err := w.g.SetAvatar(ctx, ana, "lynx-gold"); err != nil {
		t.Fatalf("an animal: %v", err)
	}
}

// The ranks of the players with ink from before them are counted as the server starts, quietly: nothing to tell.
func TestRanksDue(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	var all []answered
	for _, q := range w.b.Live("geography", "") {
		if q.Extra().Fact != "" && len(all) < 6 {
			all = append(all, answered{q.Base().ID, true})
		}
	}
	w.dayHistory(ana, all)
	if _, err := w.db.Write.Exec(`INSERT INTO ranks_due (user_id) VALUES (?)`, ana); err != nil {
		t.Fatal(err)
	}
	if n, err := w.g.RanksDue(ctx); n != 1 || err != nil {
		t.Fatalf("counted %d %v", n, err)
	}
	if r := w.rankIn(ana, "geography"); r.Level != 2 {
		t.Fatalf("geography: %+v", r)
	}
	if n, _ := w.g.NewsOf(ctx, ana, 0); n.Rose != nil {
		t.Fatalf("a rank from before told: %+v", n.Rose)
	}
	if n := w.count(`SELECT count(*) FROM ranks_due`); n != 0 {
		t.Fatalf("%d left to count", n)
	}
}
