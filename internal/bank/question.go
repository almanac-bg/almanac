// Package bank holds the game's questions: the types a question can be, the bank on disk, and the checks a bank must
// pass before a server plays it.
//
// Every type lives in its own file (choice.go, number.go, order.go) and plugs in through the same three steps: it
// checks itself, deals itself for one play (shuffled, without its answer), and grades what a player gave. Adding a
// type is a new file here and its renderer in the web client; nothing else changes.
package bank

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"strings"
)

// Difficulty is how hard a question is meant to be. How hard it really is comes from the answers players give.
type Difficulty string

const (
	Easy   Difficulty = "easy"
	Medium Difficulty = "medium"
	Hard   Difficulty = "hard"
)

// Head is what every question starts with: who it is, what it is, and what it asks.
type Head struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	Difficulty Difficulty `json:"difficulty"`
	Text       string     `json:"text"`

	// Category comes from the file the question is in (questions/<category>.json).
	Category string `json:"-"`
}

// Tail is what every question may end with: a picture, the fact behind the answer, and when it was added or needs
// a look again.
type Tail struct {
	Image *Image `json:"image,omitempty"`
	// Fact is "Знаеше ли?": something worth knowing behind the answer, shown once it's revealed.
	Fact string `json:"fact,omitempty"`
	// Tags are topics across categories ("bg", "christmas"): themed sets draw on them.
	Tags []string `json:"tags,omitempty"`
	// Added is when the question joined the bank (YYYY-MM-DD).
	Added string `json:"added,omitempty"`
	// ReviewBy is when its answer may stop being true (a record, an office holder): checked again by then.
	ReviewBy string `json:"reviewBy,omitempty"`
	// Retired questions are never dealt again, but stay so that history and stats keep their text.
	Retired bool `json:"retired,omitempty"`
}

// Question is one question of any type.
type Question interface {
	Base() *Head
	Extra() *Tail
	// Deal prepares the question for one play: options or items in an order of their own, the answer hidden. The same
	// seed always deals the same way, so a play can be stored as (id, seed) and dealt again.
	Deal(seed uint64) Dealt
	// check finds what's wrong with the question by its type's rules (the shared fields are checked in check.go).
	check() []string
	// key says when two questions are the same question (the bank allows no duplicates).
	key() string
	// words is every text a player sees, the answer included (for the giveaway checks).
	words() []string
}

// Dealt is a question as one play shows it.
type Dealt interface {
	Question() Question
	// View is what a player gets before answering: everything but the answer.
	View() any
	// Grade scores a player's answer (as JSON from the client) against this deal.
	Grade(answer json.RawMessage) (Graded, error)
	// Reveal is the answer as this deal shows it, with the fact and the picture's credit.
	Reveal() any
}

// Graded is what an answer was worth.
type Graded struct {
	// Score runs from 0 (wrong) to 1 (perfect). Types with partial credit (a close number, an order half right) land in
	// between; the game turns it into points.
	Score float64
	// Right is whether it counts as a right answer (for streaks and stats).
	Right bool
	// Exact marks a number guessed spot on.
	Exact bool
	// Given is the answer in the bank's own terms, independent of the deal (which option of the bank's, which order of
	// the bank's items): what the answer log keeps, so stats add up across deals.
	Given json.RawMessage
	// Shown is the same answer as the deal showed it (for going over a run afterwards).
	Shown json.RawMessage
}

// rng is the generator a deal shuffles with: the same seed, the same deal, on every platform and Go version.
func rng(seed uint64) *rand.Rand {
	return rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
}

// shuffle returns 0..n-1 in an order the seed decides.
func shuffle(seed uint64, n int) []int {
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	r := rng(seed)
	r.Shuffle(n, func(i, j int) { order[i], order[j] = order[j], order[i] })
	return order
}

// view is what every type's view starts with.
type view struct {
	Type  string     `json:"type"`
	Text  string     `json:"text"`
	Image *ImageView `json:"image,omitempty"`
}

func viewOf(h *Head, t *Tail) view {
	return view{Type: h.Type, Text: h.Text, Image: t.Image.view()}
}

// reveal is what every type's reveal ends with: the question's id (for reporting it, once it's answered), the fact
// behind the answer, and the picture's credit.
type reveal struct {
	ID     string       `json:"id"`
	Fact   string       `json:"fact,omitempty"`
	Credit *ImageCredit `json:"credit,omitempty"`
}

func revealOf(h *Head, t *Tail) reveal {
	return reveal{ID: h.ID, Fact: t.Fact, Credit: t.Image.credit()}
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// AnswerText is a question's answer in words, for whoever keeps the bank (the admin page).
func AnswerText(q Question) string {
	switch q := q.(type) {
	case *Choice:
		return q.Answer
	case *Number:
		return strings.TrimSpace(formatNumber(q.Answer, q.Step) + " " + q.Unit)
	case *Order:
		items := make([]string, 0, len(q.Items))
		for _, i := range q.right() {
			items = append(items, fmt.Sprintf("%s (%s)", q.Items[i].Text, formatNumber(q.Items[i].Value, 0.01)))
		}
		return strings.Join(items, " → ")
	}
	return ""
}

// Option is a choice's option by its place in the bank (0 is the answer), for reading the answer log.
func Option(q Question, i int) string {
	if c, ok := q.(*Choice); ok && i >= 0 && i < len(c.options()) {
		return c.options()[i]
	}
	return ""
}
