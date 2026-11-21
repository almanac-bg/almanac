package bank

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
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

// Category is a subject questions are about: a topic.
type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Bank is a loaded, checked bank.
type Bank struct {
	// Dir is where it was loaded from: its pictures are served from there.
	Dir string
	// Commit is the commit of the bank's repository it was loaded from, when the loader knows it (Commit): which bank
	// a server plays, in its /api/health.
	Commit     string
	Categories []Category
	// Questions are every question, retired ones too, by category in the order of Categories, then as in its file.
	Questions []Question
	byID      map[string]Question
	// waived are the rules the bank's waivers lift, by question: [id, rule].
	waived map[[2]string]bool
	// left are the questions of a retired kind the bank's files still have (RetiredKinds): not loaded, never dealt,
	// but written back where they were (Write).
	left map[string]leftover
}

// leftover is a question of a retired kind as its file has it: its category, the id of the question before it in the
// file ("" for none), and itself as it is.
type leftover struct {
	category, after string
	raw             json.RawMessage
}

// RetiredKinds are the kinds the game no longer has (21 Nov 2026: „Подсказки“, „Свържи“, „Раздели“; with the score
// only right or wrong, clues were waiting, and pairs or groups bundled four answers into one). Each question of them
// became a choice or a true-or-not, by the same id. One a bank's file still has loads with a warning (RuleKind) and
// is left out, as if it weren't there: never dealt, not dropped (Dropped), and kept as it was by the tools that write
// the bank's files (Write). A day whose ten pinned it plays it as void that day (play: day.go), the accepted cost; a
// day ahead deals another in its place. A version of one the game kept from before reads back as ErrRetiredKind
// (Decode).
var RetiredKinds = []string{"clues", "match", "split"}

// Of is a bank of these questions as they are (read with Decode), unchecked: a fixture a test builds in code, where
// Load would want every rule of a real bank met (pictures on disk, sources, facts).
func Of(categories []Category, questions []Question) *Bank {
	b := &Bank{Categories: categories, Questions: questions, byID: map[string]Question{}}
	for _, q := range questions {
		b.byID[q.Base().ID] = q
	}
	return b
}

// Left lists the questions of a retired kind the bank's files still have (RetiredKinds), by id, in order.
func (b *Bank) Left() []string {
	ids := slices.Collect(maps.Keys(b.left))
	slices.Sort(ids)
	return ids
}

// isLeft is whether the bank's files have a question of a retired kind by this id (RetiredKinds).
func (b *Bank) isLeft(id string) bool {
	_, ok := b.left[id]
	return ok
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

var categoryID = regexp.MustCompile(`^[a-z]+$`)

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
	b := &Bank{Dir: dir, byID: map[string]Question{}, left: map[string]leftover{}}
	var problems []Problem
	fail := func(file string, line int, id, msg string) {
		problems = append(problems, Problem{File: file, Line: line, ID: id, Msg: msg})
	}
	warn := func(file string, line int, id, rule, msg string) {
		problems = append(problems, Problem{File: file, Line: line, ID: id, Msg: msg, Rule: rule, Warning: true})
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
		if c.Name == "" {
			fail(CategoriesFile, 0, "", fmt.Sprintf("category %q needs a name", c.ID))
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
		qs, err := decodeFile(data, c.ID, func(line int, id, msg string) { fail(file, line, id, msg) }, func(line int, id, after string, raw json.RawMessage) {
			warn(file, line, id, RuleKind, "a question of a retired kind: make it a choice or a true-or-not, by the same id")
			if first, dup := where[id]; dup || id == "" {
				fail(file, line, id, fmt.Sprintf("the id is taken (%s:%d)", first.File, first.Line))
				return
			}
			where[id] = Problem{File: file, Line: line}
			b.left[id] = leftover{category: c.ID, after: after, raw: raw}
		})
		if err != nil {
			fail(file, 0, "", err.Error())
			continue
		}
		for _, item := range qs {
			q, line := item.q, item.line
			h := q.Base()
			errs, warnings := checkQuestion(q, today)
			for _, im := range picturesOf(q) {
				errs = append(errs, im.checkFiles(filepath.Join(dir, ImagesDir))...)
			}
			for _, e := range errs {
				fail(file, line, h.ID, e)
			}
			for _, w := range warnings {
				warn(file, line, h.ID, w.Rule, w.Msg)
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
			h.subjects, h.version = subjectsOf(q), versionOf(q)
			b.byID[h.ID] = q
			b.Questions = append(b.Questions, q)
		}
	}

	// Pictures nobody uses: left behind by an edit, or a question that went missing. Not those a copy keeps for plays
	// still showing a question's earlier version (keep.go).
	used := map[string]bool{}
	for name := range Gone(dir) {
		used[name] = true
	}
	for _, q := range b.Questions {
		for _, im := range picturesOf(q) {
			for _, f := range im.files() {
				used[f.name] = true
			}
		}
	}
	if images, err := os.ReadDir(filepath.Join(dir, ImagesDir)); err == nil {
		for _, im := range images {
			if !used[im.Name()] && !strings.HasPrefix(im.Name(), ".") {
				warn(filepath.Join(ImagesDir, im.Name()), 0, "", RulePicture, "no question uses this picture")
			}
		}
	}

	// The rules over the questions (rules.go), now that the bank is all in: one question can give another away.
	waivers, err := readWaivers(dir)
	if err != nil {
		fail(WaiversFile, 0, "", err.Error())
	}
	problems = append(problems, b.lint(waivers, where)...)

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
// it starts on (for the bank's keepers). A question of a retired kind is told to left as it is, with the id of the
// question before it (RetiredKinds), and not decoded.
func decodeFile(data []byte, category string, fail func(line int, id, msg string), left func(line int, id, after string, raw json.RawMessage)) ([]located, error) {
	after := ""
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
		if !ok && slices.Contains(RetiredKinds, probe.Type) {
			left(line, probe.ID, after, raw)
			after = probe.ID
			continue
		}
		after = probe.ID
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
