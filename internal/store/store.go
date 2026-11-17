// Package store keeps the game's data in one SQLite file: opening it, bringing its schema up to date (a new version
// keeps a copy from before, KeepCopy), and the few helpers every query uses. The migrations apply in the order of
// their names, and are checked so that the schema comes out the same wherever they ran, whatever order they landed in
// (migrate).
//
// SQLite takes one writer at a time, so writes go through a single connection (Write) and never wait on each other's
// locks; reads go through a pool (Read) and run alongside, thanks to the write-ahead log. The pool keeps its
// connections open between requests: opening one sets it up and reads the whole schema, which under load would cost
// more than the reads themselves.
//
// The query planner chooses by the tables' statistics (ANALYZE): Open brings them up to date, and so does every hour
// after (PRAGMA optimize, which looks again only at tables that have grown or shrunk a lot). A read connection reads
// them when it opens, so the pool's are renewed hourly too.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
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
	stop  context.CancelFunc // ends keepOptimized
}

// optimizeEvery is how often the statistics are looked at again, and how long a read connection is kept (so that it
// plans by them).
const optimizeEvery = time.Hour

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
		// The file mapped into memory: a connection's own cache starts over whenever another one writes, which in a
		// game is all the time, and then each page read is a copy through the kernel; mapped, it's a look in memory.
		"mmap_size(1073741824)", // 1 GB, of address space (the pages are the system's file cache, shared)
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
	// More readers than cores: a long read (a big day's board being counted) mustn't keep the quick ones waiting. All
	// of them are kept open while in use (database/sql would keep two, and open the rest anew for each burst); a
	// few minutes idle closes one, and with it what its cache holds.
	readers := max(8, 4*runtime.NumCPU())
	r.SetMaxOpenConns(readers)
	r.SetMaxIdleConns(readers)
	r.SetConnMaxIdleTime(5 * time.Minute)
	r.SetConnMaxLifetime(optimizeEvery)
	db := &DB{Write: w, Read: r}
	if err := db.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	// Every table looked at (0x10000) and analysed if it needs it (0x2), in a bounded time (0x10: a big table's
	// indexes are sampled): milliseconds, where analysing all of a big database would hold the writer for seconds.
	if _, err := w.Exec("PRAGMA optimize=0x10012"); err != nil {
		db.Close()
		return nil, err
	}
	ctx, stop := context.WithCancel(context.Background())
	db.stop = stop
	go db.keepOptimized(ctx)
	return db, nil
}

// keepOptimized brings the statistics up to date every optimizeEvery, until Close.
func (db *DB) keepOptimized(ctx context.Context) {
	t := time.NewTicker(optimizeEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := db.Write.ExecContext(ctx, "PRAGMA optimize"); err != nil && ctx.Err() == nil {
				slog.Warn("updating the statistics", "err", err)
			}
		}
	}
}

func (db *DB) Close() error {
	if db.stop != nil {
		db.stop()
	}
	return errors.Join(db.Read.Close(), db.Write.Close())
}

// migrate applies every migration in migrations/ the database hasn't had yet, in the order of their names
// (NNNN_what.sql), each in a transaction, and keeps their names in schema_migrations. Names, not a count: two
// changes made side by side may both add a migration with the same number, and each is still applied once, whichever
// lands first. A database holding a migration this program doesn't have is newer than it, and refused: running old
// code on it could lose data. user_version keeps the count too, so that releases from before names refuse it as well.
//
// The order is the names' everywhere, and the schema it makes is the same everywhere: in production, in the tests and
// in a new database. Two checks hold it so:
//
//   - A migration takes nothing away it doesn't name (a table, a column, an index, a trigger, a view): what it drops
//     on purpose is in a line "-- drops: runs.opponent, runs_board". Otherwise it fails, and nothing of it is kept:
//     a rebuild that copies a table by a list of its columns can't lose one another migration added.
//   - A migration that arrives late (changes made side by side land in any order, so production may have had
//     0052_b before 0051_a comes) is tried first, with the rest still to apply, on a copy of the schema alone. Unless
//     that makes the schema of a new database migrated in name order, the database is refused before anything is
//     applied, and the program doesn't start (a deploy then goes back by itself). The late migration never ran
//     there, so it can be changed to hold after the others, or given a number after the latest.
func (db *DB) migrate() error { return db.migrateTo(-1) }

var migrationName = regexp.MustCompile(`^[0-9]{4}_[a-z0-9_]+\.sql$`)

// migrationsTable keeps the names of the migrations a database has had.
const migrationsTable = `CREATE TABLE IF NOT EXISTS schema_migrations (
	name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT, WITHOUT ROWID`

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
	if _, err := db.Write.Exec(migrationsTable); err != nil {
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
	var todo, late []string
	last := ""
	for name := range done {
		last = max(last, name)
	}
	for _, name := range names {
		if !done[name] {
			todo = append(todo, name)
			if name < last {
				late = append(late, name)
			}
		}
	}
	if len(late) > 0 {
		slog.Warn("migrations arrive after a later one", "late", late, "latest", last)
		if err := db.tryLate(names, todo, late, last); err != nil {
			return err
		}
	}
	return db.applyAll(todo)
}

// tryLate applies the migrations still to do (todo, some of them late: named before the latest one the database has
// had) to a copy of the database's schema, without its rows. Unless the schema that makes is the one a new database
// migrated with all of them in order (names) has, it says how they differ, and nothing is applied.
func (db *DB) tryLate(names, todo, late []string, last string) error {
	refuse := func(err error) error {
		return fmt.Errorf("migrations %s arrive after %s, which the database has had already: %w. Nothing is "+
			"applied. They never ran on it: change them to hold after the others too, or give them numbers after "+
			"the latest", strings.Join(late, ", "), last, err)
	}
	trial, err := memory()
	if err != nil {
		return err
	}
	defer trial.Close()
	if err := copySchema(db.Write, trial.Write); err != nil {
		return err
	}
	if err := trial.applyAll(todo); err != nil {
		return refuse(err)
	}
	fresh, err := memory()
	if err != nil {
		return err
	}
	defer fresh.Close()
	if _, err := fresh.Write.Exec(migrationsTable); err != nil {
		return err
	}
	if err := fresh.applyAll(names); err != nil {
		return refuse(fmt.Errorf("a new database can't be migrated with them: %w", err))
	}
	have, err := shapeOf(trial.Write)
	if err != nil {
		return err
	}
	want, err := shapeOf(fresh.Write)
	if err != nil {
		return err
	}
	if diff := unlike(have, want); len(diff) > 0 {
		return refuse(fmt.Errorf("the schema would differ from a new database's: %s", strings.Join(diff, "; ")))
	}
	return nil
}

// applyAll applies the migrations named, in that order.
func (db *DB) applyAll(names []string) error {
	for _, name := range names {
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

// apply applies one migration in a transaction, committed only if the migration takes away nothing of the schema
// that it doesn't name in a drops line (and, a rebuild, breaks no reference).
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
	var before, after map[string]part
	check := mayDrop.MatchString(body)
	if check {
		if before, err = partsOf(tx); err != nil {
			return errors.Join(err, tx.Rollback())
		}
	}
	if _, err := tx.Exec(body); err != nil {
		return errors.Join(err, tx.Rollback())
	}
	if check {
		if after, err = partsOf(tx); err != nil {
			return errors.Join(err, tx.Rollback())
		}
	}
	if gone := lost(body, before, after); len(gone) > 0 {
		return errors.Join(fmt.Errorf("it takes away %s without naming them in a line \"-- drops: ...\" (name "+
			"them there if that's meant; if not, keep them: a rebuild copies every column the table has, and makes "+
			"its indexes and triggers again)", strings.Join(gone, ", ")), tx.Rollback())
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
	// A context that ended (the player went away) has rolled the transaction back already, and then each step after
	// says only that it's done: the context's end is what happened.
	if err := fn(tx); err != nil {
		rollback := tx.Rollback()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.Join(err, rollback)
	}
	if err := tx.Commit(); err != nil && ctx.Err() != nil {
		return ctx.Err()
	} else if err != nil {
		return err
	}
	return nil
}

// Now is the time as the database keeps it: milliseconds since 1970.
func Now() int64 { return time.Now().UnixMilli() }

// Ms turns a time into the database's milliseconds.
func Ms(t time.Time) int64 { return t.UnixMilli() }
