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
// items, pairs, clues, the fact, the day's line, a picture's description.

// read is every line of a question a player reads, the fact, the day's line and the pictures' descriptions too.
func read(q Question) []string {
	out := append(q.words(), q.Extra().Fact, q.Extra().Day)
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

// Typography the bank keeps one way (bank fmt sets all but the quotes: tidy).
var (
	threeDots   = regexp.MustCompile(`\.\.\.`)
	spacedDash  = regexp.MustCompile(` [-–] `)
	looseYear   = regexp.MustCompile(`\d г\.`)
	foreignMark = regexp.MustCompile(`["”«»]`)
	// looseShare is a percent sign glued to its number or apart by a plain space: the game writes „36 %“, a no-break
	// space between (web/src/game/numbers.ts).
	looseShare = regexp.MustCompile(`(\d) ?%`)
	// looseDegree is an angle's degree sign apart from its number („90 ° с.ш.“): an angle is „90°“, a temperature
	// „25 °C“.
	looseDegree = regexp.MustCompile(`(\d)[ \x{a0}]°([^CF]|$)`)
)

// unquoted applies f to the parts of s outside „…“ quotes: a quoted title keeps its own spelling („18% сиво“).
func unquoted(s string, f func(string) string) string {
	var b strings.Builder
	depth, start := 0, 0
	for i, r := range s {
		switch r {
		case '„':
			if depth == 0 {
				b.WriteString(f(s[start:i]))
				start = i
			}
			depth++
		case '“':
			if depth > 0 {
				depth--
				if depth == 0 {
					b.WriteString(s[start : i+len("“")])
					start = i + len("“")
				}
			}
		}
	}
	if depth > 0 {
		return b.String() + s[start:]
	}
	return b.String() + f(s[start:])
}

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
		case unquoted(s, shareAndDegree) != s:
			out = append(out, "„36 %“ with a no-break space, an angle „90°“ with none (bank fmt sets them): "+s)
		case foreignMark.MatchString(s):
			out = append(out, "quotes are „…“: "+s)
		case strings.Count(s, "„") != strings.Count(s, "“"):
			out = append(out, "a quote opened and not closed, or closed and not opened: "+s)
		}
	}
	return out
}

// tidy sets in a line what the bank writes one way: „…“ for three dots, a dash for a spaced hyphen, a no-break space
// between a number and its „г.“ (so that a year never ends a line without it), and outside quotes one between a
// number and its „%“, none between an angle and its „°“. A web address is left as it is.
func tidy(s string) string {
	if strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://") {
		return s
	}
	s = threeDots.ReplaceAllString(s, "…")
	s = spacedDash.ReplaceAllString(s, " — ")
	s = looseYear.ReplaceAllStringFunc(s, func(m string) string { return strings.Replace(m, " ", " ", 1) })
	return unquoted(s, shareAndDegree)
}

// shareAndDegree sets a percent sign and a degree sign as the game writes them.
func shareAndDegree(s string) string {
	s = looseShare.ReplaceAllString(s, "$1 %")
	return looseDegree.ReplaceAllString(s, "$1°$2")
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

// ruleDated: a question for a day (on) has the line of its day (Tail.Day), a sentence ending in a period, and the
// line names the date (16 декември): one of them, for a question of several days. A moving feast's day (Великден: a
// day of one year, another the next) is named by the feast instead, so its date isn't looked for. A question whose
// own text names its date (the date is what it asks about: „Коя държава празнува на 1 юли…?“) may go without the
// line: the player has read the date, and a line that only says it again takes a phone's screen from the fact.
func ruleDated(q Question) []string {
	t := q.Extra()
	if len(t.On) == 0 {
		return nil
	}
	if t.Day == "" {
		if _, named := namesDate(t.On, q.Base().Text); named {
			return nil
		}
		return []string{"a question for a day (on) has its day's line (day): what happened on the day, naming it"}
	}
	var out []string
	if !strings.ContainsRune(".!…", ends(t.Day)) {
		out = append(out, "its day's line ends in a period")
	}
	if dates, named := namesDate(t.On, t.Day); len(dates) > 0 && !named {
		out = append(out, fmt.Sprintf("its day's line doesn't name the date (%s)", strings.Join(dates, " or ")))
	}
	return out
}

// ruleOwnDate: a true-or-not for a day names no date, and isn't about the day itself. It is dealt on its date, under
// „На този ден“, so a statement that something falls on it („3 юни е Световният ден на велосипеда.“) answers itself,
// and so does its mirror, one that puts it on another date („…празнува Коледа на 7 януари.“ on 25 December: the
// player knows it isn't), or one about the day as such („…са родени в един и същи ден.“). It states something the date
// doesn't give away (who declared it, what it marks). Nor does a choice for a day have its date for the answer („На
// коя дата…?“ — „13 март“): the player knows what day it is.
func ruleOwnDate(q Question) []string {
	on := q.Extra().On
	if len(on) == 0 {
		return nil
	}
	switch q := q.(type) {
	case *TrueFalse:
		if _, named := namesDate(on, q.Text); named {
			return []string{"a true-or-not for a day names its date: dealt on it, under „На този ден“, it answers itself"}
		}
		if m := anyDate.FindStringSubmatch(q.Text); m != nil {
			return []string{fmt.Sprintf("a true-or-not for a day names a date (%s): dealt on its own, under „На този ден“, the player knows whether it's today", m[1])}
		}
		if m := sameDay.FindStringSubmatch(q.Text); m != nil {
			return []string{fmt.Sprintf("a true-or-not for a day is about the day itself („%s“): dealt on it, under „На този ден“, it answers itself", m[1])}
		}
	case *Choice:
		if _, named := namesDate(on, q.Answer); named {
			return []string{"a choice for a day has its date for the answer: dealt on it, under „На този ден“, it answers itself"}
		}
	}
	return nil
}

// anyDate is a date as the bank writes one (7 януари, 1-ви май); sameDay a statement about a day as such („в един и
// същи ден“, „на този ден“).
var (
	anyDate = regexp.MustCompile(`(?:^|[^\d])(\d{1,2}(?:-?\p{L}{1,2})? (?:` + strings.Join(monthNames, "|") + `))(?:[^\p{L}]|$)`)
	sameDay = regexp.MustCompile(`(?i)((?:един и същи|същия|същият|този|днешния) ден)(?:[^\p{L}]|$)`)
)

// namesDate says the every-year days of on as a date writes them (16 декември), and whether s names one of them.
func namesDate(on []string, s string) (dates []string, named bool) {
	for _, d := range on {
		var month, day int
		if len(d) != 5 {
			continue
		}
		if _, err := fmt.Sscanf(d, "%d-%d", &month, &day); err != nil || month < 1 || month > 12 {
			continue // a malformed day is an error of the format
		}
		dates = append(dates, fmt.Sprintf("%d %s", day, monthNames[month-1]))
		date := regexp.MustCompile(fmt.Sprintf(`(?:^|[^\d])0?%d(?:-?\p{L}{1,2})? %s`, day, monthNames[month-1]))
		named = named || date.MatchString(s)
	}
	return dates, named
}

// presentWords are a career, a show or an office told in the present: a player who „играе за“ a club, a fighter who
// „се бие в“ a league, a host who „води предаването“, a show that „се записва всяка вечер“, whoever „е президент на“ a
// country. The bank tells the past in the present too („През 1994 г. Стоичков играе за „Барселона““), so only a line
// with no time of its own is read as now (presentTime), and never in a question that says its subject's life is over
// (lifeOver). In lower case.
var presentWords = regexp.MustCompile(`(?:^|[^\p{L}])(` + strings.Join([]string{
	`играе за`,
	`играе в (?:отбора|тима|клуба|националния|нба|нхл|премиър лийг|ла лига|серия а|бундеслигата)`,
	`(?:се бие|бие се) (?:в|за)`,
	`(?:се състезава|състезава се) (?:за|в|под)`,
	`(?:е|остава) (?:старши |главен )?треньор на`,
	`тренира (?:отбора|тима|клуба|националния)`,
	`(?:е|остава) капитан на`,
	`води (?:предаването|шоуто|рубриката|новините|емисията|сутрешния|вечерния|предаване|шоу)`,
	`(?:е|остава) водещ[аи]? на`,
	`(?:се записва|се снима) (?:всяка|всеки|в зала|в студио)`,
	`заема поста`,
	`(?:е|остава) (?:президент|премиер|министър-председател|кмет|министър|председател|генерален секретар|` +
		`генерален директор|главен изпълнителен директор|канцлер|папа|патриарх|крал|кралица|император) на`,
}, "|") + `)(?:[^\p{L}]|$)`)

// presentTime says a line has a time of its own (a year, a decade, a span, a moment, an order among holders), or
// counts a span (колко години), so its present is the past's.
var presentTime = regexp.MustCompile(`\d{4}|\d0-те|\d+ (?:години|сезона)|(?:^|[^\p{L}])(?:когато|по време на|докато|` +
	`след като|преди|след|от|до|при|през|век|века|вече не|бивш\p{L}*|бил\p{L}*|тогава|едно време|някога|по-късно|` +
	`като дете|колко|пъти|разказва|първ\p{L}*|втор\p{L}*|трет\p{L}*|последн\p{L}*|най-\p{L}+)(?:[^\p{L}]|$)`)

// lifeOver says a question's subject has died: a life's span in years („(1936–2011)“), or its death told.
var lifeOver = regexp.MustCompile(`\d{4}\s*[–—-]\s*\d{4}\)|(?:^|[^\p{L}])(?:умира|почина|почива|загива|убит\p{L}*|` +
	`погребан\p{L}*|посмъртно)(?:[^\p{L}]|$)`)

// ruleStalePresent: a career, a show or an office told as now (presentWords) in a line with no time of its own
// (presentTime) can stop being true: it has reviewBy, or a year that pins it. A false true-or-not stays false.
func ruleStalePresent(q Question) []string {
	if q.Extra().ReviewBy != "" {
		return nil
	}
	if tf, ok := q.(*TrueFalse); ok && !tf.Answer {
		return nil
	}
	lines := append([]string{q.Base().Text, q.Extra().Fact, q.Extra().Day}, cluesOf(q)...)
	if lifeOver.MatchString(strings.ToLower(strings.Join(lines, " "))) {
		return nil
	}
	for _, line := range lines {
		for _, s := range sentences(strings.ToLower(line)) {
			if m := presentWords.FindStringSubmatch(s); m != nil && !presentTime.MatchString(s) {
				return []string{fmt.Sprintf("„%s“ tells a career, a show or an office as now: pin it to a year, or set reviewBy", m[1])}
			}
		}
	}
	return nil
}

// sentences are a line's sentences: cut at „.“, „!“, „?“ and „;“, but not at an abbreviation's period („1878 г.“,
// „хил.“).
func sentences(line string) []string {
	var out []string
	from := 0
	for i, r := range line {
		if strings.ContainsRune(".!?;", r) && (r != '.' || !abbreviation.MatchString(line[from:i+1])) {
			out = append(out, line[from:i])
			from = i + 1
		}
	}
	return append(out, line[from:])
}

// cluesOf are a question's clues, if it has any.
func cluesOf(q Question) []string {
	if c, ok := q.(*Clues); ok {
		return c.Clues
	}
	return nil
}
