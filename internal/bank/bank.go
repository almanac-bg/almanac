package bank

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

// A bank on disk is a directory:
//
//	categories.json         the categories, in the order players see them
//	questions/<id>.json     each category's questions, one JSON array per category
//	images/                 the pictures the questions use
//
// The real bank is private (so players can't look answers up); the public sample in bank/sample is enough to develop
// and test with.
const (
	CategoriesFile = "categories.json"
	QuestionsDir   = "questions"
	ImagesDir      = "images"
)

// Category is a subject questions are about.
type Category struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Icon  string `json:"icon"`
	Color string `json:"color"`
}

// Bank is a loaded, checked bank.
type Bank struct {
	Dir        string
	Categories []Category
	// Questions are every question, retired ones too, by category in the order of Categories, then as in its file.
	Questions []Question
	byID      map[string]Question
}

// Get finds a question by id, retired ones too (history keeps pointing at them).
func (b *Bank) Get(id string) (Question, bool) {
	q, ok := b.byID[id]
	return q, ok
}

// InCategory lists a category's questions, retired ones too, as its file has them.
func (b *Bank) InCategory(category string) []Question {
	var out []Question
	for _, q := range b.Questions {
		if q.Base().Category == category {
			out = append(out, q)
		}
	}
	return out
}

// Live lists the questions that may be dealt: not retired, of the category and type asked ("" for any).
func (b *Bank) Live(category, typ string) []Question {
	var out []Question
	for _, q := range b.Questions {
		h := q.Base()
		if !q.Extra().Retired && (category == "" || h.Category == category) && (typ == "" || h.Type == typ) {
			out = append(out, q)
		}
	}
	return out
}

var (
	categoryID = regexp.MustCompile(`^[a-z]+$`)
	color      = regexp.MustCompile(`^#[0-9a-f]{6}$`)
)

// types are the question types the game knows, by name.
var types = map[string]func() Question{}

func register(name string, newQuestion func() Question) { types[name] = newQuestion }

// Types lists the question types the game knows.
func Types() []string {
	names := make([]string, 0, len(types))
	for name := range types {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// Load reads and checks the bank in dir. Errors (any Problem that isn't a warning) mean the bank must not be played:
// Load then returns a nil Bank with the problems. A server keeps playing the bank it has while a new one is broken.
func Load(dir string) (*Bank, []Problem) {
	b := &Bank{Dir: dir, byID: map[string]Question{}}
	var problems []Problem
	fail := func(file string, line int, id, msg string) {
		problems = append(problems, Problem{File: file, Line: line, ID: id, Msg: msg})
	}
	warn := func(file string, line int, id, msg string) {
		problems = append(problems, Problem{File: file, Line: line, ID: id, Msg: msg, Warning: true})
	}

	data, err := os.ReadFile(filepath.Join(dir, CategoriesFile))
	if err == nil {
		err = strictJSON(data, &b.Categories)
	}
	if err != nil {
		fail(CategoriesFile, 0, "", err.Error())
		return nil, problems
	}
	known := map[string]bool{}
	for _, c := range b.Categories {
		if !categoryID.MatchString(c.ID) || known[c.ID] {
			fail(CategoriesFile, 0, "", fmt.Sprintf("category id %q must be unique lowercase latin letters", c.ID))
		}
		if c.Name == "" || c.Icon == "" || !color.MatchString(c.Color) {
			fail(CategoriesFile, 0, "", fmt.Sprintf("category %q needs a name, an icon and a color like #a1b2c3", c.ID))
		}
		known[c.ID] = true
	}

	files, err := os.ReadDir(filepath.Join(dir, QuestionsDir))
	if err != nil {
		fail(QuestionsDir, 0, "", err.Error())
		return nil, problems
	}
	for _, f := range files {
		id, ok := strings.CutSuffix(f.Name(), ".json")
		if !ok || !known[id] {
			fail(filepath.Join(QuestionsDir, f.Name()), 0, "", "not a category's file (categories.json lists them)")
		}
	}

	today := time.Now().Format(time.DateOnly)
	keys := map[string]string{}
	where := map[string]Problem{}
	for _, c := range b.Categories {
		file := filepath.Join(QuestionsDir, c.ID+".json")
		data, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			fail(file, 0, "", "missing: every category has its file (an empty one is [])")
			continue
		}
		qs, err := decodeFile(data, c.ID, func(line int, id, msg string) { fail(file, line, id, msg) })
		if err != nil {
			fail(file, 0, "", err.Error())
			continue
		}
		for _, item := range qs {
			q, line := item.q, item.line
			h := q.Base()
			errs, warnings := checkQuestion(q, today)
			if q.Extra().Image != nil {
				errs = append(errs, q.Extra().Image.checkFiles(filepath.Join(dir, ImagesDir))...)
			}
			for _, e := range errs {
				fail(file, line, h.ID, e)
			}
			for _, w := range warnings {
				warn(file, line, h.ID, w)
			}
			if first, dup := where[h.ID]; dup {
				fail(file, line, h.ID, fmt.Sprintf("the id is taken (%s:%d)", first.File, first.Line))
			} else {
				where[h.ID] = Problem{File: file, Line: line}
			}
			if other, dup := keys[q.key()]; dup {
				fail(file, line, h.ID, "the same question as "+other)
			} else {
				keys[q.key()] = h.ID
			}
			b.byID[h.ID] = q
			b.Questions = append(b.Questions, q)
		}
	}

	// Pictures nobody uses: left behind by an edit, or a question that went missing.
	used := map[string]bool{}
	for _, q := range b.Questions {
		if im := q.Extra().Image; im != nil {
			used[im.File], used[im.Small()] = true, true
		}
	}
	if images, err := os.ReadDir(filepath.Join(dir, ImagesDir)); err == nil {
		for _, im := range images {
			if !used[im.Name()] && !strings.HasPrefix(im.Name(), ".") {
				warn(filepath.Join(ImagesDir, im.Name()), 0, "", "no question uses this picture")
			}
		}
	}

	for _, p := range problems {
		if !p.Warning {
			return nil, problems
		}
	}
	return b, problems
}

type located struct {
	q    Question
	line int
}

// decodeFile reads a category's questions: one JSON array, each question decoded strictly by its type, with the line
// it starts on (for the bank's keepers).
func decodeFile(data []byte, category string, fail func(line int, id, msg string)) ([]located, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('[') {
		return nil, errors.New("must be a JSON array of questions")
	}
	var out []located
	for dec.More() {
		line := lineAt(data, dec.InputOffset())
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		var probe struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		}
		_ = json.Unmarshal(raw, &probe)
		newQuestion, ok := types[probe.Type]
		if !ok {
			fail(line, probe.ID, fmt.Sprintf("unknown type %q (known: %s)", probe.Type, strings.Join(Types(), ", ")))
			continue
		}
		q := newQuestion()
		if err := strictJSON(raw, q); err != nil {
			fail(line, probe.ID, err.Error())
			continue
		}
		q.Base().Category = category
		out = append(out, located{q, line})
	}
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, errors.New("something after the array")
	}
	return out, nil
}

// lineAt is the line of the first value at or after offset.
func lineAt(data []byte, offset int64) int {
	i := int(offset)
	for i < len(data) && strings.ContainsRune(" \t\r\n,", rune(data[i])) {
		i++
	}
	return bytes.Count(data[:i], []byte("\n")) + 1
}
