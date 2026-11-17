package bank

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// A server never plays the bank's checkout itself (cmd/almanac: serve): a pull moves that under it, and a pull that
// fails its check would be there for the next start to refuse. It plays a copy of its own, made by Copy as it starts
// and at each reload, and keeps the last few good ones to start from when the checkout has errors.

// Copy copies the bank in from into to (a new directory): the files Load reads and nothing else (not the repository,
// nor a batch's reports). A picture that like (an earlier copy, "" for none) already has, by the same name and size, is
// linked rather than copied: names are hashes of the content, so a copy costs the questions' text and the new pictures
// only. Load reads the copy as it would read from.
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
	return mirror(filepath.Join(from, ImagesDir), filepath.Join(to, ImagesDir), func(src, dst string) error {
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
	})
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
