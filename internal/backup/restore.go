package backup

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"filippo.io/age"
)

// Restore writes the copy stored under key to path, as a database file: decrypted with ids if it's encrypted, and
// unzipped, as it comes. It refuses to overwrite a file.
func Restore(ctx context.Context, s *Store, key, path string, ids ...age.Identity) error {
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("%s is there already: restore to a new path (or with -into-place)", path)
	}
	body, _, err := s.Get(ctx, key)
	if err != nil {
		return err
	}
	defer body.Close()
	plain, _, err := opened(body, ids)
	if err != nil {
		return err
	}
	zr, err := gzip.NewReader(plain)
	if err != nil {
		return fmt.Errorf("unzipping: %w", err)
	}
	tmp := path + ".partial"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, zr); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, filepath.Clean(path))
}

// Drill brings back the copy stored under key as a restore would (into a new file in dir, removed after; decrypted
// with ids if it's encrypted) and checks it: whole, with every core table, and none of them empty. It returns the rows
// in each core table.
func Drill(ctx context.Context, s *Store, key, dir string, ids ...age.Identity) (map[string]int64, error) {
	tmp, err := os.MkdirTemp(dir, "drill-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	path := filepath.Join(tmp, "drill.db")
	if err := Restore(ctx, s, key, path, ids...); err != nil {
		return nil, err
	}
	counts, err := Check(ctx, path)
	if err != nil {
		return nil, err
	}
	if t := empty(counts); t != "" {
		return counts, fmt.Errorf("table %s is empty", t)
	}
	return counts, nil
}

// Stored is what can be known of an encrypted copy without its key: it came back as it was sent (the hash it was
// stored with), it's an age file, and its rows as they were when it was sent.
type Stored struct {
	Bytes int64
	Rows  string // as the copy's metadata has them (table=rows,…)
}

// Intact brings back the copy stored under key and makes sure it's as it was sent: the same bytes (SHA-256) as the
// storage was given, and an age file. For a copy that can't be opened here (no key on the server); Drill opens it.
func Intact(ctx context.Context, s *Store, key string) (*Stored, error) {
	body, header, err := s.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	want := header.Get("x-amz-meta-sha256")
	h := sha256.New()
	head := &prefixWriter{n: len(ageMagic)}
	n, err := io.Copy(io.MultiWriter(h, head), body)
	if err != nil {
		return nil, err
	}
	if string(head.b) != string(ageMagic) {
		return nil, errors.New("not an age file")
	}
	if got := hex.EncodeToString(h.Sum(nil)); want == "" || got != want {
		return nil, fmt.Errorf("its hash (%s) isn't the one it was stored with (%q)", got, want)
	}
	return &Stored{Bytes: n, Rows: header.Get("x-amz-meta-rows")}, nil
}

// prefixWriter keeps the first n bytes written to it.
type prefixWriter struct {
	n int
	b []byte
}

func (p *prefixWriter) Write(b []byte) (int, error) {
	if room := p.n - len(p.b); room > 0 {
		p.b = append(p.b, b[:min(room, len(b))]...)
	}
	return len(b), nil
}

// Latest is the newest copy whose key starts with prefix (hours/, days/, or "" for any).
func Latest(ctx context.Context, s *Store, prefix string) (string, error) {
	objs, err := s.List(ctx, prefix)
	if err != nil {
		return "", err
	}
	for _, o := range objs {
		if strings.Contains(o.Key, ".db.gz") {
			return o.Key, nil
		}
	}
	return "", fmt.Errorf("%s: %w", prefix, ErrMissing)
}
