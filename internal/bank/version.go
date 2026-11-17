package bank

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

// A question changes now and then while it's in play: its answer fixed, an option reworded, a decoy added, its picture
// swapped. Its Version says which of its versions it is, by what it asks (notAsked aside: its labels, fact and dates),
// so that a play can be graded against the version it showed, and its answers counted only with those to the same
// version (the game keeps every version it has played: play.Game.Keep). Two versions with the same Version deal and
// grade alike, seed for seed.

// Version is which version of a question this is: a hash of what it asks, 16 hex digits.
func Version(q Question) string {
	if v := q.Base().version; v != "" {
		return v
	}
	return versionOf(q)
}

// versionOf works a question's Version out: its fields as JSON, without those that aren't what it asks, and each
// picture as its file (its name is its content's hash).
func versionOf(q Question) string {
	data, err := json.Marshal(q)
	var fields map[string]json.RawMessage
	if err == nil {
		err = json.Unmarshal(data, &fields)
	}
	if err != nil {
		return ""
	}
	for k := range fields {
		if notAsked[k] {
			delete(fields, k)
		}
	}
	if im := q.Extra().Image; im != nil {
		fields["image"], _ = json.Marshal(im.File)
	}
	if c, ok := q.(*Choice); ok && len(c.Pictures) > 0 {
		files := make([]string, len(c.Pictures))
		for i, p := range c.Pictures {
			files[i] = p.File
		}
		fields["pictures"], _ = json.Marshal(files)
	}
	data, _ = json.Marshal(fields) // a map's keys in order
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}

// Encode is a question as one JSON value, everything it holds: what Decode reads back (its category aside).
func Encode(q Question) ([]byte, error) { return json.Marshal(q) }

// Decode reads a question Encode wrote, of a category: a version kept from an earlier bank, to deal and grade as it
// was. Its type must be one the game knows.
func Decode(data []byte, category string) (Question, error) {
	var probe struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return nil, err
	}
	newQuestion, ok := types[probe.Type]
	if !ok {
		return nil, fmt.Errorf("unknown type %q", probe.Type)
	}
	q := newQuestion()
	if err := json.Unmarshal(data, q); err != nil {
		return nil, err
	}
	h := q.Base()
	if h.ID == "" {
		return nil, errors.New("a question without its id")
	}
	h.Category = category
	h.subjects = subjectsOf(q)
	h.version = versionOf(q)
	return q, nil
}
