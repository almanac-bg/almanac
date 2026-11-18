package bank

import "slices"

// The national calendar: the days Bulgaria marks as a nation, each of which „На този ден“ must have a question about
// Bulgaria for (bank.Tail.On with BG). They are the days a player here expects the game to know, and would share; one
// left to an actress's birthday or a premiere on television reads as a game made elsewhere. `almanac bank check`
// fails while one has none, and lists those with fewer than NationalWant. Moving feasts (Великден) aren't here: their
// questions are dated by the year.

// NationalDay is a day of the national calendar: its date (MM-DD) and what it marks.
type NationalDay struct {
	On   string
	What string
}

// NationalDays are the national calendar, in the year's order.
var NationalDays = []NationalDay{
	{"01-01", "New Year (Васильовден)"},
	{"01-06", "Epiphany (Йордановден)"},
	{"02-19", "the hanging of Vasil Levski"},
	{"03-01", "Baba Marta"},
	{"03-03", "the Liberation, the national day"},
	{"05-06", "St George's Day, the day of the army"},
	{"05-24", "the Bulgarian alphabet and culture"},
	{"06-02", "Hristo Botev and those who fell for Bulgaria"},
	{"07-18", "the birth of Vasil Levski"},
	{"09-06", "the Unification"},
	{"09-22", "Independence"},
	{"11-01", "the Enlighteners (будителите)"},
	{"12-08", "the students' day"},
	{"12-24", "Christmas Eve"},
	{"12-25", "Christmas"},
}

// NationalWant is how many questions about Bulgaria a national day should have: a few, for it comes every year and a
// day never deals a question twice.
const NationalWant = 2

// NationalCount is a national day with how many live questions about Bulgaria belong to it.
type NationalCount struct {
	NationalDay
	N int
}

// National counts the live questions about Bulgaria (Tail.BG) of each national day, every year's or a year's.
func (b *Bank) National() []NationalCount {
	out := make([]NationalCount, len(NationalDays))
	for i, d := range NationalDays {
		out[i].NationalDay = d
	}
	for _, q := range b.Live("", "") {
		t := q.Extra()
		if !t.BG {
			continue
		}
		for i, d := range NationalDays {
			if slices.ContainsFunc(t.On, func(on string) bool { return on[len(on)-min(len(on), 5):] == d.On }) {
				out[i].N++
			}
		}
	}
	return out
}
