// Package backup copies the database to S3-compatible storage (Cloudflare R2) every hour, and brings a copy back.
//
// A copy is the database as it was at one moment (VACUUM INTO a file beside it, which doesn't stop the game), checked
// (Check: SQLite's integrity_check, and the game's core tables are there, and not empty, so a new server's empty
// database is never sent), then gzipped and, given recipients (BACKUP_RECIPIENT), encrypted with age as it streams to
// a second file, which is sent. A copy costs a buffer's memory whatever the database's size, and a fast level of gzip.
// The key that opens the copies is kept off the server (crypt.go): neither the storage's key, wherever it leaks, nor
// the server itself reads a copy once it's sent. Without recipients the copies go unencrypted, as before there were
// any, and the server says so in its problems once a day: a missing key never stops the copies.
//
// Each copy is a new object, named by the moment it was made (hours/2026-11-17T153012Z.db.gz.age), and the first of
// each UTC day is also stored under days/. Nothing here overwrites or deletes a copy: the bucket's lifecycle rules
// delete them (hours/ after HoursKept, days/ after DaysKept), and its lock rules keep anyone, the server's own key
// included, from changing or deleting one before (README: Резервни копия). The copy of the day is brought back as a
// restore would bring it — downloaded, decrypted, unzipped, checked again with rows in every core table (Drill) — so a
// restore is known to work before one is needed. The server can open it for that though it holds no key to the copies:
// each copy is also encrypted to a key made for it alone, whose secret half lives in memory until that check
// (drillKey). The copies older than they should be, which the lifecycle rules ought to have deleted, are a problem
// told daily too.
//
// The server makes a copy at half past every hour (Run), away from the hour's own work (the new day at midnight, Роял at
// 21:00), by running itself as a program of its own (`almanac backup now`) at a lower priority, so a copy never takes
// the game's processor or memory (cmd/almanac). A file beside the database remembers the last copy (State): when it was
// made, for the first after a start (soon, if it's an hour old), the rows it had, against which the next one's are
// compared (a sharp fall is a problem told, the copy sent all the same), and the day whose copy was brought back.
package backup

import (
	"bufio"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"filippo.io/age"
	_ "modernc.org/sqlite" // Check opens a copy itself
)

const (
	// HoursKept and DaysKept are how long the copies under hours/ and days/ are kept: the bucket's lifecycle rules
	// delete them after (README). The privacy page promises a deleted player's data is gone from them within a month.
	HoursKept = 2 * 24 * time.Hour
	DaysKept  = 30 * 24 * time.Hour
	// stamp names a copy by when it was made (UTC): names sort as they were made.
	stamp = "2006-01-02T150405Z"
	// level is gzip's: fast, at little cost in size, so a copy takes seconds of a processor, not minutes.
	level = gzip.BestSpeed
	// stateFile is the last copy's memory, beside the database.
	stateFile = "backup.json"
)

// core are the tables a copy of the game is nothing without: its schema, its players, its days and their games.
var core = []string{"schema_migrations", "users", "days", "runs"}

// Name is the key of a copy made at t, under prefix (hours or days): encrypted copies end in .age.
func Name(prefix string, t time.Time, encrypted bool) string {
	key := prefix + "/" + t.UTC().Format(stamp) + ".db.gz"
	if encrypted {
		key += ".age"
	}
	return key
}

// Backer makes the copies.
type Backer struct {
	Store *Store
	// DB reads the database (read-only is enough).
	DB *sql.DB
	// Dir is where a copy is made before it's sent (next to the database), and where State is kept.
	Dir string
	// Recipients are whom the copies are encrypted to (none: they go unencrypted).
	Recipients []age.Recipient
	// Force sends a copy even of a database with an empty core table.
	Force bool
	now   func() time.Time // the clock (tests); nil: time.Now
}

// Report is what a copy made: where it went, how big, the rows in its core tables, and what's wrong that didn't stop
// it (problems for whoever runs the game).
type Report struct {
	Keys      []string         `json:"keys"`
	Bytes     int64            `json:"bytes"`
	Rows      map[string]int64 `json:"rows"`
	Encrypted bool             `json:"encrypted"`
	Drilled   bool             `json:"drilled"` // brought back and checked (the day's copy)
	Warnings  []string         `json:"warnings,omitempty"`
}

// State is what's kept of the last copy, beside the database.
type State struct {
	At   time.Time        `json:"at"` // when the last copy was stored
	Key  string           `json:"key"`
	Rows map[string]int64 `json:"rows"`
	Day  string           `json:"day"` // the last UTC day (2006-01-02) whose copy was brought back whole
}

// LoadState reads the state kept in dir (the zero State if there's none).
func LoadState(dir string) State {
	var s State
	if data, err := os.ReadFile(filepath.Join(dir, stateFile)); err == nil {
		_ = json.Unmarshal(data, &s)
	}
	return s
}

func (s State) save(dir string) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, stateFile+".part")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, stateFile))
}

func (b *Backer) clock() time.Time {
	if b.now != nil {
		return b.now()
	}
	return time.Now()
}

// Once makes a copy, checks it, and stores it under hours/ (and under days/ too if it's the day's first, then brings
// that back and checks it again). A damaged copy, or one of an empty game, is not stored.
func (b *Backer) Once(ctx context.Context) (*Report, error) {
	ctx, cancel := context.WithTimeout(ctx, 50*time.Minute) // never into the next hour's
	defer cancel()
	removeLeftovers(b.Dir)
	now := b.clock().UTC()
	state := LoadState(b.Dir)
	r := &Report{Encrypted: len(b.Recipients) > 0}

	snap, err := snapshot(ctx, b.DB, b.Dir)
	if err != nil {
		return nil, fmt.Errorf("snapshot: %w", err)
	}
	defer os.Remove(snap)
	if r.Rows, err = Check(ctx, snap); err != nil {
		return nil, fmt.Errorf("the copy is damaged, not sent: %w", err)
	}
	if t := empty(r.Rows); t != "" && !b.Force {
		return nil, fmt.Errorf("table %s is empty, so the copy is not sent (a new server, not yet restored? README)", t)
	}
	r.Warnings = append(r.Warnings, fell(state.Rows, r.Rows)...)

	recipients := b.Recipients
	var drill []age.Identity
	if len(recipients) > 0 {
		id, rec, err := drillKey(recipients)
		if err != nil {
			return nil, err
		}
		recipients, drill = append(recipients[:len(recipients):len(recipients)], rec), []age.Identity{id}
	}
	packed, err := pack(snap, recipients)
	if err != nil {
		return nil, fmt.Errorf("packing the copy: %w", err)
	}
	defer os.Remove(packed)
	os.Remove(snap) // as soon as it's no longer needed: it's the database's size
	f, err := os.Open(packed)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return nil, err
	}
	r.Bytes = fi.Size()
	meta := map[string]string{"rows": rowsMeta(r.Rows)}

	key := Name("hours", now, r.Encrypted)
	if err := b.put(ctx, key, f, meta); err != nil {
		return nil, err
	}
	r.Keys = append(r.Keys, key)
	state.At, state.Key, state.Rows = now, key, r.Rows
	if err := state.save(b.Dir); err != nil {
		slog.Warn("backup: keeping its state", "err", err)
	}
	day := now.Format(time.DateOnly)
	if state.Day == day {
		return r, nil
	}

	// The day's first: kept a month, and brought back now to know it would restore.
	key = Name("days", now, r.Encrypted)
	if err := b.put(ctx, key, f, meta); err != nil {
		return r, err
	}
	r.Keys = append(r.Keys, key)
	rows, err := Drill(ctx, b.Store, key, b.Dir, drill...)
	if err != nil {
		return r, fmt.Errorf("restore drill of %s: %w", key, err)
	}
	slog.Info("restore drill passed", "key", key, "rows", rows)
	r.Drilled = true
	state.Day = day
	if err := state.save(b.Dir); err != nil {
		slog.Warn("backup: keeping its state", "err", err)
	}
	stale, err := Overdue(ctx, b.Store, now)
	if err != nil {
		r.Warnings = append(r.Warnings, "listing the copies: "+err.Error())
	} else if len(stale) > 0 {
		r.Warnings = append(r.Warnings, fmt.Sprintf("the bucket keeps %d copies past their time (the oldest %s): set its lifecycle rules (README)", len(stale), stale[len(stale)-1].Key))
	}
	return r, nil
}

func (b *Backer) put(ctx context.Context, key string, f *os.File, meta map[string]string) error {
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	return b.Store.Put(ctx, key, f, meta)
}

// snapshot copies the database read through db into a new file in dir (VACUUM INTO: the database as it is at one
// moment, while the game goes on), and returns its path.
func snapshot(ctx context.Context, db *sql.DB, dir string) (string, error) {
	f, err := os.CreateTemp(dir, "snapshot-*.db")
	if err != nil {
		return "", err
	}
	path := f.Name()
	f.Close()
	os.Remove(path) // VACUUM INTO makes the file itself
	if _, err := db.ExecContext(ctx, `VACUUM INTO ?`, path); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

// pack gzips the database file at path and encrypts it to recipients (if any) into a new file beside it, as it
// streams: no more of it is in memory at once than the buffers.
func pack(path string, recipients []age.Recipient) (_ string, err error) {
	in, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.CreateTemp(filepath.Dir(path), "copy-*.part")
	if err != nil {
		return "", err
	}
	defer func() {
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			os.Remove(out.Name())
		}
	}()
	buf := bufio.NewWriterSize(out, 256<<10)
	var w io.Writer = buf
	var enc io.WriteCloser
	if len(recipients) > 0 {
		if enc, err = age.Encrypt(buf, recipients...); err != nil {
			return "", err
		}
		w = enc
	}
	zw, _ := gzip.NewWriterLevel(w, level)
	if _, err := io.Copy(zw, bufio.NewReaderSize(in, 256<<10)); err != nil {
		return "", err
	}
	if err := zw.Close(); err != nil {
		return "", err
	}
	if enc != nil {
		if err := enc.Close(); err != nil {
			return "", err
		}
	}
	if err := buf.Flush(); err != nil {
		return "", err
	}
	return out.Name(), out.Sync()
}

// removeLeftovers removes what a copy cut short (the server stopped under it) left in dir: an hour old, so never
// another copy's that is under way.
func removeLeftovers(dir string) {
	for _, pattern := range []string{"snapshot-*.db", "copy-*.part", "drill-*"} {
		paths, _ := filepath.Glob(filepath.Join(dir, pattern))
		for _, p := range paths {
			if fi, err := os.Stat(p); err == nil && time.Since(fi.ModTime()) > time.Hour {
				os.RemoveAll(p)
			}
		}
	}
}

// empty is the first core table with no rows ("": none).
func empty(rows map[string]int64) string {
	for _, t := range core {
		if rows[t] == 0 {
			return t
		}
	}
	return ""
}

// fell says which core tables have fewer than half the rows they had in the copy before: a game doesn't lose half its
// players or games in an hour, unless something deleted them.
func fell(before, now map[string]int64) []string {
	var out []string
	for _, t := range core {
		if was := before[t]; was >= 10 && now[t] < was/2 {
			out = append(out, fmt.Sprintf("table %s fell from %d rows to %d since the copy before: if that's wrong, restore one from before it (README)", t, was, now[t]))
		}
	}
	return out
}

func rowsMeta(rows map[string]int64) string {
	var parts []string
	for _, t := range slices.Sorted(maps.Keys(rows)) {
		parts = append(parts, fmt.Sprintf("%s=%d", t, rows[t]))
	}
	return strings.Join(parts, ",")
}

// Overdue lists the copies older than their prefix keeps them (with a day for the lifecycle rules to get to them),
// newest first: there should be none.
func Overdue(ctx context.Context, s *Store, now time.Time) ([]Object, error) {
	var out []Object
	for prefix, kept := range map[string]time.Duration{"hours/": HoursKept, "days/": DaysKept} {
		objs, err := s.List(ctx, prefix)
		if err != nil {
			return nil, err
		}
		for _, o := range objs {
			if now.Sub(o.Modified) > kept+48*time.Hour {
				out = append(out, o)
			}
		}
	}
	slices.SortFunc(out, func(a, b Object) int { return b.Modified.Compare(a.Modified) })
	return out, nil
}

// Run makes a copy at half past every hour until ctx ends, by calling once (soon after starting instead, if the last
// copy kept in dir is an hour old or more); a copy that failed is tried again in ten minutes.
func Run(ctx context.Context, dir string, once func(context.Context) error) {
	now := time.Now()
	wait := time.Until(next(now))
	if now.Sub(LoadState(dir).At) >= time.Hour {
		wait = time.Minute
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		if err := once(ctx); err != nil && ctx.Err() == nil {
			wait = 10 * time.Minute
			continue
		}
		wait = time.Until(next(time.Now()))
	}
}

// next is the first half past an hour after t.
func next(t time.Time) time.Time {
	n := t.Truncate(time.Hour).Add(30 * time.Minute)
	if !n.After(t) {
		n = n.Add(time.Hour)
	}
	return n
}

// Check opens the database file at path read-only and makes sure it's whole: SQLite's integrity_check finds nothing
// wrong (every page, every index), and each core table is there. It returns the rows in each core table.
func Check(ctx context.Context, path string) (map[string]int64, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	rows, err := db.QueryContext(ctx, `PRAGMA integrity_check(20)`)
	if err != nil {
		return nil, fmt.Errorf("integrity check: %w", err)
	}
	var found []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			rows.Close()
			return nil, err
		}
		found = append(found, line)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("integrity check: %w", err)
	}
	if len(found) != 1 || found[0] != "ok" {
		msg := strings.Join(strings.Fields(strings.Join(found, " ")), " ")
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
		return nil, fmt.Errorf("integrity check: %s", msg)
	}
	counts := make(map[string]int64, len(core))
	for _, t := range core {
		var n int64
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM `+t).Scan(&n); err != nil {
			return nil, fmt.Errorf("table %s: %w", t, err)
		}
		counts[t] = n
	}
	return counts, nil
}
