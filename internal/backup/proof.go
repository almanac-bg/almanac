package backup

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// The drill opens each day's copy with a key of its own, so it proves the copy decodes, not that the key the owner
// keeps opens it: a BACKUP_RECIPIENT that is a valid key but not the owner's (an old pair, a test pair, a secret
// lost) keeps the drill green while no copy can ever be opened. Age names no recipient in a copy (its stanzas are
// anonymous by design), so nothing on the server can tell whose key a copy is for; only opening it can. So the owner
// opens one now and then, off the server (backup verify -identity), which prints the copy's proof code: part of the
// hash of the gzipped database inside it, which only opening it gives. On the server, `backup proven <code>` checks
// the code against the hash of the code the server kept for each day's copy (it never keeps the code: whoever reads
// its files can't make a proof), and records which key the proven copy went to. The server then says daily, as a
// problem, when the key the copies go to has had no proof for ProofGrace since it was first used, or none for
// ProofEvery.

const (
	// ProofGrace is how long a new key may go unproven, and ProofEvery how long a proof holds. The key can't drift on
	// its own (a new BACKUP_RECIPIENT is a new key, unproven at once), so a proof is asked again only to learn that the
	// secret key is still kept: once a year, a chore the owner can bear, not a monthly one.
	ProofGrace = 7 * 24 * time.Hour
	ProofEvery = 365 * 24 * time.Hour
	// provenFile is the last proof, beside the database.
	provenFile = "backup-proven.json"
)

// ProofCode is the code that shows a copy was opened: the first 80 bits of the SHA-256 of what it decrypts to (sum),
// in groups of four hex digits.
func ProofCode(sum []byte) string {
	h := hex.EncodeToString(sum[:10])
	var parts []string
	for i := 0; i < len(h); i += 4 {
		parts = append(parts, h[i:i+4])
	}
	return strings.Join(parts, "-")
}

// proofHash is what the server keeps of a proof code: its hash, so that the code itself is known only to whoever
// opens the copy.
func proofHash(code string) string {
	sum := sha256.Sum256([]byte("almanac backup proof " + normalCode(code)))
	return hex.EncodeToString(sum[:])
}

// normalCode is a code as typed, without its dashes, spaces and capitals.
func normalCode(code string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '-' || r == ' ' || r == '\t':
			return -1
		case 'A' <= r && r <= 'F':
			return r + 'a' - 'A'
		}
		return r
	}, code)
}

// Proven is the last proof that the key kept off the server opens the copies: when it was recorded, the copy it
// opened, and the key (Fingerprint) that copy went to.
type Proven struct {
	At        time.Time `json:"at"`
	Key       string    `json:"key"`
	Recipient string    `json:"recipient"`
}

// LoadProven reads the last proof kept in dir (the zero Proven if there's none).
func LoadProven(dir string) Proven {
	var p Proven
	if data, err := os.ReadFile(filepath.Join(dir, provenFile)); err == nil {
		_ = json.Unmarshal(data, &p)
	}
	return p
}

// ErrNotProof is the error for a code that is no copy's this server kept.
var ErrNotProof = errors.New("that code is no day's copy's this server made in the last month: " +
	"verify a day's copy (backup verify -identity <file>, with no key or with a days/ one) and give the code it prints")

// Prove records the proof code of a copy, as `backup verify -identity` printed it off the server: it must be the
// code of a day's copy this server made and still keeps a record of (State.Sent).
func Prove(dir, code string, now time.Time) (Proven, error) {
	want := proofHash(code)
	if len(normalCode(code)) != 20 {
		return Proven{}, ErrNotProof
	}
	st := LoadState(dir)
	for _, key := range slices.Backward(slices.Sorted(maps.Keys(st.Sent))) { // the newest whose code it is
		if sent := st.Sent[key]; sent.Proof != "" && sent.Proof == want {
			p := Proven{At: now.UTC(), Key: key, Recipient: sent.Recipient}
			return p, saveJSON(filepath.Join(dir, provenFile), p)
		}
	}
	return Proven{}, ErrNotProof
}

// unproven says what's wrong with the proof that the copies open (none: nothing): the key they go to now has had no
// proof since ProofGrace after it was first used, or its last is older than ProofEvery.
func unproven(st State, p Proven, now time.Time) []string {
	if st.Recipient == nil {
		return nil
	}
	how := "open a day's copy off the server with the secret key (backup verify -identity <file>) and record the code " +
		"it prints on the server (backup proven <code>; README)"
	switch {
	case p.Recipient != st.Recipient.Key:
		if now.Sub(st.Recipient.Since) >= ProofGrace {
			return []string{fmt.Sprintf("no copy encrypted to BACKUP_RECIPIENT (key %s, since %s) is known to open with "+
				"the secret key kept off the server: %s", st.Recipient.Key, st.Recipient.Since.Format(time.DateOnly), how)}
		}
	case now.Sub(p.At) >= ProofEvery:
		return []string{fmt.Sprintf("the copies were last opened with the secret key kept off the server on %s: is it "+
			"still there? %s", p.At.Format(time.DateOnly), how)}
	}
	return nil
}
