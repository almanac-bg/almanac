package store

import (
	"database/sql"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

const (
	// KeptCopies is how many of the copies KeepCopy makes are kept: enough to go back a few releases, few enough that
	// the disk holds them beside the database (each is its size).
	KeptCopies = 3
	// CopiesKept is how long any copy of the database beside it is kept (before-<version>.db, a copy put aside by
	// `backup restore -into-place`, one made by hand): a deleted player's data is gone from every copy within a
	// month, as the privacy page says.
	CopiesKept = 30 * 24 * time.Hour
)

// KeepCopy copies the database at path to before-<version>.db beside it, for a new version to make as it first
// starts, before its migrations: a release whose migrations went wrong can be undone with the copy. It makes none
// (and says so) if there is no database yet, or a copy for the version exists already (a restart, or a return to a
// version that ran before). Then the copies are pruned (PruneCopies).
func KeepCopy(path, version string) (bool, error) {
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	dir := filepath.Dir(path)
	to := filepath.Join(dir, "before-"+version+".db")
	if _, err := os.Stat(to); err == nil {
		return false, nil
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return false, err
	}
	defer db.Close()
	// VACUUM INTO: the database as it is, the write-ahead log included, whatever state the last run left it in.
	part := to + ".part"
	os.Remove(part)
	if _, err := db.Exec(`VACUUM INTO ?`, part); err != nil {
		os.Remove(part)
		return false, err
	}
	if err := os.Rename(part, to); err != nil {
		return false, err
	}
	return true, PruneCopies(path)
}

// PruneCopies removes the copies of the database at path that lie beside it (every other *.db file there) once they're
// older than CopiesKept, and the copies KeepCopy makes beyond the latest KeptCopies. The server runs it hourly, so a
// month is a month even with no release.
func PruneCopies(path string) error {
	dir, live := filepath.Dir(path), filepath.Base(path)
	paths, err := filepath.Glob(filepath.Join(dir, "*.db"))
	if err != nil {
		return err
	}
	type kept struct {
		path string
		at   time.Time
	}
	var before []kept
	var errs []error
	for _, p := range paths {
		fi, err := os.Stat(p)
		if err != nil || fi.IsDir() || filepath.Base(p) == live {
			continue
		}
		c := kept{p, fi.ModTime()}
		switch {
		case time.Since(c.at) > CopiesKept:
			errs = append(errs, remove(c.path))
		case strings.HasPrefix(filepath.Base(p), "before-v"):
			before = append(before, c)
		}
	}
	slices.SortFunc(before, func(a, b kept) int { return b.at.Compare(a.at) })
	for _, c := range before[min(len(before), KeptCopies):] {
		errs = append(errs, remove(c.path))
	}
	return errors.Join(errs...)
}

// remove removes a copy, and its log and shared memory if it has them.
func remove(path string) error {
	slog.Info("removing a copy of the database", "path", path)
	errs := []error{os.Remove(path)}
	for _, f := range []string{path + "-wal", path + "-shm"} {
		if err := os.Remove(f); !errors.Is(err, fs.ErrNotExist) {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
