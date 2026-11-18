package backup

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"filippo.io/age"

	"github.com/almanac-bg/almanac/internal/store"
)

// AWS's own example of a signed request ("Example: GET Object", Signature Version 4 for Amazon S3).
func TestSignsAsAWSDoes(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	req.Header.Set("Range", "bytes=0-9")
	sign(req, "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", emptyHash,
		time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC))
	want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
		"SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
		"Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if got := req.Header.Get("Authorization"); got != want {
		t.Fatalf("signed\n%s\nwant\n%s", got, want)
	}
}

// AWS's example of a signed listing ("Example: GET Bucket (List Objects)").
func TestSignsAListingAsAWSDoes(t *testing.T) {
	req, _ := http.NewRequest("GET", "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J", nil)
	sign(req, "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", emptyHash,
		time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC))
	want := "Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"
	if got := req.Header.Get("Authorization"); !strings.HasSuffix(got, want) {
		t.Fatalf("signed\n%s\nwant …%s", got, want)
	}
}

type object struct {
	body     []byte
	meta     http.Header
	modified time.Time
}

// fakeStore keeps what's put in it, checking each request is signed and its body is what was signed. Like a bucket
// with lock rules, it refuses to overwrite or delete what it has.
type fakeStore struct {
	mu   sync.Mutex
	objs map[string]*object // by path: /backups/<key>
	now  time.Time          // when what's put now is put (zero: time.Now)
}

func (f *fakeStore) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=key/") {
		http.Error(w, "unsigned", http.StatusForbidden)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case r.Method == http.MethodPut:
		if _, ok := f.objs[r.URL.Path]; ok {
			http.Error(w, "locked", http.StatusForbidden)
			return
		}
		body, _ := io.ReadAll(r.Body)
		if sha := r.Header.Get("x-amz-content-sha256"); sha != hashOf(body) || r.ContentLength != int64(len(body)) {
			http.Error(w, "the body isn't what was signed", http.StatusBadRequest)
			return
		}
		at := f.now
		if at.IsZero() {
			at = time.Now()
		}
		meta := http.Header{}
		for k, v := range r.Header {
			if strings.HasPrefix(strings.ToLower(k), "x-amz-meta-") {
				meta[k] = v
			}
		}
		f.objs[r.URL.Path] = &object{body: body, meta: meta, modified: at}
	case r.Method == http.MethodGet && r.URL.Query().Get("list-type") == "2":
		type content struct {
			Key          string
			Size         int
			LastModified time.Time
		}
		var res struct {
			XMLName  xml.Name `xml:"ListBucketResult"`
			Contents []content
		}
		for path, o := range f.objs {
			key := strings.TrimPrefix(path, "/backups/")
			if strings.HasPrefix(key, r.URL.Query().Get("prefix")) {
				res.Contents = append(res.Contents, content{key, len(o.body), o.modified})
			}
		}
		_ = xml.NewEncoder(w).Encode(res)
	case r.Method == http.MethodGet:
		o, ok := f.objs[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		for k, v := range o.meta {
			w.Header()[k] = v
		}
		_, _ = w.Write(o.body)
	default:
		http.Error(w, "no", http.StatusMethodNotAllowed)
	}
}

func hashOf(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func (f *fakeStore) keys(prefix string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for path := range f.objs {
		if key := strings.TrimPrefix(path, "/backups/"); strings.HasPrefix(key, prefix) {
			out = append(out, key)
		}
	}
	slices.Sort(out)
	return out
}

func (f *fakeStore) get(key string) []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	if o := f.objs["/backups/"+key]; o != nil {
		return o.body
	}
	return nil
}

// world is a game's database with a player, a day and a game in it, and a bucket.
type world struct {
	dir   string
	db    *store.DB
	fake  *fakeStore
	store *Store
	at    time.Time
}

func newWorld(t *testing.T) *world {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{
		`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Аз', 'az', 1, 1)`,
		`INSERT INTO days (day, questions) VALUES ('2026-11-15', '[]')`,
		`INSERT INTO runs (user_id, kind, day, questions, started_at) VALUES (1, 'day', '2026-11-15', '[]', 1)`,
	} {
		if _, err := db.Write.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	fake := &fakeStore{objs: map[string]*object{}}
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	return &world{dir: dir, db: db, fake: fake, at: time.Date(2026, 11, 15, 10, 30, 0, 0, time.UTC),
		store: &Store{Endpoint: srv.URL, Bucket: "backups", AccessKey: "key", SecretKey: "secret", Region: "auto"}}
}

// backer makes copies of what db reads, encrypted to recipients, each an hour after the one before.
func (w *world) backer(db *sql.DB, recipients ...age.Recipient) *Backer {
	return &Backer{Store: w.store, DB: db, Dir: w.dir, Recipients: recipients, now: func() time.Time {
		w.at = w.at.Add(time.Hour)
		w.fake.now = w.at
		return w.at
	}}
}

// put stores a file, gzipped, under key, as a copy would be.
func (w *world) put(t *testing.T, key string, file []byte) {
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	zw.Write(file)
	zw.Close()
	if err := w.store.Put(t.Context(), key, bytes.NewReader(gz.Bytes()), nil); err != nil {
		t.Fatal(err)
	}
}

func TestBackUpAndRestore(t *testing.T) {
	w := newWorld(t)
	r, err := w.backer(w.db.Read).Once(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if r.Encrypted || !r.Drilled || len(r.Keys) != 2 || r.Rows["users"] != 1 || r.Bytes == 0 || len(r.Warnings) > 0 {
		t.Fatalf("report %+v", r)
	}
	if want := []string{"days/2026-11-15T113000Z.db.gz", "hours/2026-11-15T113000Z.db.gz"}; !slices.Equal(w.fake.keys(""), want) {
		t.Fatalf("stored %v, want %v", w.fake.keys(""), want)
	}
	for _, k := range r.Keys {
		if _, err := gzip.NewReader(bytes.NewReader(w.fake.get(k))); err != nil {
			t.Fatalf("%s: %v", k, err)
		}
	}

	restored := filepath.Join(w.dir, "restored.db")
	if _, err := Restore(t.Context(), w.store, r.Keys[0], restored, plain); err != nil {
		t.Fatal(err)
	}
	if _, err := Restore(t.Context(), w.store, r.Keys[0], restored, plain); err == nil {
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
	for _, pattern := range []string{"snapshot-*", "copy-*", "drill-*"} {
		if left, _ := filepath.Glob(filepath.Join(w.dir, pattern)); len(left) > 0 {
			t.Fatalf("left behind %v", left)
		}
	}
}

// Each copy is a new object: nothing is overwritten (the fake bucket refuses it, as a locked one would). The day's
// copy is the first of each UTC day, and it's the one brought back.
func TestEachCopyIsNew(t *testing.T) {
	w := newWorld(t)
	owner, _ := age.GenerateX25519Identity()
	b := w.backer(w.db.Read, owner.Recipient())
	w.at = time.Date(2026, 11, 15, 21, 30, 0, 0, time.UTC)
	drilled := 0
	for range 4 { // 22:30, 23:30, then 00:30 and 01:30 the next day
		r, err := b.Once(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if r.Drilled {
			drilled++
		}
	}
	if got := w.fake.keys("hours/"); len(got) != 4 {
		t.Fatalf("hours %v", got)
	}
	if got, want := w.fake.keys("days/"), []string{"days/2026-11-15T223000Z.db.gz.age", "days/2026-11-16T003000Z.db.gz.age"}; !slices.Equal(got, want) || drilled != 2 {
		t.Fatalf("days %v, drilled %d", got, drilled)
	}
	s := LoadState(w.dir)
	if s.Day != "2026-11-16" || s.Key != "hours/2026-11-16T013000Z.db.gz.age" || s.Rows["runs"] != 1 || s.DayRows["users"] != 1 || len(s.Sent) != 6 {
		t.Fatalf("state %+v", s)
	}
	if latest, _, err := Latest(t.Context(), w.store, "days/"); err != nil || latest != "days/2026-11-16T003000Z.db.gz.age" {
		t.Fatalf("latest %q %v", latest, err)
	}
	// What this server stored is known for its own; the same name with other bytes, or a name its records cover that
	// it never stored, isn't.
	for key, want := range map[string][2]bool{
		"days/2026-11-16T003000Z.db.gz.age":  {true, true},
		"hours/2026-11-16T013000Z.db.gz.age": {true, true},
		"hours/2026-11-16T020000Z.db.gz.age": {false, true},
		"hours/2026-11-01T000000Z.db.gz.age": {false, false},
		"hours/latest.db.gz.age":             {false, false},
	} {
		sum := hashOf(w.fake.get(key))
		if made, known := s.Made(key, sum); made != want[0] || known != want[1] {
			t.Errorf("%s: made %v known %v, want %v", key, made, known, want)
		}
	}
	if made, _ := s.Made("days/2026-11-16T003000Z.db.gz.age", hashOf([]byte("other"))); made {
		t.Error("other bytes under its name passed for the server's")
	}
}

// A copy is made every quarter of an hour, seven minutes past: away from the hour's and Роял's work.
func TestNextCopy(t *testing.T) {
	for at, want := range map[string]string{"10:00": "10:07", "10:06": "10:07", "10:07": "10:22", "10:30": "10:37", "10:59": "11:07"} {
		in, _ := time.Parse("15:04", at)
		if got := next(in).Format("15:04"); got != want {
			t.Errorf("after %s: %s, want %s", at, got, want)
		}
	}
}

// Encrypted, a copy can be opened only with the key kept off the server; the server checks the day's all the same,
// with a key made for that copy alone.
func TestEncryptedCopies(t *testing.T) {
	w := newWorld(t)
	owner, err := age.GenerateHybridIdentity()
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.backer(w.db.Read, owner.Recipient()).Once(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if !r.Encrypted || !r.Drilled || !strings.HasSuffix(r.Keys[0], ".db.gz.age") {
		t.Fatalf("report %+v", r)
	}
	data := w.fake.get(r.Keys[0])
	if !bytes.HasPrefix(data, ageMagic) || bytes.Contains(data, []byte("SQLite format")) {
		t.Fatal("not encrypted")
	}

	path := filepath.Join(w.dir, "back.db")
	if _, err := Restore(t.Context(), w.store, r.Keys[0], path, plain); !errors.Is(err, ErrEncrypted) {
		t.Fatalf("restored without the key: %v", err)
	}
	other, _ := age.GenerateHybridIdentity()
	if _, err := Drill(t.Context(), w.store, r.Keys[0], w.dir, Opening{IDs: []age.Identity{other}}); err == nil {
		t.Fatal("opened with another key")
	}
	back, err := Drill(t.Context(), w.store, r.Keys[0], w.dir, Opening{IDs: []age.Identity{owner}})
	if err != nil || back.Rows["users"] != 1 || !back.Encrypted || back.Meta == "" {
		t.Fatalf("with the key: %+v %v", back, err)
	}

	// Without its key, it's known to be stored as it was sent.
	st, err := Intact(t.Context(), w.store, r.Keys[1])
	if err != nil || st.Bytes != int64(len(data)) || !strings.Contains(st.Rows, "users=1") {
		t.Fatalf("intact %+v %v", st, err)
	}
	w.fake.mu.Lock()
	w.fake.objs["/backups/"+r.Keys[1]].body[len(data)-5] ^= 1
	w.fake.mu.Unlock()
	if _, err := Intact(t.Context(), w.store, r.Keys[1]); err == nil {
		t.Fatal("a changed copy passed")
	}
	if _, err := Drill(t.Context(), w.store, r.Keys[1], w.dir, Opening{IDs: []age.Identity{owner}}); err == nil {
		t.Fatal("a changed copy opened")
	}
}

// A copy from before they were encrypted, under its old name, still comes back, but only when it's asked for: anyone
// with the bucket's key could have put it there.
func TestOldCopiesStillRestore(t *testing.T) {
	w := newWorld(t)
	if _, err := w.db.Write.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		t.Fatal(err)
	}
	file, err := os.ReadFile(filepath.Join(w.dir, "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	w.put(t, "days/15.db.gz", file)
	owner, _ := age.GenerateX25519Identity()
	if _, err := Drill(t.Context(), w.store, "days/15.db.gz", w.dir, Opening{IDs: []age.Identity{owner}}); !errors.Is(err, ErrUnencrypted) {
		t.Fatalf("an unencrypted copy taken with a key: %v", err)
	}
	back, err := Drill(t.Context(), w.store, "days/15.db.gz", w.dir, Opening{IDs: []age.Identity{owner}, Unencrypted: true})
	if err != nil || back.Rows["runs"] != 1 || back.Encrypted || back.Proof != "" {
		t.Fatalf("%+v %v", back, err)
	}
}

func TestRecipients(t *testing.T) {
	secret, recipient, err := NewKeys()
	if err != nil || !strings.HasPrefix(secret, "AGE-SECRET-KEY-PQ-1") || !strings.HasPrefix(recipient, "age1pq1") {
		t.Fatalf("%q %q %v", secret, recipient, err)
	}
	x, _ := age.GenerateX25519Identity()
	x2, _ := age.GenerateX25519Identity()
	if rs, err := Recipients(" " + recipient + "\n"); err != nil || len(rs) != 1 {
		t.Fatalf("%v %v", rs, err)
	}
	if rs, err := Recipients(x.Recipient().String() + ", " + x2.Recipient().String()); err != nil || len(rs) != 2 {
		t.Fatalf("%v %v", rs, err)
	}
	if rs, err := Recipients(""); err != nil || rs != nil {
		t.Fatalf("none: %v %v", rs, err)
	}
	for _, bad := range []string{"age1nope", secret, recipient + " " + x.Recipient().String()} {
		if _, err := Recipients(bad); err == nil {
			t.Fatalf("took %q", bad)
		}
	}
	ids, err := Identities(strings.NewReader("# the key\n" + secret + "\n"))
	if err != nil || len(ids) != 1 {
		t.Fatalf("%v %v", ids, err)
	}
}

// An empty game is never sent (a new server, before its restore), unless asked; a game that lost half its rows is sent,
// and that's said.
func TestAnEmptyGameIsNotSent(t *testing.T) {
	w := newWorld(t)
	b := w.backer(w.db.Read)
	for i := range 30 {
		if _, err := w.db.Write.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Играч', ?, 1, 1)`, "p"+string(rune('a'+i))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := b.Once(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Write.Exec(`DELETE FROM users WHERE id > 5`); err != nil {
		t.Fatal(err)
	}
	r, err := b.Once(t.Context())
	if err != nil || len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "users fell from 31 rows to 5") {
		t.Fatalf("%+v %v", r, err)
	}

	if _, err := w.db.Write.Exec(`DELETE FROM runs`); err != nil {
		t.Fatal(err)
	}
	stored := len(w.fake.keys(""))
	if _, err := b.Once(t.Context()); err == nil || !strings.Contains(err.Error(), "runs is empty") {
		t.Fatalf("sent: %v", err)
	}
	if len(w.fake.keys("")) != stored {
		t.Fatal("stored")
	}
	b.Force = true
	if _, err := b.Once(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func TestTheDrillFails(t *testing.T) {
	w := newWorld(t)

	// No copy at all.
	if _, err := Drill(t.Context(), w.store, "days/x.db.gz", w.dir, plain); !errors.Is(err, ErrMissing) {
		t.Fatalf("a missing copy: %v", err)
	}

	// A copy cut short on its way.
	r, err := w.backer(w.db.Read).Once(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	whole := w.fake.get(r.Keys[0])
	w.fake.objs["/backups/cut"] = &object{body: whole[:len(whole)/2]}
	if _, err := Drill(t.Context(), w.store, "cut", w.dir, plain); err == nil {
		t.Fatal("a cut copy passed")
	}

	// A copy whose pages are damaged.
	w.put(t, "damaged", damaged(t))
	if _, err := Drill(t.Context(), w.store, "damaged", w.dir, plain); err == nil {
		t.Fatal("a damaged copy passed")
	}

	// A whole copy of a game with no games in it.
	if _, err := w.db.Write.Exec(`DELETE FROM runs`); err != nil {
		t.Fatal(err)
	}
	b := w.backer(w.db.Read)
	b.Force = true
	r, err = b.Once(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Drill(t.Context(), w.store, r.Keys[0], w.dir, plain); err == nil || !strings.Contains(err.Error(), "runs is empty") {
		t.Fatalf("an empty copy: %v", err)
	}
	left, _ := filepath.Glob(filepath.Join(w.dir, "drill-*"))
	if len(left) > 0 {
		t.Fatalf("left behind %v", left)
	}
}

// A copy that isn't the game's is never sent.
func TestABadCopyIsNotSent(t *testing.T) {
	w := newWorld(t)
	other, err := sql.Open("sqlite", filepath.Join(w.dir, "other.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if _, err := other.Exec(`CREATE TABLE users (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	_, err = w.backer(other).Once(t.Context())
	if err == nil || !strings.Contains(err.Error(), "damaged, not sent") {
		t.Fatalf("sent: %v", err)
	}
	if len(w.fake.keys("")) != 0 {
		t.Fatalf("stored %v", w.fake.keys(""))
	}
	for _, pattern := range []string{"snapshot-*", "copy-*"} {
		if left, _ := filepath.Glob(filepath.Join(w.dir, pattern)); len(left) > 0 {
			t.Fatalf("left behind %v", left)
		}
	}
}

// Copies the lifecycle rules should have deleted by now are said to be there.
func TestOverdue(t *testing.T) {
	w := newWorld(t)
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	for key, age := range map[string]time.Duration{
		"hours/new":  time.Hour,
		"hours/kept": 8 * 24 * time.Hour,
		"hours/old":  10 * 24 * time.Hour,
		"days/fresh": 31 * 24 * time.Hour,
		"days/old":   40 * 24 * time.Hour,
	} {
		w.fake.now = now.Add(-age)
		w.put(t, key, []byte("x"))
	}
	stale, err := Overdue(t.Context(), w.store, now)
	if err != nil || len(stale) != 2 || stale[0].Key != "hours/old" || stale[1].Key != "days/old" {
		t.Fatalf("%v %v", stale, err)
	}
}

// Recent copies deleted long before HoursKept (the bucket's rule for hours/ still the old two days) are said to be,
// once the day's copies show copies have been made for longer; not before.
func TestUnderkept(t *testing.T) {
	w := newWorld(t)
	now := time.Date(2026, 11, 30, 10, 0, 0, 0, time.UTC)
	put := func(key string, age time.Duration) {
		w.fake.now = now.Add(-age)
		w.put(t, key, []byte("x"))
	}
	put("hours/a", time.Hour)
	put("hours/b", 2*24*time.Hour)
	put("days/a", 3*24*time.Hour)
	if said, err := Lifecycle(t.Context(), w.store, now); err != nil || len(said) != 0 {
		t.Fatalf("too early to tell: %v %v", said, err)
	}
	put("days/b", 9*24*time.Hour)
	said, err := Lifecycle(t.Context(), w.store, now)
	if err != nil || len(said) != 1 || !strings.Contains(said[0], "after about 2 days, not 7") {
		t.Fatalf("%v %v", said, err)
	}
	put("hours/c", 7*24*time.Hour)
	if said, err := Lifecycle(t.Context(), w.store, now); err != nil || len(said) != 0 {
		t.Fatalf("kept as long as they should be: %v %v", said, err)
	}
}

// A table that loses half its rows, or more than doubles by a thousand, is said to; transient tables, small ones and
// tables new or gone aren't.
func TestChanges(t *testing.T) {
	before := map[string]int64{"users": 20, "friends": 400, "achievements": 40, "answers": 3000, "outbox": 900, "old": 100, "sessions": 5000}
	now := map[string]int64{"users": 9, "friends": 150, "achievements": 2, "answers": 7000, "outbox": 0, "new": 10, "sessions": 1}
	var said []string
	for _, c := range Changes(before, now, "the copy before", true) {
		said = append(said, c.Table)
	}
	if want := []string{"answers", "friends", "users"}; !slices.Equal(said, want) {
		t.Fatalf("said %v, want %v", said, want)
	}
	if c := Changes(before, now, "the day's first copy", false); len(c) != 2 || c[0].Table != "friends" || !strings.Contains(c[0].Said, "fell to under half the 400 rows it had in the day's first copy") {
		t.Fatalf("%+v", c)
	}
}

// The tables said to be transient are the game's: a table renamed or dropped isn't left on the list.
func TestTransientTablesExist(t *testing.T) {
	w := newWorld(t)
	for _, name := range transient {
		var n int
		if err := w.db.Read.QueryRow(`SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = ?`, name).Scan(&n); err != nil || n != 1 {
			t.Errorf("transient table %s isn't in the schema", name)
		}
	}
}

// A copy that drops half a watched table is sent, and that's said, against the copy before and the day's first; the day's
// copy says when rows point to rows that aren't there.
func TestACopyWeighsItsTables(t *testing.T) {
	w := newWorld(t)
	b := w.backer(w.db.Read)
	w.at = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	if _, err := w.db.Write.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100)
		INSERT INTO achievements (user_id, id, at) SELECT 1, 'a' || i, 1 FROM n`); err != nil {
		t.Fatal(err)
	}
	if r, err := b.Once(t.Context()); err != nil || len(r.Warnings) != 0 {
		t.Fatalf("%+v %v", r, err)
	}
	// A slow bleed: each copy a little fewer, never half of the one before, but half the day's first.
	for _, left := range []int{70, 45} {
		if _, err := w.db.Write.Exec(`DELETE FROM achievements WHERE CAST(substr(id, 2) AS INTEGER) > ?`, left); err != nil {
			t.Fatal(err)
		}
		r, err := b.Once(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if left == 70 && len(r.Warnings) != 0 || left == 45 && (len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "achievements fell to under half the 100 rows it had in the day's first copy")) {
			t.Fatalf("%d left: %v", left, r.Warnings)
		}
	}
	// The next day's first copy finds rows that point nowhere (put there with the foreign keys off).
	conn, err := w.db.Write.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{`PRAGMA foreign_keys = OFF`, `INSERT INTO achievements (user_id, id, at) VALUES (99, 'x', 1)`, `PRAGMA foreign_keys = ON`} {
		if _, err := conn.ExecContext(t.Context(), q); err != nil {
			t.Fatal(err)
		}
	}
	conn.Close()
	w.at = time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC)
	r, err := b.Once(t.Context())
	if err != nil || !r.Drilled || !slices.ContainsFunc(r.Warnings, func(s string) bool { return strings.Contains(s, "achievements → users: 1") }) {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestCheckFindsDamage(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "damaged.db")
	if err := os.WriteFile(path, damaged(t), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Check(t.Context(), path); err == nil {
		t.Fatal("damage not found")
	}
	if _, err := Check(t.Context(), filepath.Join(dir, "none.db")); err == nil {
		t.Fatal("a missing file passed")
	}
}

// damaged is a database file of the game whose index pages have been overwritten.
func damaged(t *testing.T) []byte {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Write.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
		INSERT INTO users (name, tag, created_at, seen_at) SELECT 'Играч', 'player' || i, 1, 1 FROM n`); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "copy.db")
	if _, err := db.Write.Exec(`VACUUM INTO ?`, path); err != nil {
		t.Fatal(err)
	}
	db.Close()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// Garble the second half of the file (past the schema on the first pages), a few bytes in every page.
	page := 4096
	for p := len(data) / page / 2; p < len(data)/page; p++ {
		for i := 100; i < 140; i++ {
			data[p*page+i] ^= 0x5a
		}
	}
	return data
}
