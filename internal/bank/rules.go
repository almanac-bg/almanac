package bank

import (
	"cmp"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// The bank's rules that code checks: every rule of the questions skill that a program can judge is one of Rules, so
// that a question breaking it is found by `almanac bank check` (and listed by `almanac bank lint`), not by whoever
// remembers the rule. A rule judges one question (its form, its wording, its numbers) or the bank as a whole (one
// question giving another away, the same answer asked twice).
//
// How strict: a question added since StrictFrom must pass every rule (a finding is an error, and the bank isn't
// played); an older one is warned of, so that the bank keeps loading while a content pass fixes it. A finding about
// two questions is an error if either is new: the new one should have been written around the old. A rule marked
// hint only ever warns: it points at what a person should look at, and is right often enough to be worth a look, not
// always. A true exception is waived by the bank's WaiversFile, with its reason.

// StrictFrom is when the rules below became errors for new questions: a question added since then passes all of them.
// A rule added later is strict from its own day (Rule.From), so that the questions added between are warned of, not
// refused with a bank that loaded the day before.
const StrictFrom = "2026-11-17"

// AuditFrom is when the rules the days' audit asked for (countable, offset-scale, own-number, present, twin) became
// errors for new questions.
const AuditFrom = "2026-11-21"

// WaiversFile lists, in a bank's directory, the questions a rule doesn't hold for, and why: [{"id", "rule", "why"}].
// It belongs to the bank (its ids are that bank's questions), so the private bank keeps its own.
const WaiversFile = "waivers.json"

// Waiver is a true exception to a rule: the question keeps what the rule would flag, for the reason given.
type Waiver struct {
	ID   string `json:"id"`
	Rule string `json:"rule"`
	Why  string `json:"why"`
}

// Rule is a rule of the bank that code checks.
type Rule struct {
	Name string
	// Says is the rule in a line, as `bank lint` lists it.
	Says string
	// Hint: never an error, even for a new question (the check is a heuristic: it finds what to look at).
	Hint bool
	// From is when the rule became an error for new questions (StrictFrom if empty).
	From string
	// one judges a question by itself (nil for a rule over the bank).
	one func(q Question) []string
	// all judges the bank's live questions together.
	all func(l *lintBank) []finding
}

// finding is a rule broken: by the questions in ids (the one to fix first), with what's wrong.
type finding struct {
	ids []string
	msg string
}

// Rules are every rule code checks, in the order `bank lint` lists them. Rules of a question's format (lengths,
// counts, dates, fields: check.go and each type's check) are always errors and aren't listed here.
var Rules = []Rule{
	{Name: "ending", Says: "a question ends in „?“ or „:“, a true-or-not statement and a clue in a period", one: ruleEnding},
	{Name: "address", Says: "a question says „ти“ to one player (Подреди, not Подредете)", one: ruleAddress},
	{Name: "fact", Says: "a fact is one or two sentences, ending in a period; never „Интересно е, че…“", one: ruleFact},
	{Name: "typography", Says: "„…“ quotes in pairs, the ellipsis „…“, a spaced dash —, „г.“ held to its year (bank fmt sets the last three)", one: ruleTypography},
	{Name: "language", Says: "Bulgarian words, not the Russian words and loanwords in language.json", one: ruleLanguage},
	{Name: "spelling", Says: "a name spelled one way, as names.json says", one: ruleSpelling},
	{Name: "stale", Says: "wording that can stop being true („към 2026 г.“, „все още“, a record held) has reviewBy", one: ruleStale},
	{Name: "present", Says: "a career, a show or an office told as now (играе за, води предаването, е президент на), with no year, has reviewBy", From: AuditFrom, one: ruleStalePresent},
	{Name: "estimate", Says: "a number question is an estimate: a year, or a quantity over 20 of its steps (a small count is a choice)", one: ruleEstimate},
	{Name: "anchor", Says: "an estimate counts what a well-read player can place, not an archive's count (episodes, seats, words, prize money)", Hint: true, one: ruleAnchor},
	{Name: "countable", Says: "a number doesn't count a list's items (works, awards, articles, seats, goals, times) unless a waiver names its anchor", From: AuditFrom, one: ruleCountable},
	{Name: "closing", Says: "a hard number can close the day: it is an estimate (Bank.Estimate: a quantity with a unit, over 20, not a count of a list)", Hint: true, all: ruleClosing},
	{Name: "tolerance", Says: "a number's tolerance follows the formula (Tolerance): a well-read guess scores about half", one: ruleTolerance},
	{Name: "offset-scale", Says: "on an offset scale (°C, degrees, points, a rating) the tolerance is judged, never the formula's 3/10", From: AuditFrom, one: ruleOffsetScale},
	{Name: "own-number", Says: "a number question's text or a name in it shows no number within the tolerance of its answer („Стоте дни“)", From: AuditFrom, one: ruleOwnNumber},
	{Name: "order-gap", Says: "an order's measured values are 10% apart from their neighbours; exact ones (years, counts) only differ", one: ruleOrderGap},
	{Name: "options", Says: "no option stands out by its form: only the answer with a regnal numeral, in another script, or in quotes", one: ruleOptions},
	{Name: "number-rank", Says: "across the bank and a topic, a choice of numbers has its answer about as often at each of the four ranks, not mostly in the middle", Hint: true, all: ruleNumberRank},
	{Name: "long-answer", Says: "the answer isn't much longer than every wrong option", Hint: true, one: ruleLongAnswer},
	{Name: "answer-word", Says: "no clue, and no question text, shares a word with the answer that the wrong options don't", one: ruleAnswerWord},
	{Name: "dated", Says: "a question for a day (on) has its day's line (day), ending in a period and naming the date, unless its text names it", one: ruleDated},
	{Name: "own-date", Says: "a true-or-not for a day names no date and isn't about the day itself, nor has a choice for a day its date for the answer: dealt on it, it would answer itself", one: ruleOwnDate},
	{Name: "decoy", Says: "a match has a decoy", one: ruleDecoy},
	{Name: "giveaway", Says: "no question shows a value another asks (a year, a number, an order's value) next to the same subject", all: ruleGiveaway},
	{Name: "answer-giveaway", Says: "no question shows a choice's answer as true next to that question's subject", Hint: true, all: ruleAnswerGiveaway},
	{Name: "pair-giveaway", Says: "no question shows both sides of a medium or hard match's pair close together", Hint: true, all: rulePairGiveaway},
	{Name: "shared-items", Says: "two orders share no items in one order or with one value, two matches no pair: one's reveal answers the other", all: ruleSharedItems},
	{Name: "twin", Says: "two choices over one set of options don't ask the same answer, or each other's answers mirrored", From: AuditFrom, all: ruleTwin},
	{Name: "length", Says: "a question reads no longer than its kind's usual allows (bank.Reading past the third quartile by twice the middle half's spread): the clock would run long for it", Hint: true, all: ruleLength},
	{Name: "same-identity", Says: "a \"who or what is this\" answer (a picture choice, clues) is asked once", all: ruleSameIdentity},
}

// RuleNamed finds a rule by its name.
func RuleNamed(name string) (Rule, bool) {
	i := slices.IndexFunc(Rules, func(r Rule) bool { return r.Name == name })
	if i < 0 {
		return Rule{}, false
	}
	return Rules[i], true
}

// Other names a Problem's Rule may have: warnings about the bank's upkeep rather than a question's quality.
const (
	RuleReview  = "review"  // a question due for review (reviewBy)
	RuleRetired = "retired" // retired without a reason
	RulePicture = "picture" // a picture no question uses
	RuleWaiver  = "waiver"  // a waiver that waives nothing
)

// readWaivers reads a bank's waivers, if it has any.
func readWaivers(dir string) ([]Waiver, error) {
	data, err := os.ReadFile(filepath.Join(dir, WaiversFile))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	var ws []Waiver
	if err := strictJSON(data, &ws); err != nil {
		return nil, err
	}
	return ws, nil
}

// lint runs every rule over a loaded bank's questions not retired (those of a kind Off too: newLintBank) and says what it found: errors for what a question added
// since StrictFrom breaks, warnings for the rest, nothing for what a waiver covers. where says each question's file
// and line. The bank keeps what the waivers lift (Bank.Estimate reads it).
func (b *Bank) lint(waivers []Waiver, where map[string]Problem) []Problem {
	var out []Problem
	waived := map[[2]string]bool{}
	b.waived = waived
	for _, w := range waivers {
		at := Problem{File: WaiversFile, ID: w.ID}
		q, ok := b.Get(w.ID)
		switch {
		case !ok:
			at.Msg = "no such question"
		case w.Rule == "":
			at.Msg = "a waiver names the rule it waives"
		case w.Why == "":
			at.Msg = "a waiver says why the rule doesn't hold"
		default:
			if _, known := RuleNamed(w.Rule); !known {
				at.Msg = "no such rule: " + w.Rule
			} else if q.Extra().Retired {
				at.Msg, at.Warning, at.Rule = "the question is retired: the waiver can go", true, RuleWaiver
			}
		}
		if at.Msg != "" {
			out = append(out, at)
		}
		waived[[2]string{w.ID, w.Rule}] = true
	}
	used := map[[2]string]bool{}
	l := newLintBank(b)
	report := func(r Rule, f finding) {
		for _, id := range f.ids {
			if k := [2]string{id, r.Name}; waived[k] {
				used[k] = true
				return
			}
		}
		strict, from := false, cmp.Or(r.From, StrictFrom)
		for _, id := range f.ids {
			q, _ := b.Get(id)
			strict = strict || q.Extra().Added >= from
		}
		at := where[f.ids[0]]
		out = append(out, Problem{File: at.File, Line: at.Line, ID: f.ids[0], Msg: f.msg, Rule: r.Name, Warning: r.Hint || !strict})
	}
	for _, r := range Rules {
		if r.one != nil {
			for _, q := range l.live {
				for _, msg := range r.one(q) {
					report(r, finding{ids: []string{q.Base().ID}, msg: msg})
				}
			}
		}
		if r.all != nil {
			for _, f := range r.all(l) {
				report(r, f)
			}
		}
	}
	for _, w := range waivers {
		k := [2]string{w.ID, w.Rule}
		if q, ok := b.Get(w.ID); ok && !q.Extra().Retired && !used[k] {
			if _, known := RuleNamed(w.Rule); known && w.Why != "" {
				out = append(out, Problem{File: WaiversFile, ID: w.ID, Rule: RuleWaiver, Warning: true,
					Msg: fmt.Sprintf("the %s rule finds nothing to waive: the waiver can go", w.Rule)})
			}
		}
	}
	return out
}

// newer orders two questions' ids so that the one to fix comes first: the one added later (the one that should have
// been written around the other), then the higher id.
func (l *lintBank) newer(a, b Question) []string {
	ta, tb := a.Extra().Added, b.Extra().Added
	if ta > tb || (ta == tb && a.Base().ID > b.Base().ID) {
		return []string{a.Base().ID, b.Base().ID}
	}
	return []string{b.Base().ID, a.Base().ID}
}

// Count counts problems by rule, the errors and the warnings apart: what `bank check` ends with.
type Count struct {
	Errors, Warnings int
	// ByRule counts each rule's problems ("" for a problem of the format), errors and warnings together.
	ByRule map[string]int
}

// CountOf counts problems.
func CountOf(problems []Problem) Count {
	t := Count{ByRule: map[string]int{}}
	for _, p := range problems {
		if p.Warning {
			t.Warnings++
		} else {
			t.Errors++
		}
		t.ByRule[p.Rule]++
	}
	return t
}

func (t Count) String() string {
	var parts []string
	for i, r := range ruleOrder() {
		if n := t.ByRule[r]; n > 0 {
			parts = append(parts, fmt.Sprintf("%s %d", RuleOrder()[i], n))
		}
	}
	s := fmt.Sprintf("%d errors, %d warnings", t.Errors, t.Warnings)
	if len(parts) > 0 {
		s += " (" + strings.Join(parts, ", ") + ")"
	}
	return s
}

// ruleOrder is every rule name a Problem may have, in the order reports list them: the format ("format" for ""),
// then Rules, then the upkeep warnings.
func ruleOrder() []string {
	out := []string{""}
	for _, r := range Rules {
		out = append(out, r.Name)
	}
	return append(out, RuleReview, RuleRetired, RulePicture, RuleWaiver)
}

// RuleOrder is ruleOrder with "format" for the problems of the format.
func RuleOrder() []string {
	out := ruleOrder()
	out[0] = "format"
	return out
}
