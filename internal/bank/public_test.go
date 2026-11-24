package bank

import (
	"slices"
	"testing"
)

// A live question the public sample asks too is an error: the same text, the same question in other words, a number
// asked as a choice, an order with three of its items; never two facts about one answer, nor a retired question.
func TestPublic(t *testing.T) {
	tf := func(id, text string, answer bool) *TrueFalse {
		return &TrueFalse{Head: Head{ID: id, Type: "truefalse", Difficulty: Easy, Text: text}, Answer: answer}
	}
	order := func(id string, items ...OrderItem) *Order {
		return &Order{Head: Head{ID: id, Type: "order", Text: "Подреди:"}, Items: items, Direction: "desc"}
	}
	sample := &Bank{Questions: []Question{
		choice("lit-015", "Кой монах написва „История славянобългарска“ през 1762 г.?", "Паисий Хилендарски"),
		choice("spo-001", "Кой български футболист печели „Златната топка“ през 1994 г.?", "Христо Стоичков"),
		choice("geo-004", "С колко държави граничи България?", "5"),
		number("lit-299", "От колко песни се състои „Божествена комедия“?", 100, 30, "песни"),
		tf("nat-961", "Паяците са насекоми.", false),
		order("geo-904", OrderItem{"Африка", 30.4}, OrderItem{"Европа", 10.2}, OrderItem{"Азия", 44.6}, OrderItem{"Северна Америка", 24.7}),
	}}
	retired := choice("his-900", "Кой монах написва „История славянобългарска“?", "Паисий Хилендарски")
	retired.Retired = true
	b := &Bank{Questions: []Question{
		choice("lit-015", "Кой монах написва „История славянобългарска“?", "Паисий Хилендарски"),     // other words
		choice("lit-299", "От колко песни се състои „Божествена комедия“?", "100", "72", "90", "99"), // made a choice
		order("geo-1343", OrderItem{"Азия", 44.6}, OrderItem{"Африка", 30.4}, OrderItem{"Северна Америка", 24.7}, OrderItem{"Южна Америка", 17.8}),
		tf("nat-960", "Паяците имат осем крака.", true),
		retired,
		choice("spo-086", "Кой български футболист е известен с прякора „Камата“?", "Христо Стоичков"), // another fact
		choice("geo-1591", "С колко държави граничи Румъния?", "5"),                                    // another country
		order("geo-478", OrderItem{"Азия", 4700}, OrderItem{"Африка", 1400}, OrderItem{"Европа", 745}, OrderItem{"Северна Америка", 600}),
	}}
	var got []string
	for _, p := range b.Public(sample) {
		if p.Warning || p.Rule != RulePublic {
			t.Errorf("%s: an error of the public rule, not %v", p.ID, p)
		}
		got = append(got, p.ID)
	}
	if want := []string{"lit-015", "lit-299", "geo-1343"}; !slices.Equal(got, want) {
		t.Errorf("public: %v, want %v", got, want)
	}
	if !slices.Contains(RetiredWhys, RulePublic) {
		t.Errorf("a question the sample asks is retired as %q: RetiredWhys has no such reason", RulePublic)
	}
}
