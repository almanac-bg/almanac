package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"maps"
	"math"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/play"
	"github.com/almanac-bg/almanac/internal/store"
)

func bankCommand(args []string) error {
	if len(args) == 0 {
		return usage()
	}
	rest := args[1:]
	dir := func() string {
		if len(rest) > 0 {
			return rest[0]
		}
		return defaultBankDir()
	}
	switch args[0] {
	case "check":
		return bankCheck(rest)
	case "used":
		return bankUsed()
	case "fmt":
		return bankFmt(dir())
	case "lint":
		fs := flag.NewFlagSet("bank lint", flag.ContinueOnError)
		rules := fs.String("rule", "", "only these rules (comma-separated: giveaway,stale)")
		short := fs.Bool("summary", false, "only the count of each rule")
		if err := fs.Parse(rest); err != nil {
			return usage()
		}
		into := defaultBankDir()
		if fs.NArg() > 0 {
			into = fs.Arg(0)
		}
		return bankLint(into, *rules, *short)
	case "subjects":
		return bankSubjects(dir())
	case "calibrate":
		return bankCalibrate(dir())
	case "plan":
		return bankPlan(rest)
	case "add":
		fs := flag.NewFlagSet("bank add", flag.ContinueOnError)
		dry := fs.Bool("check", false, "only check the batch: write nothing")
		checkedBy := fs.String("checked-by", "", `mark the new questions checked today by this ("new-questions fable-5.2")`)
		if err := fs.Parse(rest); err != nil || fs.NArg() == 0 {
			return usage()
		}
		into := defaultBankDir()
		if fs.NArg() > 1 {
			into = fs.Arg(1)
		}
		return bankAdd(fs.Arg(0), into, *checkedBy, *dry)
	}
	return usage()
}

// bankAdd adds a checked batch (bank.Add) to a bank: all of it, or nothing. dry (-check) only checks it and says what
// it would do: a writer checks one category's part this way, before the batch is whole.
func bankAdd(from, dir, checkedBy string, dry bool) error {
	res, err := bank.Add(dir, from, checkedBy, dry)
	if err != nil {
		return err
	}
	for _, p := range res.Warnings {
		fmt.Println(p)
	}
	var sizes []string
	for _, c := range res.Sizes {
		sizes = append(sizes, c.String())
	}
	verb := "added"
	if dry {
		verb = "would be added (nothing written)"
	}
	fmt.Printf("%s: %d questions %s, %d retired; live after: %s\n", dir, res.Added, verb, res.Retired, strings.Join(sizes, ", "))
	return nil
}

// defaultBankDir is the private bank when there is one (a clone in private/), else the public sample.
func defaultBankDir() string {
	if dir := os.Getenv("BANK_DIR"); dir != "" {
		return dir
	}
	if _, err := os.Stat("private/" + bank.CategoriesFile); err == nil {
		return "private"
	}
	return "bank/sample"
}

// bankCheck checks everything the server checks before it plays a bank, and the owner's rule that the categories are
// about the same size (bank.SizeSlack; -unbalanced lets the small public sample pass). It prints every error, and
// counts the warnings by rule (bank lint lists them); it reports the mix; the day's runway: how long each place of a
// day has questions for, where the next batch writes first (with -used, the questions the days have had are
// taken off: `almanac bank used`); and the subjects that come back. Its last line counts the problems.
func bankCheck(args []string) error {
	fs := flag.NewFlagSet("bank check", flag.ContinueOnError)
	unbalanced := fs.Bool("unbalanced", false, "pass a bank whose categories aren't about the same size (the public sample)")
	from := fs.String("used", "", "a file of the question ids the days have had (almanac bank used)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	dir := defaultBankDir()
	if fs.NArg() > 0 {
		dir = fs.Arg(0)
	}
	used, err := readUsed(*from)
	if err != nil {
		return err
	}
	b, problems := bank.Load(dir)
	count := bank.CountOf(problems)
	tally := fmt.Sprintf("%s: %s", dir, count)
	if count.Warnings > 0 {
		tally += ": almanac bank lint lists them"
	}
	for _, p := range problems {
		if !p.Warning {
			fmt.Println(p)
		}
	}
	if b == nil {
		fmt.Println(tally)
		return fmt.Errorf("%s: %d errors: the server would not play this bank", dir, count.Errors)
	}
	fmt.Println(summary(b))
	fmt.Println(runway(b, used, today()))
	fmt.Println(subjects(b, SubjectsShown))
	fmt.Println(tally)
	if off, mean := b.Uneven(); len(off) > 0 && !*unbalanced {
		return fmt.Errorf("%s: categories more than %.0f%% off the mean of %.0f: %s (a batch adds to every category alike)",
			dir, 100*bank.SizeSlack, mean, countList(off))
	}
	return nil
}

func countList(cs []bank.CategoryCount) string {
	var parts []string
	for _, c := range cs {
		parts = append(parts, c.String())
	}
	return strings.Join(parts, ", ")
}

// bankLint lists every problem of a bank by rule (bank.Rules, the format's first), each with its question's id: what
// a content pass works through. rules ("giveaway,stale") keeps only those; short prints only each rule's count.
func bankLint(dir, rules string, short bool) error {
	_, problems := bank.Load(dir)
	want := map[string]bool{}
	for _, r := range strings.Split(rules, ",") {
		if r = strings.TrimSpace(r); r != "" {
			if _, ok := bank.RuleNamed(r); !ok && !slices.Contains(bank.RuleOrder(), r) {
				return fmt.Errorf("no rule %q: the rules are %s", r, strings.Join(bank.RuleOrder(), ", "))
			}
			want[r] = true
		}
	}
	byRule := map[string][]bank.Problem{}
	for _, p := range problems {
		r := p.Rule
		if r == "" {
			r = "format"
		}
		if len(want) == 0 || want[r] {
			byRule[r] = append(byRule[r], p)
		}
	}
	all := bank.CountOf(nil)
	for _, r := range bank.RuleOrder() {
		ps := byRule[r]
		if len(ps) == 0 {
			continue
		}
		c := bank.CountOf(ps)
		all.Errors, all.Warnings = all.Errors+c.Errors, all.Warnings+c.Warnings
		says := "the format: lengths, fields, dates"
		if rule, ok := bank.RuleNamed(r); ok {
			says = rule.Says
		}
		fmt.Printf("%-14s %5d errors %5d warnings   %s\n", r, c.Errors, c.Warnings, says)
		if short {
			continue
		}
		slices.SortStableFunc(ps, func(x, y bank.Problem) int { return strings.Compare(x.ID, y.ID) })
		for _, p := range ps {
			mark := "warning"
			if !p.Warning {
				mark = "ERROR"
			}
			where := p.ID
			if where == "" {
				where = p.File
			}
			fmt.Printf("  %-9s %-7s %s\n", where, mark, p.Msg)
		}
	}
	fmt.Printf("%s: %d errors, %d warnings\n", dir, all.Errors, all.Warnings)
	return nil
}

// today is the game's day now, in Bulgaria.
func today() string { return time.Now().In(play.Bulgaria).Format(time.DateOnly) }

// runway says how long the bank holds the day's questions for each place of a day (play.DayRunway), shortest first,
// and for the questions about Bulgaria a day needs (play.BulgariaRunway): the days from today, the date the place runs
// out on, and a warning under play.RunwayWarn days. With used (the days' questions: `almanac bank used`), the days
// played and drawn ahead are taken off; without, the whole bank counts, which overstates it. The dated questions are
// counted apart: each goes on its own date only. It warns rather than fails: a bank fix must still pass while a short
// place waits for its batch.
func runway(b *bank.Bank, used play.Used, today string) string {
	var s strings.Builder
	if used.IDs == nil {
		fmt.Fprintf(&s, "the day's runway on %s (the whole bank: no day's questions taken off; -used <file> from `almanac bank used` for the truth), shortest first:\n", today)
	} else {
		fmt.Fprintf(&s, "the day's runway on %s (%d questions the days have had taken off, drawn through %s), shortest first:\n",
			today, len(used.IDs), used.Through)
	}
	places := append(play.DayRunway(b, used, today), play.BulgariaRunway(b, used, today))
	slices.SortStableFunc(places, func(x, y play.Runway) int { return x.Days - y.Days })
	for _, r := range places {
		warn := ""
		if r.Days < play.RunwayWarn {
			warn = fmt.Sprintf("   warning: under %d days: write for it first", play.RunwayWarn)
		}
		place := r.Place
		if r.Kinds == nil {
			place = fmt.Sprintf("%s (%d a day)", r.Place, r.PerDay)
		}
		fmt.Fprintf(&s, "  %-34s %5d days, %5d questions, out on %s%s\n", place, r.Days, r.Questions, r.Out, warn)
	}
	n, dates := datedLeft(b, used, today)
	fmt.Fprintf(&s, "  dated („На този ден“, not in the places): %d questions no day has had, for %d of the year's 366 dates", n, dates)
	return s.String()
}

// datedLeft counts the dated questions no day has had whose date is still to come (every year's, or that year's on
// or after today), and how many dates of the year they cover.
func datedLeft(b *bank.Bank, used play.Used, today string) (questions, dates int) {
	covered := map[string]bool{}
	for _, q := range b.Live("", "") {
		if used.IDs[q.Base().ID] || len(q.Extra().On) == 0 {
			continue
		}
		counted := false
		for _, d := range q.Extra().On {
			if len(d) == 10 && d < today {
				continue
			}
			covered[d[len(d)-5:]], counted = true, true
		}
		questions += b2i(counted)
	}
	return questions, len(covered)
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// bankUsed prints the questions the days have had (play.Game.DaysUsed), played and drawn ahead, for `bank check` and
// `bank plan` -used: run it where the game's database is (DB_PATH). Question ids and the last day drawn, nothing of
// a player's, so the file may leave the server.
func bankUsed() error {
	db, err := store.Open(dbPath())
	if err != nil {
		return err
	}
	defer db.Close()
	g := play.New(db, func() *bank.Bank { return nil })
	used, err := g.DaysUsed(context.Background())
	if err != nil {
		return err
	}
	ids := slices.Sorted(maps.Keys(used.IDs))
	fmt.Printf("# the questions the days have had (almanac bank used), %d\n%s%s\n", len(ids), usedThrough, used.Through)
	for _, id := range ids {
		fmt.Println(id)
	}
	return nil
}

// usedThrough starts the line of `bank used` that names the last day drawn.
const usedThrough = "# through "

// readUsed reads a file `bank used` printed: the question ids, one a line, and the last day drawn. No file ("") is
// the zero Used: the whole bank counts.
func readUsed(path string) (play.Used, error) {
	if path == "" {
		return play.Used{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return play.Used{}, err
	}
	used := play.Used{IDs: map[string]bool{}}
	for line := range strings.Lines(string(data)) {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, usedThrough):
			used.Through = strings.TrimPrefix(line, usedThrough)
			if _, err := time.Parse(time.DateOnly, used.Through); err != nil && used.Through != "" {
				return play.Used{}, fmt.Errorf("%s: %q isn't a day", path, used.Through)
			}
		case line == "" || strings.HasPrefix(line, "#"):
		default:
			used.IDs[line] = true
		}
	}
	return used, nil
}

// SubjectMost is how many live questions may name one subject before it's listed; SubjectShare is the share of a
// category one subject should stay under (the questions skill's soft cap); SubjectsShown is how many of each list
// `bank check` shows (`bank subjects` shows them all).
const (
	SubjectMost   = 15
	SubjectShare  = 0.01
	SubjectsShown = 20
)

// bankSubjects lists every subject that comes back (subjects), for a batch that writes away from them or a pass that
// retires the weaker of two identities.
func bankSubjects(dir string) error {
	b, problems := bank.Load(dir)
	if b == nil {
		for _, p := range problems {
			fmt.Println(p)
		}
		return errors.New("fix the errors first")
	}
	fmt.Println(subjects(b, 0))
	return nil
}

// subjects lists, without failing, the subjects that come back (bank.Repeats): the answers and names more than
// SubjectMost live questions name, with the categories they fall in (marked where over SubjectShare of one); and the
// "who or what is this" questions that share an answer (bank.SameIdentity), of which one is enough. Each list stops
// at shown lines (0: all of them).
func subjects(b *bank.Bank, shown int) string {
	var s strings.Builder
	size := map[string]int{}
	for _, c := range b.Categories {
		size[c.ID] = len(b.Live(c.ID, ""))
	}
	// cut says, at line i of n, whether the list stops there, and how many it leaves out.
	cut := func(i, n int) bool {
		if shown > 0 && i == shown {
			fmt.Fprintf(&s, "  … and %d more: almanac bank subjects\n", n-shown)
			return true
		}
		return false
	}
	repeats := b.Repeats(SubjectMost)
	fmt.Fprintf(&s, "subjects that come back: %d named in more than %d live questions (text, options, clues, items; * over %.0f%% of a category)\n",
		len(repeats), SubjectMost, 100*SubjectShare)
	for i, r := range repeats {
		if cut(i, len(repeats)) {
			break
		}
		var where []string
		for _, c := range b.Spread(r) {
			mark := ""
			if float64(c.N) > SubjectShare*float64(size[c.Category]) {
				mark = "*"
			}
			where = append(where, c.String()+mark)
		}
		fmt.Fprintf(&s, "  %5d  %-28s %s\n", len(r.IDs), r.Name, strings.Join(where, ", "))
	}
	same := b.SameIdentity()
	fmt.Fprintf(&s, "the same answer twice: %d \"who or what is this\" answers asked by more than one picture choice or clues (one is enough)\n", len(same))
	for i, g := range same {
		if cut(i, len(same)) {
			break
		}
		fmt.Fprintf(&s, "  %-30s %s\n", g.Name, strings.Join(g.IDs, ", "))
	}
	return strings.TrimRight(s.String(), "\n")
}

// summary counts what a bank holds, by category, type and difficulty.
func summary(b *bank.Bank) string {
	var s strings.Builder
	types := bank.Types()
	fmt.Fprintf(&s, "%s: %d questions (%d live)\n", b.Dir, len(b.Questions), len(b.Live("", "")))
	fmt.Fprintf(&s, "%-12s", "")
	for _, t := range types {
		fmt.Fprintf(&s, "%22s", t+" (e/m/h)")
	}
	s.WriteString("   pictures\n")
	for _, c := range b.Categories {
		fmt.Fprintf(&s, "%-12s", c.ID)
		for _, t := range types {
			n := map[bank.Difficulty]int{}
			for _, q := range b.Live(c.ID, t) {
				n[q.Base().Difficulty]++
			}
			fmt.Fprintf(&s, "%22s", fmt.Sprintf("%d/%d/%d", n[bank.Easy], n[bank.Medium], n[bank.Hard]))
		}
		pictures := 0
		for _, q := range b.Live(c.ID, "") {
			if bank.HasPictures(q) {
				pictures++
			}
		}
		fmt.Fprintf(&s, "%11d\n", pictures)
	}
	s.WriteString(balance(b))
	return strings.TrimRight(s.String(), "\n")
}

// balance says how the bank stands against its aims: a fact and dates on every question, every kind at its share of
// every category.
func balance(b *bank.Bank) string {
	var s strings.Builder
	bal := b.BalanceOf()
	pct := func(n, of int) int {
		if of == 0 {
			return 0
		}
		return int(math.Round(100 * float64(n) / float64(of)))
	}
	all := map[bank.Difficulty]int{}
	for _, n := range bal.Live {
		for d, k := range n {
			all[d] += k
		}
	}
	fmt.Fprintf(&s, "\ndifficulty   %d/%d/%d%% easy/medium/hard (no aim: batches follow the day's runway)\n",
		pct(all[bank.Easy], bal.Total), pct(all[bank.Medium], bal.Total), pct(all[bank.Hard], bal.Total))
	fmt.Fprintf(&s, "facts        %d of %d (%d without)\n", bal.Facts, bal.Total, bal.Total-bal.Facts)
	fmt.Fprintf(&s, "dates        added on %d, updated on %d (of %d)\n", bal.Added, bal.Updated, bal.Total)
	kinds := map[string]int{}
	for _, n := range bal.Types {
		for t, k := range n {
			kinds[t] += k
		}
	}
	s.WriteString("kinds       ")
	for _, t := range bank.TypeOrder {
		share := 0.0
		if bal.Total > 0 {
			share = 100 * float64(kinds[t]) / float64(bal.Total)
		}
		fmt.Fprintf(&s, " %s %.1f%% (aim %.1f)", t, share, 100*bank.TypeMix[t])
	}
	s.WriteString("\n")
	// Each category's kinds against its TypeMix share: what the topic games draw from.
	if bal.Off == 0 {
		s.WriteString("kinds mix    every category at its share of every kind\n")
		return s.String()
	}
	fmt.Fprintf(&s, "kinds mix    %d questions to write for every category to have its share of each kind (+ to write, − over):\n", bal.Off)
	fmt.Fprintf(&s, "  %-10s", "")
	for _, t := range bank.TypeOrder {
		fmt.Fprintf(&s, "%10s", t)
	}
	s.WriteString("\n")
	for _, c := range b.Categories {
		fmt.Fprintf(&s, "  %-10s", c.ID)
		for _, t := range bank.TypeOrder {
			fmt.Fprintf(&s, "%10s", fmt.Sprintf("%+d", bal.Gaps[c.ID][t]))
		}
		s.WriteString("\n")
	}
	return s.String()
}

// bankFmt rewrites the bank's files in their one format. It refuses a bank with errors: fix those first.
func bankFmt(dir string) error {
	b, problems := bank.Load(dir)
	if b == nil {
		for _, p := range problems {
			fmt.Println(p)
		}
		return errors.New("fix the errors first")
	}
	for _, c := range b.Categories {
		if err := bank.WriteCategory(dir, c.ID, b.InCategory(c.ID)); err != nil {
			return err
		}
	}
	return bank.WriteCategories(dir, b.Categories)
}
