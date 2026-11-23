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
	"slices"
	"strconv"
	"strings"
	"time"
)

// Batch files: a batch is a directory with <category>.json for each category it adds to or changes (a JSON array, as
// in the bank: a question whose id the bank has is that question changed, whole; any other is new), and maybe
// RetireFile (the questions it retires: [{"id", "why", "by"}], why one of RetiredWhys, by the question that takes its
// place, if one does: one of the batch, or one live in the bank already) and ImagesDir (its pictures).
const RetireFile = "retire.json"

// Retirement is a question a batch retires (RetireFile).
type Retirement struct {
	ID  string `json:"id"`
	Why string `json:"why"`
	By  string `json:"by,omitempty"`
}

// Added is what a batch did, or would do: how many questions it added, changed and retired, the live size of each
// category after it, and the warnings about its own questions (the new and the changed).
type Added struct {
	Added, Changed, Retired int
	Sizes                   []CategoryCount
	Warnings                []Problem
}

// Add puts a batch (from) into the bank in dir: its new questions at the end of their categories' files, its changed
// ones in their places, the questions it retires marked so, its pictures among the bank's. It checks first and writes
// nothing unless all of it holds: each question decodes strictly, of a kind the game deals (KindOn: never a new one
// Off, nor a change into one); a new one takes the next numbers of its own category's ids; a changed one is a live
// question of that category, keeps its added, is updated today, and is changed today if and only if what it asks
// changed (askedChanges); and the bank with the batch in it loads with no errors. The files are written in the bank's
// format. checkedBy, if set, marks every new or changed question checked today by it (Tail.Checked, CheckedBy) where the batch doesn't say (a changed one: says no other than the bank).
// dry checks only: the bank stays as it is.
func Add(dir, from, checkedBy string, dry bool) (Added, error) {
	today := time.Now().Format(time.DateOnly)
	b, problems := Load(dir)
	if b == nil {
		return Added{Warnings: problems}, errors.New(dir + ": the bank has errors already: fix them first")
	}
	var faults []string
	fault := func(format string, a ...any) { faults = append(faults, fmt.Sprintf(format, a...)) }

	news := map[string][]Question{}
	changes := map[string]Question{}
	seen := map[string]bool{}
	for _, c := range b.Categories {
		data, err := os.ReadFile(filepath.Join(from, c.ID+".json"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return Added{}, err
		}
		prefix, last := lastID(b.InCategory(c.ID))
		qs, err := decodeFile(data, c.ID, func(line int, id, msg string) { fault("%s.json:%d: %s: %s", c.ID, line, id, msg) })
		if err != nil {
			fault("%s.json: %v", c.ID, err)
			continue
		}
		for _, item := range qs {
			id := item.q.Base().ID
			at := fmt.Sprintf("%s.json:%d: %s", c.ID, item.line, id)
			if seen[id] {
				fault("%s: twice in the batch", at)
				continue
			}
			seen[id] = true
			if typ := item.q.Base().Type; !KindOn(typ) {
				if old, ok := b.Get(id); !ok || old.Base().Type != typ {
					fault("%s: no new %s question is written: the kind is off since %s (bank.Off)", at, typ, Off[typ])
					continue
				}
			}
			if old, ok := b.Get(id); ok {
				faults := changeFaults(old, item.q, c.ID, today)
				for _, f := range faults {
					fault("%s: %s", at, f)
				}
				o, t := old.Extra(), item.q.Extra()
				if checkedBy != "" && (t.CheckedBy == "" || (t.Checked == o.Checked && t.CheckedBy == o.CheckedBy)) {
					t.Checked, t.CheckedBy = today, checkedBy
				}
				if len(faults) == 0 && sameQuestion(old, item.q) {
					fault("%s: the same as the bank's: a batch holds only the questions it changes", at)
				}
				changes[id] = item.q
				continue
			}
			p, n, ok := splitID(id)
			switch {
			case !ok || (prefix != "" && p != prefix):
				fault("%s.json:%d: %s: not an id of %s (%s-<number>)", c.ID, item.line, id, c.ID, prefix)
			case n <= last:
				fault("%s.json:%d: %s: the bank has numbers up to %s-%d already: a new question takes the next free one",
					c.ID, item.line, id, prefix, last)
			}
			if t := item.q.Extra(); checkedBy != "" && t.CheckedBy == "" {
				t.Checked, t.CheckedBy = today, checkedBy
			}
			news[c.ID] = append(news[c.ID], item.q)
		}
	}
	if extra, _ := filepath.Glob(filepath.Join(from, "*.json")); len(extra) > 0 {
		known := map[string]bool{RetireFile: true}
		for _, c := range b.Categories {
			known[c.ID+".json"] = true
		}
		for _, f := range extra {
			if !known[filepath.Base(f)] {
				fault("%s: not a category's file", filepath.Base(f))
			}
		}
	}

	var retire []Retirement
	if data, err := os.ReadFile(filepath.Join(from, RetireFile)); err == nil {
		if err := strictJSON(data, &retire); err != nil {
			fault("%s: %v", RetireFile, err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return Added{}, err
	}
	retiring := map[string]bool{}
	for _, r := range retire {
		retiring[r.ID] = true
	}
	live := func(id string) bool { q, ok := b.Get(id); return ok && !q.Extra().Retired && !retiring[id] }
	for _, r := range retire {
		q, ok := b.Get(r.ID)
		switch {
		case changes[r.ID] != nil:
			fault("%s: %s: changed and retired in one batch", RetireFile, r.ID)
		case !ok:
			fault("%s: %s: no such question in the bank", RetireFile, r.ID)
		case q.Extra().Retired:
			fault("%s: %s: retired already", RetireFile, r.ID)
		case !slices.Contains(RetiredWhys, r.Why):
			fault("%s: %s: why is one of %s", RetireFile, r.ID, strings.Join(RetiredWhys, ", "))
		case retiring[r.By]:
			fault("%s: %s: by %s, which the batch retires too", RetireFile, r.ID, r.By)
		case r.By != "" && !seen[r.By] && !live(r.By):
			fault("%s: %s: by %s, which is neither in the batch nor live in the bank", RetireFile, r.ID, r.By)
		default:
			t := q.Extra()
			t.Retired, t.RetiredWhy, t.ReplacedBy, t.Updated = true, r.Why, r.By, today
		}
	}

	pictures, err := os.ReadDir(filepath.Join(from, ImagesDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Added{}, err
	}
	for _, p := range pictures {
		if _, err := os.Stat(filepath.Join(dir, ImagesDir, p.Name())); err == nil {
			fault("%s/%s: the bank has a picture of that name already", ImagesDir, p.Name())
		}
	}
	if len(faults) > 0 {
		return Added{}, errors.New("nothing added:\n" + strings.Join(faults, "\n"))
	}

	// The bank as it would be, in a scratch copy: its files written, its pictures linked.
	tmp, err := os.MkdirTemp("", "almanac-bank-add-")
	if err != nil {
		return Added{}, err
	}
	defer os.RemoveAll(tmp)
	if err := WriteCategories(tmp, b.Categories); err != nil {
		return Added{}, err
	}
	if _, err := os.Stat(filepath.Join(dir, WaiversFile)); err == nil {
		if err := copyFile(filepath.Join(dir, WaiversFile), filepath.Join(tmp, WaiversFile)); err != nil {
			return Added{}, err
		}
	}
	for _, c := range b.Categories {
		qs := b.InCategory(c.ID)
		for i, q := range qs {
			if changed, ok := changes[q.Base().ID]; ok {
				qs[i] = changed
			}
		}
		if err := WriteCategory(tmp, c.ID, append(qs, news[c.ID]...)); err != nil {
			return Added{}, err
		}
	}
	if err := os.MkdirAll(filepath.Join(tmp, ImagesDir), 0o755); err != nil {
		return Added{}, err
	}
	for _, src := range []string{filepath.Join(dir, ImagesDir), filepath.Join(from, ImagesDir)} {
		files, _ := os.ReadDir(src)
		for _, f := range files {
			abs, _ := filepath.Abs(filepath.Join(src, f.Name()))
			if err := os.Symlink(abs, filepath.Join(tmp, ImagesDir, f.Name())); err != nil {
				return Added{}, err
			}
		}
	}
	after, problems := Load(tmp)
	if after == nil {
		var lines []string
		for _, p := range problems {
			if !p.Warning {
				lines = append(lines, p.String())
			}
		}
		return Added{}, errors.New("nothing added: the bank with the batch in it has errors:\n" + strings.Join(lines, "\n"))
	}

	res := Added{Changed: len(changes), Retired: len(retire)}
	mine := map[string]bool{}
	for id := range changes {
		mine[id] = true
	}
	for _, c := range after.Categories {
		res.Sizes = append(res.Sizes, CategoryCount{c.ID, len(after.Live(c.ID, ""))})
		res.Added += len(news[c.ID])
		for _, q := range news[c.ID] {
			mine[q.Base().ID] = true
		}
	}
	for _, p := range problems {
		if mine[p.ID] {
			res.Warnings = append(res.Warnings, p)
		}
	}
	if dry {
		return res, nil
	}
	// It holds: the pictures first (a question never points at a picture that isn't there), then the files.
	for _, p := range pictures {
		if err := copyFile(filepath.Join(from, ImagesDir, p.Name()), filepath.Join(dir, ImagesDir, p.Name())); err != nil {
			return Added{}, err
		}
	}
	for _, c := range b.Categories {
		if err := WriteCategory(dir, c.ID, after.InCategory(c.ID)); err != nil {
			return Added{}, err
		}
	}
	return res, nil
}

// changeFaults is what's wrong with q as a change to the bank's question old, in a batch's file of category, today:
// old is a live question of that category; q keeps its added, is updated today, and is changed today if what it asks
// changed, or keeps its changed if only the rest did (its fact, its labels, its sources).
func changeFaults(old, q Question, category, today string) []string {
	o, t := old.Extra(), q.Extra()
	switch {
	case old.Base().Category != category:
		return []string{fmt.Sprintf("a question of %s: it's changed in %s.json", old.Base().Category, old.Base().Category)}
	case o.Retired:
		return []string{"retired: a retired question isn't changed (a new one takes its place)"}
	case t.Retired:
		return []string{"a batch retires a question in " + RetireFile}
	}
	// as is a date as the bank has it, for saying so.
	as := func(date string) string {
		if date == "" {
			return "none"
		}
		return date
	}
	var out []string
	if t.Added != o.Added {
		out = append(out, fmt.Sprintf("added stays as the bank has it (%s)", as(o.Added)))
	}
	if t.Updated != today {
		out = append(out, fmt.Sprintf("a change sets updated to today (%s)", today))
	}
	if asked := askedChanges(old, q); len(asked) > 0 {
		if t.Changed != today {
			msg := fmt.Sprintf("what it asks changed (%s): changed is today (%s) too", strings.Join(asked, ", "), today)
			if t.Changed == "" {
				msg += "; or, as a new question, it takes the next free id (the bank has this one)"
			}
			out = append(out, msg)
		}
	} else if t.Changed != o.Changed {
		out = append(out, fmt.Sprintf("what it asks is the same (only its fact or labels changed): changed stays as the bank has it (%s)", as(o.Changed)))
	}
	return out
}

// notAsked are a question's fields that aren't what it asks: its labels (difficulty, days, Bulgaria), the fact and
// the day's line, its dates, sources and retirement. Players' answers from before a change to them were to the same
// question (Tail.Changed). Every other field is what it asks: the text, the answer and options, items, pairs, decoy,
// clues, groups, a number's unit, step, scale and tolerance, an order's direction, the type, a picture; each type's
// asked writes those out for its Version (version.go), and TestEveryFieldClassed holds every field to one or the other.
var notAsked = map[string]bool{
	"id": true, "difficulty": true, "fact": true, "day": true, "on": true, "bg": true, "sources": true,
	"added": true, "changed": true, "updated": true, "checked": true, "checkedBy": true, "reviewBy": true,
	"retired": true, "retiredWhy": true, "replacedBy": true,
}

// askedChanges are the fields of what a question asks that differ between two versions of it, by name.
func askedChanges(a, b Question) []string {
	fa, fb := askedOf(a), askedOf(b)
	var out []string
	for _, k := range slices.Sorted(maps.Keys(fa)) {
		if !notAsked[k] && fa[k] != fb[k] {
			out = append(out, k)
		}
	}
	for _, k := range slices.Sorted(maps.Keys(fb)) {
		if _, ok := fa[k]; !ok && !notAsked[k] {
			out = append(out, k)
		}
	}
	return out
}

// sameQuestion is whether two versions of a question are the same but for the day they were updated.
func sameQuestion(a, b Question) bool {
	fa, fb := fieldsOf(a), fieldsOf(b)
	delete(fa, "updated")
	delete(fb, "updated")
	return maps.Equal(fa, fb)
}

// fieldsOf is a question's fields as the bank writes them (its typography set, tidy), each compact.
func fieldsOf(q Question) map[string]string {
	data, err := Format([]Question{q})
	var raw []map[string]json.RawMessage
	if err != nil || json.Unmarshal(data, &raw) != nil || len(raw) != 1 {
		return map[string]string{}
	}
	out := map[string]string{}
	for k, v := range raw[0] {
		var b bytes.Buffer
		_ = json.Compact(&b, v)
		out[k] = b.String()
	}
	return out
}

// askedOf is fieldsOf with each picture as the file it shows: who took it, its licence and its description are its
// labels.
func askedOf(q Question) map[string]string {
	out := fieldsOf(q)
	if im := q.Extra().Image; im != nil {
		out["image"] = im.File
	}
	if c, ok := q.(*Choice); ok && len(c.Pictures) > 0 {
		files := make([]string, len(c.Pictures))
		for i, p := range c.Pictures {
			files[i] = p.File
		}
		out["pictures"] = strings.Join(files, " ")
	}
	return out
}

// lastID is a category's id prefix ("gen") and the highest number its questions have, retired ones too.
func lastID(qs []Question) (prefix string, last int) {
	for _, q := range qs {
		if p, n, ok := splitID(q.Base().ID); ok {
			prefix, last = p, max(last, n)
		}
	}
	return prefix, last
}

// splitID splits "gen-412" into "gen" and 412.
func splitID(id string) (prefix string, n int, ok bool) {
	i := strings.LastIndexByte(id, '-')
	if i <= 0 {
		return "", 0, false
	}
	n, err := strconv.Atoi(id[i+1:])
	return id[:i], n, err == nil && n > 0
}

// NextID is the first free number of a category's ids, with its prefix: "gen", 1503.
func (b *Bank) NextID(category string) (prefix string, next int) {
	prefix, last := lastID(b.InCategory(category))
	return prefix, last + 1
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
