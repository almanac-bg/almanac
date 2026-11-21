package bank

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// heldBack is a question of a retired kind as a bank's file may still have it, by the id of a sample question.
const heldBack = `{"id": "gen-002", "type": "clues", "difficulty": "easy", "text": "Кой е този празник?",
  "clues": ["Едно.", "Две.", "Три."], "answer": "24 май", "wrong": ["1 март", "3 март", "6 май"]}`

// A question of a retired kind that a bank's file still has: the bank loads with a warning of it (so that `bank check`
// reminds whoever keeps it), never deals it, doesn't count it as dropped, and the tools that write the bank keep it
// as it was, where it was; a batch makes it one of the kinds the game has, by the same id.
func TestRetiredKindsLeftInABank(t *testing.T) {
	dir := sampleCopy(t)
	path := filepath.Join(dir, QuestionsDir, "general.json")
	data, _ := os.ReadFile(path)
	var qs []json.RawMessage
	if err := json.Unmarshal(data, &qs); err != nil {
		t.Fatal(err)
	}
	qs[1] = json.RawMessage(heldBack)
	data, _ = json.Marshal(qs)
	write(t, path, string(data))
	write(t, filepath.Join(dir, WaiversFile), `[{"id": "gen-002", "rule": "options", "why": "Its options."},
  {"id": "gen-001", "rule": "pair-giveaway", "why": "A pair."}]`)

	b, problems := Load(dir)
	if b == nil {
		t.Fatalf("a bank with a question of a retired kind doesn't load: %v", problems)
	}
	var kind, waivers int
	for _, p := range problems {
		switch {
		case p.Rule == RuleKind && p.ID == "gen-002" && p.Warning:
			kind++
		case p.Rule == RuleWaiver && p.Warning && (p.ID == "gen-002" || p.ID == "gen-001"):
			waivers++
		}
	}
	if kind != 1 || waivers != 2 {
		t.Errorf("warned %d times of the retired kind and %d of the waivers: %v", kind, waivers, problems)
	}
	if _, ok := b.Get("gen-002"); ok || slices.ContainsFunc(b.Live("", ""), func(q Question) bool { return q.Base().ID == "gen-002" }) {
		t.Error("a question of a retired kind is in play")
	}
	if dropped := Dropped(sample, b); len(dropped) != 0 {
		t.Errorf("dropped: %v", dropped)
	}

	// bank fmt (Write) keeps it, in its place.
	for _, c := range b.Categories {
		if err := b.Write(dir, c.ID, nil, nil); err != nil {
			t.Fatal(err)
		}
	}
	data, _ = os.ReadFile(path)
	if err := json.Unmarshal(data, &qs); err != nil {
		t.Fatal(err)
	}
	if len(qs) != len(b.InCategory("general"))+1 || !strings.Contains(string(qs[1]), `"clues"`) {
		t.Fatalf("written without the question of a retired kind in its place: %s", data)
	}
	if again, _ := Load(dir); again == nil || len(again.Questions) != len(b.Questions) {
		t.Fatal("the bank written again loads otherwise")
	}

	// A batch can't bring one in…
	today := time.Now().Format(time.DateOnly)
	batch := t.TempDir()
	write(t, filepath.Join(batch, "general.json"), "["+heldBack+"]")
	if _, err := Add(dir, batch, "test", true); err == nil || !strings.Contains(err.Error(), "retired kind") {
		t.Errorf("a batch of a retired kind: %v", err)
	}
	// …and makes it a choice, by its id, in its place.
	write(t, filepath.Join(batch, "general.json"), edited(t, loadSample(t), "gen-002", func(m map[string]any) {
		m["changed"], m["updated"], m["sources"] = today, today, []string{"https://bg.wikipedia.org/wiki/24_май"}
	}))
	if res, err := Add(dir, batch, "test", false); err != nil || res.Changed != 1 || res.Added != 0 {
		t.Fatalf("made a choice: %+v, %v", res, err)
	}
	after, problems := Load(dir)
	if after == nil {
		t.Fatal(problems)
	}
	if q, ok := after.Get("gen-002"); !ok || q.Base().Type != "choice" || after.InCategory("general")[1] != q {
		t.Errorf("gen-002 isn't a choice in its place: %v", ok)
	}
	for _, p := range problems {
		if p.Rule == RuleKind {
			t.Errorf("still warned: %v", p)
		}
	}
}
