package play

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The Алманах is a player's book: a chapter per topic, and „Микс“ (every topic) and „България“ (the questions about
// Bulgaria from every topic) as pages of their own. A chapter holds the fact behind every question the player has
// answered right, each written in ink or in pencil (ink.go), and says one number, its ink.

// Learned is one fact in a player's almanac: the question, its answer, and the fact behind it; in ink or in pencil
// (ink.go); when it was written, and where: the day's ten (its issue), a chapter's game, a duel. A statement to judge
// true or not has no question: its answer is the statement itself, Untrue if it isn't so (the bank keeps no
// corrected one).
type Learned struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Question string `json:"question,omitempty"`
	Answer   string `json:"answer"`
	Untrue   bool   `json:"untrue,omitempty"`
	Fact     string `json:"fact"`
	Ink      bool   `json:"ink,omitempty"`
	At       int64  `json:"at"`
	// Kind is the game it was learned in ("day", "topic", "duel"), and Issue the day's, for one of the day's ten.
	Kind  string `json:"kind,omitempty"`
	Issue int    `json:"issue,omitempty"`
}

// AlmanacPage is how many facts a page of a chapter shows: a few screens' worth on a phone. A chapter grows to
// hundreds, so it comes a page at a time.
const AlmanacPage = 30

// AlmanacSearch is how long a search of a chapter may be, in letters: a word or a few, never a page of text to match
// against every fact.
const AlmanacSearch = 60

// Almanac is a page of a player's book (a chapter, or all of it), the latest written first; each chapter's ink (Ink:
// the one number a chapter says; pencil is listed, never counted); and where the next page starts (none after the
// last). The first page has the notes in the book too (NotesOf), the latest first, and each chapter's mastery
// (Chapters).
type Almanac struct {
	Facts []Learned `json:"facts"`
	// Found is how many entries the page's chapter (and the search) lists: its pages are Found / AlmanacPage.
	Found    int            `json:"found"`
	Ink      map[string]int `json:"ink"`
	Next     string         `json:"next,omitempty"`
	Notes    []Note         `json:"notes,omitempty"`
	Chapters []Mastery      `json:"chapters,omitempty"`
	// Ranks are each of the bank's chapters' ranks, as kept (rank.go); Seal the one the player wears; Held, whether
	// the guessing check holds their ranks at Страница now. The first page only.
	Ranks []ChapterRank `json:"ranks,omitempty"`
	Seal  *Seal         `json:"seal,omitempty"`
	Held  bool          `json:"held,omitempty"`
	// Since is the day the player's book began: their first game's.
	Since string `json:"since,omitempty"`
}

// AlmanacQuery is what a page of the book is asked for: a chapter ("": all of it), where the page before ended (its
// Next; "": from the latest) or which page it is (Page, from 0: a chapter's pages are numbered), words to find in its
// facts (their question, answer or fact), and how many to a page.
type AlmanacQuery struct {
	Topic, From, Search string
	Page, Limit         int
}

// factsIn is how many facts each chapter has: its live questions with a fact („Микс“ every topic's, „България“ those
// about Bulgaria).
func factsIn(b *bank.Bank) map[string]int {
	of := map[string]int{}
	for _, q := range b.Live("", "") {
		if q.Extra().Fact != "" {
			of[q.Base().Category]++
			of[MixTopic]++
			if q.Extra().BG {
				of[BulgariaTopic]++
			}
		}
	}
	return of
}

// inChapter says whether a question's fact belongs to a chapter.
func inChapter(q bank.Question, topic string) bool {
	switch topic {
	case "", MixTopic:
		return true
	case BulgariaTopic:
		return q.Extra().BG
	}
	return q.Base().Category == topic
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
		Fact: q.Extra().Fact, At: at.at, Kind: at.kind, Ink: ink}
	if at.kind == "day" {
		l.Issue = Issue(at.day)
	}
	if tf, ok := q.(*bank.TrueFalse); ok {
		l.Question, l.Answer, l.Untrue = "", tf.Text, !tf.Answer
	}
	return l
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
	var found []Learned
	err = g.written(ctx, userID, func(q bank.Question, w written) {
		if w.ink {
			countIn(out.Ink, q)
		}
		at := w.at
		if !inChapter(q, aq.Topic) || paged && (at.at > before || at.at == before && q.Base().ID >= fromID) {
			return
		}
		if l := learnedAs(q, at, w.ink); len(words) == 0 || hasWords(l, words) {
			found = append(found, l)
		}
	})
	if err != nil {
		return out, err
	}
	// The latest first: learned in that order, read backwards.
	slices.Reverse(found)
	out.Found = len(found)
	if !paged {
		found = found[min(len(found), max(aq.Page, 0)*aq.Limit):]
	}
	if len(found) > aq.Limit {
		found = found[:aq.Limit]
		last := found[len(found)-1]
		out.Next = strconv.FormatInt(last.At, 10) + ":" + last.ID
	}
	out.Facts = append(out.Facts, found...)
	if aq.From == "" && aq.Page == 0 {
		var since sql.NullInt64
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT min(started_at) FROM runs WHERE user_id = ?`, userID).
			Scan(&since); err != nil {
			return out, err
		}
		if since.Valid {
			out.Since = dayOf(time.UnixMilli(since.Int64))
		}
		if out.Notes, err = g.NotesOf(ctx, userID); err != nil {
			return out, err
		}
		if out.Chapters, err = g.ChaptersOf(ctx, userID); err != nil {
			return out, err
		}
		if out.Ranks, out.Held, err = g.RanksOf(ctx, userID); err != nil {
			return out, err
		}
		var chosen sql.NullString
		if err := g.DB.Read.QueryRowContext(ctx, `SELECT seal FROM users WHERE id = ?`, userID).Scan(&chosen); err != nil &&
			!errors.Is(err, sql.ErrNoRows) {
			return out, err
		}
		out.Seal = sealOf(out.Ranks, chosen.String)
	}
	return out, nil
}

// ChaptersOf is how much of each chapter of the book a player knows: the bank's topics (MasteryOf), then „Микс“ (over
// every topic: their ability over all of them, against every question) and „България“ (each of its questions known
// as well as its own topic is: no ability of its own, bulgaria.go), both told as soon as the topics are, by all the
// player's answers, once one of them is right (one of its own, for „България“).
func (g *Game) ChaptersOf(ctx context.Context, userID int64) ([]Mastery, error) {
	out, err := g.MasteryOf(ctx, userID)
	if err != nil {
		return nil, err
	}
	h, err := g.hardness(ctx)
	if err != nil {
		return nil, err
	}
	topics, all, err := g.abilities(ctx, g.DB.Read, h, userID, 0, false)
	if err != nil {
		return nil, err
	}
	out = append(out, masteryOf(MixTopic, all, h.byTopic[""]))
	sum, n := 0.0, 0
	for _, q := range g.Bank().Live("", "") {
		if !q.Extra().BG {
			continue
		}
		a, ok := topics[q.Base().Category]
		if !ok {
			a = newAbility()
		}
		sum += sigmoid(a.mean - h.of(q))
		n++
	}
	bg := masteryOf(BulgariaTopic, all, nil)
	if topics[BulgariaTopic].rights == 0 {
		bg.Sure, bg.First = false, false // none of its own questions right yet: nothing to tell of it
	}
	if n > 0 {
		bg.Known = int(math.Round(100 * sum / float64(n)))
		t := TierOf(bg.Known)
		bg.Tier, bg.Name, bg.Next, bg.NextAt = t, MasteryTiers[t].Name, "", 0
		if t+1 < len(MasteryTiers) {
			bg.Next, bg.NextAt = MasteryTiers[t+1].Name, MasteryTiers[t+1].From
		}
	}
	return append(out, bg), nil
}

// facts are how many facts a player's almanac has, and the topics it has every fact of (of the topic's live questions:
// a retired question's fact counts in n, never towards a topic's whole), in the bank's order.
type facts struct {
	n     int
	whole []string
}

// factsOf counts a player's almanac, as Профил and its notes do.
func (g *Game) factsOf(ctx context.Context, userID int64) (facts, error) {
	var f facts
	byTopic := map[string]int{}
	err := g.written(ctx, userID, func(q bank.Question, _ written) {
		f.n++
		if !q.Extra().Retired {
			byTopic[q.Base().Category]++
		}
	})
	in := factsIn(g.Bank())
	for _, c := range g.Bank().Categories {
		if n := in[c.ID]; n > 0 && byTopic[c.ID] >= n {
			f.whole = append(f.whole, c.ID)
		}
	}
	return f, err
}
