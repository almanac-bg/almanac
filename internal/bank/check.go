package bank

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Limits on what players read, so that every question fits a phone's screen without scrolling.
const (
	textMax      = 160 // a question
	imageTextMax = 60  // a question about a picture: the picture carries the rest
	optionMax    = 60  // a choice's option
	itemMax      = 45  // an order's item
	pairMax      = 30  // a side of a match's pair: two columns on a phone
	groupMax     = 24  // a split's group: two buttons side by side on a phone
	unitMax      = 12
	factMax      = 200 // "Знаеше ли?": one or two sentences, read at a glance
	dayMax       = 100 // the line of a question's day („На този ден“): one short sentence
)

var idPattern = regexp.MustCompile(`^[a-z]+-[0-9]+$`)

// RulesFrom is when the bank's rules for new questions took effect: a question added since then has a fact and
// the date it last changed. (Older questions get theirs as they're gone over.)
const RulesFrom = "2026-11-14"

// SourcesFrom is when the bank started keeping where each question was checked: a question added since then has its
// sources, and when and by what it was checked (Tail.Sources, Checked, CheckedBy).
const SourcesFrom = "2026-11-17"

// TouchedFrom is when a change started needing its sources too: a question changed since then (updated) has them, so
// that the bank's sources grow with every fix, and the next one starts from where the last was checked.
const TouchedFrom = "2026-11-19"

// ShortFactsFrom is when a new question's fact became at most shortFactMax characters: on a phone it shows under the
// answer, with the day's line on a day's date, and a fact that runs past four lines is cut there.
const ShortFactsFrom = "2026-11-19"

// shortFactMax is the most a fact of a question added since ShortFactsFrom says.
const shortFactMax = 140

// Problem is something wrong with a bank. A bank with errors is never played; warnings are for whoever keeps it.
type Problem struct {
	File string
	Line int
	ID   string
	Msg  string
	// Rule is the rule broken (Rules, or an upkeep warning: RuleReview…); "" for the format.
	Rule    string
	Warning bool
}

func (p Problem) String() string {
	var b strings.Builder
	if p.File != "" {
		b.WriteString(p.File)
		if p.Line > 0 {
			fmt.Fprintf(&b, ":%d", p.Line)
		}
		b.WriteString(": ")
	}
	if p.ID != "" {
		b.WriteString(p.ID + ": ")
	}
	if p.Warning {
		b.WriteString("warning: ")
	}
	if p.Rule != "" {
		b.WriteString("[" + p.Rule + "] ")
	}
	b.WriteString(p.Msg)
	return b.String()
}

// checkQuestion finds what's wrong with one question's format: the fields every type shares, then its type's own
// rules. Its warnings are about upkeep (a reason to retire, a review due), each with its rule.
func checkQuestion(q Question, today string) (errs []string, warnings []Problem) {
	h, t := q.Base(), q.Extra()
	if !idPattern.MatchString(h.ID) {
		errs = append(errs, "id must be like gen-001")
	}
	switch h.Difficulty {
	case Easy, Medium, Hard:
	default:
		errs = append(errs, `difficulty must be "easy", "medium" or "hard"`)
	}
	limit := textMax
	if HasPictures(q) {
		limit = imageTextMax
	}
	errs = append(errs, checkLine("text", h.Text, limit)...)
	if t.Image != nil {
		errs = append(errs, t.Image.check()...)
	}
	if t.Fact != "" {
		most := factMax
		if t.Added >= ShortFactsFrom {
			most = shortFactMax
		}
		errs = append(errs, checkLine("fact", t.Fact, most)...)
	}
	if t.Day != "" {
		errs = append(errs, checkLine("day", t.Day, dayMax)...)
		if len(t.On) == 0 {
			errs = append(errs, "day is the line of a question for a day: it goes with on")
		}
	}
	errs = append(errs, checkDate("added", t.Added)...)
	errs = append(errs, checkDate("changed", t.Changed)...)
	errs = append(errs, checkDate("updated", t.Updated)...)
	errs = append(errs, checkDate("checked", t.Checked)...)
	errs = append(errs, checkDate("reviewBy", t.ReviewBy)...)
	for _, u := range t.Sources {
		if !strings.HasPrefix(u, "https://") || strings.ContainsAny(u, " \t\n") {
			errs = append(errs, "a source is a page's address (https://…): "+u)
		}
	}
	if (t.Checked == "") != (t.CheckedBy == "") {
		errs = append(errs, "checked and checkedBy go together: when, and by what")
	}
	if t.RetiredWhy != "" && !slices.Contains(RetiredWhys, t.RetiredWhy) {
		errs = append(errs, "retiredWhy is one of "+strings.Join(RetiredWhys, ", "))
	}
	if !t.Retired && (t.RetiredWhy != "" || t.ReplacedBy != "") {
		errs = append(errs, "retiredWhy and replacedBy are for a retired question")
	}
	if t.Retired && t.RetiredWhy == "" {
		warnings = append(warnings, Problem{Rule: RuleRetired, Msg: "retired without a reason (retiredWhy)"})
	}
	for _, d := range t.On {
		full := d
		if len(d) == 5 {
			full = "2024-" + d // a leap year: 02-29 is a day too
		}
		if _, err := time.Parse(time.DateOnly, full); err != nil {
			errs = append(errs, `on must list days like "03-03" (every year) or "2027-05-02" (that year)`)
		}
	}
	if t.Updated != "" && t.Added != "" && t.Updated < t.Added {
		errs = append(errs, "updated is before added")
	}
	if t.Changed != "" && (t.Changed < t.Added || (t.Updated != "" && t.Changed > t.Updated)) {
		errs = append(errs, "changed is between added and updated")
	}
	if t.Added >= SourcesFrom && !t.Retired {
		if len(t.Sources) == 0 {
			errs = append(errs, "a question added since "+SourcesFrom+" needs its sources")
		}
		if t.Checked == "" {
			errs = append(errs, "a question added since "+SourcesFrom+" needs checked and checkedBy")
		}
	} else if t.Updated >= TouchedFrom && !t.Retired {
		if len(t.Sources) == 0 {
			errs = append(errs, "a question changed since "+TouchedFrom+" needs its sources: the pages the change was checked on")
		}
		if t.Checked == "" {
			errs = append(errs, "a question changed since "+TouchedFrom+" needs checked and checkedBy")
		}
	}
	if t.Added >= RulesFrom && !t.Retired {
		if t.Fact == "" {
			errs = append(errs, "a question added since "+RulesFrom+" needs a fact („Знаеше ли?“)")
		}
		if t.Updated == "" {
			errs = append(errs, "a question added since "+RulesFrom+" needs updated (the day it last changed)")
		}
	}
	if m, ok := q.(*Match); ok && m.Decoy == "" && !t.Retired && t.Added >= DecoysFrom {
		errs = append(errs, "a match added since "+DecoysFrom+" needs a decoy")
	}
	if off, ok := Off[h.Type]; ok && t.Added >= off && !t.Retired {
		errs = append(errs, "no new "+h.Type+" question is written: the kind is off since "+off+" (bank.Off)")
	}
	if t.ReviewBy != "" && t.ReviewBy <= today && !t.Retired {
		warnings = append(warnings, Problem{Rule: RuleReview, Msg: "due for review since " + t.ReviewBy})
	}
	errs = append(errs, q.check()...)
	return errs, warnings
}

// checkLine: a line of text a player reads, with nothing stray around or inside it.
func checkLine(field, s string, max int) []string {
	switch {
	case s == "":
		return []string{field + " is empty"}
	case strings.TrimSpace(s) != s:
		return []string{field + " has spaces around it"}
	case strings.IndexFunc(s, unicode.IsControl) >= 0:
		r, _ := utf8.DecodeRuneInString(s[strings.IndexFunc(s, unicode.IsControl):])
		return []string{fmt.Sprintf("%s has a control character (U+%04X): a line break, a tab, or a byte a substitution left", field, r)}
	case strings.Contains(s, "  "):
		return []string{field + " has a double space"}
	case utf8.RuneCountInString(s) > max:
		return []string{fmt.Sprintf("%s is over %d characters", field, max)}
	}
	return checkLetters(field, s)
}

// foreignLetters are Cyrillic letters Bulgarian doesn't use: they come in with Russian words, names and quotes.
const foreignLetters = "\u0451\u044b\u044d\u0401\u042b\u042d" // io, yeru and e, small and capital

// checkLetters: a player reads only Bulgarian letters (a Russian name is written the Bulgarian way: Грозни).
func checkLetters(field, s string) []string {
	if i := strings.IndexAny(s, foreignLetters); i >= 0 {
		r, _ := utf8.DecodeRuneInString(s[i:])
		return []string{fmt.Sprintf("%s has %c, a letter Bulgarian doesn't use", field, r)}
	}
	return nil
}

func checkLength(field, s string, min, max int) []string {
	if n := utf8.RuneCountInString(strings.TrimSpace(s)); n < min || n > max {
		return []string{fmt.Sprintf("%s must be %d–%d characters", field, min, max)}
	}
	return nil
}

func checkUnit(u string) []string {
	if u == "" {
		return nil
	}
	return checkLine("unit", u, unitMax)
}

func checkURL(field, s string) []string {
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return []string{field + " must be an https:// address"}
	}
	return nil
}

func checkDate(field, s string) []string {
	if s == "" {
		return nil
	}
	if _, err := time.Parse(time.DateOnly, s); err != nil {
		return []string{field + " must be a date like 2026-11-12"}
	}
	return nil
}

// strictJSON decodes exactly one JSON value into v, refusing fields v doesn't have: a typo in the bank, or a client
// sending what it shouldn't, is an error rather than silently ignored.
func strictJSON(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var wrong *json.UnmarshalTypeError
		if errors.As(err, &wrong) && wrong.Field != "" {
			return fmt.Errorf("%s is %s, and takes %s", wrong.Field, jsonKinds[wrong.Value], takes(wrong.Type))
		}
		return err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errors.New("more than one JSON value")
	}
	return nil
}

// jsonKinds are JSON's values as a refusal names them (json.UnmarshalTypeError.Value).
var jsonKinds = map[string]string{"string": "text", "number": "a number", "bool": "true or false", "array": "a list",
	"object": "an object"}

// takes names what a field takes, by its type: for whoever wrote „"answer": 5“ where a choice's answer is text.
func takes(t reflect.Type) string {
	switch t.Kind() {
	case reflect.String:
		return "text"
	case reflect.Bool:
		return "true or false"
	case reflect.Slice, reflect.Array:
		return "a list"
	case reflect.Struct, reflect.Map, reflect.Pointer:
		return "an object"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return "a whole number"
	}
	return "a number"
}
