// Package bank holds the game's questions: the types a question can be, the bank on disk, and the checks a bank must
// pass before a server plays it. Its questions are filed by category, one file each: a category is a chapter, and
// „category“ is the bank's word for it alone (the game's, the API's and the client's is „chapter“).
//
// Every type lives in its own file (choice.go, number.go, order.go, truefalse.go, match.go, split.go, clues.go) and plugs in through the
// same three steps: it checks itself, deals itself for one play (shuffled, without its answer), and grades what a
// player gave; and it writes out what it asks, field by field, which its versions are told apart by (version.go).
// Adding a type is a new file here, a version of it pinned (TestPinnedVersions), and its renderer in the web client;
// nothing else changes. With the
// answer a deal also shows how players have answered the question so far (crowd.go), in its own order. What a question
// names (subjects.go) keeps a day to one question of a subject, and tells the bank's keepers which subjects come back.
// A batch goes in whole or not at all (add.go): its new questions, its changes to questions the bank has, and its
// retirements, checked against the bank as it would be first. A server plays a copy of a bank (keep.go), and knows
// which commit of the bank's repository it is.
//
// Besides its format (check.go), a loaded bank is held to every rule of the questions skill a program can judge
// (rules.go): how lines end and are typed (wording.go), the options (options.go), numbers as estimates with one
// tolerance formula (number.go) that count no list, judge an offset scale and show no number near the answer
// (estimate.go), orders' gaps (order.go), and give-aways and twins from one question to another (giveaway.go, on the
// word stems of text.go), near-duplicates that ask one fact in other words (near.go). Errors for questions added
// since StrictFrom, warnings for older ones, waivers for the true exceptions. Each chapter's themes (themes.go), with
// the share of it each aims for, are what a batch is planned by: every question names its own, and the draw never
// reads them.
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

	// subjects are what the question names as its subject (Subjects), and version which version of it this is
	// (Version), worked out as the bank loads.
	subjects []string
	version  string
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
	// only (a moving feast: Великден). On such a day it goes into the day's questions („На този ден“), its Day saying
	// why.
	On []string `json:"on,omitempty"`
	// Day is the line of a question that belongs to days (On): what happened on that day, naming it („На 16 декември
	// 1982 г. умира Колин Чапман.“). It shows with the answer (it could give the answer away before), and only when the
	// question is dealt on its day as „На този ден“ (RevealOn), so that the fact is free to say something else.
	Day string `json:"day,omitempty"`
	// BG is a question about Bulgaria: its people, places, history, culture, language, sport. Every day has a few.
	BG bool `json:"bg,omitempty"`
	// Theme is the one of its chapter's themes (themes.go: the bank's ThemesFile) it is mainly about: what a batch is
	// planned by, never what the draw reads. Every question added since ThemesFrom names one.
	Theme string `json:"theme,omitempty"`
	// Sources are the pages the answer and the fact were confirmed on (URLs): what a later check starts from, and
	// where to look first when a source turns out wrong. Never sent to a player. Every question added since
	// SourcesFrom has them.
	Sources []string `json:"sources,omitempty"`
}

// RetiredWhys are the reasons a question leaves play: wrong (its answer or fact was), stale (it stopped being true),
// weak (dull, too easy, unfair or badly made), twin (another question asks the same), giveaway (it gave another's
// answer away, or another gave its), rule (a rule of the bank changed). Wrong and stale ones also leave what players
// have learned (their Алманах): what they learned there wasn't so.
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
	// asked is what the question asks besides its type, text and picture, field by field, as its Version hashes it
	// (version.go): its answer, options, items, pairs, clues, groups; each picture as its file.
	asked() map[string]any
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
	// Score runs from 0 (wrong) to 1 (perfect). Types with partial credit (a close number) land in between, with what
	// luck alone would get taken out; an order is 1 or 0, right or not. The game counts only Right in a score; a score
	// short of right but above nothing is „близо“.
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
// behind the answer, the line of its day (dealt on it: RevealOn), the picture's credit, and how players have answered
// it. Each type's reveal is a pointer to a struct that embeds it, so that RevealOn can add the day's line.
type reveal struct {
	ID     string       `json:"id"`
	Day    string       `json:"day,omitempty"`
	Fact   string       `json:"fact,omitempty"`
	Credit *ImageCredit `json:"credit,omitempty"`
	Crowd  *CrowdView   `json:"crowd,omitempty"`
}

func revealOf(h *Head, t *Tail, c *CrowdView) reveal {
	return reveal{ID: h.ID, Fact: t.Fact, Credit: t.Image.credit(), Crowd: c}
}

func (r *reveal) shared() *reveal { return r }

// RevealOn is a deal's reveal in the day's questions of day (YYYY-MM-DD; "" for any other game): with the line of its
// day (Tail.Day) when the question belongs to that day („На този ден“), as Reveal without it otherwise.
func RevealOn(d Dealt, c *Crowd, day string) any {
	out := d.Reveal(c)
	if t := d.Question().Extra(); day != "" && t.OnDay(day) {
		if r, ok := out.(interface{ shared() *reveal }); ok {
			r.shared().Day = t.Day
		}
	}
	return out
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// AnswerText is a question's answer in words, as players read it (the Алманах): numbers written the Bulgarian way,
// with their unit; an answer of parts (AnswerLines) on one line.
func AnswerText(q Question) string {
	switch q := q.(type) {
	case *Choice:
		return q.Answer
	case *Clues:
		return q.Answer
	case *Number:
		return strings.TrimSpace(sayNumber(q.Answer, q.Step) + " " + q.Unit)
	case *Order:
		return strings.Join(AnswerLines(q), " → ")
	case *TrueFalse:
		if q.Answer {
			return "Вярно"
		}
		return "Невярно"
	case *Match, *Split:
		return strings.Join(AnswerLines(q), "; ")
	}
	return ""
}

// AnswerLines is an answer of parts, a line each, as an entry of the book lists it under a short headword: an
// order's items in their right order, each with its value; a match's pairs; a split's two groups, each with its items.
// Nil for an answer of one word or number.
func AnswerLines(q Question) []string {
	switch q := q.(type) {
	case *Order:
		items := make([]string, 0, len(q.Items))
		for _, i := range q.right() {
			items = append(items, fmt.Sprintf("%s (%s)", q.Items[i].Text, strings.TrimSpace(sayNumber(q.Items[i].Value, 0.01)+" "+q.Unit)))
		}
		return items
	case *Match:
		pairs := make([]string, 0, len(q.Pairs))
		for _, p := range q.Pairs {
			pairs = append(pairs, p.Left+" — "+p.Right)
		}
		return pairs
	case *Split:
		groups := [2][]string{}
		for _, it := range q.Items {
			if it.Group == 0 || it.Group == 1 {
				groups[it.Group] = append(groups[it.Group], it.Text)
			}
		}
		return []string{q.Groups[0] + ": " + strings.Join(groups[0], ", "), q.Groups[1] + ": " + strings.Join(groups[1], ", ")}
	}
	return nil
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
