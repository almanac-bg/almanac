package play

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// Моят Алманах is a player's collection of what they've learned: the fact behind every question they've answered
// right, by topic, out of all the facts the topic has. It's part of progress (progress.go): the facts collected make
// achievements of their own (a hundred, a thousand, five thousand, and every fact of a topic), and Профил says how
// many there are.

// Learned is one fact in a player's almanac: the question, its answer, and the fact behind it; and the day it was
// learned (first answered right, in Bulgaria) with that day's issue (Issue), which head a day's facts. A statement to
// judge true or not has no question: its answer is the statement itself, Untrue if it isn't so (the bank keeps no
// corrected one).
type Learned struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Question string `json:"question,omitempty"`
	Answer   string `json:"answer"`
	Untrue   bool   `json:"untrue,omitempty"`
	Fact     string `json:"fact"`
	At       int64  `json:"at"`
	Day      string `json:"day"`
	Issue    int    `json:"issue,omitempty"`
}

// AlmanacPage is how many facts a page of Моят Алманах shows: a few screens' worth on a phone. The collection grows
// to thousands, so it comes a page at a time, as the player scrolls.
const AlmanacPage = 30

// Almanac is a page of a player's collection (of one topic, or of all), newest first; how many facts they have, by
// topic and in all; how many each topic has in all; and where the next page starts (none after the last).
type Almanac struct {
	Facts []Learned      `json:"facts"`
	Have  map[string]int `json:"have"`
	All   int            `json:"all"`
	Of    map[string]int `json:"of"`
	Next  string         `json:"next,omitempty"`
}

// factsIn is how many facts each topic has: its live questions with a fact.
func factsIn(b *bank.Bank) map[string]int {
	of := map[string]int{}
	for _, q := range b.Live("", "") {
		if q.Extra().Fact != "" {
			of[q.Base().Category]++
		}
	}
	return of
}

// learned calls fn with every question a player has answered right that has a fact (a retired one too: what was
// learned stays, unless it wasn't so: a question retired as wrong or stale, bank.Tail.Untrue), newest first, with when
// it was first answered right.
func (g *Game) learned(ctx context.Context, userID int64, fn func(q bank.Question, at int64)) error {
	b := g.Bank()
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, min(a.at) FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? AND a.is_right GROUP BY a.question_id ORDER BY min(a.at) DESC, a.question_id DESC`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var at int64
		if err := rows.Scan(&id, &at); err != nil {
			return err
		}
		if q, ok := b.Get(id); ok && q.Extra().Fact != "" && !q.Extra().Untrue() {
			fn(q, at)
		}
	}
	return rows.Err()
}

// learnedAs is a learned question as its almanac shows it.
func learnedAs(q bank.Question, at int64) Learned {
	day := time.UnixMilli(at).In(Bulgaria).Format(time.DateOnly)
	l := Learned{ID: q.Base().ID, Category: q.Base().Category, Question: q.Base().Text, Answer: bank.AnswerText(q),
		Fact: q.Extra().Fact, At: at, Day: day, Issue: Issue(day)}
	if tf, ok := q.(*bank.TrueFalse); ok {
		l.Question, l.Answer, l.Untrue = "", tf.Text, !tf.Answer
	}
	return l
}

// AlmanacOf reads a page of a player's collection: up to limit facts of a topic ("": of all), the first after from (the
// Next of the page before; "": from the newest). Next is when and which fact the page ends on, since facts are in that
// order (learned, newest first), so a fact learned meanwhile never moves the next page.
func (g *Game) AlmanacOf(ctx context.Context, userID int64, topic, from string, limit int) (Almanac, error) {
	out := Almanac{Facts: []Learned{}, Have: map[string]int{}, Of: factsIn(g.Bank())}
	fromAt, fromID, paged := strings.Cut(from, ":")
	after, err := strconv.ParseInt(fromAt, 10, 64)
	paged = paged && err == nil
	more := false
	err = g.learned(ctx, userID, func(q bank.Question, at int64) {
		id, category := q.Base().ID, q.Base().Category
		out.All++
		out.Have[category]++
		switch {
		case topic != "" && category != topic, paged && (at > after || at == after && id >= fromID):
		case len(out.Facts) == limit:
			more = true
		default:
			out.Facts = append(out.Facts, learnedAs(q, at))
		}
	})
	if last := len(out.Facts) - 1; more && last >= 0 {
		out.Next = strconv.FormatInt(out.Facts[last].At, 10) + ":" + out.Facts[last].ID
	}
	return out, err
}

// facts are how many facts a player's almanac has, and whether it has every fact of a topic (of the topic's live
// questions: a retired question's fact counts in n, never towards a topic's whole).
type facts struct {
	n     int
	whole bool
}

// learnedIn is how many facts a game (runID) put in the player's almanac: the questions it answered right for the
// first time that have a fact, as the almanac counts them (learned). Its news says so: what a first day earns that only
// goes up.
func (g *Game) learnedIn(ctx context.Context, userID, runID int64) (int, error) {
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id FROM answers a WHERE a.run_id = ?1 AND a.is_right
		AND NOT EXISTS (SELECT 1 FROM answers b JOIN runs r ON r.id = b.run_id WHERE r.user_id = ?2
			AND b.question_id = a.question_id AND b.is_right AND (b.at < a.at OR (b.at = a.at AND b.run_id < a.run_id)))`,
		runID, userID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	b, n := g.Bank(), 0
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		if q, ok := b.Get(id); ok && q.Extra().Fact != "" && !q.Extra().Untrue() {
			n++
		}
	}
	return n, rows.Err()
}

// factsOf counts a player's almanac, as its achievements and Профил do.
func (g *Game) factsOf(ctx context.Context, userID int64) (facts, error) {
	var f facts
	byTopic := map[string]int{}
	err := g.learned(ctx, userID, func(q bank.Question, _ int64) {
		f.n++
		if !q.Extra().Retired {
			byTopic[q.Base().Category]++
		}
	})
	for topic, n := range factsIn(g.Bank()) {
		if byTopic[topic] >= n {
			f.whole = true
		}
	}
	return f, err
}
