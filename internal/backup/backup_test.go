package backup

import (
	"bytes"
	"compress/gzip"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// AWS's own example of a signed request ("Example: GET Object", Signature Version 4 for Amazon S3).
func TestSignsAsAWSDoes(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	req.Header.Set("Range", "bytes=0-9")
	sign(req, "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", nil,
		time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC))
	want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
		"SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
		"Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got := req.Header.Get("Authorization"); got != want {
		t.Fatalf("signed\n%s\nwant\n%s", got, want)
	}
}

// fakeStore keeps what's put in it, checking each request is signed.
type fakeStore struct {
	mu   sync.Mutex
	objs map[string][]byte
}

func (f *fakeStore) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=key/") {
		http.Error(w, "unsigned", http.StatusForbidden)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	switch r.Method {
	case http.MethodPut:
		body, _ := io.ReadAll(r.Body)
		f.objs[r.URL.Path] = body
	case http.MethodGet:
		body, ok := f.objs[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(body)
	}
}

func TestBackUpAndRestore(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Write.Exec(`INSERT INTO users (name, name_key, created_at, seen_at) VALUES ('Аз', 'аз', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	fake := &fakeStore{objs: map[string][]byte{}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	beats := 0
	beat := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { beats++ }))
	defer beat.Close()
	s := &Store{Endpoint: srv.URL, Bucket: "backups", AccessKey: "key", SecretKey: "secret", Region: "auto"}
	b := &Backer{Store: s, DB: db.Read, Dir: dir, Heartbeat: beat.URL}
	if err := b.Once(t.Context()); err != nil {
		t.Fatal(err)
	}
	keys := Keys(time.Now())
	for _, k := range keys {
		data := fake.objs["/backups/"+k]
		if _, err := gzip.NewReader(bytes.NewReader(data)); err != nil || len(data) == 0 {
			t.Fatalf("%s: %d bytes, %v", k, len(data), err)
		}
	}
	if beats != 1 {
		t.Fatalf("%d heartbeats", beats)
	}

	restored := filepath.Join(dir, "restored.db")
	if err := Restore(t.Context(), s, keys[0], restored); err != nil {
		t.Fatal(err)
	}
	if err := Restore(t.Context(), s, keys[0], restored); err == nil {
		t.Fatal("restored over a file that's there")
	}
	back, err := sql.Open("sqlite", "file:"+restored+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer back.Close()
	var name, check string
	if err := back.QueryRow(`SELECT name FROM users`).Scan(&name); err != nil || name != "Аз" {
		t.Fatalf("restored %q, %v", name, err)
	}
	if err := back.QueryRow(`PRAGMA integrity_check`).Scan(&check); err != nil || check != "ok" {
		t.Fatalf("integrity %q %v", check, err)
	}
}
