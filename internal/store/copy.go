package store

import (
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"time"
)

// KeptCopies is how many copies KeepCopy keeps.
const KeptCopies = 10

// KeepCopy copies the database at path to before-<version>.db beside it, for a new version to make as it first
// starts, before its migrations: a release whose migrations went wrong can be undone with the copy. The ten latest
// copies are kept. It makes none (and says so) if there is no database yet, or a copy for the version exists already
// (a restart, or a return to a version that ran before).
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
	return true, prune(dir)
}

// prune removes the copies beyond the latest KeptCopies.
func prune(dir string) error {
	paths, err := filepath.Glob(filepath.Join(dir, "before-v*.db"))
	if err != nil {
		return err
	}
	type kept struct {
		path string
		at   time.Time
	}
	var all []kept
	for _, p := range paths {
		if fi, err := os.Stat(p); err == nil {
			all = append(all, kept{p, fi.ModTime()})
		}
	}
	slices.SortFunc(all, func(a, b kept) int { return b.at.Compare(a.at) })
	var errs []error
	for _, c := range all[min(len(all), KeptCopies):] {
		errs = append(errs, os.Remove(c.path))
		if err := os.Remove(c.path + "-wal"); !errors.Is(err, fs.ErrNotExist) { // an older deploy's copy of its log
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
