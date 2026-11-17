package backup

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"strings"

	"filippo.io/age"
)

// The copies are encrypted with age (age-encryption.org): to the recipients BACKUP_RECIPIENT names, public keys whose
// secret halves are kept off the server, so that what's sent can be read only where those are. Anyone with a key
// opens a copy with this program (backup restore -identity) or with age itself (age -d -i key | gunzip).

// ageMagic is how an age file starts.
var ageMagic = []byte("age-encryption.org/v1\n")

// ErrEncrypted is the error for a copy that's encrypted, brought back without a key that opens it.
var ErrEncrypted = errors.New("the copy is encrypted: open it with the key kept off the server (-identity)")

// Recipients reads the recipients in s (BACKUP_RECIPIENT): one or more age public keys, separated by spaces, commas
// or new lines. They must be of one kind (all post-quantum, as backup keys makes them, or all X25519): age won't mix
// them.
func Recipients(s string) ([]age.Recipient, error) {
	fields := strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' })
	if len(fields) == 0 {
		return nil, nil
	}
	rs, err := age.ParseRecipients(strings.NewReader(strings.Join(fields, "\n")))
	if err != nil {
		return nil, fmt.Errorf("BACKUP_RECIPIENT: %w", err)
	}
	// A set age refuses to encrypt to (mixed kinds) would fail every copy: found now, not at the first one.
	if _, _, err := drillKey(rs); err != nil {
		return nil, fmt.Errorf("BACKUP_RECIPIENT: %w", err)
	}
	return rs, nil
}

// Identities reads the secret keys in r (an age identity file: one key a line, # for comments).
func Identities(r io.Reader) ([]age.Identity, error) {
	ids, err := age.ParseIdentities(r)
	if err != nil {
		return nil, fmt.Errorf("the key: %w", err)
	}
	return ids, nil
}

// NewKeys makes a key pair for the copies: the secret key that opens them (AGE-SECRET-KEY-PQ-1…, to be kept off the
// server) and its public half, the recipient (age1pq1…, for BACKUP_RECIPIENT). Post-quantum, as age now makes its
// keys: a copy taken today can't be opened by a quantum computer later either.
func NewKeys() (secret, recipient string, err error) {
	id, err := age.GenerateHybridIdentity()
	if err != nil {
		return "", "", err
	}
	return id.String(), id.Recipient().String(), nil
}

// drillKey makes a key pair for one copy alone: the copy is encrypted to it besides the recipients, so the server can
// open what it has just sent and check it (Drill), though it holds no key to the copies. Its secret half lives in
// memory until that check and is never written anywhere; it's of the recipients' kind, as age won't mix them. It's
// checked here that age takes the recipients with it.
func drillKey(recipients []age.Recipient) (age.Identity, age.Recipient, error) {
	var id age.Identity
	var r age.Recipient
	if hasX25519(recipients) {
		x, err := age.GenerateX25519Identity()
		if err != nil {
			return nil, nil, err
		}
		id, r = x, x.Recipient()
	} else {
		h, err := age.GenerateHybridIdentity()
		if err != nil {
			return nil, nil, err
		}
		id, r = h, h.Recipient()
	}
	w, err := age.Encrypt(io.Discard, append(recipients[:len(recipients):len(recipients)], r)...)
	if err != nil {
		return nil, nil, err
	}
	if err := w.Close(); err != nil {
		return nil, nil, err
	}
	return id, r, nil
}

func hasX25519(rs []age.Recipient) bool {
	for _, r := range rs {
		if _, ok := r.(*age.X25519Recipient); ok {
			return true
		}
	}
	return false
}

// opened is what r holds, decrypted if it's an age file (with ids; ErrEncrypted without), as it is if not.
func opened(r io.Reader, ids []age.Identity) (io.Reader, bool, error) {
	br := bufio.NewReaderSize(r, 64<<10)
	head, _ := br.Peek(len(ageMagic))
	if !bytes.Equal(head, ageMagic) {
		return br, false, nil
	}
	if len(ids) == 0 {
		return nil, true, ErrEncrypted
	}
	d, err := age.Decrypt(br, ids...)
	if err != nil {
		return nil, true, fmt.Errorf("decrypting: %w", err)
	}
	return d, true, nil
}
