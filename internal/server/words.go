package server

import (
	"regexp"
	"strconv"
	"strings"
)

var (
	leadingNumber = regexp.MustCompile(`^\d+(?:[  \x{202f}]\d{3})*`)
	readsSZ       = regexp.MustCompile(`(?i)^(?:[сз]|[sz][^h]|[sz]$)`)
)

// withWord is „с“ or „със“ before a word, a name or a number, as the client's withWord (web/src/lib/words.ts) says it:
// „със“ where it's read starting with an с or a з, in either alphabet, past an opening quote („със Стефан Баторий“,
// „с Мечка 12“), or a number read so („със 7“, „с 20“).
func withWord(text string) string {
	s := strings.TrimPrefix(text, "„")
	sz := readsSZ.MatchString(s)
	if n := leadingNumber.FindString(s); n != "" {
		sz = readsWithS(strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, n))
	}
	if sz {
		return "със " + text
	}
	return "с " + text
}

// readsWithS is whether a whole number (its digits) is read in Bulgarian starting with an „с“: седем (7),
// седемнадесет (17), седемдесет… (70–79), сто… (100–199), седемстотин… (700–799); past a thousand, as its leading
// group is read, except a lone one („хиляда“, „милион“).
func readsWithS(digits string) bool {
	d := strings.TrimLeft(digits, "0")
	if d == "" {
		return false
	}
	head := len(d) % 3
	if head == 0 {
		head = 3
	}
	lead, _ := strconv.Atoi(d[:head])
	switch {
	case len(d) > 3 && lead == 1:
		return false
	case lead >= 100:
		return lead/100 == 1 || lead/100 == 7
	case lead >= 10:
		return lead == 17 || lead/10 == 7
	}
	return lead == 7
}
