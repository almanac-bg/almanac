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
//	themes.json             each category's themes, with the share of it each aims for (themes.go)
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

// Category is a subject questions are about: a chapter of the game (the package's doc).
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
	// Themes are each category's themes (ThemesFile; nil for a bank without them). themesBroken: the file has errors.
	Themes       map[string][]Theme
	themesBroken bool
	// waived are the rules the bank's waivers lift, by question: [id, rule].
	waived map[[2]string]bool
}

// Of is a bank of these questions as they are (read with Decode), unchecked: a fixture a test builds in code, where
// Load would want every rule of a real bank met (pictures on disk, sources, facts).
func Of(categories []Category, questions []Question) *Bank {
	b := &Bank{Categories: categories, Questions: questions, byID: map[string]Question{}}
	for _, q := range questions {
		b.byID[q.Base().ID] = q
	}
	return b
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

// Off are the kinds the game doesn't deal, each with the day it went off. Their questions stay in the bank as they
// are, and a play already dealt one (today's issue drawn before, a duel's second side, a review) still shows it; but
// no draw takes one (Live leaves them out: the day, the chapter games, duels), nothing counts them (the balance, the
// day's runway, the plan), and no new one is written (check.go, add.go). The rules still read them (newLintBank), so
// that they stay ready, their waivers with them. „Подсказки“ went off on 2026-11-23 (the owner, DECISIONS.md): with
// an answer only right or wrong, waiting for a clue was pointless. Switching a kind back on is taking it out of here:
// nothing else changes.
var Off = map[string]string{"clues": "2026-11-23"}

// KindOn is whether the game deals questions of a kind: not one Off.
func KindOn(kind string) bool {
	_, off := Off[kind]
	return !off
}

// Playable is whether a question may be dealt: not retired, and of a kind the game deals (KindOn).
func Playable(q Question) bool { return !q.Extra().Retired && KindOn(q.Base().Type) }

// Live lists the questions that may be dealt (Playable), of the category and type asked ("" for any).
func (b *Bank) Live(category, typ string) []Question {
	var out []Question
	for _, q := range b.Questions {
		h := q.Base()
		if Playable(q) && (category == "" || h.Category == category) && (typ == "" || h.Type == typ) {
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
	b := &Bank{Dir: dir, byID: map[string]Question{}}
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

	themes, errs := readThemes(dir, b.Categories)
	for _, e := range errs {
		fail(ThemesFile, 0, "", e)
	}
	b.Themes, b.themesBroken = themes, len(errs) > 0

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
			errs = append(errs, b.checkTheme(q)...)
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
