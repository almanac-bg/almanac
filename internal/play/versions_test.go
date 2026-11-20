package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	mrand "math/rand/v2"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

func newRand() *mrand.Rand { return mrand.New(mrand.NewPCG(1, 2)) }

// editedSample is the sample bank with some of its questions edited (edit is given each, as JSON, by id): the bank as
// a reload brings it.
func editedSample(t *testing.T, edit func(id string, q map[string]any)) *bank.Bank {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS("../../bank/sample")); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, bank.QuestionsDir, "*.json"))
	for _, f := range files {
		data, _ := os.ReadFile(f)
		var qs []map[string]any
		if err := json.Unmarshal(data, &qs); err != nil {
			t.Fatal(err)
		}
		for _, q := range qs {
			edit(q["id"].(string), q)
		}
		data, _ = json.Marshal(qs)
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

// reload puts a bank in play, its versions kept first, as the server does.
func (w *world) reload(b *bank.Bank) {
	w.t.Helper()
	if err := w.g.Keep(w.t.Context(), b); err != nil {
		w.t.Fatal(err)
	}
	w.b = b
	w.g.Bank = func() *bank.Bank { return b }
}

// runOf makes a player's run of the questions given (by id), of a kind; a live duel's is its duel's.
func (w *world) runOf(user int64, kind string, ids ...string) int64 {
	w.t.Helper()
	picks := make([]Pick, len(ids))
	for i, id := range ids {
		picks[i] = Pick{ID: id, Seed: uint64(i + 1)}
	}
	var id int64
	err := w.db.Tx(w.t.Context(), func(tx *sql.Tx) error {
		r, err := w.g.insertRun(w.t.Context(), tx, user, kind, nil, nil, picks)
		if err != nil {
			return err
		}
		id = r.id
		if kind == "duel" {
			_, err = tx.Exec(`INSERT INTO duels (questions, a_id, a_run, created_at, expires_at) VALUES ('[]', ?, ?, 0, ?)`,
				user, id, store.Ms(w.now.Add(time.Hour)))
		}
		return err
	})
	if err != nil {
		w.t.Fatal(err)
	}
	return id
}

// A question is graded as it was shown, whatever the bank has become meanwhile: a key fixed between a question
// showing and its answer (geo-960, a statement that was true) grades the answer the screen asked for, in a game of
// one's own, after a refresh, after a restart, and in a live duel, which grades through the deal it shows. Its answer
// is kept as to that version; going over the game shows that version, and how others answered it; and the new version
// starts its crowd and hardness afresh.
func TestGradedAsShown(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.reload(w.b)
	before := w.b
	fixed := editedSample(t, func(id string, q map[string]any) {
		if id == "geo-960" {
			q["answer"], q["changed"], q["updated"] = false, "2026-11-14", "2026-11-14"
		}
	})
	if bank.Version(mustQuestion(t, w, "geo-960")) == bank.Version(func() bank.Question { q, _ := fixed.Get("geo-960"); return q }()) {
		t.Fatal("the fix didn't change the version")
	}
	if q, _ := fixed.Get("geo-001"); bank.Version(q) != bank.Version(mustQuestion(t, w, "geo-001")) {
		t.Fatal("a question unchanged has a new version")
	}
	truth := json.RawMessage(`{"truth":true}`)

	// A game of one's own: shown under the bank before, answered under the fixed one.
	ana := w.user()
	run := w.runOf(ana, "topic", "geo-960", "geo-001")
	if s := w.show(ana, run); s.Question == nil || !strings.Contains(string(mustJSON(t, s.Question.View)), "Мусала") {
		t.Fatalf("shown: %+v", s.Question)
	}
	shown := w.picks(run)[0]
	if shown.V != bank.Version(mustQuestion(t, w, "geo-960")) {
		t.Fatalf("the version shown isn't kept: %+v", shown)
	}
	w.reload(fixed)
	w.wait(3 * time.Second)
	if s, _ := w.g.State(ctx, ana, run); s.Question == nil { // a refresh shows it still, as it was
		t.Fatal("the question shown went with the reload")
	}
	res, err := w.g.Answer(ctx, ana, run, 0, truth)
	if err != nil || !res.Right {
		t.Fatalf("the answer the screen asked for, graded against the fix: %+v %v", res, err)
	}
	var version sql.NullInt64
	_ = w.db.Read.QueryRow(`SELECT version FROM answers WHERE run_id = ? AND n = 0`, run).Scan(&version)
	if want := w.g.versionOf(shown); !version.Valid || version.Int64 != want.(int64) {
		t.Fatalf("the answer kept as to version %v, not %v", version, want)
	}
	// The next question, shown now, is the fixed bank's (unchanged here), and so is its version.
	w.show(ana, run)
	if p := w.picks(run)[1]; p.V != bank.Version(func() bank.Question { q, _ := fixed.Get("geo-001"); return q }()) {
		t.Fatalf("the next question's version: %+v", p)
	}
	w.wait(3 * time.Second)
	if _, err := w.g.Answer(ctx, ana, run, 1, w.right(run, 1)); err != nil {
		t.Fatal(err)
	}
	// Gone over after: the statement as it was shown, its answer as it was then.
	review, err := w.g.Review(ctx, ana, run)
	if err != nil || len(review) != 2 || !strings.Contains(string(mustJSON(t, review[0].Reveal)), `"truth":true`) {
		t.Fatalf("the review: %s %v", mustJSON(t, review), err)
	}

	// After a restart, with only the fixed bank loaded: the version shown is read back as it was kept.
	bo := w.user()
	w.reload(before)
	run = w.runOf(bo, "topic", "geo-960")
	w.show(bo, run)
	restarted := &Game{DB: w.db, Bank: func() *bank.Bank { return fixed }, Now: w.g.Now}
	if err := restarted.Keep(ctx, fixed); err != nil {
		t.Fatal(err)
	}
	w.g, w.b = restarted, fixed
	w.wait(3 * time.Second)
	if res, err := w.g.Answer(ctx, bo, run, 0, truth); err != nil || !res.Right {
		t.Fatalf("after a restart: %+v %v", res, err)
	}

	// A live duel: dealt as it began, under the bank before; shown and answered after the fix.
	gal := w.user()
	w.reload(before)
	run = w.runOf(gal, "duel", "geo-960")
	d, _ := w.g.Deal(w.picks(run)[0])
	w.reload(fixed)
	if err := w.g.ShowLive(ctx, gal, run, 0, w.now, d); err != nil {
		t.Fatal(err)
	}
	w.wait(2 * time.Second)
	if res, err := w.g.AnswerLive(ctx, gal, run, 0, truth, w.now, time.Time{}, d); err != nil || !res.Right {
		t.Fatalf("a live duel's answer: %+v %v", res, err)
	}
	// A deal that isn't the run's question is out of step.
	other, _ := w.g.Deal(Pick{ID: "geo-001", Seed: 1})
	if err := w.g.ShowLive(ctx, gal, w.runOf(gal, "duel", "geo-960"), 0, w.now, other); !errors.Is(err, ErrOutOfStep) {
		t.Fatalf("another question shown live: %v", err)
	}

	// The fixed version's crowd and hardness start afresh: the answers to the one before aren't its, though given the
	// same day; they're still the earlier version's.
	w.g.CrowdMin = 1
	if err := w.g.CountCrowds(ctx); err != nil {
		t.Fatal(err)
	}
	if c := w.crowd("geo-960"); c != nil {
		t.Fatalf("the fixed question has the crowd of the one before: %+v", c)
	}
	if c := w.crowd("geo-001"); c == nil || c.Answers != 1 {
		t.Fatalf("an unchanged question lost its crowd: %+v", c)
	}
	if q, _ := before.Get("geo-960"); w.g.Crowd(q) != nil {
		t.Fatal("a crowd shown for a version the count didn't have")
	}
	h, err := w.g.countHardness(ctx, w.now, fixed)
	if err != nil {
		t.Fatal(err)
	}
	q, _ := fixed.Get("geo-960")
	if h.of(q) != hardnessOf(labelKnown[q.Base().Difficulty]) {
		t.Fatal("the fixed question's hardness counts the answers to the one before")
	}
}

// A recording is a game whose every question is still in play as it was played: none retired, none changed since.
func TestRecordingsAsPlayed(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	w.reload(w.b)
	ana, bo := w.user(), w.user()
	s, err := w.g.StartTopic(ctx, ana, MixTopic)
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, repeat(w.right, Length)...)
	played := w.picks(s.ID)
	recorded := func() bool {
		var rec *recorded
		err := w.db.Tx(ctx, func(tx *sql.Tx) error {
			var err error
			rec, err = w.g.recordedRun(tx, bo, map[string]bool{})
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		return rec != nil && rec.id == s.ID
	}
	if !recorded() {
		t.Fatal("a game as it was played isn't a recording")
	}
	w.reload(editedSample(t, func(id string, q map[string]any) {
		if id == played[2].ID {
			q["retired"], q["retiredWhy"] = true, "weak"
		}
	}))
	if recorded() {
		t.Fatal("a game with a question retired since is a recording")
	}
	w.reload(editedSample(t, func(id string, q map[string]any) {
		if id == played[5].ID {
			q["text"] = "Вярно ли е, че " + strings.ToLower(q["text"].(string)[:2]) + q["text"].(string)[2:]
		}
	}))
	if recorded() {
		t.Fatal("a game with a question changed since is a recording")
	}
}

// A question retired as untrue counts in nobody's mastery, nor has a hardness: its key was wrong.
func TestUntrueLeavesMastery(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	s, err := w.g.StartTopic(ctx, ana, "geography")
	if err != nil {
		t.Fatal(err)
	}
	w.play(ana, s.ID, repeat(w.right, Length)...)
	h, _ := w.g.hardness(ctx)
	topics, _, _ := w.g.abilities(ctx, w.db.Read, h, ana, 0, false)
	all := topics["geography"].answers
	picked := w.picks(s.ID)
	w.reload(editedSample(t, func(id string, q map[string]any) {
		switch id {
		case picked[0].ID:
			q["retired"], q["retiredWhy"] = true, "wrong"
		case picked[1].ID:
			q["retired"], q["retiredWhy"] = true, "weak"
		}
	}))
	h, err = w.g.countHardness(ctx, w.now, w.b)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := h.byID[picked[0].ID]; ok {
		t.Fatal("a question retired as untrue has a hardness")
	}
	topics, _, _ = w.g.abilities(ctx, w.db.Read, h, ana, 0, false)
	if got := topics["geography"].answers; got != all-1 {
		t.Fatalf("answers in the mastery: %d, want %d (the untrue one out, the weak one in)", got, all-1)
	}
	k, err := w.g.countKnowledge(ctx, w.now, w.b)
	if err != nil || len(k["geography"]) != 1 || k["geography"][0].answers != all-1 {
		t.Fatalf("the boards of knowledge: %+v %v", k["geography"], err)
	}
}

// A reload doesn't make anyone wait for everyone's answers to be counted again: the counts before stand meanwhile
// (a question the count lacks by its label), and the new one is made in the background. A count isn't lost to a
// player who gives up waiting for the first.
func TestCountsStandOverAReload(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	s, _ := w.g.StartTopic(ctx, ana, MixTopic)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if err := w.g.Count(ctx); err != nil {
		t.Fatal(err)
	}
	first, _ := w.g.hardness(ctx)
	w.reload(editedSample(t, func(string, map[string]any) {}))
	gone, cancel := context.WithCancel(ctx)
	cancel()
	h, err := w.g.hardness(gone) // a request gone already: what's counted stands, nothing waits
	if err != nil || h != first {
		t.Fatalf("the hardness over a reload: %v", err)
	}
	if _, err := w.g.knowledge(gone); err != nil {
		t.Fatal(err)
	}
	w.g.hard.settle()
	if h, _ := w.g.hardness(ctx); h == first {
		t.Fatal("not counted again for the new bank")
	}

	// The first count of a server with none kept, its waiter gone: it goes on, and the next finds it.
	if _, err := w.db.Write.Exec(`DELETE FROM counts`); err != nil {
		t.Fatal(err)
	}
	fresh := &Game{DB: w.db, Bank: w.g.Bank, Now: w.g.Now}
	if _, err := fresh.knowledge(gone); !errors.Is(err, context.Canceled) {
		t.Fatalf("waiting with a request gone: %v", err)
	}
	fresh.known.settle()
	if k, err := fresh.knowledge(gone); err != nil || len(k[""]) != 1 {
		t.Fatalf("the count its waiter left: %+v %v", k, err)
	}
}
