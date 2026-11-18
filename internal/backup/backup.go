// Package backup copies the database to S3-compatible storage (Cloudflare R2) every quarter of an hour, and brings a
// copy back.
//
// A copy is the database as it was at one moment (VACUUM INTO a file beside it, which doesn't stop the game), checked
// (Check: SQLite's integrity_check, and the game's core tables are there, and not empty, so a new server's empty
// database is never sent), then gzipped and, given recipients (BACKUP_RECIPIENT), encrypted with age as it streams to
// a second file, which is sent. A copy costs a buffer's memory whatever the database's size, and a fast level of gzip.
// The key that opens the copies is kept off the server (crypt.go): neither the storage's key, wherever it leaks, nor
// the server itself reads a copy once it's sent. Without recipients the copies go unencrypted, as before there were
// any, and the server says so in its problems once a day: a missing key never stops the copies.
//
// Each copy is a new object, named by the moment it was made (hours/2026-11-17T153012Z.db.gz.age: hours/ is the
// bucket's name for the recent copies, whose rules are set on it), and the first of each UTC day is also stored under
// days/. Nothing here overwrites or deletes a copy: the bucket's lifecycle rules delete them (hours/ after HoursKept,
// days/ after DaysKept), and its lock rules keep anyone, the server's own key included, from changing or deleting one
// before (README: Резервни копия). Copies older than they should be, which the lifecycle rules ought to have deleted,
// are a problem told daily, and so are recent copies deleted much sooner than they should be (Lifecycle).
//
// The copy of the day is brought back as a restore would bring it — downloaded, decrypted, unzipped, checked again
// with rows in every core table (Drill) — so its bytes are known to come back whole before they're needed. The server
// can open it for that though it holds no key to the copies: each copy is also encrypted to a key made for it alone,
// whose secret half lives in memory until that check (drillKey). That proves the copy decodes, not that the owner's
// key opens it: a valid but wrong BACKUP_RECIPIENT would pass. So whoever holds the key proves it now and then
// (proof.go): `backup verify -identity` off the server opens a day's copy and prints a code only its plain bytes give,
// and `backup proven <code>` on the server records it. The server knows each day's code by its hash alone, and says
// daily when the key the copies go to has had no proof, or none for a month (a problem told), and at once when that
// key changes.
//
// What a copy holds is weighed as it's made, against the copy before and the day's first (Changes): every table's
// rows, so that a table that loses half its rows (a bug that deletes, a bad release) or more than doubles is a problem
// told at once, while the copies from before it are still kept; and once a day, that no row points to one that isn't
// there (Dangling). The copy is sent all the same: a told problem, not a lost copy.
//
// The server makes a copy every Every (Run), offset from the quarter hours where the game's own work is (the new day
// at midnight, Роял at 21:00), by running itself as a program of its own (`almanac backup now`) at a lower priority,
// so a copy never takes the game's processor or memory (cmd/almanac). A file beside the database remembers the copies
// (State): when the last was made, for the first after a start (soon, if one is due), the rows it had and the day's
// first had, the day whose copy was brought back, the key the copies go to, and what this server stored (each copy's
// hash, so that a copy in the bucket is known for the server's own or not: Made; and the hash of each day's proof code).
package backup

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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
	// delete them after, and its lock rules keep them that long (README). A bad release noticed days later still has
	// a copy from every quarter of an hour of the week before it. The privacy page promises a deleted player's data is
	// gone from them within a month.
	HoursKept = 7 * 24 * time.Hour
	DaysKept  = 30 * 24 * time.Hour
	// Every is how often a copy is made: at most about that much play is lost with the server.
	Every = 15 * time.Minute
	// offset is how far past each quarter hour a copy is made: away from the game's own work on the quarter hours.
	offset = 7 * time.Minute
	// stamp names a copy by when it was made (UTC): names sort as they were made.
	stamp = "2006-01-02T150405Z"
	// level is gzip's: fast, at little cost in size, so a copy takes seconds of a processor, not minutes.
	level = gzip.BestSpeed
	// stateFile is the copies' memory, beside the database.
	stateFile = "backup.json"
)

// core are the tables a copy of the game is nothing without: its schema, its players, its days and their games.
var core = []string{"schema_migrations", "users", "days", "runs"}

// transient are the tables whose rows come and go by design (queues, codes, sessions, sign-ups, requests waiting for
// an answer): their rows are counted, but how many they lose or gain is never a problem. Every other table is
// watched (Changes).
var transient = []string{
	"code_mails", "code_misses", "friend_requests", "handoffs", "kv", "mail_suppressed", "outbox", "push_queue",
	"push_reminded", "royal_plans", "royal_players", "runs_after", "runs_unjudged", "sessions", "sign_in_codes",
}

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

// Report is what a copy made: where it went, how big, the rows in each table, and what's wrong that didn't stop it
// (problems for whoever runs the game).
type Report struct {
	Keys      []string         `json:"keys"`
	Bytes     int64            `json:"bytes"`
	Rows      map[string]int64 `json:"rows"`
	Encrypted bool             `json:"encrypted"`
	Drilled   bool             `json:"drilled"` // brought back and checked (the day's copy)
	Warnings  []string         `json:"warnings,omitempty"`
}

// State is what's kept of the copies, beside the database.
type State struct {
	At      time.Time        `json:"at"` // when the last copy was stored
	Key     string           `json:"key"`
	Rows    map[string]int64 `json:"rows"`              // every table's, in the last copy
	Day     string           `json:"day"`               // the last UTC day (2006-01-02) whose copy was brought back whole
	DayRows map[string]int64 `json:"dayRows,omitempty"` // every table's, in that day's copy
	// Recipient is the key the copies go to, and since when (nil: they go unencrypted).
	Recipient *Recipient `json:"recipient,omitempty"`
	// Sent is what this server stored, by key, for as long as the bucket keeps it.
	Sent map[string]Sent `json:"sent,omitempty"`
}

// Recipient is the key (BACKUP_RECIPIENT) the copies go to, by its Fingerprint, and since when.
type Recipient struct {
	Key   string    `json:"key"`
	Since time.Time `json:"since"`
}

// Sent is a copy this server stored: its bytes' hash (SHA-256, hex), and for a day's encrypted copy, the hash of its
// proof code (ProofCode) and the key it went to.
type Sent struct {
	SHA256    string `json:"sha256"`
	Proof     string `json:"proof,omitempty"`
	Recipient string `json:"recipient,omitempty"`
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
	return saveJSON(filepath.Join(dir, stateFile), s)
}

// saveJSON writes v to path, whole or not at all.
func saveJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".part"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Made says whether the copy under key, whose bytes hash to sum (SHA-256, hex), is one this server stored. known is
// false when its records can't say: a copy named for a time before them, or not named as the server names its copies
// (and on a new server, every copy). A copy named for a time the records cover that isn't among them, or whose bytes
// aren't the ones stored, wasn't made here: someone put it there with the bucket's key.
func (s State) Made(key, sum string) (made, known bool) {
	if sent, ok := s.Sent[key]; ok {
		return sent.SHA256 == sum, true
	}
	at, ok := stampOf(key)
	if !ok {
		return false, false
	}
	for k := range s.Sent {
		if t, ok := stampOf(k); ok && !t.After(at) {
			return false, true
		}
	}
	return false, false
}

// record notes a copy stored under key, and forgets those the bucket no longer keeps.
func (s *State) record(key string, sent Sent, now time.Time) {
	if s.Sent == nil {
		s.Sent = map[string]Sent{}
	}
	s.Sent[key] = sent
	for k := range s.Sent {
		kept := HoursKept
		if strings.HasPrefix(k, "days/") {
			kept = DaysKept
		}
		if t, ok := stampOf(k); !ok || now.Sub(t) > kept {
			delete(s.Sent, k)
		}
	}
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
	ctx, cancel := context.WithTimeout(ctx, 50*time.Minute)
	defer cancel()
	removeLeftovers(b.Dir)
	now := b.clock().UTC()
	state := LoadState(b.Dir)
	r := &Report{Encrypted: len(b.Recipients) > 0}
	day := now.Format(time.DateOnly)
	first := state.Day != day // the day's first copy

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
	said := map[string]bool{}
	for _, c := range append(Changes(state.Rows, r.Rows, "the copy before", true), Changes(state.DayRows, r.Rows, "the day's first copy", false)...) {
		if !said[c.Table] {
			said[c.Table] = true
			r.Warnings = append(r.Warnings, c.Said)
		}
	}
	if first {
		if d, err := Dangling(ctx, snap); err != nil {
			r.Warnings = append(r.Warnings, "checking the foreign keys: "+err.Error())
		} else if d != "" {
			r.Warnings = append(r.Warnings, d)
		}
	}

	recipients := b.Recipients
	var drill []age.Identity
	fingerprint := ""
	if r.Encrypted {
		fingerprint = Fingerprint(recipients)
		if state.Recipient == nil || state.Recipient.Key != fingerprint {
			if state.Recipient != nil {
				r.Warnings = append(r.Warnings, "the copies now go to another key (BACKUP_RECIPIENT changed): none of "+
					"them is known to open until its secret key opens one (backup verify -identity, off the server; then backup proven)")
			}
			state.Recipient = &Recipient{Key: fingerprint, Since: now}
		}
		id, rec, err := drillKey(recipients)
		if err != nil {
			return nil, err
		}
		recipients, drill = append(recipients[:len(recipients):len(recipients)], rec), []age.Identity{id}
	} else {
		state.Recipient = nil
	}
	packed, sums, err := pack(snap, recipients)
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
	state.record(key, Sent{SHA256: sums.file}, now)
	if err := state.save(b.Dir); err != nil {
		slog.Warn("backup: keeping its state", "err", err)
	}
	if !first {
		return r, nil
	}

	// The day's first: kept a month, and brought back now to know it would restore.
	key = Name("days", now, r.Encrypted)
	if err := b.put(ctx, key, f, meta); err != nil {
		return r, err
	}
	r.Keys = append(r.Keys, key)
	sent := Sent{SHA256: sums.file}
	if r.Encrypted {
		sent.Proof, sent.Recipient = proofHash(ProofCode(sums.plain)), fingerprint
	}
	state.record(key, sent, now)
	if err := state.save(b.Dir); err != nil {
		slog.Warn("backup: keeping its state", "err", err)
	}
	back, err := Drill(ctx, b.Store, key, b.Dir, Opening{IDs: drill, Unencrypted: !r.Encrypted})
	if err != nil {
		return r, fmt.Errorf("restore drill of %s: %w", key, err)
	}
	slog.Info("restore drill passed", "key", key, "rows", rowsMeta(back.Rows))
	r.Drilled = true
	state.Day, state.DayRows = day, r.Rows
	if err := state.save(b.Dir); err != nil {
		slog.Warn("backup: keeping its state", "err", err)
	}
	if said, err := Lifecycle(ctx, b.Store, now); err != nil {
		r.Warnings = append(r.Warnings, "listing the copies: "+err.Error())
	} else {
		r.Warnings = append(r.Warnings, said...)
	}
	if r.Encrypted {
		r.Warnings = append(r.Warnings, unproven(state, LoadProven(b.Dir), now)...)
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

// packSums are a packed copy's hashes (SHA-256): of the file as it's stored (hex), and of the gzipped database before
// it was encrypted, which only a key that opens the copy gives back (ProofCode).
type packSums struct {
	file  string
	plain []byte
}

// pack gzips the database file at path and encrypts it to recipients (if any) into a new file beside it, as it
// streams: no more of it is in memory at once than the buffers.
func pack(path string, recipients []age.Recipient) (_ string, sums packSums, err error) {
	in, err := os.Open(path)
	if err != nil {
		return "", sums, err
	}
	defer in.Close()
	out, err := os.CreateTemp(filepath.Dir(path), "copy-*.part")
	if err != nil {
		return "", sums, err
	}
	defer func() {
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			os.Remove(out.Name())
		}
	}()
	fileSum, plainSum := sha256.New(), sha256.New()
	buf := bufio.NewWriterSize(io.MultiWriter(out, fileSum), 256<<10)
	var w io.Writer = buf
	var enc io.WriteCloser
	if len(recipients) > 0 {
		if enc, err = age.Encrypt(buf, recipients...); err != nil {
			return "", sums, err
		}
		w = enc
	}
	zw, _ := gzip.NewWriterLevel(io.MultiWriter(w, plainSum), level)
	if _, err := io.Copy(zw, bufio.NewReaderSize(in, 256<<10)); err != nil {
		return "", sums, err
	}
	if err := zw.Close(); err != nil {
		return "", sums, err
	}
	if enc != nil {
		if err := enc.Close(); err != nil {
			return "", sums, err
		}
	}
	if err := buf.Flush(); err != nil {
		return "", sums, err
	}
	sums.file, sums.plain = hex.EncodeToString(fileSum.Sum(nil)), plainSum.Sum(nil)
	return out.Name(), sums, out.Sync()
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

// Change is a table whose rows changed sharply, and what's said of it.
type Change struct{ Table, Said string }

// Changes says which watched tables (all but the transient) changed sharply since before (a copy's rows; since names
// it): to fewer than half the rows they had (a core table from 10 rows, any other from 50), or, with rises, to more
// than twice as many and a thousand more. A game doesn't lose half its friendships or achievements in a day, nor
// double its answers in a quarter of an hour, unless something deleted them or wrote them over and over. A table
// that's new, or gone (a migration's), says nothing.
func Changes(before, now map[string]int64, since string, rises bool) []Change {
	var out []Change
	for _, t := range slices.Sorted(maps.Keys(before)) {
		was := before[t]
		is, ok := now[t]
		if !ok || slices.Contains(transient, t) {
			continue
		}
		least := int64(50)
		if slices.Contains(core, t) {
			least = 10
		}
		switch {
		case was >= least && is < was/2 && !rises: // the same words all day, so it's told once
			out = append(out, Change{t, fmt.Sprintf("table %s fell to under half the %d rows it had in %s: if that's wrong, restore a copy from before it (README)", t, was, since)})
		case was >= least && is < was/2:
			out = append(out, Change{t, fmt.Sprintf("table %s fell from %d rows to %d since %s: if that's wrong, restore a copy from before it (README)", t, was, is, since)})
		case rises && is >= was+1000 && is > 2*was:
			out = append(out, Change{t, fmt.Sprintf("table %s rose from %d rows to %d since %s: a flood, or something writing over and over?", t, was, is, since)})
		}
	}
	return out
}

// rowsMeta is the core tables' rows, for a copy's metadata (which S3 keeps small: 2 KB).
func rowsMeta(rows map[string]int64) string {
	var parts []string
	for _, t := range slices.Sorted(slices.Values(core)) {
		if n, ok := rows[t]; ok {
			parts = append(parts, fmt.Sprintf("%s=%d", t, n))
		}
	}
	return strings.Join(parts, ",")
}

// Overdue lists the copies older than their prefix keeps them (with two days for the lifecycle rules to get to them),
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

// Underkept is the age of the oldest recent copy (hours/) when it's a day or more short of HoursKept while the day's
// copies (days/) show copies have been made for longer: the bucket's lifecycle rule for hours/ deletes them too soon
// (0: it doesn't, or it's too early to tell).
func Underkept(ctx context.Context, s *Store, now time.Time) (time.Duration, error) {
	oldest := func(prefix string) (time.Duration, error) {
		objs, err := s.List(ctx, prefix)
		if err != nil || len(objs) == 0 {
			return 0, err
		}
		return now.Sub(objs[len(objs)-1].Modified), nil
	}
	days, err := oldest("days/")
	if err != nil || days < HoursKept+24*time.Hour {
		return 0, err
	}
	hours, err := oldest("hours/")
	if err != nil || hours >= HoursKept-24*time.Hour {
		return 0, err
	}
	return hours, nil
}

// Lifecycle says what the copies in the bucket show is wrong with its lifecycle rules (README): copies kept past
// their time (Overdue), or recent ones deleted much sooner (Underkept).
func Lifecycle(ctx context.Context, s *Store, now time.Time) ([]string, error) {
	var out []string
	stale, err := Overdue(ctx, s, now)
	if err != nil {
		return nil, err
	}
	if len(stale) > 0 {
		out = append(out, fmt.Sprintf("the bucket keeps %d copies past their time (the oldest %s): set its lifecycle rules (README)", len(stale), stale[len(stale)-1].Key))
	}
	short, err := Underkept(ctx, s, now)
	if err != nil {
		return nil, err
	}
	if short > 0 {
		days := int(HoursKept.Hours() / 24)
		out = append(out, fmt.Sprintf("the bucket deletes the recent copies (hours/) after about %.0f days, not %d: set its lifecycle and lock rules for hours/ to %d days (README)",
			short.Hours()/24, days, days))
	}
	return out, nil
}

// Run makes a copy every Every, offset past each quarter hour, until ctx ends, by calling once (soon after starting
// instead, if the last copy kept in dir is due); a copy that failed is tried again in five minutes.
func Run(ctx context.Context, dir string, once func(context.Context) error) {
	now := time.Now()
	wait := time.Until(next(now))
	if now.Sub(LoadState(dir).At) >= Every {
		wait = time.Minute
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		if err := once(ctx); err != nil && ctx.Err() == nil {
			wait = 5 * time.Minute
			continue
		}
		wait = time.Until(next(time.Now()))
	}
}

// next is when the first copy after t is due: offset past a quarter hour.
func next(t time.Time) time.Time {
	n := t.Truncate(Every).Add(offset)
	if !n.After(t) {
		n = n.Add(Every)
	}
	return n
}

// stampOf is when the copy under key was made, as its name says (ok: it's named as the server names its copies).
func stampOf(key string) (time.Time, bool) {
	m := copyName.FindStringSubmatch(key)
	if m == nil {
		return time.Time{}, false
	}
	t, err := time.Parse(stamp, m[2])
	return t, err == nil
}

// Check opens the database file at path read-only and makes sure it's whole: SQLite's integrity_check finds nothing
// wrong (every page, every index), and each core table is there. It returns the rows in every table.
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
	found, err := column(ctx, db, `PRAGMA integrity_check(20)`)
	if err != nil {
		return nil, fmt.Errorf("integrity check: %w", err)
	}
	if len(found) != 1 || found[0] != "ok" {
		msg := strings.Join(strings.Fields(strings.Join(found, " ")), " ")
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
		return nil, fmt.Errorf("integrity check: %s", msg)
	}
	tables, err := column(ctx, db, `SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\'`)
	if err != nil {
		return nil, err
	}
	for _, t := range core {
		if !slices.Contains(tables, t) {
			return nil, fmt.Errorf("table %s: not there", t)
		}
	}
	counts := make(map[string]int64, len(tables))
	for _, t := range tables {
		var n int64
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM "`+strings.ReplaceAll(t, `"`, `""`)+`"`).Scan(&n); err != nil {
			return nil, fmt.Errorf("table %s: %w", t, err)
		}
		counts[t] = n
	}
	return counts, nil
}

// Dangling says which tables of the database file at path have rows that point to a row that isn't there (SQLite's
// foreign_key_check: what a delete that went around the foreign keys, or a migration that rebuilt a table wrong,
// leaves), "" if none.
func Dangling(ctx context.Context, path string) (string, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return "", err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	rows, err := db.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	found := map[string]int{}
	for rows.Next() {
		var table, parent string
		var rowid, fk sql.NullInt64
		if err := rows.Scan(&table, &rowid, &parent, &fk); err != nil {
			return "", err
		}
		found[table+" → "+parent]++
	}
	if err := rows.Err(); err != nil || len(found) == 0 {
		return "", err
	}
	var parts []string
	for _, k := range slices.Sorted(maps.Keys(found)) {
		parts = append(parts, fmt.Sprintf("%s: %d", k, found[k]))
	}
	return "rows point to rows that aren't there (PRAGMA foreign_key_check): " + strings.Join(parts, ", "), nil
}

// column is the first column of each row a query gives.
func column(ctx context.Context, db *sql.DB, query string) ([]string, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
