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
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite" // the driver: pure Go, so the program stays one static file
)

//go:embed migrations/*.sql
var migrations embed.FS

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

// migrate applies migrations/NNNN_*.sql in order, each in a transaction, and keeps the count in user_version.
func (db *DB) migrate() error {
	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	slices.Sort(files)
	for i, f := range files {
		n, _, _ := strings.Cut(strings.TrimPrefix(f, "migrations/"), "_")
		if v, err := strconv.Atoi(n); err != nil || v != i+1 {
			return fmt.Errorf("%s: migrations are numbered 0001, 0002… without gaps", f)
		}
	}
	var version int
	if err := db.Write.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > len(files) {
		return fmt.Errorf("the database is at version %d, newer than this program (%d): run a newer release", version, len(files))
	}
	for i := version; i < len(files); i++ {
		body, err := migrations.ReadFile(files[i])
		if err != nil {
			return err
		}
		err = db.Tx(context.Background(), func(tx *sql.Tx) error {
			if _, err := tx.Exec(string(body)); err != nil {
				return err
			}
			_, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", i+1))
			return err
		})
		if err != nil {
			return fmt.Errorf("%s: %w", files[i], err)
		}
	}
	return nil
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
