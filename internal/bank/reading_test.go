package bank

import (
	"fmt"
	"strings"
	"testing"
)

// Reading counts the letters and digits a question shows before it's answered, and a picture as PictureReading.
func TestReading(t *testing.T) {
	for _, c := range []struct {
		q    Question
		want int
	}{
		{&TrueFalse{Head: Head{Type: "truefalse", Text: "Луната е спътник на Земята."}}, 22},
		{&Choice{Head: Head{Type: "choice", Text: "Коя?"}, Answer: "Аа", Wrong: []string{"Бб", "Вв", "Гг"}}, 3 + 8},
		{&Number{Head: Head{Type: "number", Text: "Колко?"}, Unit: "км", Answer: 12345}, 5 + 2},
		{&Match{Head: Head{Type: "match", Text: "Свържи:"}, Pairs: []MatchPair{{"А", "Б"}}, Decoy: "В"}, 6 + 3},
		{&Split{Head: Head{Type: "split", Text: "Раздели:"}, Groups: [2]string{"Да", "Не"}, Items: []SplitItem{{Text: "x1"}}}, 7 + 4 + 2},
		{&Clues{Head: Head{Type: "clues", Text: "Кой?"}, Clues: []string{"Едно.", "Две.", "Три."}, Answer: "А", Wrong: []string{"Б", "В", "Г"}}, 3 + 10 + 4},
		{&Choice{Head: Head{Type: "choice", Text: "Кое?"}, Answer: "скрито", Pictures: make([]Image, 4)}, 3 + 4*PictureReading},
	} {
		if got := Reading(c.q); got != c.want {
			t.Errorf("%s %q reads %d, want %d", c.q.Base().Type, c.q.Base().Text, got, c.want)
		}
	}
}

// The length rule flags a question that reads far past its kind's usual, and nothing in a kind too small to say what
// is usual.
func TestRuleLength(t *testing.T) {
	var live []Question
	for i := range 40 {
		live = append(live, &Choice{Head: Head{ID: fmt.Sprintf("gen-%d", i), Type: "choice",
			Text: strings.Repeat("а", 50+i)}, Answer: "аа", Wrong: []string{"бб", "вв", "гг"}})
	}
	long := &Choice{Head: Head{ID: "gen-99", Type: "choice", Text: strings.Repeat("а", 200)}, Answer: "аа",
		Wrong: []string{"бб", "вв", "гг"}}
	got := ruleLength(&lintBank{live: append(live, long)})
	if len(got) != 1 || got[0].ids[0] != "gen-99" || !strings.Contains(got[0].msg, "208 letters") {
		t.Fatalf("one long choice among 40: %+v", got)
	}
	if got := ruleLength(&lintBank{live: append(live[:lengthKind-2], long)}); len(got) != 0 {
		t.Fatalf("a kind of %d questions: %+v", lengthKind-1, got)
	}
	same := make([]Question, 40)
	for i := range same {
		same[i] = &Choice{Head: Head{ID: fmt.Sprintf("gen-%d", i), Type: "choice", Text: strings.Repeat("а", 50)},
			Answer: "аа", Wrong: []string{"бб", "вв", "гг"}}
	}
	if got := ruleLength(&lintBank{live: append(same, long)}); len(got) != 0 {
		t.Fatalf("a kind all of one length: %+v", got)
	}
	if r, ok := RuleNamed("length"); !ok || !r.Hint {
		t.Fatal("the length rule is a hint of Rules")
	}
}
