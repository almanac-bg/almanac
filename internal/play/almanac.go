package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The Алманах is a player's book: a chapter per topic. A game across topics (a duel's, or one of every topic kept from
// before) has its facts in their own topics' chapters, never one list of them all. A chapter holds the fact behind every question the player has
// met, in ink where it was a right answer in the issue the first time they met it, else in grey (ink.go), and says one
// number, its ink.

// Learned is one fact in a player's almanac: the question (its picture too), its answer, and the fact behind it; in
// ink or in grey (ink.go); when it was written, and where: the day's ten (its issue), a chapter's game, a duel. A
// statement to judge true or not has no question: its answer is the statement itself, Untrue if it isn't so (the bank
// keeps no corrected one).
type Learned struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Question string `json:"question,omitempty"`
	Answer   string `json:"answer"`
	// Lines is an answer of parts (an order, the three its game dealt; a match, a split: bank.DealtAnswer), a line
	// each: the entry lists them under a short headword rather than set the whole answer as one.
	Lines  []string `json:"lines,omitempty"`
	Untrue bool     `json:"untrue,omitempty"`
	Fact   string   `json:"fact"`
	Ink    bool     `json:"ink,omitempty"`
	At     int64    `json:"at"`
	// Kind is the game it was learned in ("day", "topic", "duel"), and Issue the day's, for one of the day's ten.
	Kind  string `json:"kind,omitempty"`
	Issue int    `json:"issue,omitempty"`
	// Image is a picture question's picture (bank.Picture: a choice of pictures', its answer's), as the play screen
	// has it, and Credit whose it is: without it „Кой е този остров?“ says nothing in the book.
	Image  *bank.ImageView   `json:"image,omitempty"`
	Credit *bank.ImageCredit `json:"credit,omitempty"`
}

// AlmanacPage is how many facts a page of a chapter shows: a few screens' worth on a phone. A chapter grows to
// hundreds, so it comes a page at a time.
const AlmanacPage = 30

// AlmanacSearch is how long a search of a chapter may be, in letters: a word or a few, never a page of text to match
// against every fact.
const AlmanacSearch = 60

// Almanac is a page of a player's book (a chapter, or all of it), the latest written first; each chapter's ink (Ink:
// the one number a chapter says; grey is listed, never counted); and where the next page starts (none after the
// last). The first page has each chapter's rank too.
type Almanac struct {
	Facts []Learned `json:"facts"`
	// Found is how many entries the page's chapter (and the search) lists: its pages are Found / AlmanacPage.
	Found int            `json:"found"`
	Ink   map[string]int `json:"ink"`
	Next  string         `json:"next,omitempty"`
	// Page is which page of the chapter this is, from 0: the one asked for, or the one that holds the fact asked for
	// (AlmanacQuery.Fact).
	Page int `json:"page,omitempty"`
	// Ranks are each of the bank's chapters' seals, as kept (rank.go). The first page only.
	Ranks []ChapterRank `json:"ranks,omitempty"`
	// Since is the day the player's book began: their first game's.
	Since string `json:"since,omitempty"`
}

// AlmanacQuery is what a page of the book is asked for: a chapter ("": all of it), where the page before ended (its
// Next; "": from the latest) or which page it is (Page, from 0: a chapter's pages are numbered), words to find in its
// facts (their question, answer or fact), and how many to a page. Fact asks for the page that holds one fact (its
// question's id), whichever it is, in Page's place (the first, if the chapter hasn't it): the day's result links to
// the facts the day wrote, which a few games since may have moved off the first page.
type AlmanacQuery struct {
	Topic, From, Search, Fact string
	Page, Limit               int
}

// inChapter says whether a question's fact belongs to a chapter (its topic; "", the book as a whole: what its head
// counts).
func inChapter(q bank.Question, topic string) bool {
	return topic == "" || q.Base().Category == topic
}

// learnedAt is where and when a fact was written: the right answer that wrote it (ink.go).
type learnedAt struct {
	at   int64
	kind string
	day  string
}

// learnedAs is a written question as its almanac shows it.
func learnedAs(q bank.Question, at learnedAt, ink bool) Learned {
	l := Learned{ID: q.Base().ID, Category: q.Base().Category, Question: q.Base().Text, Answer: bank.AnswerText(q),
		Lines: bank.AnswerLines(q), Fact: q.Extra().Fact, At: at.at, Kind: at.kind, Ink: ink}
	l.Image, l.Credit = bank.Picture(q)
	if at.kind == "day" {
		l.Issue = Issue(at.day)
	}
	if tf, ok := q.(*bank.TrueFalse); ok {
		l.Question, l.Answer, l.Untrue = "", tf.Text, !tf.Answer
	}
	return l
}

// entry is a fact as a page of the book has it (l), its question, and the game that wrote it (run: 0 if it's gone).
type entry struct {
	l   Learned
	q   bank.Question
	run int64
}

// asDealt sets each order's entry to the items its game dealt it, in their right order (bank.DealtAnswer): an order is
// dealt three of its four (bank.Order.Deal), and the book lists the three the player put in order. One whose game is
// gone lists the bank's four.
func (g *Game) asDealt(ctx context.Context, entries []entry) error {
	byRun := map[int64][]int{}
	for i, e := range entries {
		if _, ok := e.q.(*bank.Order); ok && e.run != 0 {
			byRun[e.run] = append(byRun[e.run], i)
		}
	}
	if len(byRun) == 0 {
		return nil
	}
	ids, err := json.Marshal(slices.Collect(maps.Keys(byRun)))
	if err != nil {
		return err
	}
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT id, questions FROM runs WHERE id IN (SELECT value FROM json_each(?))`,
		string(ids))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var raw string
		var picks []Pick
		if err := rows.Scan(&id, &raw); err != nil {
			return err
		}
		if json.Unmarshal([]byte(raw), &picks) != nil {
			continue
		}
		for _, i := range byRun[id] {
			e := &entries[i]
			if k := slices.IndexFunc(picks, func(p Pick) bool { return p.ID == e.q.Base().ID }); k >= 0 {
				e.l.Answer, e.l.Lines = bank.DealtAnswer(e.q.Deal(picks[k].Seed))
			}
		}
	}
	return rows.Err()
}

// hasWords says whether a fact has every word of a search in it (its question, answer or fact), as the player wrote
// them or not: Bulgarian needs no more than lower case.
func hasWords(l Learned, words []string) bool {
	text := strings.ToLower(l.Question + " " + l.Answer + " " + l.Fact)
	for _, w := range words {
		if !strings.Contains(text, w) {
			return false
		}
	}
	return true
}

// AlmanacOf reads a page of a player's book (AlmanacQuery), the latest written first. Next is when and which fact the
// page ends on, since facts are in that order, so a fact written meanwhile only comes at the top, and no page after
// it shows one twice.
func (g *Game) AlmanacOf(ctx context.Context, userID int64, aq AlmanacQuery) (Almanac, error) {
	out := Almanac{Facts: []Learned{}, Ink: map[string]int{}}
	fromAt, fromID, paged := strings.Cut(aq.From, ":")
	before, err := strconv.ParseInt(fromAt, 10, 64)
	paged = paged && err == nil
	search := []rune(strings.ToLower(strings.TrimSpace(aq.Search)))
	words := strings.Fields(string(search[:min(len(search), AlmanacSearch)]))
	var found []entry
	err = g.written(ctx, userID, func(q bank.Question, w written) {
		if w.ink {
			countIn(out.Ink, q)
		}
		at := w.at
		if !inChapter(q, aq.Topic) || paged && (at.at > before || at.at == before && q.Base().ID >= fromID) {
			return
		}
		found = append(found, entry{learnedAs(q, at, w.ink), q, w.run})
	})
	if err != nil {
		return out, err
	}
	// A search reads each entry's answer as its game dealt it: all of them, before the page is cut.
	if len(words) > 0 {
		if err := g.asDealt(ctx, found); err != nil {
			return out, err
		}
		found = slices.DeleteFunc(found, func(e entry) bool { return !hasWords(e.l, words) })
	}
	// The latest first: learned in that order, read backwards.
	slices.Reverse(found)
	out.Found = len(found)
	if aq.Fact != "" && !paged && aq.Limit > 0 {
		aq.Page = max(0, slices.IndexFunc(found, func(e entry) bool { return e.l.ID == aq.Fact })) / aq.Limit
	}
	out.Page = max(aq.Page, 0)
	if !paged {
		found = found[min(len(found), max(aq.Page, 0)*aq.Limit):]
	}
	if len(found) > aq.Limit {
		found = found[:aq.Limit]
		last := found[len(found)-1].l
		out.Next = strconv.FormatInt(last.At, 10) + ":" + last.ID
	}
	if len(words) == 0 {
		if err := g.asDealt(ctx, found); err != nil {
			return out, err
		}
	}
	for _, e := range found {
		out.Facts = append(out.Facts, e.l)
	}
	if aq.From == "" && aq.Page == 0 {
		var since sql.NullInt64
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT min(started_at) FROM runs WHERE user_id = ?`, userID).
			Scan(&since); err != nil {
			return out, err
		}
		if since.Valid {
			out.Since = dayOf(time.UnixMilli(since.Int64))
		}
		if out.Ranks, err = g.RanksOf(ctx, userID); err != nil {
			return out, err
		}
	}
	return out, nil
}
