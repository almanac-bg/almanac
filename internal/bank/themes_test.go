package bank

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// A bank's themes.json holds each of its categories' themes, and nothing else.
func TestThemesFile(t *testing.T) {
	cats := []Category{{"gen", "Общи"}, {"geo", "География"}}
	for _, c := range []struct {
		name, file, want string
	}{
		{"good", `{"gen": [{"id": "food", "name": "Храна", "covers": "ястия", "target": 60}, {"id": "other", "name": "друго", "covers": "останалото", "target": 40}],
			"geo": [{"id": "other", "name": "друго", "covers": "всичко", "target": 100}]}`, ""},
		{"a category without", `{"gen": [{"id": "other", "name": "друго", "covers": "всичко", "target": 100}]}`, "geo has no themes"},
		{"no such category", `{"gen": [{"id": "other", "name": "друго", "covers": "всичко", "target": 100}],
			"geo": [{"id": "other", "name": "друго", "covers": "всичко", "target": 100}], "art": []}`, "art: not a category"},
		{"twice", `{"gen": [{"id": "other", "name": "друго", "covers": "всичко", "target": 50}, {"id": "other", "name": "друго", "covers": "всичко", "target": 50}],
			"geo": [{"id": "other", "name": "друго", "covers": "всичко", "target": 100}]}`, "theme other twice"},
		{"no catch-all", `{"gen": [{"id": "food", "name": "Храна", "covers": "ястия", "target": 100}],
			"geo": [{"id": "other", "name": "друго", "covers": "всичко", "target": 100}]}`, `no theme "other"`},
		{"not 100", `{"gen": [{"id": "food", "name": "Храна", "covers": "ястия", "target": 50}, {"id": "other", "name": "друго", "covers": "всичко", "target": 40}],
			"geo": [{"id": "other", "name": "друго", "covers": "всичко", "target": 100}]}`, "add up to 90"},
		{"a field it doesn't know", `{"gen": [{"id": "other", "name": "друго", "covers": "всичко", "target": 100, "share": 1}],
			"geo": [{"id": "other", "name": "друго", "covers": "всичко", "target": 100}]}`, "unknown field"},
	} {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, ThemesFile), []byte(c.file), 0o644)
		themes, errs := readThemes(dir, cats)
		got := strings.Join(errs, "; ")
		if c.want == "" && (got != "" || len(themes["gen"]) != 2) {
			t.Errorf("%s: %q, %v", c.name, got, themes)
		}
		if c.want != "" && (!strings.Contains(got, c.want) || themes != nil) {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
	if themes, errs := readThemes(t.TempDir(), cats); themes != nil || errs != nil {
		t.Errorf("a bank without themes.json: %v, %v", themes, errs)
	}
}

var genThemes = map[string][]Theme{"gen": {
	{ID: "food", Name: "Храна", Covers: "ястия", Target: 40},
	{ID: "bg_customs", Name: "Българските обичаи", Covers: "обичаи", Target: 30, BG: true},
	{ID: "language", Name: "Език", Covers: "думи", Target: 20},
	{ID: OtherTheme, Name: "друго", Covers: "останалото", Target: 10},
}}

// A question names its chapter's theme: an error for one added since ThemesFrom, a warning for an older one, nothing for
// a kind the game doesn't deal; a theme the chapter doesn't have is always an error.
func TestThemeRule(t *testing.T) {
	old := choice("gen-1", "Кое ястие е с точени кори?", "Баница", "Таратор", "Мусака", "Сарми")
	fresh := choice("gen-2", "Коя супа е студена?", "Таратор", "Боб чорба", "Шкембе чорба", "Курбан")
	fresh.Added = ThemesFrom
	tagged := choice("gen-3", "Кой празник е на 1 март?", "Баба Марта", "Еньовден", "Тодоровден", "Ивановден")
	tagged.Added, tagged.Theme = ThemesFrom, "bg_customs"
	clues := &Clues{Head: Head{ID: "gen-4", Type: "clues", Text: "Кое е това?"}, Tail: Tail{Added: ThemesFrom}}
	b := bankOf(old, fresh, tagged, clues)
	b.Themes = genThemes
	got := slices.DeleteFunc(found(b), func(s string) bool { return !strings.Contains(s, "theme ") })
	if !slices.Equal(got, []string{"theme gen-1", "!theme gen-2"}) {
		t.Errorf("found %v", got)
	}
	b.Themes = nil
	if got := slices.DeleteFunc(found(b), func(s string) bool { return !strings.Contains(s, "theme ") }); len(got) > 0 {
		t.Errorf("a bank without themes: %v", got)
	}

	b.Themes = genThemes
	if errs := b.checkTheme(tagged); errs != nil {
		t.Errorf("a known theme: %v", errs)
	}
	tagged.Theme = "sport"
	if errs := b.checkTheme(tagged); len(errs) != 1 || !strings.Contains(errs[0], `"sport" isn't one of gen's`) {
		t.Errorf("an unknown theme: %v", errs)
	}
	tagged.Retired = true
	if errs := b.checkTheme(tagged); errs != nil {
		t.Errorf("a retired question's theme: %v", errs)
	}
	b.Themes = nil
	tagged.Retired = false
	if errs := b.checkTheme(tagged); len(errs) != 1 {
		t.Errorf("a theme in a bank without themes: %v", errs)
	}
}

// themed is a bank of the category gen with n live questions of each theme.
func themed(n map[string]int) *Bank {
	var qs []Question
	for _, theme := range slices.Sorted(maps.Keys(n)) {
		for range n[theme] {
			q := choice("gen-x", "?", "а", "б", "в", "г")
			q.Theme, q.Category = theme, "gen"
			qs = append(qs, q)
		}
	}
	b := Of([]Category{{"gen", "Общи"}}, qs)
	b.Themes = genThemes
	return b
}

// Each chapter's themes against their targets: the furthest short first, the catch-all last.
func TestThemesOf(t *testing.T) {
	b := themed(map[string]int{"food": 50, "bg_customs": 10, "language": 20, OtherTheme: 15, "": 5})
	chs := b.ThemesOf()
	if len(chs) != 1 {
		t.Fatalf("%d chapters", len(chs))
	}
	ch := chs[0]
	if ch.Live != 100 || ch.Untagged != 5 {
		t.Errorf("live %d, untagged %d", ch.Live, ch.Untagged)
	}
	var got []string
	for _, tc := range ch.Themes {
		got = append(got, fmt.Sprintf("%s %d", tc.ID, tc.Short))
	}
	if want := []string{"bg_customs 20", "language 0", "food -10", "other -5"}; !slices.Equal(got, want) {
		t.Errorf("themes %v, want %v", got, want)
	}
	// Off: half the distances from the targets, 10, 20, 0 and 5 points (the untagged count in none).
	if ch.Off != 17.5 {
		t.Errorf("off %g", ch.Off)
	}
	if Of(b.Categories, nil).ThemesOf() != nil {
		t.Error("a bank without themes has themes")
	}
}

// A batch writes into the themes short of their target, each by how short, those about Bulgaria named first; never
// into a catch-all; what the gaps don't hold, by the targets.
func TestPlanThemes(t *testing.T) {
	b := themed(map[string]int{"food": 30, "bg_customs": 10, "language": 10, OtherTheme: 0})
	ch := b.ThemesOf()[0]
	// After a batch of 10 the chapter has 60: food wants 24 (has 30), bg_customs 18 (8 short), language 12 (2 short),
	// other 6 (a catch-all: none).
	var got []string
	for _, p := range PlanThemes(ch, 10) {
		got = append(got, fmt.Sprintf("%s %d", p.ID, p.Write))
	}
	if want := []string{"bg_customs 8", "language 2", "food 0", "other 0"}; !slices.Equal(got, want) {
		t.Errorf("planned %v, want %v", got, want)
	}

	// A smaller batch shares out by the gaps, the largest remainders rounding up; Bulgaria first even when it takes less.
	b = themed(map[string]int{"food": 10, "bg_customs": 25, "language": 5, OtherTheme: 10})
	got = nil
	for _, p := range PlanThemes(b.ThemesOf()[0], 5) {
		got = append(got, fmt.Sprintf("%s %d", p.ID, p.Write))
	}
	// Of 55: food wants 22 (12 short), bg_customs 16.5 (over), language 11 (6 short): 5 × 12/18 = 3.3, 5 × 6/18 = 1.7.
	if want := []string{"food 3", "language 2", "bg_customs 0", "other 0"}; !slices.Equal(got, want) {
		t.Errorf("planned %v, want %v", got, want)
	}

	b = themed(map[string]int{"food": 10, "bg_customs": 5, "language": 5, OtherTheme: 0})
	got = nil
	for _, p := range PlanThemes(b.ThemesOf()[0], 10) {
		got = append(got, fmt.Sprintf("%s %d", p.ID, p.Write))
	}
	// Of 30: food wants 12 (2 short), bg_customs 9 (4 short), language 6 (1 short): 7 short in all, fewer than 10; the
	// other 3 by the targets (40, 30, 20 of 90): food 3.33, bg_customs 5, language 1.67.
	if want := []string{"bg_customs 5", "food 3", "language 2", "other 0"}; !slices.Equal(got, want) {
		t.Errorf("a batch over the gaps: %v, want %v", got, want)
	}
}

// Every question the sample deals has its theme, and the copies of a bank carry its themes (Beside).
func TestSampleThemes(t *testing.T) {
	b := loadSample(t)
	for _, ch := range b.ThemesOf() {
		if ch.Untagged > 0 {
			t.Errorf("%s: %d questions without a theme", ch.Category, ch.Untagged)
		}
	}
	if len(b.Themes) != len(b.Categories) {
		t.Errorf("themes for %d of %d categories", len(b.Themes), len(b.Categories))
	}
	if !slices.Contains(Beside, ThemesFile) {
		t.Error("a copy of a bank leaves its themes behind")
	}
}
