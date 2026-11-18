package bank

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A copy is the bank as Load reads it, and the next copy links the pictures it shares with this one.
func TestCopy(t *testing.T) {
	from := filepath.Join(t.TempDir(), "bank")
	if err := os.CopyFS(from, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	// What a clone has besides the bank stays out of the copy.
	for _, f := range []string{".git/HEAD", "reports/batch/REPORT.md", "images/.DS_Store"} {
		os.MkdirAll(filepath.Join(from, filepath.Dir(f)), 0o755)
		os.WriteFile(filepath.Join(from, f), []byte("x"), 0o644)
	}
	first := filepath.Join(t.TempDir(), "first")
	if err := Copy(from, first, ""); err != nil {
		t.Fatal(err)
	}
	want, got := loadSample(t), mustLoad(t, first)
	if len(got.Questions) != len(want.Questions) || len(got.Categories) != len(want.Categories) {
		t.Fatalf("the copy has %d questions in %d categories, the bank %d in %d",
			len(got.Questions), len(got.Categories), len(want.Questions), len(want.Categories))
	}
	for _, f := range []string{".git", "reports", "images/.DS_Store"} {
		if _, err := os.Stat(filepath.Join(first, f)); err == nil {
			t.Errorf("%s was copied", f)
		}
	}

	second := filepath.Join(t.TempDir(), "second")
	if err := Copy(from, second, first); err != nil {
		t.Fatal(err)
	}
	pictures, _ := os.ReadDir(filepath.Join(second, ImagesDir))
	if len(pictures) == 0 {
		t.Fatal("no pictures in the sample's copy")
	}
	for _, p := range pictures {
		a, _ := os.Stat(filepath.Join(first, ImagesDir, p.Name()))
		b, _ := os.Stat(filepath.Join(second, ImagesDir, p.Name()))
		if !os.SameFile(a, b) {
			t.Errorf("%s copied again, not linked", p.Name())
		}
	}

	// A file in questions/ that isn't a category's: Load refuses the copy as it refuses the bank.
	os.WriteFile(filepath.Join(from, QuestionsDir, "stray.json"), []byte("[]"), 0o644)
	third := filepath.Join(t.TempDir(), "third")
	if err := Copy(from, third, second); err != nil {
		t.Fatal(err)
	}
	if b, _ := Load(third); b != nil {
		t.Error("the copy of a bank with a stray file loads")
	}
	// Copying into a directory that's there already fails: a copy is always new.
	if err := Copy(from, third, ""); err == nil {
		t.Error("copied over an earlier copy")
	}
}

func mustLoad(t *testing.T, dir string) *Bank {
	t.Helper()
	b, problems := Load(dir)
	if b == nil {
		t.Fatalf("%s doesn't load: %v", dir, problems)
	}
	return b
}

func TestCommit(t *testing.T) {
	const (
		main  = "1111111111111111111111111111111111111111"
		other = "2222222222222222222222222222222222222222"
		loose = "3333333333333333333333333333333333333333"
	)
	write := func(path, s string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	repo := t.TempDir()
	git := filepath.Join(repo, ".git")

	if c := Commit(repo); c != "" {
		t.Errorf("no repository: %q", c)
	}
	// A fresh clone: the branch in packed-refs.
	write(filepath.Join(git, "HEAD"), "ref: refs/heads/main\n")
	write(filepath.Join(git, "packed-refs"), "# pack-refs with: peeled fully-peeled sorted\n"+other+" refs/heads/other\n"+main+" refs/heads/main\n")
	if c := Commit(repo); c != main {
		t.Errorf("packed: %q", c)
	}
	// After a pull: the loose ref wins.
	write(filepath.Join(git, "refs/heads/main"), loose+"\n")
	if c := Commit(repo); c != loose {
		t.Errorf("loose: %q", c)
	}
	// Detached.
	write(filepath.Join(git, "HEAD"), other+"\n")
	if c := Commit(repo); c != other {
		t.Errorf("detached: %q", c)
	}
	// A worktree: its own HEAD, the repository's branches.
	tree := t.TempDir()
	wt := filepath.Join(git, "worktrees", "tree")
	write(filepath.Join(tree, ".git"), "gitdir: "+wt+"\n")
	write(filepath.Join(wt, "HEAD"), "ref: refs/heads/main\n")
	write(filepath.Join(wt, "commondir"), "../..\n")
	if c := Commit(tree); c != loose {
		t.Errorf("worktree: %q", c)
	}
	// Nonsense is no commit.
	write(filepath.Join(wt, "HEAD"), "ref: refs/../../etc/passwd\n")
	if c := Commit(tree); c != "" {
		t.Errorf("a ref out of the repository: %q", c)
	}
	write(filepath.Join(git, "HEAD"), "not a commit\n")
	if c := Commit(repo); c != "" {
		t.Errorf("garbage: %q", c)
	}
	if !strings.HasPrefix(main, Short(main)) || len(Short(main)) != 7 {
		t.Errorf("Short: %q", Short(main))
	}
}

// A copy keeps the pictures the bank no longer has, for good: a game is gone over with the version of a question it
// showed, however long ago (the game keeps every version for good), and the version's pictures with it. Load doesn't
// count them as left behind.
func TestCopyKeepsGonePictures(t *testing.T) {
	from := filepath.Join(t.TempDir(), "bank")
	if err := os.CopyFS(from, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	first := filepath.Join(t.TempDir(), "first")
	if err := Copy(from, first, ""); err != nil {
		t.Fatal(err)
	}
	// A question with a picture leaves the bank, and its picture with it.
	var gone *Image
	files, _ := filepath.Glob(filepath.Join(from, QuestionsDir, "*.json"))
	for _, f := range files {
		data, _ := os.ReadFile(f)
		var qs []json.RawMessage
		if err := json.Unmarshal(data, &qs); err != nil {
			t.Fatal(err)
		}
		for i, raw := range qs {
			var q struct{ Image *Image }
			_ = json.Unmarshal(raw, &q)
			if q.Image != nil && gone == nil {
				gone = q.Image
				qs = append(qs[:i], qs[i+1:]...)
				data, _ = json.Marshal(qs)
				os.WriteFile(f, data, 0o644)
				break
			}
		}
	}
	if gone == nil {
		t.Fatal("no picture in the sample")
	}
	os.Remove(filepath.Join(from, ImagesDir, gone.File))
	os.Remove(filepath.Join(from, ImagesDir, gone.Small()))

	second := filepath.Join(t.TempDir(), "second")
	if err := Copy(from, second, first); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{gone.File, gone.Small()} {
		a, _ := os.Stat(filepath.Join(first, ImagesDir, f))
		b, err := os.Stat(filepath.Join(second, ImagesDir, f))
		if err != nil || !os.SameFile(a, b) {
			t.Fatalf("%s isn't kept in the next copy: %v", f, err)
		}
	}
	today := time.Now().Format(time.DateOnly)
	if left := Gone(second); len(left) != 2 || left[gone.File] != today || left[gone.Small()] != today {
		t.Fatalf("gone: %v", left)
	}
	_, problems := Load(second)
	for _, p := range problems {
		if strings.Contains(p.File, gone.File) {
			t.Fatalf("a picture kept for plays is told as left behind: %v", p)
		}
	}
	// It goes along to the next copy, with the day it left; and to a copy made years later, still with that day.
	third := filepath.Join(t.TempDir(), "third")
	if err := Copy(from, third, second); err != nil {
		t.Fatal(err)
	}
	if left := Gone(third); left[gone.File] != today {
		t.Fatalf("the day it left: %v", left)
	}
	fourth := filepath.Join(t.TempDir(), "fourth", ImagesDir)
	if err := carry(filepath.Join(third, ImagesDir), fourth, time.Now().AddDate(5, 0, 0)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(fourth, gone.File)); err != nil {
		t.Fatalf("a picture of a version kept is gone from a later copy: %v", err)
	}
	if left := Gone(filepath.Dir(fourth)); left[gone.File] != today {
		t.Fatalf("the day it left, years later: %v", left)
	}
}

// A picture's name is its content's hash: one changed under its name is refused (it's cached for good by its name).
func TestPictureNamedByContent(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bank")
	if err := os.CopyFS(dir, os.DirFS(sample)); err != nil {
		t.Fatal(err)
	}
	images, _ := filepath.Glob(filepath.Join(dir, ImagesDir, "????????????????.webp"))
	if len(images) < 2 {
		t.Fatal("too few pictures in the sample")
	}
	data, _ := os.ReadFile(images[1])
	os.WriteFile(images[0], data, 0o644)
	b, problems := Load(dir)
	if b != nil {
		t.Fatal("a bank with a picture changed under its name loads")
	}
	found := false
	for _, p := range problems {
		found = found || strings.Contains(p.Msg, "isn't named by its content")
	}
	if !found {
		t.Fatalf("not told: %v", problems)
	}
}
