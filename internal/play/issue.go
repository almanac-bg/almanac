package play

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// The day's ten are the game's issue of the day, as an almanac's: numbered from the first day they were played as the
// game plays them now (the rebuild went live that evening), the same number for everyone. Днес heads the day with it,
// the day's result carries it („Брой 6“), and the Алманах names it beside each fact the day wrote.

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

// IssueDay is the day (YYYY-MM-DD) of an issue's number, the other way from Issue; "" for a number no day has.
func IssueDay(issue int) string {
	if issue < 1 {
		return ""
	}
	first, _ := time.Parse(time.DateOnly, FirstIssue)
	return first.AddDate(0, 0, issue-1).Format(time.DateOnly)
}

// IssueChapters are a day's chapters in the order its ten are asked („В броя“ on Днес): what the issue holds, never
// which questions. None while the day isn't drawn yet (ahead.go draws it before it comes).
func (g *Game) IssueChapters(ctx context.Context, day string) ([]string, error) {
	var raw string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT questions FROM days WHERE day = ?`, day).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var picks []Pick
	if err := json.Unmarshal([]byte(raw), &picks); err != nil {
		return nil, err
	}
	// One for each of the ten, in its place, as the tiles and the card put each mark under its chapter: a retired
	// question is still the bank's; one gone from it altogether (void for the day: voidDay) is a „Микс“ in its place.
	b := g.Bank()
	out := make([]string, len(picks))
	for i, p := range picks {
		out[i] = "mix"
		if q, ok := b.Get(p.ID); ok {
			out[i] = q.Base().Category
		}
	}
	return out, nil
}
