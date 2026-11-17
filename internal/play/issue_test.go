package play

import "testing"

func TestIssue(t *testing.T) {
	for day, want := range map[string]int{
		"2026-11-12": 1,
		"2026-11-17": 6,
		"2027-03-29": 138, // past the clocks going forward: still a day apart
		"2027-11-12": 366,
		"2026-11-11": 0,
		"":           0,
		"17.11.2026": 0,
	} {
		if got := Issue(day); got != want {
			t.Errorf("Issue(%q) = %d, want %d", day, got, want)
		}
	}
}
