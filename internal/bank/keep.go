package bank

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// A server never plays the bank's checkout itself (cmd/almanac: serve): a pull moves that under it, and a pull that
// fails its check would be there for the next start to refuse. It plays a copy of its own, made by Copy as it starts
// and at each reload, and keeps the last few good ones to start from when the checkout has errors.
//
// A copy's pictures only grow: one the bank no longer has (its question changed, or left) stays in the copies for
// KeepGone after it left, as a play may still show the version of the question it was in (the game keeps every
// version it played), and images/.gone says since when each such has gone.

// KeepGone is how long a picture the bank no longer has stays in its copies: longer than any play shows a question's
// earlier version (a challenge's time, a game gone over after).
const KeepGone = 30 * 24 * time.Hour

// GoneFile lists the pictures a copy keeps that the bank no longer has, a line each: the file and the day it left.
const GoneFile = ".gone"

// Copy copies the bank in from into to (a new directory): the files Load reads and nothing else (not the repository,
// nor a batch's reports). A picture that like (an earlier copy, "" for none) already has, by the same name and size, is
// linked rather than copied: names are hashes of the content, so a copy costs the questions' text and the new pictures
// only. Those like has that the bank no longer does come along for KeepGone after they left (GoneFile). Load reads the
// copy as it would read from.
func Copy(from, to, like string) error {
	if err := os.Mkdir(to, 0o755); err != nil {
		return err
	}
	if err := copyFile(filepath.Join(from, CategoriesFile), filepath.Join(to, CategoriesFile)); err != nil {
		return err
	}
	if err := copyFile(filepath.Join(from, WaiversFile), filepath.Join(to, WaiversFile)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// Every entry of questions/, as it is: Load refuses a file there that isn't a category's, and so must the copy's.
	if err := mirror(filepath.Join(from, QuestionsDir), filepath.Join(to, QuestionsDir), func(src, dst string) error {
		return copyFile(src, dst)
	}); err != nil {
		return err
	}
	if err := mirror(filepath.Join(from, ImagesDir), filepath.Join(to, ImagesDir), func(src, dst string) error {
		name := filepath.Base(src)
		if strings.HasPrefix(name, ".") {
			return nil // Load passes over them
		}
		if like != "" {
			old := filepath.Join(like, ImagesDir, name)
			if a, err := os.Stat(src); err == nil {
				if b, err := os.Stat(old); err == nil && b.Mode().IsRegular() && a.Size() == b.Size() {
					if os.Link(old, dst) == nil {
						return nil
					}
				}
			}
		}
		return copyFile(src, dst)
	}); err != nil {
		return err
	}
	if like == "" {
		return nil
	}
	return carry(filepath.Join(like, ImagesDir), filepath.Join(to, ImagesDir), time.Now())
}

// carry brings the pictures an earlier copy has (in from) and the bank no longer does into a new copy's (to), linked,
// until KeepGone after they left, and lists them in to's GoneFile.
func carry(from, to string, now time.Time) error {
	entries, err := os.ReadDir(from)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	left := Gone(filepath.Dir(from))
	today := now.Format(time.DateOnly)
	var lines []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") || !e.Type().IsRegular() {
			continue
		}
		dst := filepath.Join(to, name)
		if _, err := os.Lstat(dst); err == nil {
			continue // the bank has it
		}
		day, ok := left[name]
		if !ok {
			day = today // left with this copy
		}
		if d, err := time.Parse(time.DateOnly, day); err != nil || now.Sub(d) >= KeepGone {
			continue
		}
		if err := os.MkdirAll(to, 0o755); err != nil {
			return err
		}
		if os.Link(filepath.Join(from, name), dst) != nil {
			if err := copyFile(filepath.Join(from, name), dst); err != nil {
				return err
			}
		}
		lines = append(lines, name+" "+day+"\n")
	}
	if len(lines) == 0 {
		return nil
	}
	return os.WriteFile(filepath.Join(to, GoneFile), []byte(strings.Join(lines, "")), 0o644)
}

// Gone are the pictures a copy of the bank in dir keeps that the bank no longer has, by file, with the day each left
// (GoneFile; none in a bank's checkout).
func Gone(dir string) map[string]string {
	out := map[string]string{}
	data, err := os.ReadFile(filepath.Join(dir, ImagesDir, GoneFile))
	if err != nil {
		return out
	}
	for line := range strings.Lines(string(data)) {
		if name, day, ok := strings.Cut(strings.TrimSpace(line), " "); ok {
			out[name] = day
		}
	}
	return out
}

// mirror makes dir to with what dir from has: each file through file, each directory an empty one (a bank has none
// in these, so Load complains of one, and must of the copy's too). A bank without from is copied without it.
func mirror(from, to string, file func(src, dst string) error) error {
	entries, err := os.ReadDir(from)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := os.Mkdir(to, 0o755); err != nil {
		return err
	}
	for _, e := range entries {
		src, dst := filepath.Join(from, e.Name()), filepath.Join(to, e.Name())
		switch {
		case e.IsDir():
			err = os.Mkdir(dst, 0o755)
		case e.Type().IsRegular():
			err = file(src, dst)
		default:
			// A link or the like: copied as the file it stands for, as Load would read it.
			if info, serr := os.Stat(src); serr == nil && info.Mode().IsRegular() {
				err = file(src, dst)
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

var commitHash = regexp.MustCompile(`^[0-9a-f]{40}([0-9a-f]{24})?$`)

// Commit is the commit checked out in dir, when it's a clone of the bank's repository ("" when it isn't, or can't be
// told): which bank a server plays. It reads the repository's files itself (HEAD, then the branch's ref, loose or
// packed), as the server has no git to ask.
func Commit(dir string) string {
	git := filepath.Join(dir, ".git")
	if data, err := os.ReadFile(git); err == nil { // a worktree: "gitdir: <its directory in the repository>"
		p, ok := strings.CutPrefix(strings.TrimSpace(string(data)), "gitdir: ")
		if !ok {
			return ""
		}
		if !filepath.IsAbs(p) {
			p = filepath.Join(dir, p)
		}
		git = p
	}
	head, err := os.ReadFile(filepath.Join(git, "HEAD"))
	if err != nil {
		return ""
	}
	h := strings.TrimSpace(string(head))
	ref, ok := strings.CutPrefix(h, "ref: ")
	if !ok {
		if commitHash.MatchString(h) {
			return h // detached
		}
		return ""
	}
	// A worktree keeps its HEAD; the branches are the repository's.
	common := git
	if data, err := os.ReadFile(filepath.Join(git, "commondir")); err == nil {
		if c := strings.TrimSpace(string(data)); filepath.IsAbs(c) {
			common = c
		} else {
			common = filepath.Join(git, c)
		}
	}
	if !strings.HasPrefix(ref, "refs/") || strings.Contains(ref, "..") {
		return ""
	}
	for _, d := range []string{git, common} {
		if data, err := os.ReadFile(filepath.Join(d, filepath.FromSlash(ref))); err == nil {
			if c := strings.TrimSpace(string(data)); commitHash.MatchString(c) {
				return c
			}
			return ""
		}
	}
	packed, err := os.ReadFile(filepath.Join(common, "packed-refs"))
	if err != nil {
		return ""
	}
	for line := range bytes.Lines(packed) {
		c, name, ok := strings.Cut(strings.TrimSpace(string(line)), " ")
		if ok && name == ref && commitHash.MatchString(c) {
			return c
		}
	}
	return ""
}

// Short is a commit as people read it: its first seven characters ("" stays "").
func Short(commit string) string {
	if len(commit) > 7 {
		return commit[:7]
	}
	return commit
}
