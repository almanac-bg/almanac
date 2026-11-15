// Package backup copies the database to S3-compatible storage (Cloudflare R2) every hour, and brings a copy back.
//
// A copy is the database as it was at one moment (VACUUM INTO, which doesn't stop the game), gzipped. Copies are named
// by the hour of the day and the day of the month, so each new one replaces the one before in its place: there are
// always the last 24 hours and the last month or so, nothing to clean up, and nothing kept longer.
//
// Because each copy overwrites a good one, a copy is checked before it's sent (Check: SQLite's integrity_check, and
// the game's core tables are there); a damaged one is never sent, the heartbeat stays quiet, and the error goes to
// whoever runs the game. Once a day (the copy made in drillHour) the copy just stored is brought back as a restore
// would bring it — downloaded, unzipped, opened read-only — and checked again, with rows in every core table (Drill),
// so a restore is known to work before one is needed. `almanac backup verify` does the same by hand.
package backup

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	_ "modernc.org/sqlite" // Check opens a copy itself
)

// Store is a bucket in S3-compatible storage.
type Store struct {
	// Endpoint is the storage's address (R2: https://<account>.eu.r2.cloudflarestorage.com).
	Endpoint string
	Bucket   string
	// AccessKey and SecretKey are an access key pair allowed to read and write the bucket.
	AccessKey, SecretKey string
	// Region is the signing region ("auto" for R2).
	Region string
	Client *http.Client
}

func (s *Store) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return &http.Client{Timeout: 5 * time.Minute}
}

func (s *Store) url(key string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSuffix(s.Endpoint, "/") + "/" + s.Bucket + "/" + key)
	if err != nil || u.Scheme != "https" && u.Hostname() != "127.0.0.1" {
		return nil, errors.New("the backup endpoint must be an https:// address")
	}
	return u, nil
}

// Put stores body under key.
func (s *Store) Put(ctx context.Context, key string, body []byte) error {
	u, err := s.url(key)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.ContentLength = int64(len(body))
	sign(req, s.AccessKey, s.SecretKey, s.Region, body, time.Now())
	return s.do(req, nil)
}

// ErrMissing is the error for a key the bucket doesn't have.
var ErrMissing = errors.New("no such copy")

// Get reads what's stored under key.
func (s *Store) Get(ctx context.Context, key string) ([]byte, error) {
	u, err := s.url(key)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	sign(req, s.AccessKey, s.SecretKey, s.Region, nil, time.Now())
	var out bytes.Buffer
	if err := s.do(req, &out); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func (s *Store) do(req *http.Request, out io.Writer) error {
	res, err := s.client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return fmt.Errorf("%s %s: %w", req.Method, req.URL.Path, ErrMissing)
	}
	if res.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("%s %s: %s %s", req.Method, req.URL.Path, res.Status, bytes.TrimSpace(msg))
	}
	if out != nil {
		_, err = io.Copy(out, res.Body)
	}
	return err
}

// sign signs a request with AWS Signature Version 4: the host and every header already set, and the body's hash.
func sign(req *http.Request, accessKey, secretKey, region string, body []byte, now time.Time) {
	now = now.UTC()
	amzDate := now.Format("20060102T150405Z")
	day := now.Format("20060102")
	payload := sha256.Sum256(body)
	payloadHash := hex.EncodeToString(payload[:])
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)

	headers := map[string]string{"host": req.URL.Host}
	for k, v := range req.Header {
		headers[strings.ToLower(k)] = strings.TrimSpace(strings.Join(v, ","))
	}
	names := make([]string, 0, len(headers))
	for k := range headers {
		names = append(names, k)
	}
	slices.Sort(names)
	var canonHeaders strings.Builder
	for _, k := range names {
		canonHeaders.WriteString(k + ":" + headers[k] + "\n")
	}
	signed := strings.Join(names, ";")

	canonical := strings.Join([]string{
		req.Method,
		escapePath(req.URL.Path),
		req.URL.Query().Encode(),
		canonHeaders.String(),
		signed,
		payloadHash,
	}, "\n")
	scope := day + "/" + region + "/s3/aws4_request"
	hashed := sha256.Sum256([]byte(canonical))
	toSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(hashed[:])

	key := hmacSHA256([]byte("AWS4"+secretKey), day)
	for _, part := range []string{region, "s3", "aws4_request"} {
		key = hmacSHA256(key, part)
	}
	signature := hex.EncodeToString(hmacSHA256(key, toSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+accessKey+"/"+scope+
		", SignedHeaders="+signed+", Signature="+signature)
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

// escapePath encodes a path as S3 signs it: every byte but the unreserved ones and the slashes.
func escapePath(p string) string {
	var b strings.Builder
	for i := 0; i < len(p); i++ {
		c := p[i]
		if 'A' <= c && c <= 'Z' || 'a' <= c && c <= 'z' || '0' <= c && c <= '9' || strings.IndexByte("-._~/", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// Snapshot is the database as it is now, gzipped.
func Snapshot(ctx context.Context, db *sql.DB, dir string) ([]byte, error) {
	f, err := os.CreateTemp(dir, "snapshot-*.db")
	if err != nil {
		return nil, err
	}
	path := f.Name()
	f.Close()
	os.Remove(path) // VACUUM INTO makes the file itself
	defer os.Remove(path)
	if _, err := db.ExecContext(ctx, `VACUUM INTO ?`, path); err != nil {
		return nil, err
	}
	if _, err := Check(ctx, path); err != nil {
		return nil, fmt.Errorf("the copy is damaged, not sent: %w", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var gz bytes.Buffer
	w, _ := gzip.NewWriterLevel(&gz, gzip.BestCompression)
	if _, err := w.Write(data); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return gz.Bytes(), nil
}

// core are the tables a copy of the game is nothing without: its schema, its players, its days and their games.
var core = []string{"schema_migrations", "users", "days", "runs"}

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

// Drill brings back the copy stored under key as a restore would (into a new file in dir, removed after) and checks
// it: whole, with every core table, and none of them empty. It returns the rows in each core table.
func Drill(ctx context.Context, s *Store, key, dir string) (map[string]int64, error) {
	tmp, err := os.MkdirTemp(dir, "drill-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	path := filepath.Join(tmp, "drill.db")
	if err := Restore(ctx, s, key, path); err != nil {
		return nil, err
	}
	counts, err := Check(ctx, path)
	if err != nil {
		return nil, err
	}
	for _, t := range core {
		if counts[t] == 0 {
			return counts, fmt.Errorf("table %s is empty", t)
		}
	}
	return counts, nil
}

// Keys are where a copy made at t goes: its hour of the day, and its day of the month.
func Keys(t time.Time) []string {
	t = t.UTC()
	return []string{fmt.Sprintf("hours/%02d.db.gz", t.Hour()), fmt.Sprintf("days/%02d.db.gz", t.Day())}
}

// Backer makes the copies.
type Backer struct {
	Store *Store
	DB    *sql.DB
	// Dir is where a copy is made before it's sent (next to the database).
	Dir string
	// Heartbeat, if set, is fetched after each copy that made it (checked and stored): a monitor that hears nothing for
	// a while says so.
	Heartbeat string
}

// drillHour is the hour (UTC) whose copy is brought back and checked: 05:00 in Bulgaria, when few play.
const drillHour = 3

// Once makes a copy, checks it, and stores it in each of its places. A damaged copy is not stored, and the heartbeat
// not sent.
func (b *Backer) Once(ctx context.Context) error {
	return b.once(ctx, time.Now())
}

func (b *Backer) once(ctx context.Context, now time.Time) error {
	data, err := Snapshot(ctx, b.DB, b.Dir)
	if err != nil {
		return fmt.Errorf("snapshot: %w", err)
	}
	keys := Keys(now)
	for _, key := range keys {
		if err := b.Store.Put(ctx, key, data); err != nil {
			return err
		}
	}
	slog.Info("backed up", "bytes", len(data), "keys", keys)
	if b.Heartbeat != "" {
		beat, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		if req, err := http.NewRequestWithContext(beat, http.MethodGet, b.Heartbeat, nil); err == nil {
			if res, err := b.Store.client().Do(req); err == nil {
				res.Body.Close()
			}
		}
	}
	return nil
}

// Drill brings back the day's copy made at now (days/DD.db.gz) and checks it (see the package Drill).
func (b *Backer) Drill(ctx context.Context, now time.Time) error {
	key := Keys(now)[1]
	counts, err := Drill(ctx, b.Store, key, b.Dir)
	if err != nil {
		return fmt.Errorf("restore drill of %s: %w", key, err)
	}
	slog.Info("restore drill passed", "key", key, "rows", counts)
	return nil
}

// Run makes a copy every hour until ctx ends; a failed one is tried again in ten minutes. The copy made in drillHour
// is then brought back and checked.
func (b *Backer) Run(ctx context.Context, onError func(error)) {
	wait := time.Minute // the first soon after starting
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = time.Hour
		now := time.Now()
		if err := b.once(ctx, now); err != nil {
			if ctx.Err() == nil {
				slog.Error("backup", "err", err)
				onError(err)
				wait = 10 * time.Minute
			}
			continue
		}
		if now.UTC().Hour() == drillHour {
			if err := b.Drill(ctx, now); err != nil && ctx.Err() == nil {
				slog.Error("backup", "err", err)
				onError(err)
			}
		}
	}
}

// Restore writes the copy stored under key to path, as a database file. It refuses to overwrite one.
func Restore(ctx context.Context, s *Store, key, path string) error {
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("%s is there already: restore to a new path, then swap it in with the game stopped", path)
	}
	data, err := s.Get(ctx, key)
	if err != nil {
		return err
	}
	r, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return err
	}
	tmp := path + ".partial"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Clean(path))
}
