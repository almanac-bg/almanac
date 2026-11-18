package royal

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The evening's questions are graded as they were shown, whatever the bank has become meanwhile, over a restart too: a
// statement's key fixed while it shows (a reload held till the evening is over would never do this, but nothing in
// the grading counts on that) grades the answer the screen asked for.
func TestGradedAsDealt(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	var current atomic.Pointer[bank.Bank]
	current.Store(w.g.Bank())
	w.g.Bank = current.Load
	if err := w.g.Keep(ctx, current.Load()); err != nil {
		t.Fatal(err)
	}
	ana := w.player()
	w.start(ana)
	for i := 0; w.h.night.dealt[w.view(ana.ID).N].Question().Base().Type != "truefalse"; i++ {
		if i >= 15 {
			t.Skip("an evening without a statement")
		}
		w.give(ana, true)
		w.onward()
	}
	v := w.view(ana.ID)
	shown := w.h.night.dealt[v.N].Question()
	right := w.answer(ana, true)

	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(current.Load().Dir)); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, bank.QuestionsDir, shown.Base().Category+".json")
	data, _ := os.ReadFile(file)
	var qs []map[string]any
	_ = json.Unmarshal(data, &qs)
	for _, q := range qs {
		if q["id"] == shown.Base().ID {
			q["answer"], q["changed"], q["updated"] = !q["answer"].(bool), "2026-11-15", "2026-11-15"
		}
	}
	data, _ = json.Marshal(qs)
	_ = os.WriteFile(file, data, 0o600)
	fixed, problems := bank.Load(dir)
	if fixed == nil {
		t.Fatal(problems)
	}
	if err := w.g.Keep(ctx, fixed); err != nil {
		t.Fatal(err)
	}
	current.Store(fixed)

	// The server restarts: the evening is dealt again as it was drawn.
	w.hub(anyone)
	if err := w.h.Load(ctx); err != nil {
		t.Fatal(err)
	}
	w.h.Step(ctx)
	w.follow(ana.ID)
	if err := w.h.Answer(ctx, ana.ID, v.N, right); err != nil {
		t.Fatal(err)
	}
	if m := w.view(ana.ID).mine(); !m.Right {
		t.Fatalf("the answer the screen asked for, graded against the fix: %+v", m)
	}
}
