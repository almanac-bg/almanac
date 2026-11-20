package server

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/play"
)

// /admin's „Думите на играта“ names every noun of the closed list in DECISIONS.md, by its exact name, and nothing
// else: a noun added to (or taken from) the list, or renamed, fails here until /admin counts it.
func TestNounNamesAreTheClosedList(t *testing.T) {
	text, err := os.ReadFile("../../DECISIONS.md")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?s)nouns are a closed list:\*\*(.*?)\. Adding one`).FindSubmatch(text)
	if m == nil {
		t.Fatal("DECISIONS.md has no closed list of nouns: the pattern changed?")
	}
	var list []string
	for w := range strings.FieldsFuncSeq(string(m[1]), func(r rune) bool { return r == ',' || r == '(' || r == ')' }) {
		if w = strings.Join(strings.Fields(w), " "); w != "" {
			list = append(list, w)
		}
	}
	var named []string
	for _, n := range play.Nouns {
		name, ok := nounNames[n]
		if !ok {
			t.Errorf("/admin has no name for the noun %q", n)
		}
		named = append(named, name[0])
	}
	if len(nounNames) != len(play.Nouns) {
		t.Errorf("/admin names %d nouns, play.Nouns has %d", len(nounNames), len(play.Nouns))
	}
	for _, w := range list {
		if !slices.Contains(named, w) {
			t.Errorf("the closed list's „%s“ isn't among /admin's nouns %q", w, named)
		}
	}
	for _, w := range named {
		if !slices.ContainsFunc(list, func(x string) bool { return strings.EqualFold(x, w) }) {
			t.Errorf("/admin's „%s“ isn't in the closed list %q", w, list)
		}
	}
}
