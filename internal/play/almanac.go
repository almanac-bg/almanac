package play

import (
	"context"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The Алманах is a player's book: a chapter per topic, and „Микс“ (every topic) and „България“ (the questions about
// Bulgaria from every topic) as chapters of their own. A chapter holds the fact behind every question the player has
// answered right, out of all the facts the topic has, and says how much of the topic they know (mastery.go). It's
// part of progress (progress.go): the notes in the book are its milestones, and Профил says how many facts there are.

// Learned is one fact in a player's almanac: the question, its answer, and the fact behind it; when it was learned
// (first answered right), and where: the day's ten (its issue), a chapter's game, a duel. A statement to judge true or
// not has no question: its answer is the statement itself, Untrue if it isn't so (the bank keeps no corrected one).
type Learned struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Question string `json:"question,omitempty"`
	Answer   string `json:"answer"`
	Untrue   bool   `json:"untrue,omitempty"`
	Fact     string `json:"fact"`
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

// Almanac is a page of a player's book (a chapter, or all of it), the latest learned first; how many facts they have,
// by chapter and in all; how many each chapter has in all; and where the next page starts (none after the last). The
// first page has the notes in the book too (NotesOf), the latest first, and each chapter's mastery (Chapters).
type Almanac struct {
	Facts    []Learned      `json:"facts"`
	Have     map[string]int `json:"have"`
	All      int            `json:"all"`
	Of       map[string]int `json:"of"`
	Next     string         `json:"next,omitempty"`
	Notes    []Note         `json:"notes,omitempty"`
	Chapters []Mastery      `json:"chapters,omitempty"`
}

// AlmanacQuery is what a page of the book is asked for: a chapter ("": all of it), where the page before ended (its
// Next; "": from the latest), words to find in its facts (their question, answer or fact), and how many at most.
type AlmanacQuery struct {
	Topic, From, Search string
	Limit               int
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

// learnedAt is where and when a fact was learned: the first right answer to its question.
type learnedAt struct {
	at   int64
	kind string
	day  string
}

// learned calls fn with every question a player has answered right that has a fact (a retired one too: what was
// learned stays, unless it wasn't so: a question retired as wrong or stale, bank.Tail.Untrue), in the order they were
// learned, with when and in what game each was first answered right.
func (g *Game) learned(ctx context.Context, userID int64, fn func(q bank.Question, at learnedAt)) error {
	b := g.Bank()
	// The game's kind and day come from the row of the first right answer (SQLite takes a bare column from the row
	// min() picks).
	rows, err := g.DB.Read.QueryContext(ctx, `SELECT a.question_id, min(a.at), r.kind, coalesce(r.day, '')
		FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ? AND a.is_right GROUP BY a.question_id ORDER BY min(a.at), a.question_id`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var at learnedAt
		if err := rows.Scan(&id, &at.at, &at.kind, &at.day); err != nil {
			return err
		}
		if q, ok := b.Get(id); ok && q.Extra().Fact != "" && !q.Extra().Untrue() {
			fn(q, at)
		}
	}
	return rows.Err()
}

// learnedAs is a learned question as its almanac shows it.
func learnedAs(q bank.Question, at learnedAt) Learned {
	l := Learned{ID: q.Base().ID, Category: q.Base().Category, Question: q.Base().Text, Answer: bank.AnswerText(q),
		Fact: q.Extra().Fact, At: at.at, Kind: at.kind}
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

// AlmanacOf reads a page of a player's book (AlmanacQuery), the latest learned first. Next is when and which fact the
// page ends on, since facts are in that order, so a fact learned meanwhile only comes at the top, and no page after
// it shows one twice.
func (g *Game) AlmanacOf(ctx context.Context, userID int64, aq AlmanacQuery) (Almanac, error) {
	out := Almanac{Facts: []Learned{}, Have: map[string]int{}, Of: factsIn(g.Bank())}
	fromAt, fromID, paged := strings.Cut(aq.From, ":")
	before, err := strconv.ParseInt(fromAt, 10, 64)
	paged = paged && err == nil
	search := []rune(strings.ToLower(strings.TrimSpace(aq.Search)))
	words := strings.Fields(string(search[:min(len(search), AlmanacSearch)]))
	var found []Learned
	err = g.learned(ctx, userID, func(q bank.Question, at learnedAt) {
		category := q.Base().Category
		out.All++
		out.Have[category]++
		out.Have[MixTopic]++
		if q.Extra().BG {
			out.Have[BulgariaTopic]++
		}
		if !inChapter(q, aq.Topic) || paged && (at.at > before || at.at == before && q.Base().ID >= fromID) {
			return
		}
		if l := learnedAs(q, at); len(words) == 0 || hasWords(l, words) {
			found = append(found, l)
		}
	})
	if err != nil {
		return out, err
	}
	// The latest first: learned in that order, read backwards.
	slices.Reverse(found)
	if len(found) > aq.Limit {
		found = found[:aq.Limit]
		last := found[len(found)-1]
		out.Next = strconv.FormatInt(last.At, 10) + ":" + last.ID
	}
	out.Facts = append(out.Facts, found...)
	if aq.From == "" {
		if out.Notes, err = g.NotesOf(ctx, userID); err != nil {
			return out, err
		}
		if out.Chapters, err = g.ChaptersOf(ctx, userID); err != nil {
			return out, err
		}
	}
	return out, nil
}

// ChaptersOf is how much of each chapter of the book a player knows: the bank's topics (MasteryOf), then „Микс“ (over
// every topic: their ability over all of them, against every question) and „България“ (each of its questions known
// as well as its own topic is: no ability of its own, bulgaria.go), both told as soon as the topics are, by all the
// player's answers.
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

// factsOf counts a player's almanac, as Профил and its notes do.
func (g *Game) factsOf(ctx context.Context, userID int64) (facts, error) {
	var f facts
	byTopic := map[string]int{}
	err := g.learned(ctx, userID, func(q bank.Question, _ learnedAt) {
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
