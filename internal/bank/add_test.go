package bank

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// sampleCopy copies the public sample to a scratch bank a test may change.
func sampleCopy(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestAddPutsABatchIn(t *testing.T) {
	dir := sampleCopy(t)
	b := loadSample(t)
	_, next := b.NextID("general")
	old := b.Live("general", "choice")[0].Base().ID
	today := time.Now().Format(time.DateOnly)
	batch := t.TempDir()
	id := "gen-" + strconv.Itoa(next)
	write(t, filepath.Join(batch, "general.json"), `[
  {"id": "`+id+`", "type": "choice", "difficulty": "easy", "text": "Коя е най-високата планина в България?", "answer": "Рила",
   "wrong": ["Пирин", "Витоша", "Стара планина"], "fact": "Връх Мусала е висок 2925 м — най-високият на Балканския полуостров.",
   "added": "`+today+`", "updated": "`+today+`", "bg": true, "sources": ["https://bg.wikipedia.org/wiki/Рила"]}
]`)
	write(t, filepath.Join(batch, RetireFile), `[{"id": "`+old+`", "why": "twin", "by": "`+id+`"}]`)

	before, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json"))
	res, err := Add(dir, batch, "new-questions test", true)
	if err != nil || res.Added != 1 || res.Retired != 1 || res.Sizes[0] != (CategoryCount{"general", len(b.Live("general", ""))}) {
		t.Fatalf("a dry run: %+v, %v", res, err)
	}
	if after, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json")); string(after) != string(before) {
		t.Fatal("a dry run changed the bank")
	}
	if res, err := Add(dir, batch, "new-questions test", false); err != nil || res.Added != 1 || res.Retired != 1 {
		t.Fatalf("added: %+v, %v", res, err)
	}
	after, problems := Load(dir)
	if after == nil {
		t.Fatalf("the bank doesn't load after the batch: %v", problems)
	}
	if q, ok := after.Get(id); !ok || q.Base().Category != "general" {
		t.Errorf("%s isn't in general", id)
	}
	if q, _ := after.Get(old); !q.Extra().Retired || q.Extra().RetiredWhy != "twin" || q.Extra().ReplacedBy != id {
		t.Errorf("%s isn't retired as a twin replaced by %s: %+v", old, id, q.Extra())
	}
	if q, _ := after.Get(id); q.Extra().Checked != today || q.Extra().CheckedBy != "new-questions test" {
		t.Errorf("%s isn't marked checked: %+v", id, q.Extra())
	}
	data, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json"))
	if want, _ := Format(after.InCategory("general")); string(data) != string(want) {
		t.Error("general.json isn't in the bank's format after the batch")
	}
}

func TestAddWritesNothingUnlessAllOfItHolds(t *testing.T) {
	b := loadSample(t)
	_, next := b.NextID("general")
	today := time.Now().Format(time.DateOnly)
	question := func(id, wrong string) string {
		return `{"id": "` + id + `", "type": "choice", "difficulty": "easy", "text": "Кое?", "answer": "А",
		"wrong": [` + wrong + `], "fact": "Факт.", "added": "` + today + `", "updated": "` + today + `"}`
	}
	good := `"Б", "В", "Г"`
	for name, c := range map[string]struct {
		files map[string]string
		want  string
	}{
		"another category's id":               {map[string]string{"general.json": "[" + question("his-"+strconv.Itoa(next), good) + "]"}, "not an id of general"},
		"a broken question":                   {map[string]string{"general.json": "[" + question("gen-"+strconv.Itoa(next), `"Б", "В"`) + "]"}, "exactly 3 wrong"},
		"an unknown field":                    {map[string]string{"general.json": "[" + strings.Replace(question("gen-"+strconv.Itoa(next), good), "{", `{"typo": 1, `, 1) + "]"}, "unknown field"},
		"retiring a question the bank hasn't": {map[string]string{RetireFile: `[{"id": "gen-99999", "why": "wrong"}]`}, "no such question"},
		"retiring without a reason":           {map[string]string{RetireFile: `[{"id": "gen-001", "why": "old"}]`}, "why is one of"},
		"a stray file":                        {map[string]string{"notes.json": `[]`}, "not a category's file"},
		"a rule a new question breaks":        {map[string]string{"general.json": "[" + strings.NewReplacer("Кое?", "Кое", `"added": "`+today, `"sources": ["https://bg.wikipedia.org"], "checked": "2026-11-17", "checkedBy": "t", "added": "`+StrictFrom, `"updated": "`+today, `"updated": "`+StrictFrom).Replace(question("gen-"+strconv.Itoa(next), good)) + "]"}, "[ending]"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := sampleCopy(t)
			before, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json"))
			batch := t.TempDir()
			for f, body := range c.files {
				write(t, filepath.Join(batch, f), body)
			}
			if _, err := Add(dir, batch, "", false); err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want an error with %q, got %v", c.want, err)
			}
			if after, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json")); string(after) != string(before) {
				t.Error("a failed batch changed the bank")
			}
		})
	}
}

// edited is a bank's question as a batch's file has it (a JSON array of one), with edit made to its fields.
func edited(t *testing.T, b *Bank, id string, edit func(m map[string]any)) string {
	t.Helper()
	q, ok := b.Get(id)
	if !ok {
		t.Fatalf("no %s", id)
	}
	data, _ := Format([]Question{q})
	var qs []map[string]any
	if err := json.Unmarshal(data, &qs); err != nil {
		t.Fatal(err)
	}
	edit(qs[0])
	out, _ := json.Marshal(qs)
	return string(out)
}

// A batch changes a question whose id the bank has, whole and in its place: updated today, changed today only if what
// it asks changed, added as it was; a new one takes the next number, as ever.
func TestAddChangesQuestions(t *testing.T) {
	dir := sampleCopy(t)
	b := loadSample(t)
	today := time.Now().Format(time.DateOnly)
	_, next := b.NextID("general")
	added := "gen-" + strconv.Itoa(next)
	first, second := edited(t, b, "gen-001", func(m map[string]any) {
		m["text"], m["changed"], m["updated"] = "На коя дата си връзваме мартеници?", today, today
	}), edited(t, b, "gen-002", func(m map[string]any) {
		m["fact"], m["updated"], m["difficulty"] = "Празникът е официален от 1990 г.", today, "medium"
	})
	batch := t.TempDir()
	write(t, filepath.Join(batch, "general.json"), "["+strings.Trim(first, "[]")+", "+strings.Trim(second, "[]")+`,
  {"id": "`+added+`", "type": "choice", "difficulty": "easy", "text": "Коя е най-високата планина в България?", "answer": "Рила",
   "wrong": ["Пирин", "Витоша", "Стара планина"], "fact": "Връх Мусала е висок 2925 м — най-високият на Балканския полуостров.",
   "added": "`+today+`", "updated": "`+today+`", "bg": true, "sources": ["https://bg.wikipedia.org/wiki/Рила"]}]`)

	before, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json"))
	if res, err := Add(dir, batch, "content-pass test", true); err != nil || res.Added != 1 || res.Changed != 2 || res.Retired != 0 {
		t.Fatalf("a dry run: %+v, %v", res, err)
	}
	if after, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json")); string(after) != string(before) {
		t.Fatal("a dry run changed the bank")
	}
	if res, err := Add(dir, batch, "content-pass test", false); err != nil || res.Added != 1 || res.Changed != 2 {
		t.Fatalf("changed: %+v, %v", res, err)
	}
	after, problems := Load(dir)
	if after == nil {
		t.Fatalf("the bank doesn't load after the batch: %v", problems)
	}
	gen := after.InCategory("general")
	if gen[0].Base().ID != "gen-001" || gen[1].Base().ID != "gen-002" || gen[len(gen)-1].Base().ID != added {
		t.Error("a changed question moved from its place, or a new one isn't at the end")
	}
	if len(gen) != len(b.InCategory("general"))+1 {
		t.Errorf("general has %d questions, want %d", len(gen), len(b.InCategory("general"))+1)
	}
	q1, _ := after.Get("gen-001")
	if q1.Base().Text != "На коя дата си връзваме мартеници?" || q1.Extra().Changed != today || q1.Extra().Updated != today {
		t.Errorf("gen-001: %q %+v", q1.Base().Text, q1.Extra())
	}
	q2, _ := after.Get("gen-002")
	was, _ := b.Get("gen-002")
	if q2.Extra().Fact == "" || q2.Base().Difficulty != Medium || q2.Extra().Changed != was.Extra().Changed || q2.Extra().Added != was.Extra().Added {
		t.Errorf("gen-002: %+v", q2.Extra())
	}
	for _, q := range []Question{q1, q2} {
		if q.Extra().Checked != today || q.Extra().CheckedBy != "content-pass test" {
			t.Errorf("%s isn't marked checked: %+v", q.Base().ID, q.Extra())
		}
	}
}

func TestAddChangesOnlyByTheRules(t *testing.T) {
	b := loadSample(t)
	today := time.Now().Format(time.DateOnly)
	dated := func(m map[string]any) { m["updated"] = today }
	for name, c := range map[string]struct {
		files map[string]string
		want  string
	}{
		"updated not today": {map[string]string{"general.json": edited(t, b, "gen-001", func(m map[string]any) {
			m["fact"], m["updated"] = "Факт.", "2026-11-01"
		})}, "a change sets updated to today"},
		"asked changed, not changed today": {map[string]string{"general.json": edited(t, b, "gen-001", func(m map[string]any) {
			dated(m)
			m["answer"] = "1 март (Баба Марта)"
		})}, "what it asks changed (answer): changed is today"},
		"only the fact changed, changed moved": {map[string]string{"general.json": edited(t, b, "gen-001", func(m map[string]any) {
			dated(m)
			m["fact"], m["changed"] = "Факт.", today
		})}, "changed stays as the bank has it"},
		"added moved": {map[string]string{"general.json": edited(t, b, "gen-001", func(m map[string]any) {
			dated(m)
			m["fact"], m["added"] = "Факт.", today
		})}, "added stays as the bank has it"},
		"the same as the bank's": {map[string]string{"general.json": edited(t, b, "gen-001", dated)}, "the same as the bank's"},
		"another category's question": {map[string]string{"general.json": edited(t, b, "his-001", func(m map[string]any) {
			dated(m)
			m["fact"] = "Факт."
		})}, "a question of history"},
		"twice in a batch": {map[string]string{"general.json": func() string {
			one := strings.Trim(edited(t, b, "gen-001", func(m map[string]any) {
				dated(m)
				m["fact"] = "Факт."
			}), "[]")
			return "[" + one + ", " + one + "]"
		}()}, "twice in the batch"},
		"changed and retired": {map[string]string{
			"general.json": edited(t, b, "gen-001", func(m map[string]any) {
				dated(m)
				m["fact"] = "Факт."
			}),
			RetireFile: `[{"id": "gen-001", "why": "weak"}]`,
		}, "changed and retired in one batch"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := sampleCopy(t)
			before, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json"))
			batch := t.TempDir()
			for f, body := range c.files {
				write(t, filepath.Join(batch, f), body)
			}
			if _, err := Add(dir, batch, "", false); err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want an error with %q, got %v", c.want, err)
			}
			if after, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json")); string(after) != string(before) {
				t.Error("a failed batch changed the bank")
			}
		})
	}

	// A retired question stays as it left play.
	dir := sampleCopy(t)
	batch := t.TempDir()
	write(t, filepath.Join(batch, RetireFile), `[{"id": "gen-002", "why": "weak"}]`)
	if _, err := Add(dir, batch, "", false); err != nil {
		t.Fatal(err)
	}
	batch = t.TempDir()
	write(t, filepath.Join(batch, "general.json"), edited(t, b, "gen-002", func(m map[string]any) {
		dated(m)
		m["fact"] = "Факт."
	}))
	if _, err := Add(dir, batch, "", false); err == nil || !strings.Contains(err.Error(), "a retired question isn't changed") {
		t.Fatalf("changed a retired question: %v", err)
	}
}

// What a question asks is its text, answer, options, pictures, a number's terms…; its fact, labels and a picture's
// credit aren't.
func TestAskedChanges(t *testing.T) {
	b := loadSample(t)
	for _, c := range []struct {
		id   string
		edit func(q Question)
		want string
	}{
		{"gen-001", func(q Question) { q.Extra().Fact = "Факт." }, ""},
		{"gen-001", func(q Question) { q.Base().Difficulty = Hard; q.Extra().BG = false; q.Extra().On = []string{"03-01"} }, ""},
		{"gen-001", func(q Question) { q.(*Choice).Wrong[0] = "2 март" }, "wrong"},
		{"gen-001", func(q Question) { q.Base().Text = "Кога?" }, "text"},
		{"geo-901", func(q Question) { q.Extra().Image.Credit = "Някой" }, ""},
		{"geo-901", func(q Question) { q.Extra().Image.File = "0123456789abcdef.webp" }, "image"},
	} {
		old, _ := b.Get(c.id)
		data, _ := Format([]Question{old})
		qs, err := decodeFile(data, old.Base().Category, func(int, string, string) {})
		if err != nil {
			t.Fatal(err)
		}
		q := qs[0].q
		c.edit(q)
		if got := strings.Join(askedChanges(old, q), ", "); got != c.want {
			t.Errorf("%s: asked changes %q, want %q", c.id, got, c.want)
		}
	}
	// A number's terms, an order's items.
	for _, typ := range []string{"number", "order"} {
		old := b.Live("", typ)[0]
		data, _ := Format([]Question{old})
		qs, _ := decodeFile(data, old.Base().Category, func(int, string, string) {})
		switch q := qs[0].q.(type) {
		case *Number:
			q.Tolerance++
		case *Order:
			q.Items[0].Value++
		}
		if got := askedChanges(old, qs[0].q); len(got) != 1 {
			t.Errorf("%s: asked changes %v", typ, got)
		}
	}
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
