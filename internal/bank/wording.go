package bank

import (
	_ "embed"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// The rules of a question's wording (the skill's „Bulgarian, as the bank writes it“): how its lines end, its
// typography, its words and names, and what may go stale. They read everything a player reads: the text, the options,
// items, pairs, clues, the fact, a picture's description.

// read is every line of a question a player reads, the fact and the pictures' descriptions too.
func read(q Question) []string {
	out := append(q.words(), q.Extra().Fact)
	for _, im := range picturesOf(q) {
		out = append(out, im.Alt)
	}
	return out
}

// ends is a line's last mark, past its closing quotes and brackets: a quote ends a sentence with its own mark
// (… каза „Да!“).
func ends(s string) rune {
	r, _ := utf8.DecodeLastRuneInString(strings.TrimRight(s, "“)»"))
	return r
}

func ruleEnding(q Question) []string {
	var out []string
	text := q.Base().Text
	if _, ok := q.(*TrueFalse); ok {
		if !strings.ContainsRune(".!…", ends(text)) {
			out = append(out, "a true-or-not statement ends in a period")
		}
	} else if !strings.ContainsRune("?:", ends(text)) {
		out = append(out, "a question ends in „?“ or „:“")
	}
	if c, ok := q.(*Clues); ok {
		for _, clue := range c.Clues {
			if !strings.ContainsRune(".!…", ends(clue)) {
				out = append(out, "a clue is a sentence ending in a period: "+clue)
			}
		}
	}
	return out
}

// plural is a question that speaks to more than one player, or formally („Довършете“, „Подредете“): the game says
// „ти“ to one player (web/DESIGN.md).
var plural = regexp.MustCompile(`^(?:Довършете|Подредете|Свържете|Посочете|Изберете|Разделете|Отгатнете|Познайте|Кажете|Намерете|Определете)(?:[^\p{L}]|$)`)

func ruleAddress(q Question) []string {
	if m := plural.FindString(q.Base().Text); m != "" {
		return []string{fmt.Sprintf("„%s“: the game says „ти“ to one player", strings.TrimRight(m, " :,"))}
	}
	return nil
}

// sentenceEnd is a mark that ends a sentence when a capital follows.
var sentenceEnd = regexp.MustCompile(`[.!?…]“? +\p{Lu}`)

func ruleFact(q Question) []string {
	f := q.Extra().Fact
	if f == "" {
		return nil // a new question without one is an error of the format (RulesFrom)
	}
	var out []string
	if !strings.ContainsRune(".!?…", ends(f)) {
		out = append(out, "a fact ends in a period")
	}
	if strings.HasPrefix(f, "Интересно") {
		out = append(out, "a fact says what is surprising, not that it is („Интересно е, че…“)")
	}
	sentences := 1
	for _, m := range sentenceEnd.FindAllStringIndex(f, -1) {
		if !abbreviation.MatchString(f[:m[0]+1]) {
			sentences++
		}
	}
	if sentences > 2 {
		out = append(out, fmt.Sprintf("a fact is one or two sentences, not %d", sentences))
	}
	return out
}

// Typography the bank keeps one way (bank fmt sets the first three: tidy).
var (
	threeDots   = regexp.MustCompile(`\.\.\.`)
	spacedDash  = regexp.MustCompile(` [-–] `)
	looseYear   = regexp.MustCompile(`\d г\.`)
	foreignMark = regexp.MustCompile(`["”«»]`)
)

func ruleTypography(q Question) []string {
	var out []string
	for _, s := range read(q) {
		switch {
		case threeDots.MatchString(s):
			out = append(out, "three dots for „…“ (bank fmt sets it): "+s)
		case spacedDash.MatchString(s):
			out = append(out, "a hyphen for a dash: „ — “ (bank fmt sets it): "+s)
		case looseYear.MatchString(s):
			out = append(out, "„г.“ apart from its number: a no-break space (bank fmt sets it): "+s)
		case foreignMark.MatchString(s):
			out = append(out, "quotes are „…“: "+s)
		case strings.Count(s, "„") != strings.Count(s, "“"):
			out = append(out, "a quote opened and not closed, or closed and not opened: "+s)
		}
	}
	return out
}

// tidy sets in a line what the bank writes one way: „…“ for three dots, a dash for a spaced hyphen, a no-break space
// between a number and its „г.“ (so that a year never ends a line without it). A web address is left as it is.
func tidy(s string) string {
	if strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://") {
		return s
	}
	s = threeDots.ReplaceAllString(s, "…")
	s = spacedDash.ReplaceAllString(s, " — ")
	return looseYear.ReplaceAllStringFunc(s, func(m string) string { return strings.Replace(m, " ", " ", 1) })
}

// language.json is the one list of the Russian words and the loanwords the game doesn't use, with the Bulgarian
// words to use instead: the client's language test (web/src/language.test.ts) reads it too.
//
//go:embed language.json
var languageJSON []byte

// avoid is every form of a word to avoid (lower case), with what it is and what to say instead.
var avoid = func() map[string][2]string {
	var l struct {
		Russian map[string]string `json:"russian"`
		Loans   map[string]string `json:"loans"`
	}
	if err := strictJSON(languageJSON, &l); err != nil {
		panic("language.json: " + err.Error())
	}
	out := map[string][2]string{}
	for kind, m := range map[string]map[string]string{"Russian": l.Russian, "a loanword": l.Loans} {
		for forms, instead := range m {
			for _, f := range strings.Split(forms, "|") {
				out[f] = [2]string{kind, instead}
			}
		}
	}
	return out
}()

func ruleLanguage(q Question) []string {
	var out []string
	for _, s := range read(q) {
		for _, w := range letterWords(s) {
			if a, ok := avoid[strings.ToLower(w)]; ok {
				out = append(out, fmt.Sprintf("„%s“ is %s: say %s", w, a[0], a[1]))
			}
		}
	}
	return out
}

// names.json is the bank's spelling of names written more than one way: for each, the spelling to use, the ones not
// to, and the phrases a "not" may stand in (Северна Холандия is a province, not the country). A spelling without
// quotes is looked for outside quotes only (a quoted title keeps its own), and a spelling that differs from the one
// to use only by its capital is fine where a sentence or a label starts.
//
//go:embed names.json
var namesJSON []byte

type name struct {
	Use    string   `json:"use"`
	Not    []string `json:"not"`
	Except []string `json:"except,omitempty"`
}

var names = func() []name {
	var ns []name
	if err := strictJSON(namesJSON, &ns); err != nil {
		panic("names.json: " + err.Error())
	}
	return ns
}()

// misspelled finds a spelling not to use in s, and the one to use.
func misspelled(s string) (not, use string, ok bool) {
	plain := outsideQuotes(s)
	for _, n := range names {
		for _, v := range n.Not {
			in := plain
			if strings.HasPrefix(v, "„") {
				in = s
			}
			for at := 0; ; {
				i := strings.Index(in[at:], v)
				if i < 0 {
					break
				}
				i += at
				at = i + len(v)
				before, _ := utf8.DecodeLastRuneInString(in[:i])
				after, _ := utf8.DecodeRuneInString(in[at:])
				if unicode.IsLetter(before) || unicode.IsLetter(after) {
					continue // part of another word
				}
				if strings.EqualFold(v, n.Use) && sentenceStart(s[:i]) {
					continue
				}
				if within(s, i, at, n.Except) {
					continue
				}
				return v, n.Use, true
			}
		}
	}
	return "", "", false
}

// within is whether s[i:j] is part of one of phrases where it stands.
func within(s string, i, j int, phrases []string) bool {
	for _, p := range phrases {
		for at := 0; ; {
			k := strings.Index(s[at:], p)
			if k < 0 {
				break
			}
			k += at
			if k <= i && j <= k+len(p) {
				return true
			}
			at = k + 1
		}
	}
	return false
}

func ruleSpelling(q Question) []string {
	var out []string
	for _, s := range read(q) {
		if not, use, ok := misspelled(s); ok {
			out = append(out, fmt.Sprintf("„%s“ is written %s here", strings.Trim(not, "„“"), use))
		}
	}
	return out
}

// staleWords are wording that ties a question to the time it was written: an answer true „към 2026 г.“, „все още“,
// „в момента“, the oldest that „still“ works, a record someone holds. Measured on the real bank (16 Nov 2026), these
// find what can stop being true; „днес“, „последният“ and „най-новият“ were left out: in the bank they mostly say
// where something is kept today or which way an order runs, and stay true. In lower case.
var staleWords = regexp.MustCompile(strings.Join([]string{
	`към (?:края на |началото на |средата на )?(?:\d{1,2} \p{L}+ )?20\d\d`,
	`(?:^|[^\p{L}])в момента(?: |[.,]|$)(?:на )?`,
	`все още`,
	`сегашни(?:ят|я|те)?(?:[^\p{L}]|$)`,
	`понастоящем`,
	`(?:най-стар|най-дълго)\p{L}* (?:все още )?действащ`,
	`държи (?:\p{L}+ )?рекорд`,
	`рекордьор`,
	`досега`,
}, "|"))

// staleHint finds, in a line in lower case, the words staleWords starts from: quick, to skip the lines without.
var staleHint = []string{"към ", "момента", "все още", "сегашн", "понастоящем", "действащ", "рекорд", "досега"}

func ruleStale(q Question) []string {
	if q.Extra().ReviewBy != "" {
		return nil
	}
	for _, s := range read(q) {
		s = strings.ToLower(s) // the expressions are in lower case: (?i) makes them slow
		if !slices.ContainsFunc(staleHint, func(h string) bool { return strings.Contains(s, h) }) {
			continue
		}
		for _, m := range staleWords.FindAllString(s, -1) {
			if strings.HasSuffix(m, "на ") {
				continue // „в момента на удара“: the moment of something, not now
			}
			return []string{fmt.Sprintf("„%s“ can stop being true: set reviewBy (when to check it again)", strings.TrimSpace(strings.Trim(m, " .,")))}
		}
	}
	return nil
}

// monthNames are the months as a date writes them (3 март).
var monthNames = []string{"януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"}

// ruleDated: a question for a day of every year says in its fact why the day: the date itself (3 март). A moving
// feast's (Великден: a day of one year, another the next) names the feast instead, and isn't checked.
func ruleDated(q Question) []string {
	t := q.Extra()
	var out []string
	for _, d := range t.On {
		var month, day int
		if len(d) != 5 {
			continue
		}
		if _, err := fmt.Sscanf(d, "%d-%d", &month, &day); err != nil || month < 1 || month > 12 {
			continue // a malformed day is an error of the format
		}
		date := regexp.MustCompile(fmt.Sprintf(`(?:^|[^\d])0?%d(?:-?\p{L}{1,2})? %s`, day, monthNames[month-1]))
		if !date.MatchString(t.Fact) {
			out = append(out, fmt.Sprintf("its fact doesn't say the day it is for (%d %s)", day, monthNames[month-1]))
		}
	}
	return out
}
