package main

import (
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

// bank check names the national days with too few questions about Bulgaria, and those with none (which fail it).
func TestNationalDaysReport(t *testing.T) {
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	s, missing := nationalDays(b)
	if !slices.Contains(missing, "09-06") || !strings.Contains(s, "09-06 the Unification: none") {
		t.Errorf("missing %v in\n%s", missing, s)
	}
}
