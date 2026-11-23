package bank

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// What `almanac bank add` (and so -check, and the bank's load: bank lint, the server) refuses, a fixture each
// (testdata/refused/<case>: a batch, and want.txt, what the refusal says), against one small bank
// (testdata/refused/bank): broken JSON and a field of the wrong type; a kind the game doesn't know, and one switched
// off; a theme missing or not the chapter's; no sources; the same question again, and its twin; an answer its own text
// gives away, and one another question's fact does; a number with no unit, and a tolerance wide enough for any guess;
// a question changed into another kind; a picture that isn't there, or has no credit; a new question dated to pass
// under the rules. A want.txt that starts with "warning: " is a hint (near: a person reads the pair): the batch goes
// in, told of it. The good batches go in clean: each bad one is theirs with one thing wrong, so it's refused for that
// alone. TODAY in a fixture is the day the test runs.
func TestRefused(t *testing.T) {
	const root = "testdata/refused"
	today := time.Now().Format(time.DateOnly)
	cases, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	tried := 0
	for _, c := range cases {
		if !c.IsDir() || c.Name() == "bank" {
			continue
		}
		tried++
		t.Run(c.Name(), func(t *testing.T) {
			dir, batch := t.TempDir(), t.TempDir()
			if err := os.CopyFS(dir, os.DirFS(filepath.Join(root, "bank"))); err != nil {
				t.Fatal(err)
			}
			pad(t, dir)
			from := filepath.Join(root, c.Name())
			err := filepath.WalkDir(from, func(path string, d os.DirEntry, err error) error {
				if err != nil || d.IsDir() || d.Name() == "want.txt" {
					return err
				}
				rel, _ := filepath.Rel(from, path)
				data, err := os.ReadFile(path)
				if err != nil {
					return err
				}
				if strings.HasSuffix(rel, ".json") {
					data = []byte(strings.ReplaceAll(string(data), "TODAY", today))
				}
				if err := os.MkdirAll(filepath.Dir(filepath.Join(batch, rel)), 0o755); err != nil {
					return err
				}
				return os.WriteFile(filepath.Join(batch, rel), data, 0o644)
			})
			if err != nil {
				t.Fatal(err)
			}
			before, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json"))
			res, err := Add(dir, batch, "refused test", true)
			wantData, noWant := os.ReadFile(filepath.Join(from, "want.txt"))
			want := strings.TrimSpace(string(wantData))
			hint, warned := strings.CutPrefix(want, "warning: ")
			// A rule not yet strict (its From a day to come) warns of what it will refuse.
			name, bracketed := strings.CutPrefix(strings.SplitN(want, "]", 2)[0], "[")
			if rule, ok := RuleNamed(name); ok && bracketed && !rule.Hint && rule.From > today {
				warned = true
			}
			switch {
			case noWant != nil: // a good batch
				if err != nil || res.Added+res.Changed != 1 || len(res.Warnings) > 0 {
					t.Fatalf("a good batch: %+v, %v", res, err)
				}
			case warned:
				if err != nil || !strings.Contains(problemLines(res.Warnings), hint) {
					t.Fatalf("want a warning with %q, got %v, %v", hint, res.Warnings, err)
				}
			default:
				if err == nil || !strings.Contains(err.Error(), want) {
					t.Fatalf("want a refusal with %q, got %v", want, err)
				}
				if !strings.HasPrefix(err.Error(), "nothing added") {
					t.Errorf("a refusal starts by saying nothing was added: %v", err)
				}
			}
			if after, _ := os.ReadFile(filepath.Join(dir, QuestionsDir, "general.json")); string(after) != string(before) {
				t.Error("a check changed the bank")
			}
		})
	}
	if tried < 22 {
		t.Fatalf("%d fixtures in %s: some have gone", tried, root)
	}
}

// pad gives the bank in dir a chapter of 1500 questions that share no word with the others: how much a shared word
// says of a subject (a give-away, a near-duplicate) depends on how few questions have it, as in a real bank.
func pad(t *testing.T, dir string) {
	t.Helper()
	var qs []Question
	for i := range 1500 {
		qs = append(qs, &TrueFalse{Head: Head{ID: fmt.Sprintf("pad-%d", i+1), Type: "truefalse", Difficulty: Easy,
			Text: fmt.Sprintf("Пълнеж %d.", i+1)}, Answer: true, Tail: Tail{Fact: "Пълнеж.", Added: "2026-11-01",
			Updated: "2026-11-01", Theme: OtherTheme}})
	}
	if err := WriteCategory(dir, "padding", qs); err != nil {
		t.Fatal(err)
	}
	edit := func(file, old, new string) {
		data, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil || !strings.Contains(string(data), old) {
			t.Fatalf("%s: %v", file, err)
		}
		write(t, filepath.Join(dir, file), strings.Replace(string(data), old, new, 1))
	}
	edit(CategoriesFile, "[", `[{"id": "padding", "name": "Пълнеж"},`)
	edit(ThemesFile, "{", `{"padding": [{"id": "other", "name": "Друго", "covers": "Пълнеж", "target": 100}],`)
}

// A year's question is a year's whatever else it says: „няколко“ isn't „колко“ (tec-404, 23 Nov 2026: read as a
// quantity, its tolerance by the formula was 600 years, and any guess was right). And a number says what it measures:
// its unit, a year its text asks for, or a count its text names.
func TestYearsAndUnits(t *testing.T) {
	year := time.Now().Year()
	for text, want := range map[string]bool{
		"През коя година е Съединението на България?":                                 true,
		"През коя година, няколко години след Освобождението, е Съединението?":        true,
		"През коя година излиза първият брой, колкото и странно да звучи, във Виена?": true,
		"На колко години Моцарт пише първата си симфония?":                            false,
		"Колко години продължава Стогодишната война?":                                 false,
		"Колко метра е висок връх Мусала?":                                            false,
	} {
		n := number("gen-1", text, 1885, 16, "")
		if n.IsYear() != want {
			t.Errorf("%q: a year's question %v, want %v", text, n.IsYear(), want)
		}
		if want {
			if tol := Tolerance(n); tol != max(3, math.Round(3*math.Cbrt(float64(year-1885)))) {
				t.Errorf("%q: the formula's tolerance is %v, a quantity's", text, tol)
			}
			n.Tolerance = 570
			if ruleTolerance(n) == nil {
				t.Errorf("%q: a tolerance of 570 years passes", text)
			}
		}
	}
	for _, c := range []struct {
		text, unit string
		answer     float64
		want       string
	}{
		{"Колко метра е висок връх Мусала?", "м", 2925, ""},
		{"През коя година е Съединението на България?", "", 1885, ""},
		{"Колко държави членуват в ООН?", "", 193, ""},
		{"Какво е октановото число на обикновения бензин?", "", 95, ""},
		{"Каква е надморската височина на връх Мусала?", "", 2925, "a number without a unit"},
		{"Кога е Съединението на България?", "", 1885, "a number without a unit"},
		{"Преди колко години, смятано от нашата ера, е Съединението?", "", 1885, "reads as a year asked with „колко“"},
	} {
		got := ruleUnit(number("gen-1", c.text, c.answer, 0.3*c.answer, c.unit))
		if (c.want == "") != (len(got) == 0) || (c.want != "" && !strings.Contains(got[0], c.want)) {
			t.Errorf("%q (%q): %v, want %q", c.text, c.unit, got, c.want)
		}
	}
}

func problemLines(ps []Problem) string {
	var lines []string
	for _, p := range ps {
		lines = append(lines, p.String())
	}
	return strings.Join(lines, "\n")
}
