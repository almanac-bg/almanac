// Package store keeps the game's data in one SQLite file: opening it, bringing its schema up to date, and the few
// helpers every query uses.
//
// SQLite takes one writer at a time, so writes go through a single connection (Write) and never wait on each other's
// locks; reads go through a pool (Read) and run alongside, thanks to the write-ahead log.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"time"

	_ "modernc.org/sqlite" // the driver: pure Go, so the program stays one static file
)

//go:embed migrations/*.sql
var embedded embed.FS

// migrations are the schema's migrations (tests may set their own).
var migrations fs.FS = embedded

// DB is the game's database.
type DB struct {
	Write *sql.DB
	Read  *sql.DB
}

// Open opens (or creates) the database at path and brings its schema up to date. It refuses a database newer than
// this program (one a later version has migrated): running old code on it could lose data.
func Open(path string) (*DB, error) {
	pragmas := url.Values{}
	for _, p := range []string{
		"journal_mode(WAL)",
		"synchronous(NORMAL)", // durable across crashes of the program; the last moment may go if the machine loses power
		"foreign_keys(ON)",
		"busy_timeout(5000)",
		"temp_store(MEMORY)",
		"cache_size(-32000)", // 32 MB
	} {
		pragmas.Add("_pragma", p)
	}
	dsn := "file:" + path + "?" + pragmas.Encode()
	w, err := sql.Open("sqlite", dsn+"&_txlock=immediate")
	if err != nil {
		return nil, err
	}
	w.SetMaxOpenConns(1)
	w.SetConnMaxIdleTime(0)
	r, err := sql.Open("sqlite", dsn+"&mode=ro")
	if err != nil {
		w.Close()
		return nil, err
	}
	r.SetMaxOpenConns(max(4, runtime.NumCPU()))
	db := &DB{Write: w, Read: r}
	if err := db.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func (db *DB) Close() error { return errors.Join(db.Read.Close(), db.Write.Close()) }

// migrate applies every migration in migrations/ the database hasn't had yet, in the order of their names
// (NNNN_what.sql), each in a transaction, and keeps their names in schema_migrations. Names, not a count: two
// changes made side by side may both add a migration with the same number, and each is still applied once, whichever
// lands first. A database holding a migration this program doesn't have is newer than it, and refused: running old
// code on it could lose data. user_version keeps the count too, so that releases from before names refuse it as well.
func (db *DB) migrate() error { return db.migrateTo(-1) }

var migrationName = regexp.MustCompile(`^[0-9]{4}_[a-z0-9_]+\.sql$`)

// migrateTo migrates with the first n migrations only (all of them for -1): for tests of a migration.
func (db *DB) migrateTo(n int) error {
	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(files))
	for _, f := range files {
		name := strings.TrimPrefix(f, "migrations/")
		if !migrationName.MatchString(name) {
			return fmt.Errorf("%s: a migration is named like 0021_live_duels.sql", f)
		}
		names = append(names, name)
	}
	slices.Sort(names)
	if n >= 0 {
		names = names[:n]
	}
	if _, err := db.Write.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT, WITHOUT ROWID`); err != nil {
		return err
	}
	done, err := db.applied()
	if err != nil {
		return err
	}
	// A database migrated before names were kept: its user_version is how many of the first migrations it has.
	if len(done) == 0 {
		var version int
		if err := db.Write.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
			return err
		}
		if version > len(names) && n < 0 {
			return fmt.Errorf("the database is at version %d, newer than this program (%d migrations): run a newer release", version, len(names))
		}
		for _, name := range names[:min(version, len(names))] {
			if _, err := db.Write.Exec(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, 0)`, name); err != nil {
				return err
			}
			done[name] = true
		}
	}
	if n < 0 {
		for name := range done {
			if !slices.Contains(names, name) {
				return fmt.Errorf("the database has migration %s, newer than this program: run a newer release", name)
			}
		}
	}
	for _, name := range names {
		if done[name] {
			continue
		}
		body, err := fs.ReadFile(migrations, "migrations/"+name)
		if err != nil {
			return err
		}
		if err := db.apply(string(body), name); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}

// applied is the names of the migrations the database has had.
func (db *DB) applied() (map[string]bool, error) {
	rows, err := db.Write.Query(`SELECT name FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	done := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		done[name] = true
	}
	return done, rows.Err()
}

// rebuildMark starts a migration that rebuilds a table (SQLite changes a constraint only that way). It runs with
// foreign keys off, so that dropping the old table doesn't take the rows that point to it along, and is checked
// for broken references before it's committed: SQLite's own procedure (sqlite.org/lang_altertable.html).
const rebuildMark = "-- rebuild"

func (db *DB) apply(body, name string) error {
	ctx := context.Background()
	conn, err := db.Write.Conn(ctx) // the one write connection: the pragmas hold for the transaction on it
	if err != nil {
		return err
	}
	defer conn.Close()
	rebuild := strings.HasPrefix(body, rebuildMark)
	if rebuild {
		if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = OFF"); err != nil {
			return err
		}
		defer conn.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(body); err != nil {
		return errors.Join(err, tx.Rollback())
	}
	if rebuild {
		var broken int
		if err := tx.QueryRow("SELECT count(*) FROM pragma_foreign_key_check").Scan(&broken); err != nil || broken > 0 {
			return errors.Join(fmt.Errorf("%d broken references after the rebuild", broken), err, tx.Rollback())
		}
	}
	if _, err := tx.Exec(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`, name, Now()); err != nil {
		return errors.Join(err, tx.Rollback())
	}
	var count int
	if err := tx.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil {
		return errors.Join(err, tx.Rollback())
	}
	if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", count)); err != nil {
		return errors.Join(err, tx.Rollback())
	}
	return tx.Commit()
}

// Tx runs fn in a write transaction: committed if fn returns nil, rolled back otherwise.
func (db *DB) Tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := db.Write.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return errors.Join(err, tx.Rollback())
	}
	return tx.Commit()
}

// Now is the time as the database keeps it: milliseconds since 1970.
func Now() int64 { return time.Now().UnixMilli() }

// Ms turns a time into the database's milliseconds.
func Ms(t time.Time) int64 { return t.UnixMilli() }
