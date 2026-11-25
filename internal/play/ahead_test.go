package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The days ahead are drawn as far as each place has a question that fits it just so, never a question twice; none of
// their questions reaches another game; and a day ahead whose question leaves the bank has it replaced in its place,
// the rest of the day kept.
func TestDaysAhead(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	barred, err := w.g.DayQuestions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	days := map[string][]Pick{}
	rows, _ := w.db.Read.Query(`SELECT day, questions FROM days ORDER BY day`)
	for rows.Next() {
		var day, s string
		_ = rows.Scan(&day, &s)
		days[day] = mustPicks(t, s)
	}
	rows.Close()
	today := w.g.Today()
	if len(days[today]) != Length || len(days) < 2 {
		t.Fatalf("%d days drawn, today's %d questions", len(days), len(days[today]))
	}
	t.Logf("the sample bank holds %d days ahead", len(days)-1)
	seen := map[string]bool{}
	for day, picks := range days {
		for _, p := range picks {
			if seen[p.ID] || !barred[p.ID] {
				t.Fatalf("%s: %s twice, or not kept out of the other games", day, p.ID)
			}
			seen[p.ID] = true
		}
	}
	// A chapter game deals none of them.
	ana := w.user()
	for _, c := range w.b.Categories {
		s, err := w.g.StartChapter(ctx, ana, c.ID)
		if err != nil {
			continue // a chapter with too few questions left
		}
		for _, p := range w.picks(s.ID) {
			if barred[p.ID] {
				t.Fatalf("a %s game dealt %s, a day's", c.ID, p.ID)
			}
		}
	}
	// Two questions of tomorrow can't be dealt on it, its first and a hard one (due for review by then: as a question
	// retired, but the bank's Bulgarian questions stay as they were, and so the days after tomorrow): each is replaced
	// in its own place, by another of its chapter and kind, the rest of the day as it was; the days after stay too.
	var ahead string
	for day := range days {
		if day > today && (ahead == "" || day < ahead) {
			ahead = day
		}
	}
	was := days[ahead]
	b2, _ := bank.Load(w.b.Dir)
	gone := map[int]bool{0: true, Length - 2: true}
	for i := range gone {
		q, _ := b2.Get(was[i].ID)
		q.Extra().ReviewBy = ahead
	}
	w.swap(b2)
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	var s string
	if err := w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, ahead).Scan(&s); err != nil {
		t.Fatal(err)
	}
	now := mustPicks(t, s)
	if len(now) != Length {
		t.Fatalf("%s has %d questions", ahead, len(now))
	}
	for i, p := range now {
		if !gone[i] {
			if p != was[i] {
				t.Fatalf("%s's question %d changed: %v, was %v", ahead, i, p, was[i])
			}
			continue
		}
		if seen[p.ID] {
			t.Fatalf("%s's question %d is %s, another day's (or the one gone)", ahead, i, p.ID)
		}
		q, _ := b2.Get(p.ID)
		o, _ := b2.Get(was[i].ID)
		if q.Extra().Retired || overdue(q, ahead) || q.Base().Category != o.Base().Category || q.Base().Type != o.Base().Type ||
			q.Base().Difficulty != o.Base().Difficulty || bank.HasPictures(q) != bank.HasPictures(o) ||
			o.Extra().BG && !q.Extra().BG || q.Base().Type == "number" && !b2.Estimate(q) {
			t.Fatalf("%s's question %d: %s in the place of %s", ahead, i, p.ID, was[i].ID)
		}
	}
	for day, picks := range days {
		if day > ahead {
			if err := w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, day).Scan(&s); err != nil ||
				!slices.Equal(mustPicks(t, s), picks) {
				t.Fatalf("%s changed with tomorrow (%v)", day, err)
			}
		}
	}
	_ = w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, today).Scan(&s)
	if picks := mustPicks(t, s); picks[0] != days[today][0] {
		t.Fatalf("today's questions changed")
	}
	// The next day, the next day ahead is drawn; yesterday's questions may come back to the other games.
	w.wait(24 * time.Hour)
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	next, err := w.g.DayQuestions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range days[today] {
		if next[p.ID] {
			t.Fatalf("yesterday's %s is still kept out", p.ID)
		}
	}
}

// biggerSample is the sample bank with each question copied n times more (new ids, the text marked), each copy in
// the next chapter round, so that every chapter has every kind; its splits made medium too: enough of every place of a
// day for days ahead, whichever chapters a day gives them.
func biggerSample(t *testing.T, n int) *bank.Bank {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS("../../bank/sample")); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, bank.QuestionsDir, "*.json"))
	slices.Sort(files)
	all := make([][]map[string]any, len(files))
	prefixes := make([]string, len(files))
	for i, f := range files {
		data, _ := os.ReadFile(f)
		if err := json.Unmarshal(data, &all[i]); err != nil {
			t.Fatal(err)
		}
		prefixes[i], _, _ = strings.Cut(all[i][0]["id"].(string), "-")
	}
	out := make([][]map[string]any, len(files))
	for i := range files {
		out[i] = slices.Clone(all[i])
	}
	for i, qs := range all {
		for k := range n {
			to := (i + k + 1) % len(files)
			for j, q := range qs {
				c := maps.Clone(q)
				c["id"] = fmt.Sprintf("%s-%d%03d%02d", prefixes[to], k+1, j, i)
				c["text"] = fmt.Sprintf("%d. %s", k+1, q["text"])
				delete(c, "theme") // its own chapter's: the copy's is another
				if c["type"] == "split" {
					c["difficulty"] = "medium"
				}
				out[to] = append(out[to], c)
			}
		}
	}
	for i, f := range files {
		data, _ := json.Marshal(out[i])
		if err := os.WriteFile(f, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	b, problems := bank.Load(dir)
	if b == nil {
		t.Fatal(problems)
	}
	return b
}

// A game that rolls back takes no days with it: the days ahead are drawn in a transaction of their own, and a
// player's game only reads them (today's drawn there if it must be); the next game finds what was kept.
func TestDaysAheadRollBack(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	var seen map[string]bool
	failed := w.db.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		seen, err = w.g.dayQuestions(tx)
		if err != nil {
			return err
		}
		return errors.New("the game fails")
	})
	if failed == nil || len(seen) < Length { // the day's ten, and the questions new to the bank (unproven)
		t.Fatalf("today's %d, %v", len(seen), failed)
	}
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	s, err := w.g.StartDay(ctx, w.user())
	if err != nil {
		t.Fatal(err)
	}
	barred, _ := w.g.DayQuestions(ctx)
	for _, p := range w.picks(s.ID) {
		if !barred[p.ID] {
			t.Fatalf("today's %s isn't kept out of the other games", p.ID)
		}
	}
	// New rules: the days after tomorrow are drawn again; today and tomorrow stay.
	var before string
	tomorrow := w.now.AddDate(0, 0, 1).In(Bulgaria).Format(time.DateOnly)
	_ = w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, tomorrow).Scan(&before)
	_, _ = w.db.Write.Exec(`UPDATE kv SET value = 'older rules' WHERE key = 'days_drawn_by'`)
	w.g.daysAhead.mu.Lock()
	w.g.daysAhead.day = ""
	w.g.daysAhead.mu.Unlock()
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	var after, rules string
	_ = w.db.Read.QueryRow(`SELECT questions FROM days WHERE day = ?`, tomorrow).Scan(&after)
	_ = w.db.Read.QueryRow(`SELECT value FROM kv WHERE key = 'days_drawn_by'`).Scan(&rules)
	if before == "" || after != before || rules != drawnBy(w.b) {
		t.Fatalf("tomorrow %q → %q, rules %q", before, after, rules)
	}
}

func mustPicks(t *testing.T, s string) []Pick {
	t.Helper()
	var p []Pick
	if err := json.Unmarshal([]byte(s), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

// A question due for review is dealt by no game from its date on: the days ahead drawn before it was due are drawn
// again without it, and it is barred from every other game (DayQuestions: chapters, duels). DaysUsed gives
// the days' questions, and the last day drawn.
func TestNoGameDealsAQuestionDueForReview(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	today := w.g.Today()
	days, err := storedDays(mustTx(t, w), "")
	if err != nil {
		t.Fatal(err)
	}
	used, err := w.g.DaysUsed(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var last string
	n := 0
	for day, picks := range days {
		last = max(last, day)
		n += len(picks)
		for _, p := range picks {
			if !used.IDs[p.ID] {
				t.Fatalf("DaysUsed misses %s of %s", p.ID, day)
			}
		}
	}
	if used.Through != last || len(used.IDs) != n {
		t.Fatalf("DaysUsed: %d through %s, want %d through %s", len(used.IDs), used.Through, n, last)
	}
	// A question of the third day ahead is due for review on its day, and one no day has today. The third day is drawn
	// again without it (or, the sample being short of estimates by then, left to its morning).
	d, _ := time.Parse(time.DateOnly, today)
	third := d.AddDate(0, 0, 3).Format(time.DateOnly)
	b2, _ := bank.Load(w.b.Dir)
	later, _ := b2.Get(days[third][4].ID)
	later.Extra().ReviewBy = third
	var now bank.Question
	for _, q := range b2.Live("history", "") {
		if !used.IDs[q.Base().ID] {
			now = q
			break
		}
	}
	now.Extra().ReviewBy = today
	w.swap(b2)
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	again, _ := storedDays(mustTx(t, w), third)
	if slices.ContainsFunc(again[third], func(p Pick) bool { return p.ID == later.Base().ID }) {
		t.Fatalf("%s kept %s, due for review that day", third, later.Base().ID)
	}
	barred, err := w.g.DayQuestions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !barred[now.Base().ID] {
		t.Fatalf("%s, due for review today, isn't barred", now.Base().ID)
	}
	ana := w.user()
	for range 5 {
		s, err := w.g.StartChapter(ctx, ana, "history")
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range w.picks(s.ID) {
			if p.ID == now.Base().ID {
				t.Fatalf("a history game dealt %s, due for review", p.ID)
			}
		}
		w.play(ana, s.ID)
	}
}

// A question for a date („На този ден“) waits for it out of every other game, however far off the date is, until a
// day has dealt it; one whose only date has passed waits no more.
func TestDatedQuestionsWaitForTheirDate(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	live := b.Live("history", "")
	yearly, dealt, past, plain, next := live[0], live[1], live[2], live[3], live[4]
	for _, q := range live[:5] {
		q.Extra().On = nil
	}
	yearly.Extra().On = []string{"12-31"}
	dealt.Extra().On = []string{"01-01"}
	past.Extra().On = []string{"2020-04-12"}
	next.Extra().On = []string{"2027-03-28"}
	today := "2026-11-18"
	days := map[string][]Pick{"2026-01-01": {{ID: dealt.Base().ID}}}
	bars := barsOf(days, today, b)
	for q, want := range map[bank.Question]bool{yearly: true, dealt: false, past: false, plain: false, next: true} {
		if id := q.Base().ID; bars.all[id] != want {
			t.Errorf("%s (on %v): kept out %v, want %v", id, q.Extra().On, bars.all[id], want)
		}
	}
}

func mustTx(t *testing.T, w *world) *sql.Tx {
	t.Helper()
	tx, err := w.db.Read.Begin()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback() })
	return tx
}

// A bank reload that leaves the days ahead to draw again (here every day after tomorrow, its kinds changed: 23 Nov
// 2026, 1,287 questions changed kind) never holds the game's one writer while it draws: the days are worked out
// outside any transaction and written one day at a time, so a player's answer, or the health probe's write, goes
// through within a second however long the drawing takes. Held in one transaction, the drawing timed the probe out,
// and the deploy under way went back for it.
func TestDaysDrawnAgainLetWritesThrough(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	b := w.inPlay.Load()
	today := w.g.Today()
	before, err := storedDays(mustTx(t, w), DayShift(today, 2))
	if err != nil {
		t.Fatal(err)
	}
	if len(before) < 10 {
		t.Fatalf("%d days after tomorrow drawn: too few to tell", len(before))
	}
	// A choice of every day after tomorrow turns into a true-or-not: every one of them is misshapen.
	turned := map[string]bool{}
	for _, picks := range before {
		for _, p := range picks {
			if q, _ := b.Get(p.ID); q.Base().Type == "choice" && !bank.HasPictures(q) {
				turned[p.ID] = true
				break
			}
		}
	}
	qs := slices.Clone(b.Questions)
	for i, q := range qs {
		if turned[q.Base().ID] {
			c := q.(*bank.Choice)
			qs[i] = &bank.TrueFalse{Head: bank.Head{ID: c.ID, Type: "truefalse", Difficulty: c.Difficulty,
				Text: "Твърдение.", Category: c.Category}, Answer: true, Tail: c.Tail}
		}
	}
	changed := bank.Of(b.Categories, qs)
	w.swap(changed)

	// Each day drawn takes a while (the real bank's do, on the server, many times the sample's).
	const each = 100 * time.Millisecond
	started := make(chan struct{})
	var once sync.Once
	w.g.drawn = func(string) {
		once.Do(func() { close(started) })
		time.Sleep(each)
	}
	done := make(chan error, 1)
	go func() { done <- w.g.EnsureDays(ctx) }()
	<-started
	writes := 0
	for finished := false; !finished; {
		write, cancel := context.WithTimeout(ctx, time.Second)
		at := time.Now()
		_, err := w.db.Write.ExecContext(write, `INSERT INTO kv (key, value) VALUES ('health', ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`, at.UnixMilli())
		cancel()
		if err != nil {
			t.Fatalf("a write while the days are drawn again, after %v: %v", time.Since(at), err)
		}
		writes++
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
			finished = true
		case <-time.After(each / 2):
		}
	}
	after, err := storedDays(mustTx(t, w), DayShift(today, 2))
	if err != nil {
		t.Fatal(err)
	}
	for day, picks := range after {
		if !shaped(changed, picks) || slices.Equal(picks, before[day]) {
			t.Errorf("%s wasn't drawn again by the day's kinds", day)
		}
	}
	// The sample, a true-or-not for a choice of each day, runs short of a place a day or two sooner as drawn again.
	if len(after) < len(before)/2 || writes < len(after) {
		t.Errorf("%d days after tomorrow drawn again (%d before), %d writes went through meanwhile", len(after),
			len(before), writes)
	}
}

// The day turns while the days ahead are drawn: none of them is written for the day that ended (the new today is a
// player's to draw), and the next keeping goes on from the new day, its days ahead whole.
func TestDayTurnsWhileTheDaysAreDrawn(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	was := w.g.Today()
	before, err := storedDays(mustTx(t, w), "")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = w.db.Write.Exec(`UPDATE kv SET value = 'older rules' WHERE key = 'days_drawn_by'`)
	w.swap(bank.Of(w.b.Categories, w.b.Questions)) // a bank reloaded: the days are kept up with it
	var once sync.Once
	w.g.drawn = func(string) { once.Do(func() { w.wait(24 * time.Hour) }) }
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	w.g.drawn = nil
	now, err := storedDays(mustTx(t, w), "")
	if err != nil {
		t.Fatal(err)
	}
	for day := range now {
		if day > DayShift(was, 1) {
			t.Errorf("%s written for a day that had ended", day)
		}
	}
	if !slices.Equal(now[was], before[was]) || !slices.Equal(now[DayShift(was, 1)], before[DayShift(was, 1)]) {
		t.Error("the day that ended, or its tomorrow, changed")
	}
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	if after, _ := storedDays(mustTx(t, w), DayShift(was, 2)); len(after) < len(before)/2 {
		t.Errorf("%d days ahead of the new day drawn, %d stored before", len(after), len(before))
	}
}

// The days after tomorrow are drawn again when the bank's dated questions change, never for its questions about
// Bulgaria: one made so, made not so, retired or brought back leaves drawnBy as it was, and the days ahead what they
// hold; a question given a date, or another date, changes it, and so do the rules (DayRules is in it).
func TestDaysDrawnByTheirDates(t *testing.T) {
	b := biggerSample(t, 2)
	var bg, plain, dated bank.Question
	for _, q := range b.Live("", "") {
		switch t := q.Extra(); {
		case len(t.On) > 0:
		case t.BG:
			bg = q
		case dated == nil:
			dated = q
		default:
			plain = q
		}
	}
	if bg == nil || plain == nil || dated == nil {
		t.Fatal("the sample needs a question about Bulgaria, and two not")
	}
	dated.Extra().On = []string{"03-03"}
	was := drawnBy(b)
	if !strings.HasPrefix(was, DayRules+" ") {
		t.Fatalf("drawnBy %q doesn't name the rules", was)
	}
	same := func(what string) {
		t.Helper()
		if now := drawnBy(b); now != was {
			t.Errorf("%s: the days ahead would be drawn again (%q → %q)", what, was, now)
		}
	}
	plain.Extra().BG = true
	same("a question made one about Bulgaria")
	plain.Extra().BG = false
	bg.Extra().BG = false
	same("one made not")
	bg.Extra().BG = true
	bg.Extra().Retired = true
	same("one retired")
	bg.Extra().Retired = false
	same("one brought back")
	plain.Extra().On = []string{"12-24"}
	if drawnBy(b) == was {
		t.Error("a question given a date: the days ahead aren't drawn again")
	}
	plain.Extra().On = nil
	on := dated.Extra().On
	dated.Extra().On = []string{"02-29"}
	if drawnBy(b) == was {
		t.Error("a question given another date: the days ahead aren't drawn again")
	}
	dated.Extra().On = on
	same("everything as it was")
}

// A day drawn on its morning, not ahead, takes of the questions that fit one nobody has answered, as a day drawn ahead
// does: when KeepDays draws it (keepToday), and when a player's game draws it first, by who had as KeepDays last read
// them (lastMet). Here the day turns while the days ahead are written, so none is: the new today is the player's to
// draw. Drawn by nobody's answers, about half of each day had been answered, with an unanswered question of its place
// left (audit 24 Nov 2026, A25a-1).
func TestDayOnItsMorningPrefersNeverOpened(t *testing.T) {
	w := setup(t)
	w.use(biggerSample(t, 20))
	ctx := t.Context()
	answered := map[string]bool{}
	ana := w.user()
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.Exec(`INSERT INTO runs (user_id, kind, chapter, questions, at, started_at, finished_at)
			VALUES (?, 'chapter', ?, '[]', 0, 0, 0)`, ana, MixChapter)
		if err != nil {
			return err
		}
		run, _ := res.LastInsertId()
		for i, q := range w.b.Live("", "") {
			if i%2 == 0 {
				answered[q.Base().ID] = true
				if _, err := tx.Exec(`INSERT INTO answers (run_id, n, question_id, score, is_right, ms, at)
					VALUES (?, ?, ?, 0, 0, 4000, 0)`, run, i/2, q.Base().ID); err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	w.g.drawn = func(string) { once.Do(func() { w.wait(24 * time.Hour) }) }
	if err := w.g.EnsureDays(ctx); err != nil {
		t.Fatal(err)
	}
	w.g.drawn = nil
	today := w.g.Today()
	if _, err := w.g.StartDay(ctx, w.user()); err != nil {
		t.Fatal(err)
	}
	stored, err := storedDays(mustTx(t, w), "")
	if err != nil {
		t.Fatal(err)
	}
	if was := DayShift(today, -1); len(stored) != 2 || len(stored[was]) != Length || len(stored[today]) != Length {
		t.Fatalf("days stored: %d (the day that ended %d questions, the new today %d)", len(stored), len(stored[was]),
			len(stored[today]))
	}
	used := map[string]bool{}
	for _, picks := range stored {
		for _, p := range picks {
			used[p.ID] = true
		}
	}
	for day, picks := range stored {
		for _, p := range picks {
			if !answered[p.ID] {
				continue
			}
			q, _ := w.b.Get(p.ID)
			for _, o := range w.b.Live(q.Base().Category, q.Base().Type) {
				if !answered[o.Base().ID] && !used[o.Base().ID] && o.Base().Difficulty == q.Base().Difficulty &&
					bank.HasPictures(o) == bank.HasPictures(q) && w.b.Estimate(o) == w.b.Estimate(q) &&
					len(o.Extra().On) == 0 {
					t.Errorf("%s took %s, answered before, over %s, never", day, p.ID, o.Base().ID)
					break
				}
			}
		}
	}
}
