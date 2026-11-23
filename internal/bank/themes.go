package bank

import (
	"cmp"
	"errors"
	"fmt"
	"maps"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// A chapter's themes: what its questions are about inside it (Спорт: football, tennis, the winter sports…), each with
// the share of the chapter it aims for, so that a chapter isn't mostly one thing and its Bulgarian side isn't thin.
// They are the bank's (ThemesFile, beside CategoriesFile), every live question names its own (Tail.Theme), and they
// steer the writing only: `bank check` shows each chapter's themes against their targets, `bank plan` gives a batch's
// questions to the themes furthest short. The draw never reads them.
//
// A question takes the one theme it is mainly about; when two fit, the more specific; a match, split or order over
// several (sportsmen of four sports) takes the chapter's MixedTheme where it has one, and what fits none OtherTheme.
// Those two are what is left over, never written for (Plan).

// ThemesFile is, in a bank's directory, each category's themes: {"<category>": [{"id", "name", "covers", "target",
// "bg"}…]}. A bank without it has no themes (the rule and the reports pass over it).
const ThemesFile = "themes.json"

// ThemesFrom is when a theme became an error for a new question: one added since then names one of its chapter's
// themes; an older one without is warned of (the rule "theme") until it has one.
const ThemesFrom = "2026-11-24"

// The catch-all themes: what fits no other (every chapter has it), and a match, split or order over several of a
// chapter's themes (a chapter that has such questions).
const (
	OtherTheme = "other"
	MixedTheme = "mixed"
)

// Theme is one of a chapter's themes.
type Theme struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Covers says what belongs to it, for whoever tags a question.
	Covers string `json:"covers"`
	// Target is the share of the chapter's live questions it aims for, in percent: a chapter's add up to 100.
	Target float64 `json:"target"`
	// BG: a theme about Bulgaria (Средновековна България, Българско кино): a batch's questions about Bulgaria go to
	// these first while they are short.
	BG bool `json:"bg,omitempty"`
}

var themeID = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// readThemes reads a bank's themes, if it has them, and checks them against its categories: every category has its
// themes, ids unique in a chapter, OtherTheme among them, targets that add up to 100.
func readThemes(dir string, categories []Category) (map[string][]Theme, []string) {
	data, err := os.ReadFile(filepath.Join(dir, ThemesFile))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, []string{err.Error()}
	}
	var themes map[string][]Theme
	if err := strictJSON(data, &themes); err != nil {
		return nil, []string{err.Error()}
	}
	var errs []string
	known := map[string]bool{}
	for _, c := range categories {
		known[c.ID] = true
		if len(themes[c.ID]) == 0 {
			errs = append(errs, fmt.Sprintf("%s has no themes: every category lists its own", c.ID))
		}
	}
	for _, c := range slices.Sorted(maps.Keys(themes)) {
		if !known[c] {
			errs = append(errs, fmt.Sprintf("%s: not a category (categories.json lists them)", c))
			continue
		}
		seen, sum := map[string]bool{}, 0.0
		for _, t := range themes[c] {
			switch {
			case !themeID.MatchString(t.ID):
				errs = append(errs, fmt.Sprintf("%s: theme id %q must be lowercase latin letters, digits and _", c, t.ID))
			case seen[t.ID]:
				errs = append(errs, fmt.Sprintf("%s: theme %s twice", c, t.ID))
			case t.Name == "" || t.Covers == "":
				errs = append(errs, fmt.Sprintf("%s: theme %s needs its name and what it covers", c, t.ID))
			case t.Target <= 0:
				errs = append(errs, fmt.Sprintf("%s: theme %s needs a target above 0", c, t.ID))
			}
			errs = append(errs, checkLetters(c+": "+t.ID+"'s name", t.Name)...)
			seen[t.ID] = true
			sum += t.Target
		}
		if !seen[OtherTheme] {
			errs = append(errs, fmt.Sprintf("%s: no theme %q: what fits none of the others goes there", c, OtherTheme))
		}
		if math.Abs(sum-100) > 0.01 {
			errs = append(errs, fmt.Sprintf("%s: the targets add up to %g, not 100", c, sum))
		}
	}
	if len(errs) > 0 {
		return nil, errs
	}
	return themes, nil
}

// themeOf finds a chapter's theme by id.
func (b *Bank) themeOf(category, id string) (Theme, bool) {
	i := slices.IndexFunc(b.Themes[category], func(t Theme) bool { return t.ID == id })
	if i < 0 {
		return Theme{}, false
	}
	return b.Themes[category][i], true
}

// checkTheme: a question's theme is one of its chapter's (a retired one's isn't held to it: themes may change after
// it left). Nothing while the bank's ThemesFile itself has errors: those say it once.
func (b *Bank) checkTheme(q Question) []string {
	theme := q.Extra().Theme
	if theme == "" || q.Extra().Retired || b.themesBroken {
		return nil
	}
	if b.Themes == nil {
		return []string{"theme: the bank has no " + ThemesFile + " to name it in"}
	}
	if _, ok := b.themeOf(q.Base().Category, theme); !ok {
		return []string{fmt.Sprintf("theme %q isn't one of %s's (%s): %s", theme, q.Base().Category, ThemesFile,
			strings.Join(b.themeIDs(q.Base().Category), ", "))}
	}
	return nil
}

func (b *Bank) themeIDs(category string) []string {
	var ids []string
	for _, t := range b.Themes[category] {
		ids = append(ids, t.ID)
	}
	return ids
}

// ruleTheme: every live question the game deals names its chapter's theme (in a bank with themes). The kinds Off
// aren't held to it: nothing counts them.
func ruleTheme(l *lintBank) []finding {
	if l.bank.Themes == nil {
		return nil
	}
	var out []finding
	for _, q := range l.live {
		if q.Extra().Theme == "" && KindOn(q.Base().Type) {
			out = append(out, finding{ids: []string{q.Base().ID}, msg: "no theme: one of " + q.Base().Category + "'s in " +
				ThemesFile + " (" + strings.Join(l.bank.themeIDs(q.Base().Category), ", ") + ")"})
		}
	}
	return out
}

// ThemeCount is a theme of a chapter as the bank has it.
type ThemeCount struct {
	Theme
	// N counts the chapter's live questions of the theme, Share is their share of the chapter in percent.
	N     int
	Share float64
	// Short is how many questions it lacks for its Target of the chapter as it is (below 0: how many over).
	Short int
}

// ChapterThemes is a chapter's themes against their targets.
type ChapterThemes struct {
	Category, Name string
	// Live counts the chapter's live questions (Bank.Live), Untagged those of them without a theme. The shares, the
	// gaps and Off are of the others (Tagged): an untagged question is in no theme yet, not in a theme short.
	Live, Untagged int
	// Off is how far the chapter stands from its targets: half the sum of every theme's distance from its target, in
	// points (the share of the chapter that would have to move to meet them all; 0 is on target).
	Off float64
	// Themes are the chapter's themes, the furthest short first, the catch-alls (Planned) last.
	Themes []ThemeCount
}

// Tagged counts the chapter's live questions that name a theme.
func (ch ChapterThemes) Tagged() int { return ch.Live - ch.Untagged }

// ThemesOf is each chapter's themes against their targets (none in a bank without themes): what `bank check` shows,
// and what `bank plan` writes for.
func (b *Bank) ThemesOf() []ChapterThemes {
	if b.Themes == nil {
		return nil
	}
	var out []ChapterThemes
	for _, c := range b.Categories {
		ch := ChapterThemes{Category: c.ID, Name: c.Name}
		n := map[string]int{}
		for _, q := range b.Live(c.ID, "") {
			ch.Live++
			if t := q.Extra().Theme; t == "" {
				ch.Untagged++
			} else {
				n[t]++
			}
		}
		tagged := ch.Tagged()
		for _, t := range b.Themes[c.ID] {
			tc := ThemeCount{Theme: t, N: n[t.ID]}
			if tagged > 0 {
				tc.Share = 100 * float64(tc.N) / float64(tagged)
			}
			tc.Short = int(math.Round(t.Target/100*float64(tagged))) - tc.N
			ch.Off += math.Abs(tc.Share-t.Target) / 2
			ch.Themes = append(ch.Themes, tc)
		}
		slices.SortStableFunc(ch.Themes, func(x, y ThemeCount) int {
			if x.Planned() != y.Planned() {
				return b2i(y.Planned()) - b2i(x.Planned())
			}
			return cmp.Compare(y.Short, x.Short)
		})
		out = append(out, ch)
	}
	return out
}

// Planned is whether a batch writes for a theme: not a catch-all (OtherTheme, MixedTheme), which takes what is left.
func (t Theme) Planned() bool { return t.ID != OtherTheme && t.ID != MixedTheme }

// PlanThemes gives a batch's n questions in a chapter to its themes, never to a catch-all: to those short of their
// target in the chapter as it will be (its tagged questions and the batch), each by how short it is; what is left once
// every gap is filled (a batch larger than the gaps), by the targets. Shares are whole questions, the largest remainders
// rounding up. The themes come back the ones written for first: those about Bulgaria (Theme.BG), then the rest, each by
// how many it takes; the themes it gives none to after, as ThemesOf has them.
func PlanThemes(ch ChapterThemes, n int) []PlannedTheme {
	n = max(n, 0)
	size := float64(ch.Tagged() + n)
	out := make([]PlannedTheme, len(ch.Themes))
	short, targets := make([]float64, len(ch.Themes)), 0.0
	gaps := 0.0
	for i, t := range ch.Themes {
		out[i] = PlannedTheme{ThemeCount: t}
		if t.Planned() {
			short[i] = max(t.Target/100*size-float64(t.N), 0)
			gaps += short[i]
			targets += t.Target
		}
	}
	weights := make([]float64, len(out))
	for i, t := range ch.Themes {
		switch {
		case !t.Planned() || n == 0:
		case gaps >= float64(n):
			weights[i] = short[i] / gaps * float64(n)
		default:
			weights[i] = short[i] + (float64(n)-gaps)*t.Target/targets
		}
	}
	for i, w := range shareOut(weights, n) {
		out[i].Write = w
	}
	slices.SortStableFunc(out, func(x, y PlannedTheme) int {
		if (x.Write > 0) != (y.Write > 0) {
			return b2i(y.Write > 0) - b2i(x.Write > 0)
		}
		if x.Write > 0 && x.BG != y.BG {
			return b2i(y.BG) - b2i(x.BG)
		}
		return y.Write - x.Write // else as ThemesOf has them: the furthest short first, the catch-alls last
	})
	return out
}

// shareOut rounds shares that add up to n to whole numbers that do: each its floor, then one more to the largest
// remainders (the larger share breaking a tie, then the earlier).
func shareOut(shares []float64, n int) []int {
	out := make([]int, len(shares))
	given := 0
	for i, s := range shares {
		out[i] = int(math.Floor(s + 1e-9))
		given += out[i]
	}
	order := make([]int, len(shares))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(x, y int) int {
		rx, ry := shares[x]-float64(out[x]), shares[y]-float64(out[y])
		if c := cmp.Compare(ry, rx); c != 0 {
			return c
		}
		return cmp.Compare(shares[y], shares[x])
	})
	for _, i := range order {
		if given >= n || shares[i] <= 0 {
			break
		}
		out[i]++
		given++
	}
	return out
}

// PlannedTheme is a theme in a batch's plan: Write of the batch's questions go to it.
type PlannedTheme struct {
	ThemeCount
	Write int
}
