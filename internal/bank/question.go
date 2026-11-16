// Package bank holds the game's questions: the types a question can be, the bank on disk, and the checks a bank must
// pass before a server plays it.
//
// Every type lives in its own file (choice.go, number.go, order.go, truefalse.go, match.go, split.go, clues.go) and plugs in through the
// same three steps: it checks itself, deals itself for one play (shuffled, without its answer), and grades what a
// player gave. Adding a type is a new file here and its renderer in the web client; nothing else changes. With the
// answer a deal also shows how players have answered the question so far (crowd.go), in its own order. What a question
// names (subjects.go) keeps a day to one question of a subject, and tells the bank's keepers which subjects come back.
// A batch of new questions goes in whole or not at all (add.go): checked against the bank as it would be first.
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

	// subjects are what the question names as its subject (Subjects), worked out as the bank loads.
	subjects []string
}

// Tail is what every question may end with: a picture, the fact behind the answer, when it was added, changed and
// checked, on what sources, and why it left play if it did.
type Tail struct {
	Image *Image `json:"image,omitempty"`
	// Fact is "Знаеше ли?": something worth knowing behind the answer, shown in the review after a game. Every
	// question added since RulesFrom has one.
	Fact string `json:"fact,omitempty"`
	// Added is when the question joined the bank (YYYY-MM-DD).
	Added string `json:"added,omitempty"`
	// Changed is when what it asks last changed (YYYY-MM-DD): its wording, answer, options, items, pairs, clues or
	// picture, so that players' answers from before then were to another question (crowds and calibration start
	// there). Empty: not since it was added.
	Changed string `json:"changed,omitempty"`
	// Updated is when the question last changed at all (YYYY-MM-DD): Changed, or its fact, labels or dates.
	Updated string `json:"updated,omitempty"`
	// Checked is when it was last checked against its sources, and CheckedBy by what: a process and its model
	// ("new-questions fable-5.2"), or the bank's commit that added or last changed it ("bank 7bb2938": its message
	// and report say how it was checked). An audit of a process finds its questions by it.
	Checked   string `json:"checked,omitempty"`
	CheckedBy string `json:"checkedBy,omitempty"`
	// ReviewBy is when its answer may stop being true (a record, an office holder): checked again by then.
	ReviewBy string `json:"reviewBy,omitempty"`
	// Retired questions are never dealt again, but stay so that history and stats keep their text. RetiredWhy says
	// why (RetiredWhys), ReplacedBy the question that took its place, if one did.
	Retired    bool   `json:"retired,omitempty"`
	RetiredWhy string `json:"retiredWhy,omitempty"`
	ReplacedBy string `json:"replacedBy,omitempty"`
	// On are the days the question belongs to: "MM-DD" every year (3 March, a birthday), or "YYYY-MM-DD" that year
	// only (a moving feast: Великден). On such a day it goes into the day's questions („На този ден“), its fact saying
	// why.
	On []string `json:"on,omitempty"`
	// BG is a question about Bulgaria: its people, places, history, culture, language, sport. Every day has a few.
	BG bool `json:"bg,omitempty"`
	// Sources are the pages the answer and the fact were confirmed on (URLs): what a later check starts from, and
	// where to look first when a source turns out wrong. Never sent to a player. Every question added since
	// SourcesFrom has them.
	Sources []string `json:"sources,omitempty"`
}

// RetiredWhys are the reasons a question leaves play: wrong (its answer or fact was), stale (it stopped being true),
// weak (dull, too easy, unfair or badly made), twin (another question asks the same), giveaway (it gave another's
// answer away, or another gave its), rule (a rule of the bank changed). Wrong and stale ones also leave what players
// have learned (Моят Алманах): what they learned there wasn't so.
var RetiredWhys = []string{"wrong", "stale", "weak", "twin", "giveaway", "rule"}

// Untrue is whether a retired question left play because it wasn't (or stopped being) true.
func (t *Tail) Untrue() bool {
	return t.Retired && (t.RetiredWhy == "wrong" || t.RetiredWhy == "stale")
}

// AskedSince is the day what a question asks last changed: Changed, else Added.
func (t *Tail) AskedSince() string {
	if t.Changed != "" {
		return t.Changed
	}
	return t.Added
}

// OnDay is whether a question belongs to a day (YYYY-MM-DD): its On holds the day, or the day's month and day.
func (t *Tail) OnDay(day string) bool {
	for _, d := range t.On {
		if d == day || (len(d) == 5 && len(day) == 10 && d == day[5:]) {
			return true
		}
	}
	return false
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
	// Reveal is the answer as this deal shows it, with the fact, the picture's credit, and how players have answered
	// the question so far (nil when that isn't known yet).
	Reveal(*Crowd) any
}

// Graded is what an answer was worth.
type Graded struct {
	// Score runs from 0 (wrong) to 1 (perfect). Types with partial credit (a close number, an order half right) land in
	// between, with what luck alone would get taken out (an order or a match put down at random is worth next to
	// nothing); the game turns it into points.
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
// behind the answer, the picture's credit, and how players have answered it.
type reveal struct {
	ID     string       `json:"id"`
	Fact   string       `json:"fact,omitempty"`
	Credit *ImageCredit `json:"credit,omitempty"`
	Crowd  *CrowdView   `json:"crowd,omitempty"`
}

func revealOf(h *Head, t *Tail, c *CrowdView) reveal {
	return reveal{ID: h.ID, Fact: t.Fact, Credit: t.Image.credit(), Crowd: c}
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// AnswerText is a question's answer in words, as players read it (Моят Алманах): numbers written the Bulgarian way,
// with their unit.
func AnswerText(q Question) string {
	switch q := q.(type) {
	case *Choice:
		return q.Answer
	case *Clues:
		return q.Answer
	case *Number:
		return strings.TrimSpace(sayNumber(q.Answer, q.Step) + " " + q.Unit)
	case *Order:
		items := make([]string, 0, len(q.Items))
		for _, i := range q.right() {
			items = append(items, fmt.Sprintf("%s (%s)", q.Items[i].Text, strings.TrimSpace(sayNumber(q.Items[i].Value, 0.01)+" "+q.Unit)))
		}
		return strings.Join(items, " → ")
	case *TrueFalse:
		if q.Answer {
			return "Вярно"
		}
		return "Невярно"
	case *Match:
		pairs := make([]string, 0, len(q.Pairs))
		for _, p := range q.Pairs {
			pairs = append(pairs, p.Left+" — "+p.Right)
		}
		return strings.Join(pairs, "; ")
	case *Split:
		groups := [2][]string{}
		for _, it := range q.Items {
			if it.Group == 0 || it.Group == 1 {
				groups[it.Group] = append(groups[it.Group], it.Text)
			}
		}
		return q.Groups[0] + ": " + strings.Join(groups[0], ", ") + "; " + q.Groups[1] + ": " + strings.Join(groups[1], ", ")
	}
	return ""
}

// KeeperText is the answer as whoever keeps the bank reads it (the admin page): a match's decoy too.
func KeeperText(q Question) string {
	if m, ok := q.(*Match); ok && m.Decoy != "" {
		return AnswerText(q) + "; примамка: " + m.Decoy
	}
	return AnswerText(q)
}

// Option is a choice's option by its place in the bank (0 is the answer), for reading the answer log.
func Option(q Question, i int) string {
	var options []string
	switch q := q.(type) {
	case *Choice:
		options = q.options()
	case *Clues:
		options = q.options()
	}
	if i >= 0 && i < len(options) {
		return options[i]
	}
	return ""
}
