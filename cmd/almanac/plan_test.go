package main

import (
	"slices"
	"strconv"
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
	p := planBatch(b, 30, time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC))
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
