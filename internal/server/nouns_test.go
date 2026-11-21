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

// „профил“ is marked by a player opening their own Профил too, which asks for their page as anyone's (play.Used),
// and Днес asking for their numbers (/api/me/stats) marks nothing.
func TestOwnProfileMarksProfile(t *testing.T) {
	g := start(t)
	p, id := g.guest()
	used := func() int {
		var bits int
		if err := g.db.Read.QueryRow(`SELECT used FROM users WHERE id = ?`, id).Scan(&bits); err != nil {
			t.Fatal(err)
		}
		return bits
	}
	if status, _ := p.call("GET", "/api/me/stats", nil); status != 200 || used() != 0 {
		t.Fatalf("Днес's numbers: %d, used %b", status, used())
	}
	if status, _ := p.call("GET", "/api/players/"+tagOf(p), nil); status != 200 || used() == 0 {
		t.Fatalf("Профил: %d, used %b", status, used())
	}
}

// The privacy page names every part of the game a player is marked as opening (play.Used): one marked anew fails here
// until the page says so.
func TestPrivacyNamesWhatIsMarkedOpened(t *testing.T) {
	said := map[string]string{"almanac": "Алманаха", "chapters": "страница на глава", "friends": "Приятели",
		"board": "класацията", "seal": "печата", "profile": "профил"}
	var page strings.Builder
	if err := privacyBody.Execute(&page, map[string]any{}); err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?s)Кои части на играта отвори тази седмица</strong> \((.*?)\) —`).
		FindStringSubmatch(page.String())
	if m == nil {
		t.Fatal("the privacy page doesn't say which parts opened are marked")
	}
	list := strings.Join(strings.Fields(m[1]), " ")
	for _, n := range play.Nouns {
		if !play.Opened(n) {
			continue
		}
		if w, ok := said[n]; !ok || !strings.Contains(list, w) {
			t.Errorf("the privacy page's „%s“ doesn't name %q, marked as opened", list, n)
		}
	}
}
