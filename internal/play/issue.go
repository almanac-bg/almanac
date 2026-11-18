package play

import (
	"strconv"
	"strings"
	"time"
)

// The day's ten are the game's issue of the day, as an almanac's: numbered from the first day they were played as the
// game plays them now (the rebuild went live that evening), the same number for everyone. Начало heads the day with
// it, the day's result and its shared text carry it („Брой 6“), Моят Алманах heads each day's facts with it, and a
// past issue is played by it (/issues/6: past.go).

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

// IssueDay is the day of an issue by its number (YYYY-MM-DD); "" for a number that isn't one.
func IssueDay(n int) string {
	if n < 1 || n > 100*366 {
		return ""
	}
	first, _ := time.Parse(time.DateOnly, FirstIssue)
	return first.AddDate(0, 0, n-1).Format(time.DateOnly)
}

// months are the months as a date says them („17 ноември“).
var months = [...]string{"януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември",
	"октомври", "ноември", "декември"}

// DateWords is a day (YYYY-MM-DD) as a sentence says it: „17 ноември“.
func DateWords(day string) string {
	d, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return day
	}
	return strconv.Itoa(d.Day()) + " " + months[d.Month()-1]
}

// MissedWords are the issues a repair still asks for, as its sentence says them: „пропуснатия брой от 17 ноември“,
// or „пропуснатите броеве от 16 и 17 ноември“; "" for none left.
func (r *Repair) MissedWords() string {
	var days []string
	for _, m := range r.Missed {
		if !m.Done {
			days = append(days, m.Day)
		}
	}
	switch len(days) {
	case 0:
		return ""
	case 1:
		return "пропуснатия брой от " + DateWords(days[0])
	}
	a, b := DateWords(days[0]), DateWords(days[len(days)-1])
	if days[0][:7] == days[len(days)-1][:7] { // one month: „16 и 17 ноември“
		a, _, _ = strings.Cut(a, " ")
	}
	return "пропуснатите броеве от " + a + " и " + b
}
