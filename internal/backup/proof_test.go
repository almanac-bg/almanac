package backup

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"filippo.io/age"
)

// plain opens the copies made with no key: unencrypted, and asked for.
var plain = Opening{Unencrypted: true}

// A BACKUP_RECIPIENT that is a valid key, but not the one kept off the server, keeps the drill green: so the copies
// are not known to open until the owner's key opens one and its code is recorded. A code proves only the key it was
// made with: once the copies go to another key, they're unproven again, and that's said at once and daily.
func TestOnlyTheOwnersKeyProvesTheCopies(t *testing.T) {
	w := newWorld(t)
	owner, _ := age.GenerateHybridIdentity()
	wrong, _ := age.GenerateHybridIdentity() // a valid key whose secret the owner doesn't have
	b := w.backer(w.db.Read, owner.Recipient())
	w.at = time.Date(2026, 11, 15, 22, 0, 0, 0, time.UTC)
	day := func() *Report { // the next day's first copy: the drill, and what's said daily
		t.Helper()
		if _, err := w.db.Write.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES ('Нов', ?, 1, 1)`, w.at.String()); err != nil {
			t.Fatal(err)
		}
		w.at = w.at.Truncate(24 * time.Hour).Add(23 * time.Hour) // the backer adds an hour
		r, err := b.Once(t.Context())
		if err != nil || !r.Drilled {
			t.Fatalf("%+v %v", r, err)
		}
		// The fake bucket has no lifecycle rules: what's said of the copies it keeps on isn't this test's.
		r.Warnings = slices.DeleteFunc(r.Warnings, func(s string) bool { return strings.HasPrefix(s, "the bucket keeps") })
		return r
	}
	if r := day(); len(r.Warnings) != 0 {
		t.Fatalf("a new key is given its time: %v", r.Warnings)
	}
	w.at = w.at.Add(ProofGrace)
	r := day()
	if len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "is known to open with the secret key") {
		t.Fatalf("unproven: %v", r.Warnings)
	}

	// The owner opens the day's copy off the server, and gives its code to the server.
	key := r.Keys[1]
	if _, err := Drill(t.Context(), w.store, key, w.dir, Opening{IDs: []age.Identity{wrong}}); err == nil {
		t.Fatal("opened with a key it isn't for")
	}
	back, err := Drill(t.Context(), w.store, key, w.dir, Opening{IDs: []age.Identity{owner}})
	if err != nil || len(back.Proof) != 24 {
		t.Fatalf("%+v %v", back, err)
	}
	if _, err := Prove(w.dir, "0000-0000-0000-0000-0000", w.at); !errors.Is(err, ErrNotProof) {
		t.Fatalf("a made-up code: %v", err)
	}
	state, err := os.ReadFile(filepath.Join(w.dir, stateFile))
	if err != nil || bytes.Contains(state, []byte(back.Proof)) || bytes.Contains(state, []byte(normalCode(back.Proof))) {
		t.Fatalf("the server keeps the code itself (%v)", err)
	}
	p, err := Prove(w.dir, " "+strings.ToUpper(back.Proof)+" ", w.at)
	if err != nil || p.Key != key || p.Recipient != Fingerprint([]age.Recipient{owner.Recipient()}) {
		t.Fatalf("%+v %v", p, err)
	}
	if r := day(); len(r.Warnings) != 0 {
		t.Fatalf("proven: %v", r.Warnings)
	}
	w.at = w.at.Add(ProofEvery)
	if r = day(); len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "last opened with the secret key") {
		t.Fatalf("a month on: %v", r.Warnings)
	}
	if _, err := Prove(w.dir, back.Proof, w.at); !errors.Is(err, ErrNotProof) {
		t.Fatalf("the code of a copy the bucket no longer keeps: %v", err)
	}
	if back, err = Drill(t.Context(), w.store, r.Keys[1], w.dir, Opening{IDs: []age.Identity{owner}}); err != nil {
		t.Fatal(err)
	}
	if _, err := Prove(w.dir, back.Proof, w.at); err != nil {
		t.Fatal(err)
	}

	// BACKUP_RECIPIENT changed to a key that isn't the proven one: said at once, and its copies unproven.
	b.Recipients = []age.Recipient{wrong.Recipient()}
	r, err = b.Once(t.Context())
	if err != nil || len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "BACKUP_RECIPIENT changed") {
		t.Fatalf("changed: %+v %v", r, err)
	}
	w.at = w.at.Add(ProofGrace)
	if r := day(); len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "is known to open with the secret key") {
		t.Fatalf("the old proof doesn't hold for the new key: %v", r.Warnings)
	}
	// The same keys, listed in another order, are the same keys.
	if Fingerprint([]age.Recipient{owner.Recipient(), wrong.Recipient()}) != Fingerprint([]age.Recipient{wrong.Recipient(), owner.Recipient()}) {
		t.Fatal("the fingerprint depends on the order")
	}
}

// `latest` is only ever a copy as the server makes it: encrypted, named by its time, stored at that time. What someone
// with the bucket's key puts there besides (unencrypted, named otherwise, or stored long after its name) is skipped,
// and said to be.
func TestLatestIsTheServersCopy(t *testing.T) {
	w := newWorld(t)
	owner, _ := age.GenerateX25519Identity()
	w.at = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	r, err := w.backer(w.db.Read, owner.Recipient()).Once(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	plant := func(key string, at time.Time, body []byte) {
		w.fake.now = at
		if err := w.store.Put(t.Context(), key, bytes.NewReader(body), nil); err != nil {
			t.Fatal(err)
		}
	}
	later := w.at.Add(30 * time.Minute)
	plant("hours/2026-11-15T113000Z.db.gz", later, []byte("plain"))             // unencrypted
	plant("hours/evil.db.gz.age", later, ageMagic)                              // not named by a time
	plant("hours/2026-11-15T090000Z.db.gz.age", later.Add(time.Hour), ageMagic) // stored long after its name
	plant("other/2026-11-15T113000Z.db.gz.age", later, ageMagic)                // not a copy's prefix
	key, skipped, err := Latest(t.Context(), w.store, "")
	if err != nil || key != r.Keys[0] || len(skipped) != 4 {
		t.Fatalf("latest %q, skipped %v, %v", key, skipped, err)
	}
	if key, _, err := Latest(t.Context(), w.store, "days/"); err != nil || key != r.Keys[1] {
		t.Fatalf("days: %q %v", key, err)
	}
	if _, _, err := Latest(t.Context(), newWorld(t).store, ""); !errors.Is(err, ErrMissing) {
		t.Fatalf("none: %v", err)
	}
	// An unencrypted copy is never taken unless asked for, with a key or without.
	path := filepath.Join(w.dir, "x.db")
	for _, open := range []Opening{{IDs: []age.Identity{owner}}, {}} {
		if _, err := Restore(t.Context(), w.store, "hours/2026-11-15T113000Z.db.gz", path, open); !errors.Is(err, ErrUnencrypted) {
			t.Fatalf("%v", err)
		}
	}
}
