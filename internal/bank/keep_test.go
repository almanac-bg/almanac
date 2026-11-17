package bank

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
