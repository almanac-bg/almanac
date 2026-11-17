package play

import "time"

// The day's ten are the game's issue of the day, as an almanac's: numbered from the first day they were played as the
// game plays them now (the rebuild went live that evening), the same number for everyone. Начало heads the day with
// it, the day's result and its shared text carry it („Брой 6“), and Моят Алманах heads each day's facts with it.

// FirstIssue is the day of Брой 1 (YYYY-MM-DD, in Bulgaria).
const FirstIssue = "2026-11-12"

// Issue is a day's number (YYYY-MM-DD): 1 on FirstIssue, one more each day after; 0 for a day before it, or not a day.
func Issue(day string) int {
	d, err := time.Parse(time.DateOnly, day)
	first, _ := time.Parse(time.DateOnly, FirstIssue)
	if err != nil || d.Before(first) {
		return 0
	}
	return int(d.Sub(first)/(24*time.Hour)) + 1
}
