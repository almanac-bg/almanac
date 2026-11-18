package backup

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// Restored is what a copy brought back was: encrypted or not, its proof code (an encrypted copy's: ProofCode), when
// the bucket says it was stored, and the core tables' rows its metadata names (as whoever stored it wrote them). Drill
// adds the rows the copy has.
type Restored struct {
	Encrypted bool
	Proof     string
	Modified  time.Time
	Meta      string
	Rows      map[string]int64
}

// Restore writes the copy stored under key to path, as a database file: decrypted with open's keys if it's
// encrypted, taken unencrypted only if open says so, and unzipped, as it comes. It refuses to overwrite a file.
func Restore(ctx context.Context, s *Store, key, path string, open Opening) (*Restored, error) {
	if _, err := os.Stat(path); err == nil {
		return nil, fmt.Errorf("%s is there already: restore to a new path (or with -into-place)", path)
	}
	body, header, err := s.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	plain, encrypted, err := opened(body, open)
	if err != nil {
		return nil, err
	}
	r := &Restored{Encrypted: encrypted, Meta: header.Get("x-amz-meta-rows")}
	r.Modified, _ = http.ParseTime(header.Get("Last-Modified"))
	sum := sha256.New()
	plain = io.TeeReader(plain, sum)
	zr, err := gzip.NewReader(plain)
	if err != nil {
		return nil, fmt.Errorf("unzipping: %w", err)
	}
	tmp := path + ".partial"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	fail := func(err error) (*Restored, error) {
		f.Close()
		os.Remove(tmp)
		return nil, err
	}
	if _, err := io.Copy(f, zr); err != nil {
		return fail(err)
	}
	if _, err := io.Copy(io.Discard, plain); err != nil { // to the end, all hashed (ProofCode)
		return fail(err)
	}
	if err := f.Sync(); err != nil {
		return fail(err)
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return nil, err
	}
	if encrypted {
		r.Proof = ProofCode(sum.Sum(nil))
	}
	return r, os.Rename(tmp, filepath.Clean(path))
}

// Drill brings back the copy stored under key as a restore would (into a new file in dir, removed after) and checks
// it: whole, with every core table, none of them empty. Its Rows are the rows in each table.
func Drill(ctx context.Context, s *Store, key, dir string, open Opening) (*Restored, error) {
	tmp, err := os.MkdirTemp(dir, "drill-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	path := filepath.Join(tmp, "drill.db")
	r, err := Restore(ctx, s, key, path, open)
	if err != nil {
		return nil, err
	}
	if r.Rows, err = Check(ctx, path); err != nil {
		return nil, err
	}
	if t := empty(r.Rows); t != "" {
		return r, fmt.Errorf("table %s is empty", t)
	}
	return r, nil
}

// Stored is what can be known of an encrypted copy without its key: it came back as it was sent (the hash it was
// stored with), it's an age file, and its rows as they were when it was sent.
type Stored struct {
	Bytes  int64
	SHA256 string // hex
	Rows   string // as the copy's metadata has them (table=rows,…)
}

// Intact brings back the copy stored under key and makes sure it's as it was sent: the same bytes (SHA-256) as the
// storage was given, and an age file. For a copy that can't be opened here (no key on the server); Drill opens it.
// Whoever has the bucket's key can store a copy that passes: State.Made says whether this server stored it.
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
	got := hex.EncodeToString(h.Sum(nil))
	if want == "" || got != want {
		return nil, fmt.Errorf("its hash (%s) isn't the one it was stored with (%q)", got, want)
	}
	return &Stored{Bytes: n, SHA256: got, Rows: header.Get("x-amz-meta-rows")}, nil
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

// copyName is how the server names an encrypted copy: hours/ or days/, then when it was made (stamp).
var copyName = regexp.MustCompile(`^(hours|days)/(\d{4}-\d\d-\d\dT\d{6}Z)\.db\.gz(\.age)?$`)

// Latest is the newest copy under prefix (hours/, days/, or "" for either) that is as the server makes them: an
// encrypted copy, named by when it was made (copyName), and stored at that time (from five minutes before to an hour
// after: a copy is stored once it's made and packed). What isn't — an unencrypted copy, any other name, a copy stored
// long after its name says, such as one put there by someone with the bucket's key — is never "the latest", and
// skipped lists those newer than it, for whoever restores to see. An unencrypted copy is restored only by its name.
func Latest(ctx context.Context, s *Store, prefix string) (key string, skipped []Object, err error) {
	objs, err := s.List(ctx, prefix)
	if err != nil {
		return "", nil, err
	}
	for _, o := range objs {
		if m := copyName.FindStringSubmatch(o.Key); m != nil && m[3] != "" {
			if at, err := time.Parse(stamp, m[2]); err == nil {
				if d := o.Modified.Sub(at); d >= -5*time.Minute && d <= time.Hour {
					return o.Key, skipped, nil
				}
			}
		}
		skipped = append(skipped, o)
	}
	return "", skipped, fmt.Errorf("no encrypted copy named as the server names them under %q: %w", prefix, ErrMissing)
}
