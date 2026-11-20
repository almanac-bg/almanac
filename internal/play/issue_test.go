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

// An issue's topics are its ten's, in their order, once the day is drawn: one of each of the bank's ten.
func TestIssueTopics(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	if got, err := w.g.IssueTopics(ctx, "2026-01-01"); err != nil || got != nil {
		t.Fatalf("a day not drawn: %v %v", got, err)
	}
	if _, err := w.g.StartDay(ctx, w.user()); err != nil {
		t.Fatal(err)
	}
	got, err := w.g.IssueTopics(ctx, w.g.Today())
	if err != nil || len(got) != Length {
		t.Fatalf("today's: %v %v", got, err)
	}
	seen := map[string]bool{}
	for _, c := range got {
		seen[c] = true
	}
	if len(seen) != len(w.b.Categories) {
		t.Fatalf("not one of each topic: %v", got)
	}
}
