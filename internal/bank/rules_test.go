package bank

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// bankOf makes a bank of questions in one category, for the rules over a bank, among 300 others that share no
// word with them: how much a shared word says depends on how few questions have it.
func bankOf(qs ...Question) *Bank {
	b := &Bank{Categories: []Category{{"gen", "Общи"}}, byID: map[string]Question{}}
	for i := range 1500 {
		qs = append(qs, &TrueFalse{Head: Head{ID: fmt.Sprintf("pad-%d", i), Type: "truefalse", Text: "Пълнеж."}})
	}
	for _, q := range qs {
		q.Base().Category = "gen"
		b.Questions = append(b.Questions, q)
		b.byID[q.Base().ID] = q
	}
	return b
}

// found is what the rules say of a bank: "rule id" for each finding, "!" before the rule for an error.
func found(b *Bank, waivers ...Waiver) []string {
	var out []string
	for _, p := range b.lint(waivers, map[string]Problem{}) {
		if strings.HasPrefix(p.ID, "pad-") {
			continue
		}
		mark := ""
		if !p.Warning {
			mark = "!"
		}
		out = append(out, mark+p.Rule+" "+p.ID)
	}
	return out
}

func choice(id, text, answer string, wrong ...string) *Choice {
	return &Choice{Head: Head{ID: id, Type: "choice", Difficulty: Medium, Text: text}, Answer: answer, Wrong: wrong,
		Tail: Tail{Fact: "Факт.", Added: "2026-11-01"}}
}

func number(id, text string, answer, tolerance float64, unit string) *Number {
	return &Number{Head: Head{ID: id, Type: "number", Difficulty: Medium, Text: text}, Answer: answer, Unit: unit,
		Step: 1, Scale: "linear", Tolerance: tolerance, Tail: Tail{Fact: "Факт.", Added: "2026-11-01"}}
}

// avoiding is a word language.json says not to use, of a kind ("Russian", "a loanword").
func avoiding(kind string) string {
	for w, a := range avoid {
		if a[0] == kind {
			return w
		}
	}
	return ""
}

// Each rule of a question, broken and kept.
func TestRulesOfAQuestion(t *testing.T) {
	plain := func(id string) *Choice {
		return choice(id, "Коя е столицата на Франция?", "Париж", "Лион", "Марсилия", "Ница")
	}
	for _, c := range []struct {
		rule string
		q    Question
		bad  bool
	}{
		{"ending", plain("a"), false},
		{"ending", choice("a", "Довърши поговорката: „Рано пиле…“", "рано пее", "късно", "рано", "пее"), true},
		{"ending", &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "Китът е бозайник"}}, true},
		{"address", choice("a", "Довършете поговорката: „Рано пиле…“?", "рано пее", "късно", "рано", "пее"), true},
		{"fact", func() Question { q := plain("a"); q.Fact = "Без точка"; return q }(), true},
		{"fact", func() Question { q := plain("a"); q.Fact = "Едно. Две. Три изречения."; return q }(), true},
		{"fact", func() Question {
			q := plain("a")
			q.Fact = "През 1804 г. е едно. А това е второ."
			return q
		}(), false},
		{"typography", choice("a", "Кой пее „...Baby One More Time“?", "Бритни Спиърс", "Мадона", "Шер", "Пинк"), true},
		{"typography", choice("a", "Какво става през 1878 г.?", "Освобождението", "Съединението", "Независимостта", "Войната"), true},
		{"typography", choice("a", "Какво става през 1878 г.?", "Освобождението", "Съединението", "Независимостта", "Войната"), false},
		{"typography", choice("a", "Кой е \"Бащата\"?", "Ботев", "Вазов", "Яворов", "Смирненски"), true},
		// The words to avoid come from language.json: written here, the client's language test would find them.
		{"language", choice("a", "Как се казва връзката към страница?", avoiding("a loanword"), "Пост", "Адрес", "Блог"), true},
		{"language", choice("a", "Коя дума е руска?", strings.ToUpper(avoiding("Russian")), "Въпрос", "Играч", "Ниво"), true},
		{"language", choice("a", "Какво е блог?", "Дневник в мрежата", "Сайт", "Книга", "Писмо"), false},
		{"spelling", choice("a", "Коя империя основава Чингиз хан?", "Монголската", "Римската", "Персийската", "Китайската"), true},
		{"spelling", choice("a", "Олимпийските игри са в Атина. Кой град е след тях?", "Пекин", "Лондон", "Рим", "Токио"), false},
		{"spelling", choice("a", "Кой град има летните Олимпийски игри през 2024 г.?", "Париж", "Лондон", "Рим", "Токио"), true},
		{"spelling", choice("a", "Кой провинции са Северна Холандия и Южна Холандия?", "Нидерландия", "Белгия", "Дания", "Франция"), false},
		{"spelling", choice("a", "Коя игра е „FIFA 23“?", "Футболна", "Тенис", "Шах", "Бокс"), false},
		{"stale", choice("a", "Коя държава е последната приета в ЕС към 2026 г.?", "Хърватия", "Румъния", "България", "Кипър"), true},
		{"stale", func() Question {
			q := choice("a", "Коя държава е последната приета в ЕС към 2026 г.?", "Хърватия", "Румъния", "България", "Кипър")
			q.ReviewBy = "2027-06-01"
			return q
		}(), false},
		{"stale", choice("a", "Кой атлет държи световния рекорд на 100 м?", "Болт", "Луис", "Блейк", "Гей"), true},
		{"stale", choice("a", "Какво се случва в момента на удара?", "Искра", "Звук", "Вълна", "Нищо"), false},
		{"estimate", number("a", "Колко са евангелията в Новия завет?", 4, 2, "евангелия"), true},
		{"estimate", number("a", "Кой е номерът за спешни случаи в ЕС?", 112, 20, ""), true},
		{"estimate", number("a", "Колко метра е висок Мусала?", 2925, 880, "м"), false},
		{"estimate", number("a", "През коя година е Освобождението?", 1878, 15, ""), false},
		{"tolerance", number("a", "Колко метра е висок Мусала?", 2925, 880, "м"), false},
		{"tolerance", number("a", "Колко метра е висок Мусала?", 2925, 100, "м"), true},
		{"tolerance", number("a", "През коя година е Освобождението?", 1878, 2, ""), true},
		{"order-gap", &Order{Head: Head{ID: "a", Type: "order", Text: "Подреди върховете по височина:"}, Unit: "м", Direction: "desc",
			Items: []OrderItem{{"Мусала", 2925}, {"Вихрен", 2914}, {"Ботев", 2376}, {"Черни връх", 1800}}}, true},
		{"order-gap", &Order{Head: Head{ID: "a", Type: "order", Text: "Подреди събитията от най-ранното:"}, Direction: "asc",
			Items: []OrderItem{{"Освобождението", 1878}, {"Съединението", 1885}, {"Независимостта", 1908}, {"Войната", 1912}}}, false},
		{"options", choice("a", "Кой е строителят на Преслав?", "Симеон I", "Борис", "Петър", "Самуил"), true},
		{"options", choice("a", "Коя е телевизията на Нова?", "bTV", "БНТ", "Нова", "Евроком"), true},
		{"options", choice("a", "Коя е катедралата в Париж?", "„Нотр Дам“", "Кьолнската", "Миланската", "Реймската"), true},
		{"options", choice("a", "Кой цар е от Второто царство?", "Иван Асен II", "Петър IV", "Калоян I", "Борил II"), false},
		{"long-answer", choice("a", "Кой е ООН?", "Организацията на обединените нации", "НАТО", "ЕС", "ОССЕ"), true},
		{"answer-word", choice("a", "Кой е този водопад?", "Ниагарският водопад", "Виктория", "Игуасу", "Анхел"), true},
		{"answer-word", choice("a", "Кой е този водопад?", "Ниагарският водопад", "Водопадът Виктория", "Игуасу", "Анхел"), false},
		{"answer-word", &Clues{Head: Head{ID: "a", Type: "clues", Text: "Коя е тази организация?"}, Answer: "Лекари без граници",
			Wrong: []string{"Червеният кръст", "УНИЦЕФ", "Амнести"}, Clues: []string{"Основават я френски лекари.", "Втора.", "Трета."}}, true},
		{"dated", plain("a"), false},
		{"dated", func() Question {
			q := plain("a")
			q.On = []string{"03-03"}
			q.Day = "На 3 март 1878 г. е подписан Санстефанският мирен договор."
			q.Fact = "Мирът е подписан в Сан Стефано."
			return q
		}(), false},
		// The fact saying the date is no longer enough: the day's line says it.
		{"dated", func() Question {
			q := plain("a")
			q.On = []string{"03-03"}
			q.Fact = "На 3 март 1878 г. е подписан мирът."
			return q
		}(), true},
		{"dated", func() Question {
			q := plain("a")
			q.On = []string{"03-03"}
			q.Day = "На този ден е подписан Санстефанският мирен договор."
			return q
		}(), true},
		{"dated", func() Question {
			q := plain("a")
			q.On = []string{"03-03"}
			q.Day = "На 3 март 1878 г. е подписан Санстефанският мирен договор"
			return q
		}(), true},
		{"dated", func() Question {
			q := plain("a")
			q.On = []string{"07-15", "07-16", "07-17"}
			q.Day = "От 15 до 17 юли са Горещниците."
			return q
		}(), false},
		{"dated", func() Question {
			q := plain("a")
			q.On = []string{"2027-05-02"}
			q.Day = "Днес е Великден."
			return q
		}(), false},
		{"dated", func() Question {
			q := plain("a")
			q.On = []string{"2027-05-02"}
			return q
		}(), true},
		// A question whose text names its date may go without the day's line; one that doesn't, may not.
		{"dated", func() Question {
			q := choice("a", "Коя държава празнува националния си ден на 1 юли?", "Канада", "САЩ", "Мексико", "Куба")
			q.On = []string{"07-01"}
			return q
		}(), false},
		{"dated", func() Question {
			q := choice("a", "Коя държава празнува националния си ден на 4 юли?", "САЩ", "Канада", "Мексико", "Куба")
			q.On = []string{"07-01"}
			return q
		}(), true},
		{"own-date", func() Question {
			q := &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "3 юни е Световният ден на велосипеда."}, Answer: true}
			q.On = []string{"06-03"}
			return q
		}(), true},
		{"own-date", func() Question {
			q := &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "Световният ден на велосипеда е обявен от ЮНЕСКО."}}
			q.On = []string{"06-03"}
			return q
		}(), false},
		// Not dated: a date in a true-or-not is just a fact to know.
		{"own-date", &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "3 юни е Световният ден на велосипеда."}, Answer: true}, false},
		// A choice may name its date: the date isn't its answer.
		{"own-date", func() Question {
			q := choice("a", "Кое число празнуват математиците на 14 март?", "π", "e", "φ", "i")
			q.On = []string{"03-14"}
			return q
		}(), false},
		{"own-date", func() Question {
			q := choice("a", "На коя дата е обявено извънредното положение?", "13 март", "8 март", "16 март", "20 март")
			q.On = []string{"03-13"}
			return q
		}(), true},
		{"anchor", number("a", "Колко епизода има сериалът „Стъклен дом“?", 64, 19, "епизода"), true},
		{"anchor", number("a", "Колко места има зала 1 на НДК?", 3380, 1000, "места"), true},
		{"anchor", number("a", "Колко населени места в България нямат жители?", 192, 58, ""), false},
		{"anchor", number("a", "Колко минути продължава филмът „Отнесени от вихъра“?", 238, 71, "минути"), false},
		{"anchor", number("a", "През коя година излиза първият епизод на „Стъклен дом“?", 2010, 8, ""), false},
		{"decoy", &Match{Head: Head{ID: "a", Type: "match", Text: "Свържи:"}, Pairs: []MatchPair{{"А", "Б"}}, Tail: Tail{Added: "2026-11-01"}}, true},
	} {
		rule, _ := RuleNamed(c.rule)
		got := rule.one(c.q)
		if (len(got) > 0) != c.bad {
			t.Errorf("%s on %q: %v", c.rule, c.q.Base().Text, got)
		}
	}
}

// A value one question asks, shown by another next to its subject, is a give-away; the same value about something
// else isn't.
func TestGiveaway(t *testing.T) {
	asks := number("his-1", "През коя година започва Втората световна война?", 1939, 13, "")
	shows := choice("geo-1", "В коя държава е Гданск?", "Полша", "Германия", "Литва", "Латвия")
	shows.Fact = "Обстрелът на Вестерплате на 1 септември 1939\u00a0г. се смята за началото на Втората световна война."
	other := choice("mus-1", "Кой пее „Over the Rainbow“?", "Джуди Гарланд", "Мадона", "Шер", "Пинк")
	other.Fact = "Песента е от филма „Магьосникът от Оз“ от 1939\u00a0г."
	b := bankOf(asks, shows, other)
	if got := found(b); !slices.Equal(got, []string{"giveaway his-1"}) && !slices.Equal(got, []string{"giveaway geo-1"}) {
		t.Errorf("found %v", got)
	}
	// An order's item shows its value in the reveal.
	order := &Order{Head: Head{ID: "his-2", Type: "order", Text: "Подреди по годината на смъртта:"}, Direction: "asc",
		Items: []OrderItem{{"Пророк Мохамед", 632}, {"Леонардо да Винчи", 1519}, {"Карл Маркс", 1883}, {"Уинстън Чърчил", 1965}},
		Tail:  Tail{Added: "2026-11-01"}}
	died := number("lit-1", "През коя година умира Леонардо да Винчи?", 1519, 24, "")
	if got := found(bankOf(order, died)); len(got) != 1 || !strings.HasPrefix(got[0], "giveaway") {
		t.Errorf("found %v", got)
	}
}

func TestAnswerGiveaway(t *testing.T) {
	asks := choice("mov-1", "Как се казва малката русалка в анимацията на „Дисни“?", "Ариел", "Жасмин", "Бел", "Аврора")
	shows := choice("mov-2", "Как се казва бащата на русалката Ариел в анимацията на „Дисни“?", "Тритон", "Посейдон", "Нептун", "Атлас")
	// Rare words are rare only in a bank of some size: the rest of it, questions that share no words with these.
	var qs []Question
	for i := range 1500 {
		qs = append(qs, choice(fmt.Sprintf("gen-%d", i+10), fmt.Sprintf("Въпрос номер %d за нещо?", i), "Едно", "Друго", "Трето", "Четвърто"))
	}
	with := func(more ...Question) []string {
		var out []string
		for _, f := range found(bankOf(append(slices.Clone(qs), more...)...)) {
			if strings.HasPrefix(f, "answer-giveaway") {
				out = append(out, f)
			}
		}
		return out
	}
	if got := with(asks, shows); len(got) != 1 {
		t.Errorf("found %v", got)
	}
	// A wrong option names it without telling: no give-away.
	shows.Text, shows.Answer, shows.Wrong = "Коя е героинята на „Дисни“ с вълшебна лампа?", "Жасмин", []string{"Ариел", "Бел", "Аврора"}
	if got := with(asks, shows); len(got) != 0 {
		t.Errorf("found %v", got)
	}
}

func TestPairsAndSharedItems(t *testing.T) {
	match := &Match{Head: Head{ID: "nat-1", Type: "match", Difficulty: Hard, Text: "Свържи животното с вида му:"},
		Pairs: []MatchPair{{"Лайка", "Куче"}, {"Хам", "Шимпанзе"}, {"Кейко", "Косатка"}, {"Джордж", "Костенурка"}}, Decoy: "Горила",
		Tail: Tail{Added: "2026-11-01"}}
	order := &Order{Head: Head{ID: "nat-2", Type: "order", Text: "Подреди по годината на полета:"}, Direction: "asc",
		Items: []OrderItem{{"Кучето Лайка", 1957}, {"Белка и Стрелка", 1960}, {"Мечето Бруно", 1961}, {"Котката Фелисет", 1963}},
		Tail:  Tail{Added: "2026-11-01"}}
	if got := found(bankOf(match, order)); !slices.Equal(got, []string{"pair-giveaway nat-2"}) && !slices.Equal(got, []string{"pair-giveaway nat-1"}) {
		t.Errorf("found %v", got)
	}
	planes := func(id, text, fourth string, values ...float64) *Order {
		return &Order{Head: Head{ID: id, Type: "order", Text: text}, Direction: "asc", Unit: "т", Tail: Tail{Added: "2026-11-01"},
			Items: []OrderItem{{"Cessna 172", values[0]}, {"Boeing 747", values[1]}, {"Ан-225 „Мрия“", values[2]}, {fourth, values[3]}}}
	}
	a := planes("tec-1", "Подреди по маса:", "Airbus A380", 1, 400, 640, 575)
	b := planes("tec-2", "Подреди по размах:", "Stratolaunch", 11, 64, 88, 117)
	if got := found(bankOf(a, b)); len(got) != 1 || !strings.HasPrefix(got[0], "shared-items") {
		t.Errorf("found %v", got)
	}
}

// How strict: an error for a question added since StrictFrom (or a pair with one), a warning for older ones and for
// hints; a waiver keeps a finding out, and one that waives nothing is told.
func TestStrictness(t *testing.T) {
	old := choice("gen-1", "Довърши поговорката: „Рано пиле…“", "рано пее", "късно", "рано", "пее")
	fresh := choice("gen-2", "Довърши поговорката: „Гладна мечка…“", "хоро не играе", "мед не яде", "не спи", "не пее")
	fresh.Added = StrictFrom
	long := choice("gen-3", "Кой е ООН?", "Организацията на обединените нации", "НАТО", "ЕС", "ОССЕ")
	long.Added = StrictFrom
	b := bankOf(old, fresh, long)
	if got := found(b); !slices.Equal(got, []string{"ending gen-1", "!ending gen-2", "long-answer gen-3"}) {
		t.Errorf("found %v", got)
	}
	got := found(b, Waiver{"gen-2", "ending", "поговорка"}, Waiver{"gen-1", "stale", "без причина"})
	if !slices.Equal(got, []string{"ending gen-1", "long-answer gen-3", "waiver gen-1"}) {
		t.Errorf("with waivers: %v", got)
	}
	got = found(b, Waiver{"gen-9", "ending", "няма го"}, Waiver{"gen-1", "nosuch", "?"}, Waiver{"gen-1", "ending", ""})
	if n := len(slices.DeleteFunc(got, func(s string) bool { return !strings.HasPrefix(s, "! ") })); n != 3 {
		t.Errorf("bad waivers make %d errors: %v", n, found(b, Waiver{"gen-9", "ending", "няма го"}))
	}
}

// A bank's waivers file is read with it.
func TestWaiversFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, WaiversFile), []byte(`[{"id": "gen-001", "rule": "ending", "why": "поговорка"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	ws, err := readWaivers(dir)
	if err != nil || len(ws) != 1 || ws[0].Why != "поговорка" {
		t.Fatalf("%v %v", ws, err)
	}
	if err := os.WriteFile(filepath.Join(dir, WaiversFile), []byte(`[{"id": "gen-001", "rules": "ending"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := readWaivers(dir); err == nil {
		t.Error("a misspelled field was read")
	}
}

func TestTidy(t *testing.T) {
	for in, want := range map[string]string{
		"„...Baby One More Time“":           "„…Baby One More Time“",
		"ЕС - Китай и ЕС – Индия":           "ЕС — Китай и ЕС — Индия",
		"През 1878 г. и 1885 г.":            "През 1878 г. и 1885 г.",
		"https://en.wikipedia.org/wiki/...": "https://en.wikipedia.org/wiki/...",
		"1877–1878 г.":                      "1877–1878 г.",
	} {
		if got := tidy(in); got != want {
			t.Errorf("tidy(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestToleranceFormula(t *testing.T) {
	for _, c := range []struct {
		q    *Number
		want float64
	}{
		{number("a", "Колко метра е висок Мусала?", 2925, 0, "м"), 880},
		{number("a", "Колко са държавите в ООН?", 193, 0, ""), 58},
		{&Number{Head: Head{Text: "Колко души?"}, Answer: 1e6, Scale: "log", Unit: "души"}, 3},
		{&Number{Head: Head{Text: "Колко градуса?"}, Answer: -89, Scale: "linear", Unit: "°C"}, 0},
	} {
		if got := Tolerance(c.q); got != c.want {
			t.Errorf("%s %v: %v, want %v", c.q.Text, c.q.Answer, got, c.want)
		}
	}
	// A year: the further back, the wider.
	recent, old := number("a", "През коя година?", 1990, 0, ""), number("a", "През коя година?", 681, 0, "")
	if r, o := Tolerance(recent), Tolerance(old); r < 9 || r > 11 || o < 31 || o > 35 {
		t.Errorf("1990: %v, 681: %v", r, o)
	}
}

// The language list is the client's too: it loads, and has both kinds.
func TestLanguageList(t *testing.T) {
	kinds := map[string]bool{}
	for _, a := range avoid {
		kinds[a[0]] = true
	}
	if !kinds["Russian"] || !kinds["a loanword"] {
		t.Errorf("language.json gives %v", kinds)
	}
}
