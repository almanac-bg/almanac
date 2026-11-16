package play

import (
	"slices"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The day's runway: how long the bank holds the day's questions, place by place, counted the way drawDay spends
// them, so that the bank is grown (the questions skill, `almanac bank plan`) before a place runs out, not after. A
// place counts only the questions that fit it just so and that a day can still take:
//
//   - none a day has had already (Used: the days played and those drawn ahead, from production's days table through
//     `almanac bank used`, which gives question ids and nothing else);
//   - none that belongs to a date („На този ден“): it can go on its own date only, and a day takes one at most;
//   - none due for review by the first day still to draw (overdue: no game deals it);
//   - for the number, estimates only (a unit, more than 20): the day finishes on one, and a day without one is short.
//
// The questions about Bulgaria have a runway of their own (BulgariaRunway): every day takes BGFloor at least. The
// days already drawn ahead count as covered: a place's runway runs from today through the drawn days, then as many
// more as its questions last.

// Used are the questions the days have had: the days played and those drawn ahead, through Through (the last day
// drawn, YYYY-MM-DD). The zero Used is a bank no day has drawn from (`bank check` without the days).
type Used struct {
	IDs     map[string]bool
	Through string
}

// Runway is how long the bank holds the day's questions for one place of a day. The bank grows where the runway is
// shortest (the questions skill): the day spends hard numbers three times faster than easy choices.
type Runway struct {
	Place string
	// Days is how many days from today the place has a question for (the days drawn already among them), and Out the
	// first day it has none (YYYY-MM-DD).
	Days int
	Out  string
	// Difficulty, Kinds and Picture say what fits the place ("split" and "clues" share theirs); Questions is how many
	// fit it that a day can still take (the days drawn ahead have theirs), PerDay how many a day takes.
	Difficulty bank.Difficulty
	Kinds      []string
	Picture    bool
	Questions  int
	PerDay     int
}

// After is the runway with more questions for the place (a batch's).
func (r Runway) After(more int, today string) Runway {
	start, _ := time.Parse(time.DateOnly, r.Out)
	start = start.AddDate(0, 0, -r.Questions/r.PerDay)
	r.Questions += more
	return r.from(start, today)
}

// from sets Days and Out for a runway whose questions are spent from start on, PerDay a day.
func (r Runway) from(start time.Time, today string) Runway {
	t, _ := time.Parse(time.DateOnly, today)
	out := start.AddDate(0, 0, r.Questions/r.PerDay)
	r.Out = out.Format(time.DateOnly)
	r.Days = int(out.Sub(t).Hours()/24 + 0.5)
	return r
}

// start is the first day not drawn yet: tomorrow of the last day drawn, or today.
func (u Used) start(today string) time.Time {
	t, _ := time.Parse(time.DateOnly, today)
	if u.Through >= today {
		t, _ = time.Parse(time.DateOnly, u.Through)
		t = t.AddDate(0, 0, 1)
	}
	return t
}

// left is whether a day still to draw (from start on) can take q: no day has had it, it belongs to no date, and it
// isn't due for review.
func (u Used) left(q bank.Question, start time.Time) bool {
	return !u.IDs[q.Base().ID] && len(q.Extra().On) == 0 && !overdue(q, start.Format(time.DateOnly))
}

// DayRunway is the runway of each place of a day, in the day's order (the place the new kinds share counts both), on
// today.
func DayRunway(b *bank.Bank, used Used, today string) []Runway {
	start := used.start(today)
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
				if used.left(q, start) && fitsPlace(q, s, k) {
					n++
				}
			}
		}
		out = append(out, Runway{Place: slot{s.difficulty, kinds[0], s.picture, ""}.place(), Difficulty: s.difficulty,
			Kinds: kinds, Picture: s.picture == withPicture, Questions: n, PerDay: times}.from(start, today))
	}
	return out
}

// BulgariaRunway is the runway of the questions about Bulgaria (bank.Tail.BG) on today: those a day can still take
// that fit one of its places just so, BGFloor a day (the least a day takes).
func BulgariaRunway(b *bank.Bank, used Used, today string) Runway {
	start := used.start(today)
	n := 0
	for _, q := range b.Live("", "") {
		if !q.Extra().BG || !used.left(q, start) {
			continue
		}
		if slices.ContainsFunc(daySlots, func(s slot) bool {
			if s.typ == newKinds[0] {
				return slices.ContainsFunc(newKinds, func(k string) bool { return fitsPlace(q, s, k) })
			}
			return fitsPlace(q, s, s.typ)
		}) {
			n++
		}
	}
	return Runway{Place: "about Bulgaria", Questions: n, PerDay: BGFloor}.from(start, today)
}

// fitsPlace is whether q fits a place of a day just so, as kind k: the number only with an estimate.
func fitsPlace(q bank.Question, s slot, k string) bool {
	return matches(q, slot{s.difficulty, k, s.picture, ""}, true, true) && (k != "number" || estimate(q))
}
