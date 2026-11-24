package main

import (
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
)

func TestFillWritesForTheShortestRunwayFirst(t *testing.T) {
	places := []play.Runway{
		{Place: "easy choice", Questions: 1000, PerDay: 1},
		{Place: "hard choice", Questions: 400, PerDay: 2}, // 200 days
		{Place: "hard number", Questions: 150, PerDay: 1},
	}
	// Ten categories: a unit is ten questions. The number runs up to the hard choices' 200 days, then they take turns
	// (the day's order first on a tie).
	got := fill(places, 10, 9, 100)
	if !slices.Equal(got, []int{0, 3, 6}) {
		t.Errorf("got %v, want [0 3 6]", got)
	}
	// No place takes more than its share, however short.
	if got := fill(places, 10, 9, 3); !slices.Equal(got, []int{3, 3, 3}) {
		t.Errorf("capped: got %v, want [3 3 3]", got)
	}
}

func TestPlanBatch(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	p := planBatch(b, 30, time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC), play.Used{})
	if p.Each != 30 || len(p.Categories) != len(b.Categories) {
		t.Fatalf("a plan of %d for %d categories", p.Each, len(p.Categories))
	}
	count, write, dated := 0, 0, 0
	for _, c := range p.Categories[0].Cells {
		count += c.Count
		write += c.Count + c.Spares
		if c.Dated {
			dated = c.Count
		}
		if c.Count > 10 {
			t.Errorf("%s %s: %d, over a third of the batch", c.Difficulty, c.Kinds, c.Count)
		}
	}
	if count != 30 || write != p.Write || dated != 6 {
		t.Errorf("cells add up to %d (write %d of %d), %d dated", count, write, p.Write, dated)
	}
	seen := map[string]bool{}
	for _, c := range p.Categories {
		prefix, next := b.NextID(c.ID)
		if c.FirstID != prefix+"-"+strconv.Itoa(next) {
			t.Errorf("%s starts at %s, the bank's next is %d", c.ID, c.FirstID, next)
		}
		for _, d := range c.Dates {
			if seen[d] {
				t.Errorf("%s twice", d)
			}
			seen[d] = true
		}
	}
	// The sample has no dates: the soonest come first, today and tomorrow (drawn already) last.
	if d := p.Categories[0].Dates[0]; d != "11-18" {
		t.Errorf("the first date is %s, want 11-18", d)
	}
}

// A plan marks BGShare of each category's questions as about Bulgaria, spread over its cells by their size, and
// says how long the questions about Bulgaria last now and after the batch.
func TestPlanAboutBulgaria(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	p := planBatch(b, 30, time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC), play.Used{})
	bg := 0
	for _, c := range p.Categories[0].Cells {
		if c.BG > c.Count {
			t.Errorf("%s: %d about Bulgaria of %d", c.name(), c.BG, c.Count)
		}
		bg += c.BG
	}
	if bg != 9 || p.Categories[3].BG != 9 || p.Bulgaria.Each != 9 {
		t.Errorf("%d about Bulgaria in the cells, %d in a category, want 9 of 30", bg, p.Categories[3].BG)
	}
	if p.Bulgaria.Place != "about Bulgaria" || p.Bulgaria.After <= p.Bulgaria.Days {
		t.Errorf("Bulgaria's runway %+v doesn't grow", p.Bulgaria)
	}
	cells := []planCell{{Count: 10}, {Count: 7}, {Count: 7}, {Count: 6, Dated: true}}
	if n := aboutBulgaria(cells, 9); n != 9 || cells[0].BG != 3 || cells[1].BG+cells[2].BG+cells[3].BG != 6 {
		t.Errorf("spread: %+v", cells)
	}
}

// The dates count only the dated questions a day can still take: none a day has had, none of a year gone by.
func TestThinDatesCountWhatIsLeft(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	now := time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)
	live := b.Live("", "")
	for _, q := range live {
		q.Extra().On = nil
	}
	live[0].Extra().On = []string{"11-18"}      // used by a day
	live[1].Extra().On = []string{"2025-11-19"} // a year gone by
	live[2].Extra().On = []string{"11-20"}      // left
	used := play.Used{IDs: map[string]bool{live[0].Base().ID: true}}
	dates := thinDates(b, now, used)
	if dates[0] != "11-18" || dates[1] != "11-19" || slices.Index(dates, "11-20") != len(dates)-1 {
		t.Errorf("dates start %v, end %v: 11-18 and 11-19 have none left, 11-20 one", dates[:3], dates[len(dates)-1])
	}
	if dates := thinDates(b, now, play.Used{}); slices.Index(dates, "11-18") < 360 {
		t.Errorf("unused, 11-18 has a question: %v", dates[:3])
	}
}

// bank check and bank plan read the questions the days have had from the file `bank used` prints.
func TestReadUsed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "used.txt")
	_ = os.WriteFile(path, []byte("# the questions the days have had (almanac bank used), 2\n# through 2027-02-14\ngen-001\nhis-302\n\n"), 0o600)
	used, err := readUsed(path)
	if err != nil || used.Through != "2027-02-14" || len(used.IDs) != 2 || !used.IDs["his-302"] {
		t.Fatalf("%+v, %v", used, err)
	}
	if used, err := readUsed(""); err != nil || used.IDs != nil {
		t.Fatalf("no file: %+v, %v", used, err)
	}
}

// bank check's runway names each place's last day and warns under play.RunwayWarn days, the questions about Bulgaria
// and the dated ones too.
func TestRunwayReport(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	s := runway(b, play.Used{}, "2026-11-16")
	for _, want := range []string{"hard number (estimate)", "about Bulgaria (3 a day)", "out on 2026-", "warning: under 150 days",
		"dated („На този ден“", "dates of the year ahead have fewer than 2"} {
		if !strings.Contains(s, want) {
			t.Errorf("no %q in\n%s", want, s)
		}
	}
}

// Against the bank the game plays (-live), bank check fails on a question changed into another kind by hand, and on
// one taken out, before almanac-bank moves the bank in play: bank add refuses both, a hand in the files doesn't ask it.
func TestCheckAgainstTheLiveBank(t *testing.T) {
	live, next := t.TempDir(), t.TempDir()
	for _, dir := range []string{live, next} {
		if err := os.CopyFS(dir, os.DirFS("../../bank/sample")); err != nil {
			t.Fatal(err)
		}
	}
	if err := bankCheck([]string{"-sample", "-live", live, next}); err != nil {
		t.Fatalf("the same bank against itself: %v", err)
	}
	file := filepath.Join(next, bank.QuestionsDir, "general.json")
	data, _ := os.ReadFile(file)
	var qs []map[string]any
	if err := json.Unmarshal(data, &qs); err != nil {
		t.Fatal(err)
	}
	write := func(qs []map[string]any) {
		out, _ := json.Marshal(qs)
		if err := os.WriteFile(file, out, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// The first choice, made a true-or-not under its id.
	i := slices.IndexFunc(qs, func(q map[string]any) bool { return q["type"] == "choice" && q["image"] == nil && q["pictures"] == nil })
	was := maps.Clone(qs[i])
	qs[i] = map[string]any{"id": was["id"], "type": "truefalse", "difficulty": was["difficulty"], "text": "Баба Марта е на 1 март.",
		"answer": true, "fact": was["fact"], "added": was["added"], "updated": was["updated"], "theme": was["theme"]}
	write(qs)
	if err := bankCheck([]string{"-sample", "-live", live, next}); err == nil || !strings.Contains(err.Error(), "1 questions gone, or of another kind") {
		t.Fatalf("a question of another kind: %v", err)
	}
	if err := bankCheck([]string{"-sample", next}); err != nil {
		t.Fatalf("by itself the bank loads: %v", err)
	}
	qs[i] = was
	write(qs[1:])
	if err := bankCheck([]string{"-sample", "-live", live, next}); err == nil || !strings.Contains(err.Error(), "1 questions gone, or of another kind") {
		t.Fatalf("a question taken out: %v", err)
	}
}

// bank check fails on a question that breaks one of the bank's rules (bank.Lint) as on one the server would refuse
// (bank.Load), but says „the server would not play this bank“ only of the second: deploy.sh holds a release for that
// alone.
func TestCheckTellsTheRulesFromTheServer(t *testing.T) {
	dir := t.TempDir()
	if err := os.CopyFS(dir, os.DirFS("../../bank/sample")); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, bank.QuestionsDir, "technology.json")
	data, _ := os.ReadFile(file)
	for _, c := range []struct{ name, from, to, says string }{
		{"a rule", "с въгленов микрофон.", "с въгленов микрофон", "errors against the bank's rules (bank lint)"},
		{"the format", `"checkedBy": "twins fable-5.2",`, `"checkedBy": "twins fable-5.2", "typo": 1,`, "the server would not play this bank"},
	} {
		broken := strings.Replace(string(data), c.from, c.to, 1)
		if broken == string(data) {
			t.Fatalf("%s: no %q in the sample", c.name, c.from)
		}
		if err := os.WriteFile(file, []byte(broken), 0o644); err != nil {
			t.Fatal(err)
		}
		err := bankCheck([]string{"-sample", dir})
		if err == nil || !strings.Contains(err.Error(), c.says) {
			t.Errorf("%s: %v, want %q", c.name, err, c.says)
		}
		if c.name == "a rule" && strings.Contains(err.Error(), "the server would not play") {
			t.Errorf("a rule's error says the server would refuse the bank: %v", err)
		}
	}
}

// bank check warns of a question dated for today or tomorrow, drawn already without it, that changed since the day
// before its date (a batch dated it late): neither day is drawn again, so its date passes without it. Not of one a
// day has had, one that changed before (it lost to the others for its date), or without the days drawn (-used).
func TestDrawnWithout(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	q := b.Live("history", "choice")[0]
	id, tail := q.Base().ID, q.Extra()
	drawn := play.Used{IDs: map[string]bool{}, Through: "2027-02-22"}
	for _, c := range []struct {
		name, on, updated string
		used              play.Used
		want              []string
	}{
		{"dated for tomorrow today", "11-26", "2026-11-25", drawn, []string{id + " (2026-11-26)"}},
		{"dated for today yesterday", "11-25", "2026-11-24", drawn, []string{id + " (2026-11-25)"}},
		{"a year's own date", "2026-11-26", "2026-11-25", drawn, []string{id + " (2026-11-26)"}},
		{"dated before tomorrow was drawn", "11-26", "2026-11-24", drawn, nil},
		{"a day after tomorrow: drawn again", "11-27", "2026-11-25", drawn, nil},
		{"a day has had it", "11-26", "2026-11-25", play.Used{IDs: map[string]bool{id: true}, Through: "2027-02-22"}, nil},
		{"tomorrow not drawn yet", "11-26", "2026-11-25", play.Used{IDs: map[string]bool{}, Through: "2026-11-25"}, nil},
		{"no days known", "11-26", "2026-11-25", play.Used{}, nil},
	} {
		tail.On, tail.Updated = []string{c.on}, c.updated
		if got := drawnWithout(b, c.used, "2026-11-25"); !slices.Equal(got, c.want) {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}

// bank check names the national days with too few questions about Bulgaria, and those with none: they fail it, but
// against the live bank (-live) only those it has some for.
func TestNationalDaysReport(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	s, missing, empty := nationalDays(b, nil, false, play.Used{}, "2026-11-18")
	if !slices.Contains(missing, "09-06") || len(empty) > 0 || !strings.Contains(s, "09-06 Съединението: none") {
		t.Errorf("missing %v, empty %v in\n%s", missing, empty, s)
	}
	// One question about Bulgaria for the Liberation; once a day has had it, 3 March is empty.
	before, _ := bank.Load("../../bank/sample")
	liberation := b.Live("history", "")[0].Base().ID
	for _, b := range []*bank.Bank{b, before} {
		q, _ := b.Get(liberation)
		q.Extra().On, q.Extra().BG = []string{"03-03"}, true
	}
	if _, missing, _ := nationalDays(b, nil, false, play.Used{}, "2026-11-18"); slices.Contains(missing, "03-03") {
		t.Errorf("3 March has %s, but is missing", liberation)
	}
	used := play.Used{IDs: map[string]bool{liberation: true}}
	if _, missing, _ := nationalDays(b, nil, false, used, "2026-11-18"); !slices.Contains(missing, "03-03") {
		t.Errorf("3 March's only question is used, but it isn't missing: %v", missing)
	}
	// Against the live bank: a day that is empty there too only warns; one the new bank emptied fails.
	_, missing, empty = nationalDays(b, b, true, used, "2026-11-18")
	if len(missing) > 0 || !slices.Contains(empty, "03-03") || !slices.Contains(empty, "09-06") {
		t.Errorf("against itself: missing %v, empty %v", missing, empty)
	}
	_, missing, empty = nationalDays(b, before, true, used, "2026-11-18")
	if len(missing) > 0 || !slices.Contains(empty, "03-03") {
		t.Errorf("against the same bank: missing %v, empty %v", missing, empty)
	}
	_, missing, empty = nationalDays(b, before, true, play.Used{}, "2026-11-18")
	if len(missing) > 0 || slices.Contains(empty, "03-03") {
		t.Errorf("nothing used: missing %v, empty %v", missing, empty)
	}
	q, _ := b.Get(liberation)
	q.Extra().Retired = true
	_, missing, empty = nationalDays(b, before, true, play.Used{}, "2026-11-18")
	if !slices.Contains(missing, "03-03") || !slices.Contains(empty, "09-06") {
		t.Errorf("3 March's last question retired: missing %v, empty %v", missing, empty)
	}
	// A live bank that doesn't load holds nothing against the new one.
	if _, missing, _ := nationalDays(b, nil, true, play.Used{}, "2026-11-18"); len(missing) > 0 {
		t.Errorf("no live bank: missing %v", missing)
	}
}

// A plan gives each category's questions to its themes furthest short of their targets, those about Bulgaria named
// first, never to a catch-all; and bank check shows every chapter's themes against their targets.
func TestPlanThemesAndReport(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	p := planBatch(b, 30, time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC), play.Used{})
	for _, c := range p.Categories {
		if len(c.Themes) != len(b.Themes[c.ID]) {
			t.Fatalf("%s: %d themes of %d", c.ID, len(c.Themes), len(b.Themes[c.ID]))
		}
		written, writing := 0, true
		for i, th := range c.Themes {
			written += th.Write
			if th.Write > 0 && (th.ID == bank.OtherTheme || th.ID == bank.MixedTheme) {
				t.Errorf("%s: %d for the catch-all %s", c.ID, th.Write, th.ID)
			}
			if th.Write > 0 && !writing {
				t.Errorf("%s: %s takes %d after a theme that takes none", c.ID, th.ID, th.Write)
			}
			writing = th.Write > 0
			if i > 0 && th.Write > 0 && th.BG && !c.Themes[i-1].BG {
				t.Errorf("%s: %s, about Bulgaria, after %s", c.ID, th.ID, c.Themes[i-1].ID)
			}
		}
		if written != p.Each {
			t.Errorf("%s: the themes take %d of %d", c.ID, written, p.Each)
		}
	}
	s := themes(b)
	for _, want := range []string{"the chapters' themes", "Спорт (sports):", "points off the targets", "the biggest gaps:", "Смесени"} {
		if !strings.Contains(s, want) {
			t.Errorf("no %q in\n%s", want, s)
		}
	}
	if !strings.Contains(p.String(), "themes to write, those about Bulgaria first:") {
		t.Errorf("the plan names no themes:\n%s", p.String())
	}
}

// From the repository's root, bank check holds a bank against the public sample (bank.Public): a bank that has the
// sample's questions live fails, the sample itself (-sample, as CI checks it) doesn't.
func TestCheckAgainstThePublicSample(t *testing.T) {
	copied := t.TempDir()
	if err := os.CopyFS(copied, os.DirFS("../../bank/sample")); err != nil {
		t.Fatal(err)
	}
	t.Chdir("../..")
	if err := bankCheck([]string{copied}); err == nil || !strings.Contains(err.Error(), "the public sample") {
		t.Fatalf("the sample's questions live in another bank: %v", err)
	}
	if err := bankCheck([]string{"-sample", bank.PublicDir}); err != nil {
		t.Fatalf("the sample by itself: %v", err)
	}
}
