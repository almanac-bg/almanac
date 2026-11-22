package play

import "testing"

// A shared day is its score and its shape: each of the ten in its place, a question that counts for nobody kept apart
// (it has no place in the score), a close answer apart from a right one and from a wrong one.
func TestShareShape(t *testing.T) {
	s := State{Trail: []Mark{
		{Right: true}, {Right: true}, {}, {Right: true}, {Void: true},
		{Right: true}, {Close: true}, {Right: true}, {Right: true}, {},
	}}
	sh := Share{Code: "k4f2m7qa", Day: "2026-11-20", Issue: Issue("2026-11-20"), Shape: shapeOf(s.Trail)}
	if sh.Shape != "1101312110" || sh.Rights() != 6 || sh.Counted() != 9 {
		t.Fatalf("shape %q, %d right of %d", sh.Shape, sh.Rights(), sh.Counted())
	}
	if got := sh.Path(); got != "/d/9-k4f2m7qa" {
		t.Fatalf("the path: %q", got)
	}
}

// An issue's day is the day whose issue it is.
func TestIssueDay(t *testing.T) {
	for _, day := range []string{FirstIssue, "2026-11-20", "2027-03-01", "2028-02-29"} {
		if got := IssueDay(Issue(day)); got != day {
			t.Errorf("%s: %s", day, got)
		}
	}
	if IssueDay(0) != "" {
		t.Error("issue 0")
	}
	if DateWords("2026-11-20") != "20 ноември" {
		t.Error(DateWords("2026-11-20"))
	}
}
