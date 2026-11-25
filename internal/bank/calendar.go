package bank

import "slices"

// The national calendar: the days Bulgaria marks as a nation, each of which „На този ден“ must have a question about
// Bulgaria for (bank.Tail.On with BG). They are the days a player here expects the game to know, and would share; one
// left to an actress's birthday or a premiere on television reads as a game made elsewhere. `almanac bank check`
// lists those with fewer than NationalWant a day can still deal, and fails while one has none (with -live, only when
// the bank checked has none for a day the live bank has some for: a fix to another question is never held up by a
// national day already empty). Moving feasts (Великден) aren't here: their questions are dated by the year.

// NationalDay is a day of the national calendar: its date (MM-DD) and its name, as the day's issue says it on Днес,
// on its card and in its share („3 март · Освобождението“).
type NationalDay struct {
	On   string
	Name string
}

// NationalDays are the national calendar, in the year's order.
var NationalDays = []NationalDay{
	{"01-01", "Нова година"},       // and Васильовден
	{"01-06", "Йордановден"},       // Epiphany
	{"02-19", "В памет на Левски"}, // his hanging, 1873
	{"03-01", "Баба Марта"},
	{"03-03", "Освобождението"},       // the national day
	{"05-06", "Гергьовден"},           // and the day of the army
	{"05-24", "Денят на писмеността"}, // Bulgarian letters, education and culture: kept short, a line on Днес at 320 px
	{"06-02", "Денят на Ботев"},       // and of those who fell for Bulgaria
	{"07-18", "Рожденият ден на Левски"},
	{"09-06", "Съединението"},
	{"09-22", "Независимостта"},
	{"11-01", "Денят на будителите"},
	{"12-08", "Студентският празник"},
	{"12-24", "Бъдни вечер"},
	{"12-25", "Коледа"},
}

// NationalName is the name of the national day a day (YYYY-MM-DD) falls on, "" on any other day. The day's issue says
// it in one quiet line: the questions dated to the day come first in its draw (play/draw.go), and the issue stays one
// question a chapter, never a themed ten.
func NationalName(day string) string {
	if len(day) != 10 {
		return ""
	}
	for _, d := range NationalDays {
		if day[5:] == d.On {
			return d.Name
		}
	}
	return ""
}

// NationalWant is how many questions about Bulgaria a national day should have: a few, for it comes every year and a
// day never deals a question twice.
const NationalWant = 2

// NationalCount is a national day with how many live questions about Bulgaria a day of its date can still deal.
type NationalCount struct {
	NationalDay
	N int
}

// National counts, for each national day, the live questions about Bulgaria (Tail.BG) a day of its date can still
// deal: every year's or a year's still ahead (on or after today, YYYY-MM-DD), and none the days have had (used: the
// ids `almanac bank used` prints; nil counts them all), for a day never deals a question twice. A day already drawn
// for the date has its question: what's left here is for the years after.
func (b *Bank) National(used map[string]bool, today string) []NationalCount {
	out := make([]NationalCount, len(NationalDays))
	for i, d := range NationalDays {
		out[i].NationalDay = d
	}
	for _, q := range b.Live("", "") {
		t := q.Extra()
		if !t.BG || used[q.Base().ID] {
			continue
		}
		for i, d := range NationalDays {
			if slices.ContainsFunc(t.On, func(on string) bool {
				return on[len(on)-min(len(on), 5):] == d.On && (len(on) != 10 || on >= today)
			}) {
				out[i].N++
			}
		}
	}
	return out
}
