package bank

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Batch files: a batch to add is a directory with <category>.json for each category it adds to (a JSON array, as in
// the bank), and maybe RetireFile (the ids it retires, each replaced by one of its questions in the same cell) and
// ImagesDir (its pictures).
const RetireFile = "retire.json"

// Added is what a batch did, or would do: how many questions it added and retired, the live size of each category
// after it, and the warnings about its own questions.
type Added struct {
	Added, Retired int
	Sizes          []CategoryCount
	Warnings       []Problem
}

// Add puts a batch (from) into the bank in dir: its questions at the end of their categories' files, the questions it
// retires marked so, its pictures among the bank's. It checks first and writes nothing unless all of it holds: each
// new question decodes strictly, takes the next numbers of its own category's ids, and the bank with the batch in it
// loads with no errors. The files are written in the bank's format. dry checks only: the bank stays as it is.
func Add(dir, from string, dry bool) (Added, error) {
	b, problems := Load(dir)
	if b == nil {
		return Added{Warnings: problems}, errors.New(dir + ": the bank has errors already: fix them first")
	}
	var faults []string
	fault := func(format string, a ...any) { faults = append(faults, fmt.Sprintf(format, a...)) }

	news := map[string][]Question{}
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
			p, n, ok := splitID(id)
			switch {
			case !ok || (prefix != "" && p != prefix):
				fault("%s.json:%d: %s: not an id of %s (%s-<number>)", c.ID, item.line, id, c.ID, prefix)
			case n <= last:
				fault("%s.json:%d: %s: the bank has numbers up to %s-%d already: a new question takes the next free one",
					c.ID, item.line, id, prefix, last)
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

	var retire []string
	if data, err := os.ReadFile(filepath.Join(from, RetireFile)); err == nil {
		if err := strictJSON(data, &retire); err != nil {
			fault("%s: %v", RetireFile, err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return Added{}, err
	}
	for _, id := range retire {
		q, ok := b.Get(id)
		switch {
		case !ok:
			fault("%s: %s: no such question in the bank", RetireFile, id)
		case q.Extra().Retired:
			fault("%s: %s: retired already", RetireFile, id)
		default:
			q.Extra().Retired = true
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
	for _, c := range b.Categories {
		if err := WriteCategory(tmp, c.ID, append(b.InCategory(c.ID), news[c.ID]...)); err != nil {
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

	res := Added{Retired: len(retire)}
	mine := map[string]bool{}
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
