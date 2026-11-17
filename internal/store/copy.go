package store

import (
	"database/sql"
	"errors"
	"fmt"
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

// KeepCopy keeps the database at path as it is before this program's migrations, in before-<version>.db beside it,
// for the program to make as it first starts: a release whose migrations went wrong is undone with the copy (a deploy
// that goes back puts it back: deploy/deploy.sh). Only a database with a migration still to come is copied: a version
// without one runs on the database as it is, and so does the version before it, so going back needs no copy (and the
// restart doesn't wait for one). A copy for the version that is there already is kept if the migrations it lacks ran
// after it was made (a start that migrated part of the way and stopped: the copy is still the way back), and made
// again otherwise (a release deployed again after it went back: what was played since isn't in the old copy). There
// must be room for the copy and the migrations, twice the database, or it's an error: better not to start than to
// migrate with no way back. It makes none if there's no database yet. Then the copies are pruned (PruneCopies).
func KeepCopy(path, version string) (bool, error) {
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	names, err := migrationNames()
	if err != nil {
		return false, err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return false, err
	}
	defer db.Close()
	had, err := migrationsIn(db, names)
	if err != nil {
		return false, err
	}
	if !slices.ContainsFunc(names, func(n string) bool { _, ok := had[n]; return !ok }) {
		return false, nil
	}
	to := filepath.Join(filepath.Dir(path), "before-"+version+".db")
	if stillTheWayBack(to, had, names) {
		return false, nil
	}
	if err := room(path); err != nil {
		return false, err
	}
	// VACUUM INTO: the database as it is, the write-ahead log included, whatever state the last run left it in.
	part := to + ".part"
	os.Remove(part)
	if _, err := db.Exec(`VACUUM INTO ?`, part); err != nil {
		os.Remove(part)
		return false, err
	}
	for _, f := range []string{to + "-wal", to + "-shm"} { // an older copy's, never to be read with this one
		if err := os.Remove(f); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return false, err
		}
	}
	if err := os.Rename(part, to); err != nil {
		return false, err
	}
	return true, PruneCopies(path)
}

// migrationsIn is the migrations a database has had, each with when (milliseconds; 0 for one from before names were
// kept, or not known).
func migrationsIn(db *sql.DB, names []string) (map[string]int64, error) {
	had := map[string]int64{}
	var table int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE name = 'schema_migrations'`).Scan(&table); err != nil {
		return nil, err
	}
	if table > 0 {
		rows, err := db.Query(`SELECT name, applied_at FROM schema_migrations`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			var at int64
			if err := rows.Scan(&name, &at); err != nil {
				return nil, err
			}
			had[name] = at
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	if len(had) == 0 { // a database from before names: its user_version counts the first migrations it has had
		var version int
		if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
			return nil, err
		}
		for _, name := range names[:min(version, len(names))] {
			had[name] = 0
		}
	}
	return had, nil
}

// stillTheWayBack says whether the copy at path is from before the migrations the database has had since it (had):
// it has had none of its own that the database hasn't, and all the database has had beyond it ran after the copy was
// made.
func stillTheWayBack(path string, had map[string]int64, names []string) bool {
	fi, err := os.Stat(path)
	if err != nil {
		return false
	}
	// Read as it lies (immutable): nothing writes a copy, and nothing of it may be changed by reading it.
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro&immutable=1")
	if err != nil {
		return false
	}
	defer db.Close()
	copied, err := migrationsIn(db, names)
	if err != nil {
		return false
	}
	since := 0
	for name := range copied {
		if _, ok := had[name]; !ok {
			return false
		}
	}
	for name, at := range had {
		if _, ok := copied[name]; ok {
			continue
		}
		if at < fi.ModTime().UnixMilli() {
			return false
		}
		since++
	}
	return since > 0
}

// spaceFree is freeSpace (tests may set their own).
var spaceFree = freeSpace

// room says whether the disk has room for a copy of the database at path and its migrations: twice its size, its
// write-ahead log included.
func room(path string) error {
	var size int64
	for _, f := range []string{path, path + "-wal"} {
		if fi, err := os.Stat(f); err == nil {
			size += fi.Size()
		}
	}
	free, ok := spaceFree(filepath.Dir(path))
	if ok && free < uint64(2*size) {
		return fmt.Errorf("no room to copy the database before its migrations: %d MB free, %d MB needed", free>>20, (2*size)>>20)
	}
	return nil
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
