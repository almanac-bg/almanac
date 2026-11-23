package play

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"strings"
	"testing"
)

// The ladder: Бележка 1, Страница 5, Тетрадка 15, Книга 40, Том 100, Летопис 250, then „Летопис · N“ for each
// further 100; the quarters between two ranks are kept with a rank.
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

// A rank as the client gets it says the way to the next one: the ink its rank starts at, the chapter's ink and the
// ink the next starts at, the bar between them (web/src/ui.ts, standing), before a first rank and past Летопис too.
// The quarters are the kept rank's own, never sent.
func TestRankSaysItsWay(t *testing.T) {
	for _, c := range []struct {
		k    keptRank
		want string
	}{
		{keptRank{}, `{"chapter":"history","level":0,"name":"","from":0,"ink":0,"next":"Бележка","nextAt":1}`},
		{keptRank{level: 2, quarter: 3, ink: 13}, `{"chapter":"history","level":2,"name":"Страница","from":5,"ink":13,` +
			`"next":"Тетрадка","nextAt":15}`},
		{keptRank{level: 7, ink: 413}, `{"chapter":"history","level":7,"name":"Летопис · 2","from":350,"ink":413,` +
			`"next":"Летопис · 3","nextAt":450}`},
	} {
		got, err := json.Marshal(chapterRank("history", c.k))
		if err != nil || string(got) != c.want {
			t.Errorf("%+v sent as %s, want %s (%v)", c.k, got, c.want, err)
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
	if err := w.g.countRanks(w.t.Context(), user); err != nil {
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

// mustRanks are a player's kept ranks.
func (w *world) mustRanks(user int64) []ChapterRank {
	w.t.Helper()
	ranks, err := w.g.RanksOf(w.t.Context(), user)
	if err != nil {
		w.t.Fatal(err)
	}
	return ranks
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
	step, err := w.g.StepOf(ctx, ana)
	if err != nil || some == 0 || step == nil || step.Left < 1 || step.Next != "Страница" || step.Level != 1 {
		t.Fatalf("after a day: ranks %+v, step %+v %v", ranks, step, err)
	}
	// The step's rank and the way to the next are its chapter's, as kept.
	for _, r := range ranks {
		if r.Chapter == step.Chapter && (r.Level != step.Level || max(1, r.NextAt-r.Ink) != step.Left) {
			t.Fatalf("the step %+v, its chapter %+v", step, r)
		}
	}
	// Five facts of geography in ink, and seven of history: two chapters at Страница, told as one.
	var all []answered
	for _, chapter := range []string{"geography", "history"} {
		k := 0
		for _, q := range w.b.Live(chapter, "") {
			if q.Extra().Fact != "" && k < 7 {
				all, k = append(all, answered{q.Base().ID, true}), k+1
			}
		}
	}
	w.dayHistory(ana, all)
	w.countRanks(ana)
	n, _ = w.g.NewsOf(ctx, ana, 0)
	if n.Rose == nil || len(n.Rose.Ranks) != 2 || !n.Rose.Best || n.Rose.Ranks[0].Name != "Страница" {
		t.Fatalf("two chapters risen: %+v", n.Rose)
	}
	for _, r := range n.Rose.Ranks {
		if r.Ink < RankFrom(r.To) || r.Ink >= RankFrom(r.To+1) {
			t.Fatalf("risen with the ink it was counted from: %+v", r)
		}
	}
	if n, _ = w.g.NewsOf(ctx, ana, 0); n.Rose != nil {
		t.Fatalf("told twice: %+v", n.Rose)
	}
	// A chapter's game writes pencil: no rank moves.
	before, _ := w.g.RanksOf(ctx, ana)
	chapter := w.game(ana, nil)
	w.g.AfterWait(ctx, ana)
	after, _ := w.g.RanksOf(ctx, ana)
	for i := range before {
		if before[i] != after[i] {
			t.Fatalf("a chapter's game (%d) moved a rank: %+v to %+v", chapter, before[i], after[i])
		}
	}
}

// An avatar is an animal, everyone's; a chapter's art is never one, whatever its rank.
func TestNoChapterAvatar(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	for _, art := range []string{"history", "geography", "music"} {
		if err := w.g.SetAvatar(ctx, ana, art); !errors.Is(err, ErrNoAvatar) {
			t.Fatalf("a chapter's art as an avatar (%s): %v", art, err)
		}
	}
	if err := w.g.SetAvatar(ctx, ana, "lynx"); err != nil {
		t.Fatalf("an animal: %v", err)
	}
}

// A guest's game brought to an account writes the book again from both, and counts its ranks again from it there and
// then: ten facts of geography the account had and five the guest had are Тетрадка at once, told once, never
// „15 с мастило · Страница“ until the next day's issue.
func TestMergeCountsRanksAgain(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	owner, guest := w.user(), w.user()
	var facts []answered
	for _, q := range w.b.Live("geography", "") {
		if q.Extra().Fact != "" && len(facts) < 15 {
			facts = append(facts, answered{q.Base().ID, true})
		}
	}
	if len(facts) != 15 {
		t.Fatalf("the sample has %d geography facts", len(facts))
	}
	w.dayHistory(owner, facts[:10])
	w.dayHistory(guest, facts[10:])
	// The guest's day is another than the account's: a day the account played stays the account's.
	if _, err := w.db.Write.Exec(`UPDATE runs SET day = '2024-06-01' WHERE user_id = ?`, guest); err != nil {
		t.Fatal(err)
	}
	for _, u := range []int64{owner, guest} {
		w.countRanks(u)
		if _, err := w.g.NewsOf(ctx, u, 0); err != nil {
			t.Fatal(err)
		}
	}
	if r := w.rankIn(owner, "geography"); r.Level != 2 {
		t.Fatalf("the account's geography before: %+v", r)
	}
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return w.g.Merge(tx, guest, owner) }); err != nil {
		t.Fatal(err)
	}
	if r := w.rankIn(owner, "geography"); r.Level != 3 || r.Name != "Тетрадка" || r.Ink != 15 || r.Next != "Книга" {
		t.Fatalf("the account's geography after the guest's game came: %+v", r)
	}
	n, err := w.g.NewsOf(ctx, owner, 0)
	if err != nil {
		t.Fatal(err)
	}
	if n.Rose == nil || len(n.Rose.Ranks) != 1 || n.Rose.Ranks[0].Chapter != "geography" || n.Rose.Ranks[0].From != 2 ||
		n.Rose.Ranks[0].To != 3 {
		t.Fatalf("the rank risen by the merge, told: %+v", n.Rose)
	}
	if n, _ = w.g.NewsOf(ctx, owner, 0); n.Rose != nil {
		t.Fatalf("told twice: %+v", n.Rose)
	}
}

// A guest's issue still being played, brought to an account, is in the book at once, and counts for the ranks as it
// finishes, as any issue: ranks change only when an issue finishes (the privacy page says so).
func TestMergeLeavesAnIssueUnfinishedToItsEnd(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	owner, guest := w.user(), w.user()
	var facts []answered
	for _, q := range w.b.Live("geography", "") {
		if q.Extra().Fact != "" && len(facts) < 15 {
			facts = append(facts, answered{q.Base().ID, true})
		}
	}
	w.dayHistory(owner, facts[:10])
	w.dayHistory(guest, facts[10:])
	// The guest's issue is today's, still being played.
	if _, err := w.db.Write.Exec(`UPDATE runs SET day = ?, finished_at = NULL WHERE user_id = ?`,
		w.g.Today(), guest); err != nil {
		t.Fatal(err)
	}
	w.countRanks(owner)
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return w.g.Merge(tx, guest, owner) }); err != nil {
		t.Fatal(err)
	}
	if r := w.rankIn(owner, "geography"); r.Level != 2 || r.Ink != 10 {
		t.Fatalf("the rank with the guest's issue still being played: %+v", r)
	}
	if ink, _ := w.g.InkOf(ctx, owner); ink["geography"] != 15 {
		t.Fatalf("the book's ink: %v", ink)
	}
	if _, err := w.db.Write.Exec(`UPDATE runs SET finished_at = 2000 WHERE user_id = ? AND day = ?`,
		owner, w.g.Today()); err != nil {
		t.Fatal(err)
	}
	w.countRanks(owner)
	if r := w.rankIn(owner, "geography"); r.Level != 3 || r.Ink != 15 {
		t.Fatalf("the rank once the issue finished: %+v", r)
	}
}

// An issue left unfinished counts once its day is over: its ink stays in the book, and the ranks (and the step to the
// next, as the reminders say it) count it at the next count after it can't be played on, never while it can.
func TestIssueLeftUnfinishedCountsOnceItsDayIsOver(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	w.dayAs(ana, Length/2, func(int) func(int64, int) json.RawMessage { return w.right })
	inRanks := func() int {
		n := 0
		for _, r := range w.mustRanks(ana) {
			n += r.Ink
		}
		return n
	}
	ink, err := w.g.InkOf(ctx, ana)
	if err != nil || inkTotal(ink) == 0 {
		t.Fatalf("the half issue's ink: %v %v", ink, err)
	}
	w.countRanks(ana)
	if n := inRanks(); n != 0 {
		t.Fatalf("an issue that can still be played counted %d ink", n)
	}
	if s, err := w.g.StepOf(ctx, ana); s != nil || err != nil {
		t.Fatalf("a step from an issue still being played: %+v %v", s, err)
	}
	// Within the grace after midnight it can still be finished; past it, it can't.
	w.at(13, 0, 5, 0)
	w.countRanks(ana)
	if n := inRanks(); n != 0 {
		t.Fatalf("an issue in its grace counted %d ink", n)
	}
	w.at(13, 12, 0, 0)
	w.dayAs(ana, -1, func(int) func(int64, int) json.RawMessage { return w.wrong })
	w.g.Settled(ctx)
	if n := inRanks(); n != inkTotal(ink) {
		t.Fatalf("the ranks hold %d ink, the left issue wrote %d", n, inkTotal(ink))
	}
	s, err := w.g.StepOf(ctx, ana)
	if err != nil || s == nil {
		t.Fatalf("no step: %v", err)
	}
	if r := w.rankIn(ana, s.Chapter); s.Left != max(1, r.NextAt-r.Ink) || s.Level != r.Level {
		t.Fatalf("the step %+v against its rank %+v", s, r)
	}
	// Профил says each chapter's ink as its Алманах card does: the book's.
	st, err := w.g.StatsOf(ctx, ana)
	if err != nil || !maps.Equal(st.Ink, ink) {
		t.Fatalf("Профил's ink %v, the book's %v (%v)", st.Ink, ink, err)
	}
}

// A chapter's game writes its facts in grey, and its news counts none of them: grey is never counted (DECISIONS.md,
// „The direction“), and only the issue writes ink.
func TestChapterGameNewsCountsNoGrey(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	run := w.game(ana, nil)
	n, err := w.g.NewsOf(ctx, ana, run)
	if err != nil {
		t.Fatal(err)
	}
	if facts := w.count(`SELECT count(*) FROM facts WHERE user_id = ? AND run_id = ? AND NOT ink`, ana, run); facts == 0 {
		t.Fatal("the chapter's game wrote nothing in grey")
	}
	data, _ := json.Marshal(n)
	if n.Ink != 0 || strings.Contains(string(data), "grey") {
		t.Fatalf("a chapter's game: %s", data)
	}
}
