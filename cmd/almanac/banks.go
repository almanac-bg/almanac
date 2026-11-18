package main

import (
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// keptBanks are the copies of the bank a server plays (bank.Copy), in a directory of their own beside the database.
// The server plays a copy, never BANK_DIR itself: a pull moves BANK_DIR, and would take pictures away from a bank still
// in play. A copy is made as the server starts and at each reload, and kept only if it loads without errors, named by
// when it was made and its commit; the newest few of different commits stay. So when BANK_DIR has errors as the
// server starts (a pull that failed its check and was left there, a bank only a newer program reads, an older program
// gone back to after a failed deploy), it starts all the same, on the newest good copy it can read: no outage for a
// bank that a restart, crash or rollback would otherwise refuse.
type keptBanks struct {
	src string // BANK_DIR
	dir string // where the copies are ("": none, and BANK_DIR is played as it is: in development)
}

const (
	// keepBanks is how many good copies of different commits stay, besides those in play.
	keepBanks = 3
	// keptStamp names a copy by when it was made (then "-" and its commit): names sort as they were made.
	keptStamp = "20060102T150405.000000000"
	// partSuffix marks a copy being made: it's checked before it takes its name.
	partSuffix = ".part"
)

// take loads the bank in BANK_DIR through a new copy. A bank with errors comes back nil with its problems, and
// leaves no copy; so does one that drops a question the newest good copy has (bank.Dropped). If no copy can be made (a full disk), BANK_DIR itself is loaded, the error logged.
func (k keptBanks) take() (b *bank.Bank, problems []bank.Problem, commit string) {
	if k.dir == "" {
		return k.direct()
	}
	for try := 0; ; try++ {
		commit = bank.Commit(k.src)
		part, like, err := k.copy(commit)
		if err != nil {
			slog.Error("bank: no copy made, so the bank is played from BANK_DIR itself", "err", err)
			return k.direct()
		}
		if bank.Commit(k.src) != commit && try < 2 {
			os.RemoveAll(part) // pulled meanwhile: the copy may be half of each
			continue
		}
		if b, problems = bank.Load(part); b == nil {
			os.RemoveAll(part)
			return nil, problems, commit
		}
		if like != "" {
			if dropped := bank.Dropped(like, b); len(dropped) > 0 {
				os.RemoveAll(part) // a question goes by retiring, never from the bank: refused, as a bank with errors
				return nil, append(problems, dropped...), commit
			}
		}
		final := strings.TrimSuffix(part, partSuffix)
		if err := os.Rename(part, final); err != nil {
			os.RemoveAll(part)
			slog.Error("bank: no copy made, so the bank is played from BANK_DIR itself", "err", err)
			return k.direct()
		}
		b.Dir, b.Commit = final, commit
		return b, problems, commit
	}
}

// direct loads BANK_DIR as it is.
func (k keptBanks) direct() (*bank.Bank, []bank.Problem, string) {
	commit := bank.Commit(k.src)
	b, problems := bank.Load(k.src)
	if b != nil {
		b.Commit = commit
	}
	return b, problems, commit
}

// copy makes a copy of BANK_DIR, still to be checked (its name ends in partSuffix), from the newest good copy (like:
// "" for none).
func (k keptBanks) copy(commit string) (part, like string, err error) {
	if err := os.MkdirAll(k.dir, 0o700); err != nil {
		return "", "", err
	}
	name := time.Now().UTC().Format(keptStamp)
	if commit != "" {
		name += "-" + commit
	}
	if kept := k.kept(); len(kept) > 0 {
		like = kept[0].dir
	}
	part = filepath.Join(k.dir, name+partSuffix)
	if err := bank.Copy(k.src, part, like); err != nil {
		os.RemoveAll(part)
		return "", "", err
	}
	return part, like, nil
}

// keptBank is a good copy: where it is, and its commit ("" when not known).
type keptBank struct{ dir, commit string }

// kept lists the good copies, the newest first.
func (k keptBanks) kept() []keptBank {
	entries, _ := os.ReadDir(k.dir)
	var out []keptBank
	for _, e := range entries {
		stamp, commit, _ := strings.Cut(e.Name(), "-")
		if _, err := time.Parse(keptStamp, stamp); err != nil || !e.IsDir() || strings.HasSuffix(e.Name(), partSuffix) {
			continue
		}
		out = append(out, keptBank{filepath.Join(k.dir, e.Name()), commit})
	}
	slices.Reverse(out) // ReadDir sorts by name
	return out
}

// fallback is the newest good copy this program can load (nil if none): what's played when BANK_DIR has errors.
func (k keptBanks) fallback() *bank.Bank {
	if k.dir == "" {
		return nil
	}
	for _, c := range k.kept() {
		if b, _ := bank.Load(c.dir); b != nil {
			b.Commit = c.commit
			return b
		}
		slog.Warn("bank: a copy kept doesn't load", "dir", c.dir)
	}
	return nil
}

// prune removes the copies no longer needed: all but those held (in play, or held for Роял) and the newest
// keepBanks of different commits; and any copy left half made.
func (k keptBanks) prune(held []*bank.Bank) {
	if k.dir == "" {
		return
	}
	keep := map[string]bool{}
	for _, b := range held {
		keep[b.Dir] = true
	}
	seen, n := map[string]bool{}, 0
	for _, c := range k.kept() {
		fresh := c.commit == "" || !seen[c.commit]
		seen[c.commit] = true
		if fresh {
			n++
		}
		if keep[c.dir] || fresh && n <= keepBanks {
			continue
		}
		if err := os.RemoveAll(c.dir); err != nil {
			slog.Warn("bank: removing an old copy", "err", err)
		}
	}
	entries, _ := os.ReadDir(k.dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), partSuffix) {
			os.RemoveAll(filepath.Join(k.dir, e.Name()))
		}
	}
}
