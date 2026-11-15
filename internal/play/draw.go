package play

import (
	"math/rand/v2"
	"slices"
	"strings"

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

// BGFloor is how many of a day's questions are about Bulgaria, at least, where the bank has them.
const BGFloor = 3

// drawDay draws a day (YYYY-MM-DD): each slot from another topic, never a question an earlier day had (while any are
// left), and of those one nobody has answered (`answered`, if set) while any are left. The slots that need something
// special (a picture, an order, a number) get their topics first, from those that have one. The number to finish on
// is an estimate (a unit, more than 20) where one is left: a year or a small count is a choice in disguise. Then the
// day is made the day's: a question that belongs to its date („На този ден“, bank.Tail.On) takes the place it fits,
// and at least BGFloor are about Bulgaria (bank.Tail.BG), each in a place it fits, from that place's topic. Exact is
// whether every slot had a question that fits it just so, never a day's before: a day ahead is drawn only so
// (ahead.go).
func drawDay(b *bank.Bank, day string, used, answered map[string]bool, r *rand.Rand) (picks []Pick, exact bool) {
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
	// A question that belongs to dates waits for one of them.
	allowed := func(q bank.Question) bool {
		t := q.Extra()
		return !taken[q.Base().ID] && (len(t.On) == 0 || t.OnDay(day))
	}
	fresh := func(q bank.Question) bool { return !used[q.Base().ID] }
	unseen := func(q bank.Question) bool { return !answered[q.Base().ID] }
	chosen := make([]bank.Question, len(slots))
	for i, s := range slots {
		prefer := []func(bank.Question) bool{unseen}
		if s.typ == "number" {
			prefer = []func(bank.Question) bool{func(q bank.Question) bool { return estimate(q) && unseen(q) }, estimate, unseen}
		}
		if q := choose(b.Live(assigned[i], ""), s, allowed, fresh, prefer, r); q != nil {
			chosen[i] = q
			taken[q.Base().ID] = true
		}
	}
	put := func(i int, q bank.Question) {
		delete(taken, chosen[i].Base().ID)
		chosen[i], assigned[i] = q, q.Base().Category
		taken[q.Base().ID] = true
	}
	// place puts q in a place it fits just so, keeping the day's topics one each: its own topic's place, or another
	// whose topic then takes q's topic's place (with a question of its own that fits that place just so). It says
	// which place, or -1.
	place := func(q bank.Question) int {
		cat := q.Base().Category
		for i, s := range slots {
			if chosen[i] != nil && assigned[i] == cat && matches(q, s, true, true) {
				put(i, q)
				return i
			}
		}
		for i, s := range slots {
			if chosen[i] == nil || !matches(q, s, true, true) {
				continue
			}
			j := slices.Index(assigned, cat)
			if j < 0 {
				put(i, q)
				return i
			}
			var swap bank.Question
			for _, o := range b.Live(assigned[i], "") {
				if o != chosen[i] && fresh(o) && allowed(o) && matches(o, slots[j], true, true) {
					swap = o
					break
				}
			}
			if swap != nil && chosen[j] != nil {
				put(j, swap)
				put(i, q)
				return i
			}
		}
		return -1
	}
	candidates := func(want func(bank.Question) bool) []bank.Question {
		var out []bank.Question
		for _, q := range b.Live("", "") {
			if want(q) && fresh(q) && allowed(q) {
				out = append(out, q)
			}
		}
		r.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
		slices.SortStableFunc(out, func(x, y bank.Question) int { return b2i(!unseen(x)) - b2i(!unseen(y)) })
		return out
	}
	kept := map[int]bool{}
	for _, q := range candidates(func(q bank.Question) bool { return q.Extra().OnDay(day) }) {
		if i := place(q); i >= 0 {
			kept[i] = true
			break
		}
	}
	bg := 0
	for _, q := range chosen {
		if q != nil && q.Extra().BG {
			bg++
		}
	}
	for _, i := range r.Perm(len(slots)) {
		if bg >= BGFloor {
			break
		}
		if kept[i] || chosen[i] == nil || chosen[i].Extra().BG {
			continue
		}
		s, topic := slots[i], assigned[i]
		for _, q := range candidates(func(q bank.Question) bool {
			return q.Extra().BG && q.Base().Category == topic && matches(q, s, true, true)
		}) {
			put(i, q)
			bg++
			break
		}
	}
	exact = true
	for i, q := range chosen {
		if q == nil {
			exact = false
			continue
		}
		exact = exact && fresh(q) && matches(q, slots[i], true, true)
		picks = append(picks, Pick{ID: q.Base().ID, Seed: r.Uint64()})
	}
	return picks, exact && len(picks) == len(slots)
}

// estimate is a number question worth closing a day on: a quantity with a unit, more than 20 — not a year (no unit)
// nor a small count, which are choices in disguise.
func estimate(q bank.Question) bool {
	n, ok := q.(*bank.Number)
	return ok && n.Unit != "" && n.Answer > 20
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
// gets — the type kept longest, then the difficulty — and a fresh one before one that isn't; of those, the first of
// prefer's wishes that any of them meets.
func choose(pool []bank.Question, s slot, allowed, fresh func(bank.Question) bool, prefer []func(bank.Question) bool, r *rand.Rand) bank.Question {
	if s.alt != "" && !slices.ContainsFunc(pool, func(q bank.Question) bool { return q.Base().Type == s.typ && allowed(q) }) {
		s.typ = s.alt
	}
	fits := []func(bank.Question) bool{
		func(q bank.Question) bool { return matches(q, s, true, true) },
	}
	// A picture is the point of a slot that asks for one, more than its difficulty: the nearest difficulty with a
	// picture comes before the same difficulty without.
	if s.picture == withPicture {
		for _, d := range nearest(s.difficulty) {
			fits = append(fits, func(q bank.Question) bool { return matches(q, slot{d, s.typ, s.picture, ""}, true, true) })
		}
	}
	fits = append(fits,
		func(q bank.Question) bool { return matches(q, s, true, false) },
		func(q bank.Question) bool { return q.Base().Type == s.typ },
		func(q bank.Question) bool { return q.Base().Difficulty == s.difficulty },
		func(bank.Question) bool { return true },
	)
	for _, needFresh := range []bool{true, false} {
		for _, fit := range fits {
			var found []bank.Question
			for _, q := range pool {
				if allowed(q) && fit(q) && (!needFresh || fresh(q)) {
					found = append(found, q)
				}
			}
			for _, wish := range prefer {
				if best := slices.DeleteFunc(slices.Clone(found), func(q bank.Question) bool { return !wish(q) }); len(best) > 0 {
					found = best
					break
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
// who knows as much as most), questions they haven't seen (seen) before those they have, and never one barred (the
// day's: DayQuestions). Choices come with a picture or without, whichever is drawn. Everyone's run has the same
// shape. Topic runs and duels draw this way (a room, DrawRoom).
func Draw(b *bank.Bank, category string, ability float64, seen, barred map[string]bool, r *rand.Rand) []Pick {
	pool := b.Live(category, "")
	taken := map[string]bool{}
	allowed := func(q bank.Question) bool { return !taken[q.Base().ID] && !barred[q.Base().ID] }
	fresh := func(q bank.Question) bool { return !seen[q.Base().ID] }
	var picks []Pick
	for _, s := range newKind(topicSlots(ability), r) {
		if q := choose(pool, s, allowed, fresh, nil, r); q != nil {
			taken[q.Base().ID] = true
			picks = append(picks, Pick{ID: q.Base().ID, Seed: r.Uint64()})
		}
	}
	return picks
}

// nearest are the other difficulties, nearest first (easy: medium, then hard).
func nearest(d bank.Difficulty) []bank.Difficulty {
	switch d {
	case bank.Easy:
		return []bank.Difficulty{bank.Medium, bank.Hard}
	case bank.Hard:
		return []bank.Difficulty{bank.Medium, bank.Easy}
	}
	return []bank.Difficulty{bank.Easy, bank.Hard}
}

// Runway is how many days of the day's questions a bank holds for one place of a day: questions that fit it just so
// and no day has had yet (one a day; a place the day has twice, half). The bank grows where the runway is shortest
// (the questions skill): the day spends hard numbers three times faster than easy choices.
type Runway struct {
	Place string
	Days  int
}

// DayRunway is the runway of each place of a day, in the day's order (the place the new kinds share counts both).
// used are the questions days have had (nil: count the whole bank, as `bank check` does with no database).
func DayRunway(b *bank.Bank, used map[string]bool) []Runway {
	var out []Runway
	seen := map[slot]bool{}
	for _, s := range daySlots {
		if seen[s] {
			continue
		}
		seen[s] = true
		times := 0
		for _, o := range daySlots {
			if o == s {
				times++
			}
		}
		kinds := []string{s.typ}
		if s.typ == newKinds[0] {
			kinds = newKinds
		}
		n := 0
		for _, k := range kinds {
			for _, q := range b.Live("", k) {
				if !used[q.Base().ID] && matches(q, slot{s.difficulty, k, s.picture, ""}, true, true) {
					n++
				}
			}
		}
		place := string(s.difficulty) + " " + strings.Join(kinds, "/")
		if s.picture == withPicture {
			place += " with a picture"
		}
		out = append(out, Runway{Place: place, Days: n / times})
	}
	return out
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}
