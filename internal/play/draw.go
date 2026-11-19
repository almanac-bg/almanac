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

// daySlots is the day's shape: one question from each topic, easy to hard; a picture and a true-or-not among the easy
// ones, an order, a split and a match among the medium ones, and a number among the hard ones. Where each sits in its
// band is drawn with the day (inBands), the same for everyone who plays it, so that the days don't all have one shape.
// A slot whose type a topic lacks takes a choice instead (choose).
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
// left), never one due for review by the day (overdue), and of those one nobody has answered (`answered`, if set) while
// any are left. The slots that need something special (a picture, an order, a number) get their topics first, from
// those that have one; the number's from those that have an estimate (a unit, more than 20) while any do, for the
// day's hardest stretch has one: a year or a small count is a choice in disguise. Then the day is made the day's: a question that
// belongs to its date („На този ден“, bank.Tail.On) takes the place it fits, and at least BGFloor are about Bulgaria
// (bank.Tail.BG), each in a place it fits, from that place's topic (an estimate's place only by another estimate).
// Throughout, a day names each subject once: no two of its questions share an answer or a quoted title
// (bank.Subjects), so that nobody meets „Титаник“ twice in one day's ten. Short names the places (Runway.Place) that
// had no question fitting them just so, never a day's before (the number's: an estimate, or the date's own question):
// a day ahead is drawn only with none short (ahead.go).
func drawDay(b *bank.Bank, day string, used, answered map[string]bool, r *rand.Rand) (picks []Pick, short []string) {
	slots := inBands(newKind(slices.Clone(daySlots), r), r)
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
	// A question dealable on the day: not due for review, and not another date's.
	dealable := func(q bank.Question) bool {
		t := q.Extra()
		return !overdue(q, day) && (len(t.On) == 0 || t.OnDay(day))
	}
	// What each slot wants of a topic, best first: a question that fits it just so (fitsPlace: the number an estimate),
	// then (the number) any of its difficulty, then any of its type.
	wants := make([][]func(string) bool, len(slots))
	for i, s := range slots {
		has := func(fit func(bank.Question) bool) func(string) bool {
			return func(topic string) bool {
				return slices.ContainsFunc(b.Live(topic, s.typ), func(q bank.Question) bool {
					return !used[q.Base().ID] && dealable(q) && fit(q)
				})
			}
		}
		wants[i] = append(wants[i], has(func(q bank.Question) bool { return fitsPlace(q, s, s.typ) }))
		if s.typ == "number" {
			wants[i] = append(wants[i], has(func(q bank.Question) bool { return matches(q, s, true, true) }))
		}
		wants[i] = append(wants[i], has(func(q bank.Question) bool {
			return matches(q, slot{q.Base().Difficulty, s.typ, s.picture, ""}, true, true)
		}))
	}
	// The special slots choose first, the one with the fewest topics to choose from first (the day's order on a tie),
	// so that a topic one of them can't do without isn't spent on another.
	var order, rest []int
	choices := make([]int, len(slots))
	for i, s := range slots {
		if !special(s) {
			rest = append(rest, i)
			continue
		}
		order = append(order, i)
		for _, c := range b.Categories {
			choices[i] += b2i(wants[i][0](c.ID))
		}
	}
	slices.SortStableFunc(order, func(x, y int) int { return choices[x] - choices[y] })
	assigned := make([]string, len(slots))
	for _, i := range append(order, rest...) {
		assigned[i] = next(wants[i]...)
	}
	taken := map[string]bool{}
	named := map[string]int{} // the subjects the day's questions name, each by how many of them
	name := func(q bank.Question, n int) {
		for _, k := range bank.Subjects(q) {
			named[k] += n
		}
	}
	// clash is whether q names a subject the day has, but for the subjects of the questions it would replace.
	clash := func(q bank.Question, replacing ...bank.Question) bool {
		for _, k := range bank.Subjects(q) {
			n := named[k]
			for _, o := range replacing {
				if o != nil && slices.Contains(bank.Subjects(o), k) {
					n--
				}
			}
			if n > 0 {
				return true
			}
		}
		return false
	}
	// A question that belongs to dates waits for one of them.
	free := func(q bank.Question) bool { return !taken[q.Base().ID] && dealable(q) }
	allowed := func(q bank.Question) bool { return free(q) && !clash(q) }
	fresh := func(q bank.Question) bool { return !used[q.Base().ID] }
	unseen := func(q bank.Question) bool { return !answered[q.Base().ID] }
	// candidates are the fresh questions free for the day that want takes, those nobody has answered first.
	candidates := func(want func(bank.Question) bool) []bank.Question {
		var out []bank.Question
		for _, q := range b.Live("", "") {
			if want(q) && fresh(q) && free(q) {
				out = append(out, q)
			}
		}
		r.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
		slices.SortStableFunc(out, func(x, y bank.Question) int { return b2i(!unseen(x)) - b2i(!unseen(y)) })
		return out
	}
	// The questions of the day's date come first: their subjects are kept for them while the places are filled, so that
	// whichever takes its place, no other question of the day names its subject.
	dated := candidates(func(q bank.Question) bool { return q.Extra().OnDay(day) })
	// One of this year's date only (Великден's, „2027-05-02“) before an every year's: passed over, it has lost this
	// date for good, where an every year's comes back next year.
	slices.SortStableFunc(dated, func(x, y bank.Question) int {
		return b2i(!slices.Contains(x.Extra().On, day)) - b2i(!slices.Contains(y.Extra().On, day))
	})
	for _, q := range dated {
		name(q, 1)
	}
	chosen := make([]bank.Question, len(slots))
	for i, s := range slots {
		prefer := []func(bank.Question) bool{unseen}
		if s.typ == "number" {
			prefer = []func(bank.Question) bool{func(q bank.Question) bool { return estimate(q) && unseen(q) }, estimate, unseen}
		}
		if q := choose(b.Live(assigned[i], ""), s, allowed, marked(used), prefer, r); q != nil {
			chosen[i] = q
			taken[q.Base().ID] = true
			name(q, 1)
		}
	}
	for _, q := range dated {
		name(q, -1)
	}
	put := func(i int, q bank.Question) {
		delete(taken, chosen[i].Base().ID)
		name(chosen[i], -1)
		chosen[i], assigned[i] = q, q.Base().Category
		taken[q.Base().ID] = true
		name(q, 1)
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
				if o != chosen[i] && fresh(o) && free(o) && fitsPlace(o, slots[j], slots[j].typ) &&
					!clash(o, chosen[i], chosen[j]) && !slices.ContainsFunc(bank.Subjects(o), func(k string) bool {
					return slices.Contains(bank.Subjects(q), k)
				}) {
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
	kept := map[int]bool{}
	for _, q := range dated {
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
			return q.Extra().BG && q.Base().Category == topic && matches(q, s, true, true) && !clash(q, chosen[i]) &&
				(!estimate(chosen[i]) || estimate(q))
		}) {
			put(i, q)
			bg++
			break
		}
	}
	for i, q := range chosen {
		s := slots[i]
		if q == nil || !fresh(q) || !matches(q, s, true, true) || (s.typ == "number" && !estimate(q) && !kept[i]) {
			short = append(short, s.place())
		}
		if q != nil {
			picks = append(picks, Pick{ID: q.Base().ID, Seed: r.Uint64()})
		}
	}
	return picks, short
}

// overdue is whether q is due for review (bank.Tail.ReviewBy) on day: its answer may have stopped being true, so no
// game deals it from that day on, until the questions skill checks it and moves the date.
func overdue(q bank.Question, day string) bool {
	by := q.Extra().ReviewBy
	return by != "" && by <= day
}

// Overdue are the live questions due for review on day (overdue): no game deals them (DayQuestions bars them, the day
// passes them by), and the server says how many when it loads a bank.
func Overdue(b *bank.Bank, day string) []string {
	var out []string
	for _, q := range b.Live("", "") {
		if overdue(q, day) {
			out = append(out, q.Base().ID)
		}
	}
	return out
}

// place names the place of a day a slot is (Runway.Place): "medium split/clues" for the new kinds' place, whichever
// it has; "hard number (estimate)", for the day finishes on one.
func (s slot) place() string {
	kinds := s.typ
	if slices.Contains(newKinds, s.typ) {
		kinds = strings.Join(newKinds, "/")
	}
	name := string(s.difficulty) + " " + kinds
	if s.typ == "number" {
		name += " (estimate)"
	}
	if s.picture == withPicture {
		name += " with a picture"
	}
	return name
}

// wishes are what choose prefers for a slot of a game that isn't the day: an estimate for the number, where one is
// left (estimate).
func wishes(s slot) []func(bank.Question) bool {
	if s.typ == "number" {
		return []func(bank.Question) bool{estimate}
	}
	return nil
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

// inBands shuffles a run's slots within their difficulty: the run still goes from easy to hard, but where its special
// questions sit (the true-or-not, the order, the match, the number) changes from run to run, so that no two games
// share one shape. The first stays where it is, a plain choice in every shape: a game opens gently, with four options
// to read and tap. A day is drawn once for everyone (ahead.go): its shape is the same for all who play it.
func inBands(slots []slot, r *rand.Rand) []slot {
	for from := 1; from < len(slots); {
		to := from + 1
		for to < len(slots) && slots[to].difficulty == slots[from].difficulty {
			to++
		}
		band := slots[from:to]
		r.Shuffle(len(band), func(i, j int) { band[i], band[j] = band[j], band[i] })
		from = to
	}
	return slots
}

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
// gets — the type kept longest, then the difficulty — and, above the fit, the least stale (stale: 0 for a question new
// to everyone the game is for, more the more of them have met it). So a question none of them has seen, however
// loosely it fits, comes before one any has, and one fewer have seen before one more have: nobody is dealt again what
// they've played while the bank has others. Of those, the first of prefer's wishes that any of them meets.
func choose(pool []bank.Question, s slot, allowed func(bank.Question) bool, stale func(bank.Question) int,
	prefer []func(bank.Question) bool, r *rand.Rand) bank.Question {
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
	// Each fit's least stale questions; of all, the least stale, the closest fit on a tie.
	var found []bank.Question
	least := -1
	for _, fit := range fits {
		level := -1
		var these []bank.Question
		for _, q := range pool {
			if !allowed(q) || !fit(q) {
				continue
			}
			switch n := stale(q); {
			case level < 0 || n < level:
				level, these = n, []bank.Question{q}
			case n == level:
				these = append(these, q)
			}
		}
		if level >= 0 && (least < 0 || level < least) {
			least, found = level, these
		}
		if least == 0 {
			break // new to all, and no closer fit is
		}
	}
	for _, wish := range prefer {
		if best := slices.DeleteFunc(slices.Clone(found), func(q bank.Question) bool { return !wish(q) }); len(best) > 0 {
			found = best
			break
		}
	}
	if len(found) == 0 {
		return nil
	}
	return found[r.IntN(len(found))]
}

// marked is how stale a question is to a draw that only tells one kind from another (choose): 1 for one in ids, else 0.
func marked(ids map[string]bool) func(bank.Question) int {
	return func(q bank.Question) int { return b2i(ids[q.Base().ID]) }
}

// seenCount is how stale a question is to a draw for players (seen: seenAmong): by how many of them have answered it.
func seenCount(seen map[string]int) func(bank.Question) int {
	return func(q bank.Question) int { return seen[q.Base().ID] }
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

// Draw draws ten questions of a topic ("" for all topics, BulgariaTopic for Bulgaria's from every topic) for players
// of an ability there (mastery.go; 0 for one who knows as much as most): questions none of them has seen before those
// one has, and so on (seen: seenAmong); never one barred (the day's: DayQuestions). Choices come with a picture or without, whichever is drawn, and the number an estimate
// where one is left (wishes). Every run goes from easy to hard, its special questions in places drawn within their
// difficulty (inBands). Topic runs and duels draw this way (a room, DrawRoom). The questions due for review are among
// the barred (DayQuestions).
func Draw(b *bank.Bank, category string, ability float64, seen map[string]int, barred map[string]bool, r *rand.Rand) []Pick {
	pool := topicPool(b, category)
	taken := map[string]bool{}
	allowed := func(q bank.Question) bool { return !taken[q.Base().ID] && !barred[q.Base().ID] }
	var picks []Pick
	for _, s := range inBands(newKind(topicSlots(ability), r), r) {
		if q := choose(pool, s, allowed, seenCount(seen), wishes(s), r); q != nil {
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

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}
