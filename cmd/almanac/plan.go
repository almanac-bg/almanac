package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
)

// A batch plan says what a batch of new questions writes, the same in every category (the bank's categories stay the
// same size): where the day's runway is shortest first, the dates that have the fewest questions of their own, and
// the ids to take. The /new-questions skill runs its writers, checkers and cross-check from it.
type batchPlan struct {
	Date string `json:"date"`
	// Each is how many questions every category adds; Write how many each writer writes, the spares for the checkers'
	// drops included.
	Each  int `json:"each"`
	Write int `json:"write"`
	// Places are the day's places, shortest runway first: days now, and after the batch (its questions for the place
	// in every category; the dated ones not counted).
	Places     []planPlace    `json:"places"`
	Categories []planCategory `json:"categories"`
}

type planPlace struct {
	Place  string `json:"place"`
	Days   int    `json:"days"`
	After  int    `json:"after"`
	Each   int    `json:"each"`
	Spares int    `json:"spares"`
}

type planCategory struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// IDs are the ids to write with: the first free number of the category's own, and Write of them on.
	FirstID string `json:"firstId"`
	LastID  string `json:"lastId"`
	// Cells are what to write: Count of a kind and difficulty (with a picture or not), and Spares more of it.
	Cells []planCell `json:"cells"`
	// Dates are the days (MM-DD) the category's dated questions belong to, one question each, the fewest-covered and
	// the soonest first.
	Dates []string `json:"dates"`
	// Avoid are the subjects that come back too often in the category already (over bank check's 1%).
	Avoid []string `json:"avoid"`
}

type planCell struct {
	Kinds      string          `json:"kinds"`
	Difficulty bank.Difficulty `json:"difficulty"`
	Picture    bool            `json:"picture"`
	// Dated cells are questions of a date (Dates): a choice without a picture (any difficulty), an easy true-or-not
	// or a hard number, whichever the day's subject asks best.
	Dated  bool `json:"dated,omitempty"`
	Count  int  `json:"count"`
	Spares int  `json:"spares"`
}

// bankPlan prints the plan for a batch of each questions a category: as text, or as JSON for the skill.
func bankPlan(args []string) error {
	fs := flag.NewFlagSet("bank plan", flag.ContinueOnError)
	each := fs.Int("n", 30, "questions each category adds")
	asJSON := fs.Bool("json", false, "print the plan as JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *each < 1 || *each > 500 {
		return errors.New("bank plan: -n is how many questions each category adds: 1 to 500")
	}
	dir := defaultBankDir()
	if fs.NArg() > 0 {
		dir = fs.Arg(0)
	}
	b, problems := bank.Load(dir)
	if b == nil {
		for _, p := range problems {
			fmt.Println(p)
		}
		return errors.New("fix the errors first")
	}
	p := planBatch(b, *each, time.Now())
	if *asJSON {
		out, err := json.MarshalIndent(p, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(out))
		return nil
	}
	fmt.Print(p.String())
	return nil
}

// Spares is the share more than a batch adds that its writers write, so that the checkers' drops still leave enough.
const Spares = 0.2

// PlaceShare is the most of a batch one place of the day takes, however short its runway: fifteen hard numbers from
// one topic in one go are forced, and an honest question beats a filled cell.
const PlaceShare = 1.0 / 3

// DatedShare is the share of a batch that belongs to a date: the days come back every year, and each needs a question
// of its own each year („На този ден“).
const DatedShare = 0.2

// planBatch plans a batch of each questions a category, on the day now: DatedShare of it for the dates with the
// fewest questions, the rest for the places of the day with the shortest runway, and Spares more of each.
func planBatch(b *bank.Bank, each int, now time.Time) batchPlan {
	spares := func(n int) int { return int(math.Ceil(float64(n) * Spares)) }
	dated := int(math.Ceil(float64(each) * DatedShare))
	places := play.DayRunway(b, nil)
	cats := len(b.Categories)
	got := fill(places, cats, each-dated, int(math.Ceil(float64(each)*PlaceShare)))

	p := batchPlan{Date: now.Format(time.DateOnly), Each: each}
	// The cells every category writes, in the day's order, then the dated ones. A place two kinds share is one cell:
	// about half each.
	var cells []planCell
	for i, r := range places {
		after := (r.Questions + got[i]*cats) / r.PerDay
		p.Places = append(p.Places, planPlace{Place: r.Place, Days: r.Days, After: after, Each: got[i], Spares: spares(got[i])})
		if got[i] > 0 {
			cells = append(cells, planCell{Kinds: strings.Join(r.Kinds, "/"), Difficulty: r.Difficulty, Picture: r.Picture,
				Count: got[i], Spares: spares(got[i])})
		}
	}
	slices.SortStableFunc(p.Places, func(x, y planPlace) int { return x.Days - y.Days })
	if dated > 0 {
		cells = append(cells, planCell{Kinds: "choice/truefalse/number", Dated: true, Count: dated, Spares: spares(dated)})
	}
	for _, c := range cells {
		p.Write += c.Count + c.Spares
	}

	dates := thinDates(b, now)
	repeats := b.Repeats(SubjectMost)
	for i, c := range b.Categories {
		prefix, next := b.NextID(c.ID)
		pc := planCategory{ID: c.ID, Name: c.Name, Cells: cells,
			FirstID: fmt.Sprintf("%s-%d", prefix, next), LastID: fmt.Sprintf("%s-%d", prefix, next+p.Write-1)}
		// Round the categories: each takes every cats-th date, so the thinnest are spread over all of them. The
		// spares' dates come after.
		for k := 0; k < dated+spares(dated) && i+k*cats < len(dates); k++ {
			pc.Dates = append(pc.Dates, dates[i+k*cats])
		}
		size := len(b.Live(c.ID, ""))
		for _, r := range repeats {
			for _, s := range b.Spread(r) {
				if s.Category == c.ID && float64(s.N) > SubjectShare*float64(size) {
					pc.Avoid = append(pc.Avoid, r.Name)
				}
			}
		}
		p.Categories = append(p.Categories, pc)
	}
	return p
}

// fill gives units questions in every category to the places of a day, one unit (a question in each of cats
// categories) at a time to the place with the fewest days left, the day's order breaking ties, and at most most
// units to a place.
func fill(places []play.Runway, cats, units, most int) []int {
	have := make([]int, len(places))
	for i, r := range places {
		have[i] = r.Questions
	}
	got := make([]int, len(places))
	for range units {
		best := -1
		for i, r := range places {
			// have[i]/PerDay[i] < have[best]/PerDay[best], in whole numbers.
			if got[i] < most && (best < 0 || have[i]*places[best].PerDay < have[best]*r.PerDay) {
				best = i
			}
		}
		if best < 0 {
			break
		}
		have[best] += cats
		got[best]++
	}
	return got
}

// thinDates are the days of the year (MM-DD) by how many live questions belong to them, the fewest first, then the
// soonest from now: each year a date takes a question of its own, so the thinnest run out first.
func thinDates(b *bank.Bank, now time.Time) []string {
	count := map[string]int{}
	for _, q := range b.Live("", "") {
		for _, d := range q.Extra().On {
			count[d[len(d)-5:]]++
		}
	}
	type day struct {
		md   string
		n    int
		soon int
	}
	var days []day
	// Today and tomorrow are drawn already; every day after is drawn again when the bank's dates change (play.Ahead).
	first := time.Date(now.Year(), now.Month(), now.Day()+2, 0, 0, 0, 0, time.UTC)
	start := time.Date(2028, 1, 1, 0, 0, 0, 0, time.UTC) // a leap year: 29 February too
	for d := start; d.Year() == 2028; d = d.AddDate(0, 0, 1) {
		md := d.Format("01-02")
		next := time.Date(first.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC)
		if next.Before(first) {
			next = next.AddDate(1, 0, 0)
		}
		soon := int(next.Sub(first).Hours() / 24)
		days = append(days, day{md, count[md], soon})
	}
	slices.SortStableFunc(days, func(x, y day) int {
		if x.n != y.n {
			return x.n - y.n
		}
		return x.soon - y.soon
	})
	out := make([]string, len(days))
	for i, d := range days {
		out[i] = d.md
	}
	return out
}

func (p batchPlan) String() string {
	var s strings.Builder
	fmt.Fprintf(&s, "a batch of %d questions a category (%d in all); each writer writes %d, the spares for the checkers' drops\n",
		p.Each, p.Each*len(p.Categories), p.Write)
	s.WriteString("the day's runway, shortest first (days now → after the batch):\n")
	for _, pl := range p.Places {
		fmt.Fprintf(&s, "  %-34s %5d → %-5d %3d a category", pl.Place, pl.Days, pl.After, pl.Each)
		if pl.Spares > 0 {
			fmt.Fprintf(&s, " (+%d spare)", pl.Spares)
		}
		s.WriteString("\n")
	}
	if len(p.Categories) == 0 {
		return s.String()
	}
	for _, c := range p.Categories[0].Cells {
		if c.Dated {
			fmt.Fprintf(&s, "dated: %d a category (+%d spare), the dates with the fewest questions first, then the soonest\n", c.Count, c.Spares)
		}
	}
	for _, c := range p.Categories {
		fmt.Fprintf(&s, "  %-11s %s … %s   dates %s\n", c.ID, c.FirstID, c.LastID, strings.Join(c.Dates, " "))
		if len(c.Avoid) > 0 {
			fmt.Fprintf(&s, "  %-11s avoid: %s\n", "", strings.Join(c.Avoid, ", "))
		}
	}
	return s.String()
}
