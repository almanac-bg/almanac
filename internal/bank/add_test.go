package bank

import (
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
		"an id already used":                  {map[string]string{"general.json": "[" + question("gen-001", good) + "]"}, "the next free one"},
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

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
