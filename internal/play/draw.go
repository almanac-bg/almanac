package play

import (
	"math/rand/v2"
	"slices"

	"github.com/almanac-bg/almanac/internal/bank"
)

// slot is what a place in a run asks for: a difficulty, a type, and a picture or not. A slot for a kind still new to
// the bank (alt set) takes alt instead where the pool has none of its own.
type slot struct {
	difficulty bank.Difficulty
	typ        string
	picture    picture
	alt        string
}

type picture int8

const (
	eitherWay picture = iota
	withPicture
	noPicture
)

// daySlots is the day's shape: one question from each topic, easy to hard; a picture and a true-or-not early, an
// order, a split and a match in the middle, and a number to finish on (closest wins). A slot whose type a topic lacks
// takes a choice instead (choose).
var daySlots = []slot{
	{bank.Easy, "choice", noPicture, ""},
	{bank.Easy, "choice", withPicture, ""},
	{bank.Easy, "truefalse", noPicture, ""},
	{bank.Medium, "choice", noPicture, ""},
	{bank.Medium, "order", noPicture, ""},
	{bank.Medium, "split", noPicture, "choice"},
	{bank.Medium, "match", noPicture, ""},
	{bank.Hard, "choice", noPicture, ""},
	{bank.Hard, "choice", noPicture, ""},
	{bank.Hard, "number", noPicture, ""},
}

// drawDay draws a day: each slot from another topic, never a question an earlier day had (while any are left). The
// slots that need something special (a picture, an order, a number) get their topics first, from those that have one.
func drawDay(b *bank.Bank, used map[string]bool, r *rand.Rand) []Pick {
	slots := newKind(slices.Clone(daySlots), r)
	var topics []string
	next := func(wants ...func(string) bool) string {
		if len(topics) == 0 { // more slots than topics: round again
			for _, c := range b.Categories {
				topics = append(topics, c.ID)
			}
			r.Shuffle(len(topics), func(i, j int) { topics[i], topics[j] = topics[j], topics[i] })
		}
		i := -1
		for _, want := range wants {
			if i = slices.IndexFunc(topics, want); i >= 0 {
				break
			}
		}
		i = max(i, 0)
		t := topics[i]
		topics = slices.Delete(topics, i, i+1)
		return t
	}
	special := func(s slot) bool { return s.typ != "choice" || s.picture == withPicture }
	assigned := make([]string, len(slots))
	for pass := range 2 {
		for i, s := range slots {
			if special(s) != (pass == 0) {
				continue
			}
			has := func(fit func(bank.Question) bool) func(string) bool {
				return func(topic string) bool {
					return slices.ContainsFunc(b.Live(topic, s.typ), func(q bank.Question) bool { return !used[q.Base().ID] && fit(q) })
				}
			}
			assigned[i] = next(
				has(func(q bank.Question) bool { return matches(q, s, true, true) }),
				has(func(q bank.Question) bool {
					return matches(q, slot{q.Base().Difficulty, s.typ, s.picture, ""}, true, true)
				}),
			)
		}
	}
	taken := map[string]bool{}
	allowed := func(q bank.Question) bool { return !taken[q.Base().ID] }
	fresh := func(q bank.Question) bool { return !used[q.Base().ID] }
	var picks []Pick
	for i, s := range slots {
		if q := choose(b.Live(assigned[i], ""), s, allowed, fresh, r); q != nil {
			taken[q.Base().ID] = true
			picks = append(picks, Pick{ID: q.Base().ID, Seed: r.Uint64()})
		}
	}
	return picks
}

// newKinds are the kinds that take turns at the run's one slot for them ("split" in a run's shape): one or the other
// in each run.
var newKinds = []string{"split", "clues"}

// newKind gives a run's slot for the new kinds one of them, at random.
func newKind(slots []slot, r *rand.Rand) []slot {
	for i := range slots {
		if slots[i].typ == newKinds[0] {
			slots[i].typ = newKinds[r.IntN(len(newKinds))]
		}
	}
	return slots
}

// choose picks an allowed question for a slot from pool: one that fits the slot exactly if it can, else as close as it
// gets — the type kept longest, then the difficulty — and a fresh one before one that isn't.
func choose(pool []bank.Question, s slot, allowed, fresh func(bank.Question) bool, r *rand.Rand) bank.Question {
	if s.alt != "" && !slices.ContainsFunc(pool, func(q bank.Question) bool { return q.Base().Type == s.typ && allowed(q) }) {
		s.typ = s.alt
	}
	fits := []func(bank.Question) bool{
		func(q bank.Question) bool { return matches(q, s, true, true) },
		func(q bank.Question) bool { return matches(q, s, true, false) },
		func(q bank.Question) bool { return q.Base().Type == s.typ },
		func(q bank.Question) bool { return q.Base().Difficulty == s.difficulty },
		func(bank.Question) bool { return true },
	}
	for _, needFresh := range []bool{true, false} {
		for _, fit := range fits {
			var found []bank.Question
			for _, q := range pool {
				if allowed(q) && fit(q) && (!needFresh || fresh(q)) {
					found = append(found, q)
				}
			}
			if len(found) > 0 {
				return found[r.IntN(len(found))]
			}
		}
	}
	return nil
}

// matches says whether q fits a slot: its difficulty, its type, and (if pictures) its picture.
func matches(q bank.Question, s slot, typ, pictures bool) bool {
	h := q.Base()
	if h.Difficulty != s.difficulty || (typ && h.Type != s.typ) {
		return false
	}
	has := bank.HasPictures(q)
	return !pictures || s.picture == eitherWay || has == (s.picture == withPicture)
}

// Draw draws ten questions of a topic ("" for all topics) for a player of an ability there (mastery.go; 0 for one
// who knows as much as most), questions they haven't seen (seen) before those they have. Choices come with a picture or without, whichever is
// drawn. Everyone's run has the same shape. Topic runs, duels and rooms draw this way.
func Draw(b *bank.Bank, category string, ability float64, seen map[string]bool, r *rand.Rand) []Pick {
	pool := b.Live(category, "")
	taken := map[string]bool{}
	allowed := func(q bank.Question) bool { return !taken[q.Base().ID] }
	fresh := func(q bank.Question) bool { return !seen[q.Base().ID] }
	var picks []Pick
	for _, s := range newKind(topicSlots(ability), r) {
		if q := choose(pool, s, allowed, fresh, r); q != nil {
			taken[q.Base().ID] = true
			picks = append(picks, Pick{ID: q.Base().ID, Seed: r.Uint64()})
		}
	}
	return picks
}
