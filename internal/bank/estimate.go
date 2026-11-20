package bank

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
)

// What makes a number an estimate a player can place, past its form (number.go): it measures something, not the
// items of a list nobody has counted (Countable); its tolerance is judged where a scale starts from no zero of its own
// (OffsetScale); and nothing in the question shows the answer near enough to score (ruleOwnNumber). The day ends on
// its hard number, so these are where the day is weakest when they fail (the days' audit, 20 Nov 2026: about half the
// closing numbers counted an archive's list).

// listWords are the words that count the items of a list: a text's articles, a composer's works, a player's goals or
// awards, a hall's seats, the times something was done. Kept in an archive, never met: nobody has a sense of how
// many, so a guess is all a player has, unless the question gives an anchor (Rossini's 39 operas is a guess; the
// 66 books of the Bible a famous total). In lower case, the forms a count takes („39 опери“, „63 клаузи“).
var listWords = func() map[string]bool {
	set := map[string]bool{}
	for _, w := range strings.Fields(`статия статии члена членове клаузи клауза параграфа точки творби творба
		награди награда пъти плочки варела варели съда съдове места зрители зрителя гола голове опери оперети песни
		пиеси сонати симфонии концерта стиха стихове стихотворения романа романи разказа книги тома листа листове
		страници статуи колони стъпала медала медали титли трофея турнира турнири епизода епизоди серии сезона мисии
		полета мача мачове победи партии хода ходове скока скокове техники изпълнители спортисти участници депутати
		кандидати подписа гласа стаи етажа прозореца прозорчета знака букви думи зърна района щата префектури
		провинции общини острова читалища обекта игри коня самолета кораба монети екземпляра етюда прелюдии кабини
		реда карти клавиша мандата филма албума сингъла рекорда`) {
		set[w] = true
	}
	return set
}()

// multipliers are the words of a unit that only scale a count („хиляди зрители“: the count is in the text).
var multipliers = map[string]bool{"хил": true, "хиляди": true, "млн": true, "милиона": true, "млрд": true,
	"милиарда": true, "трлн": true, "броя": true}

// ratio is a comparison („…пъти по-голяма“): „пъти“ then measures, it doesn't count; and a rating's „точки“ are a scale
// (OffsetScale), not a count either.
var ratio = regexp.MustCompile(`(?:^|[^\p{L}])по-\p{L}`)

// Countable is the word by which a number question counts the items of a list (Countable: „опери“), or "": its
// unit's, or (a unit that only scales, or none) the text's word for what „колко“ counts.
func Countable(q Question) string {
	n, ok := q.(*Number)
	if !ok || n.IsYear() {
		return ""
	}
	text := strings.ReplaceAll(strings.ToLower(n.Text), "населени места", "селища") // places people live in: no seats
	counts := func(w string) bool {
		return listWords[w] && (w != "пъти" || !ratio.MatchString(text)) && (w != "точки" || !ratingText.MatchString(text))
	}
	scaled := true
	for _, w := range letterWords(strings.ToLower(n.Unit)) {
		if counts(w) {
			return w
		}
		scaled = scaled && multipliers[w]
	}
	if !scaled {
		return ""
	}
	words := letterWords(text)
	for i, w := range words {
		if w != "колко" {
			continue
		}
		for _, next := range words[i+1 : min(len(words), i+4)] {
			if counts(next) {
				return next
			}
		}
	}
	return ""
}

// ruleCountable: a number that counts a list's items is no estimate, unless the bank's waiver names the anchor a
// player has for it (it is then an estimate, for the day's hard number too: Bank.Estimate).
func ruleCountable(q Question) []string {
	if w := Countable(q); w != "" {
		return []string{fmt.Sprintf("„%s“ counts a list nobody has counted: ask it as a choice, or ask what can be placed; "+
			"a true anchor (a famous total) is waived with it (waivers.json, rule countable)", w)}
	}
	return nil
}

// Estimate is whether a number question is worth closing a day on: a quantity with a unit, more than EstimateFrom —
// not a year (no unit) nor a small count, which are choices in disguise — that doesn't count a list (Countable), or
// whose count the bank waives for its anchor.
func (b *Bank) Estimate(q Question) bool {
	n, ok := q.(*Number)
	if !ok || n.Unit == "" || n.Answer <= EstimateFrom {
		return false
	}
	return Countable(q) == "" || b.waived[[2]string{n.ID, "countable"}]
}

// OffsetScale is whether a number's scale has no zero of its own (a temperature in °C, an angle or a latitude in
// degrees, a rating's or a score's points): a share of the answer says nothing there (3/10 of an Elo of 2 816 is
// 840 points, a beginner's), so its tolerance is judged (Tolerance has none for it).
func OffsetScale(n *Number) bool {
	u := strings.ToLower(n.Unit)
	return strings.HasPrefix(u, "°") || slices.Contains(letterWords(u), "точки") ||
		ratingText.MatchString(strings.ToLower(n.Text))
}

// ratingText names a rating: its points are an offset scale, whatever the unit says.
var ratingText = regexp.MustCompile(`(?:^|[^\p{L}])(?:рейтинг\p{L}*|ело)(?:[^\p{L}]|$)`)

// OffsetShare is where a tolerance on an offset scale stops being judged, as a share of the answer: from it on, it is
// the formula's 3/10 by another name (the tolerance rule takes 3/10 down to 1/ToleranceSlack of it: 1/5).
const OffsetShare = 0.2

// ruleOffsetScale: on an offset scale, the tolerance is judged by what a well-read guess misses by, never the 3/10 of
// a quantity; and the scale is linear.
func ruleOffsetScale(q Question) []string {
	n, ok := q.(*Number)
	if !ok || !OffsetScale(n) || n.IsYear() {
		return nil
	}
	if n.Scale == "log" {
		return []string{"an offset scale (°, points, a rating) is linear: a factor says nothing there"}
	}
	if n.Tolerance >= OffsetShare*math.Abs(n.Answer) {
		return []string{fmt.Sprintf("tolerance %s on an offset scale (°, points, a rating): judge what a well-read guess misses by, "+
			"under %.0f%% of the answer", sayNumber(n.Tolerance, 0.01), 100*OffsetShare)}
	}
	return nil
}

// numberWords are the numerals a name may say a number in („Стоте дни“, „Тридесетгодишната война“ is a year's
// count, not this): the tens, the hundreds and a thousand, with the endings a numeral takes („стоте“, „хилядата“).
var numberWords = map[string]float64{"десет": 10, "двадесет": 20, "двайсет": 20, "тридесет": 30, "трийсет": 30,
	"четиридесет": 40, "четирийсет": 40, "петдесет": 50, "шестдесет": 60, "седемдесет": 70, "осемдесет": 80,
	"деветдесет": 90, "сто": 100, "двеста": 200, "триста": 300, "четиристотин": 400, "петстотин": 500,
	"шестстотин": 600, "седемстотин": 700, "осемстотин": 800, "деветстотин": 900, "хиляда": 1000}

// numberWord is a word's value as a numeral, with its ending („стоте“ 100), if it is one.
func numberWord(w string) (float64, bool) {
	w = strings.ToLower(w)
	for _, end := range []string{"", "те", "та", "тина", "тината"} {
		if base, ok := strings.CutSuffix(w, end); ok {
			if v, ok := numberWords[base]; ok {
				return v, true
			}
		}
	}
	return 0, false
}

// notTheCount are numbers a question shows that count something else: a year („през 2024 г.“, for an answer that
// isn't one), a range („16–74 години“), an opus or a number („оп. 28“, „№ 5“), and how a figure is rounded
// („закръглено до сто хиляди“).
var (
	yearAfter   = regexp.MustCompile(`^[\s\x{a0}]*(?:г\.|-те)`)
	rangeBefore = regexp.MustCompile(`[–—-]\s*$`)
	rangeAfter  = regexp.MustCompile(`^\s*[–—-]\s*\d`)
	labelBefore = regexp.MustCompile(`(?:оп\.|№|номер)[\s\x{a0}]*$`)
	rounded     = regexp.MustCompile(`закръглен\p{L}* до [\p{L}\s]+`)
)

// ruleOwnNumber: a number question shows no number (in figures or in words, in its text or a name it quotes) close
// enough to its answer to score: „Стоте дни“ asked as 110 with a tolerance of 33 is answered by its name.
func ruleOwnNumber(q Question) []string {
	n, ok := q.(*Number)
	if !ok || n.Tolerance <= 0 || n.Answer == 0 {
		return nil
	}
	lines := []string{n.Text}
	if n.Image != nil {
		lines = append(lines, n.Image.Alt)
	}
	var out []string
	for _, line := range lines {
		line = rounded.ReplaceAllStringFunc(line, func(m string) string { return strings.Repeat(" ", len(m)) })
		var shown []string
		for _, at := range numbersIn(line) {
			before, after := line[:at.start], line[at.end:]
			year := !n.IsYear() && (yearAfter.MatchString(after) || at.value >= 1000 && at.value <= 2100 && at.value == math.Trunc(at.value))
			if year || rangeBefore.MatchString(before) || rangeAfter.MatchString(after) || labelBefore.MatchString(before) {
				continue
			}
			if n.Closeness(at.value) > 0 {
				shown = append(shown, line[at.start:at.end])
			}
		}
		for _, w := range letterWords(line) {
			if v, ok := numberWord(w); ok && n.Closeness(v) > 0 {
				shown = append(shown, w)
			}
		}
		for _, s := range shown {
			out = append(out, fmt.Sprintf("„%s“ in the question is within the tolerance of the answer (%s): it scores by itself",
				s, AnswerText(q)))
		}
	}
	return out
}
