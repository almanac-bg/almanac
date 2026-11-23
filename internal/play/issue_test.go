package play

import (
	"slices"
	"testing"
)

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

// An issue's chapters are its ten's, in their order, once the day is drawn: one of each of the bank's ten.
func TestIssueChapters(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	if got, err := w.g.IssueChapters(ctx, "2026-01-01"); err != nil || got != nil {
		t.Fatalf("a day not drawn: %v %v", got, err)
	}
	if _, err := w.g.StartDay(ctx, w.user()); err != nil {
		t.Fatal(err)
	}
	got, err := w.g.IssueChapters(ctx, w.g.Today())
	if err != nil || len(got) != Length {
		t.Fatalf("today's: %v %v", got, err)
	}
	seen := map[string]bool{}
	for _, c := range got {
		seen[c] = true
	}
	if len(seen) != len(w.b.Categories) {
		t.Fatalf("not one of each chapter: %v", got)
	}
}

// Each of an issue's chapters stays in its own place, as the tiles and the shared day's card put each mark under its
// chapter: a retired question keeps its chapter (the bank keeps it), and one gone from the bank altogether is a
// „Микс“ in its place, none after it moved up.
func TestIssueChaptersKeepTheirPlaces(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	st, err := w.g.StartDay(ctx, w.user())
	if err != nil {
		t.Fatal(err)
	}
	day := w.g.Today()
	was, err := w.g.IssueChapters(ctx, day)
	if err != nil || len(was) != Length {
		t.Fatalf("today's: %v %v", was, err)
	}
	picks := w.picks(st.ID)
	w.swap(editedSample(t, func(id string, q map[string]any) {
		if id == picks[6].ID {
			q["retired"], q["retiredWhy"] = true, "weak"
		}
	}))
	if got, err := w.g.IssueChapters(ctx, day); err != nil || !slices.Equal(got, was) {
		t.Fatalf("a question retired: %v %v, want %v", got, err, was)
	}
	w.swap(withoutQuestion(t, picks[3].ID))
	want := slices.Clone(was)
	want[3] = "mix"
	if got, err := w.g.IssueChapters(ctx, day); err != nil || !slices.Equal(got, want) {
		t.Fatalf("a question gone: %v %v, want %v", got, err, want)
	}
}
