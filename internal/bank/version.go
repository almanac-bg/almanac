package bank

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

// A question changes now and then while it's in play: its answer fixed, an option reworded, a decoy added, its picture
// swapped. Its Version says which of its versions it is, by what it asks (not its labels, fact and dates: notAsked),
// so that a play can be graded against the version it showed, and its answers counted only with those to the same
// version (the game keeps every version it has played: play.Game.Keep). Two versions with the same Version deal and
// grade alike, seed for seed.
//
// A version is hashed from a form of what the question asks written out field by field (each type's asked, with its
// type, text and picture), never from the type's Go struct as it happens to encode: a field a type gains changes no
// version, until a question sets it. Versions are kept for ever (question_versions, runs' Pick.V), so one that moved
// would lose every play, review and recording of the version it was. TestPinnedVersions pins them; a type
// changed on purpose so that they move needs a migration that rewrites the versions kept. TestEveryFieldClassed holds
// each field of every type to be either in the form (one that tells versions apart) or in notAsked.

// Version is which version of a question this is: a hash of what it asks, 16 hex digits.
func Version(q Question) string {
	if v := q.Base().version; v != "" {
		return v
	}
	return versionOf(q)
}

// versionOf works a question's Version out: its form (askedForm) as JSON, its keys in order.
func versionOf(q Question) string {
	data, err := json.Marshal(askedForm(q))
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}

// askedForm is what a question asks, as its version is hashed from: its type and text, its picture as the file it is
// (its name is its content's hash: who took it, its size and description are its labels), and what its type asks
// (asked). A field the form gains goes in only where it's set, so that the versions of questions without it stay.
func askedForm(q Question) map[string]any {
	h, t := q.Base(), q.Extra()
	form := q.asked()
	form["type"], form["text"] = h.Type, h.Text
	if t.Image != nil {
		form["image"] = t.Image.File
	}
	return form
}

// Encode is a question as one JSON value, everything it holds: what Decode reads back (its category aside).
func Encode(q Question) ([]byte, error) { return json.Marshal(q) }

// Decode reads a question Encode wrote, of a category: a version kept from an earlier bank, to deal and grade as it
// was. Its type must be one the game knows. Its version is worked out again from what it reads, never taken on trust:
// a field renamed since it was kept reads back as another version, which the game refuses (play: pastVersion), rather
// than as the same one without what it asked.
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
