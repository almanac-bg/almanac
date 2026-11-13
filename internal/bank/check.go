package bank

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Limits on what players read, so that every question fits a phone's screen without scrolling.
const (
	textMax      = 160 // a question
	imageTextMax = 60  // a question about a picture: the picture carries the rest
	optionMax    = 60  // a choice's option
	itemMax      = 45  // an order's item
	pairMax      = 30  // a side of a match's pair: two columns on a phone
	unitMax      = 12
	factMax      = 200 // "Знаеше ли?": one or two sentences, read at a glance
)

var idPattern = regexp.MustCompile(`^[a-z]+-[0-9]+$`)

// RulesFrom is when the bank's rules for new questions took effect: a question added since then has a fact and
// the date it last changed. (Older questions get theirs as they're gone over.)
const RulesFrom = "2026-11-14"

// Problem is something wrong with a bank. A bank with errors is never played; warnings are for whoever keeps it.
type Problem struct {
	File    string
	Line    int
	ID      string
	Msg     string
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
	b.WriteString(p.Msg)
	return b.String()
}

// checkQuestion finds what's wrong with one question: the fields every type shares, then its type's own rules.
func checkQuestion(q Question, today string) (errs, warnings []string) {
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
	if t.Image != nil {
		limit = imageTextMax
	}
	errs = append(errs, checkLine("text", h.Text, limit)...)
	if t.Image != nil {
		errs = append(errs, t.Image.check()...)
	}
	if t.Fact != "" {
		errs = append(errs, checkLine("fact", t.Fact, factMax)...)
	}
	errs = append(errs, checkDate("added", t.Added)...)
	errs = append(errs, checkDate("updated", t.Updated)...)
	errs = append(errs, checkDate("reviewBy", t.ReviewBy)...)
	if t.Updated != "" && t.Added != "" && t.Updated < t.Added {
		errs = append(errs, "updated is before added")
	}
	if t.Added >= RulesFrom && !t.Retired {
		if t.Fact == "" {
			errs = append(errs, "a question added since "+RulesFrom+" needs a fact („Знаеше ли?“)")
		}
		if t.Updated == "" {
			errs = append(errs, "a question added since "+RulesFrom+" needs updated (the day it last changed)")
		}
	}
	if t.ReviewBy != "" && t.ReviewBy <= today && !t.Retired {
		warnings = append(warnings, "due for review since "+t.ReviewBy)
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
	case strings.ContainsAny(s, "\n\r\t"):
		return []string{field + " has a line break or tab"}
	case strings.Contains(s, "  "):
		return []string{field + " has a double space"}
	case utf8.RuneCountInString(s) > max:
		return []string{fmt.Sprintf("%s is over %d characters", field, max)}
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
		return err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errors.New("more than one JSON value")
	}
	return nil
}
