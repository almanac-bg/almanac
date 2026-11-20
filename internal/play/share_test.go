package play

import "testing"

// A shared day is its score and its shape: a question that counts for nobody has no square, as it has no place in the
// score, and a close answer is not a right one.
func TestShareText(t *testing.T) {
	s := State{Trail: []Mark{
		{Right: true}, {Right: true}, {}, {Right: true}, {Void: true},
		{Right: true}, {Close: true}, {Right: true}, {Right: true}, {},
	}}
	sh := Share{Code: "k4f2m7qa", Day: "2026-11-20", Issue: Issue("2026-11-20"), Shape: shapeOf(s)}
	if sh.Shape != "110110110" || sh.Rights() != 6 {
		t.Fatalf("shape %q, %d right", sh.Shape, sh.Rights())
	}
	want := "Алманах, брой 9 · 20 ноември\n6 от 9 ■■□■■□■■□\nalmanac.bg/d/9-k4f2m7qa"
	if got := sh.Text("almanac.bg" + sh.Path()); got != want {
		t.Fatalf("%q, not %q", got, want)
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
	if IssueWords("2026-11-20") != "Брой 9 · 20 ноември" {
		t.Error(IssueWords("2026-11-20"))
	}
}
