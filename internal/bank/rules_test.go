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
		// The mirror: dealt on 25 December, another date says it's false.
		{"own-date", func() Question {
			q := &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "Българската православна църква празнува Коледа на 7 януари."}}
			q.On = []string{"12-25"}
			return q
		}(), true},
		{"own-date", func() Question {
			q := &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "Денят на труда се празнува на 1-ви май в повечето държави."}, Answer: true}
			q.On = []string{"05-01"}
			return q
		}(), true},
		// About the day itself: dealt on 12 February, both were born on it.
		{"own-date", func() Question {
			q := &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "Чарлз Дарвин и Ейбрахам Линкълн са родени в един и същи ден."}, Answer: true}
			q.On = []string{"02-12"}
			return q
		}(), true},
		// A year, a number, or a weekday's name isn't a date.
		{"own-date", func() Question {
			q := &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "Българската православна църква празнува Коледа по юлианския календар от 1968 г. насам."}}
			q.On = []string{"12-25"}
			return q
		}(), false},
		{"own-date", func() Question {
			q := &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "Чарлз Дарвин е роден в същата година като Ейбрахам Линкълн."}, Answer: true}
			q.On = []string{"02-12"}
			return q
		}(), false},
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
		{"countable", number("a", "Колко опери пише Джоакино Росини?", 39, 12, "опери"), true},
		{"countable", number("a", "На колко клаузи се дели Магна харта?", 63, 19, "клаузи"), true},
		{"countable", number("a", "Колко хиляди зрители гледат филма „11А“?", 98, 29, "хиляди"), true},
		{"countable", number("a", "Колко пъти бие сърцето за минута?", 70, 21, "пъти"), true},
		{"countable", number("a", "Около колко пъти Земята е по-тежка от Луната?", 81, 24, "пъти"), false},
		{"countable", number("a", "Колко метра е висок Мусала?", 2925, 880, "м"), false},
		{"countable", number("a", "Какъв е най-високият рейтинг „Ело“ на Веселин Топалов?", 2816, 80, "точки"), false},
		{"countable", number("a", "Колко точки вкарва Янис Адетокунбо в шестия мач?", 50, 15, "точки"), true},
		{"countable", number("a", "Колко хиляди души живеят в Гренландия?", 57, 17, "хил."), false},
		{"countable", number("a", "Колко населени места в България нямат жители?", 192, 58, ""), false},
		{"countable", number("a", "През коя година излиза първият епизод на „Стъклен дом“?", 2010, 8, ""), false},
		{"offset-scale", number("a", "Какъв е най-високият рейтинг „Ело“ на Веселин Топалов?", 2816, 840, "точки"), true},
		{"offset-scale", number("a", "Какъв е най-високият рейтинг „Ело“ на Веселин Топалов?", 2816, 80, "точки"), false},
		{"offset-scale", number("a", "При колко градуса по Целзий се топи готварската сол?", 801, 250, "°C"), true},
		{"offset-scale", number("a", "При колко градуса по Целзий се топи готварската сол?", 801, 80, "°C"), false},
		{"offset-scale", number("a", "Около колко градуса е един радиан?", 57.3, 17, "°"), true},
		{"offset-scale", number("a", "Колко метра е висок Мусала?", 2925, 880, "м"), false},
		{"own-number", number("a", "Колко дни продължават „Стоте дни“ на Наполеон?", 110, 33, "дни"), true},
		{"own-number", number("a", "Колко дни трае обсадата, започнала 90 дни след войната?", 110, 33, "дни"), true},
		{"own-number", number("a", "Колко метра е дълъг тунелът, открит през 2024 г.?", 2000, 500, "м"), false},
		{"own-number", number("a", "Колко са прелюдиите в цикъла оп. 28 на Шопен?", 24, 8, "прелюдии"), false},
		{"own-number", number("a", "Колко милиона души живеят в Германия, закръглено до сто хиляди?", 82.7, 20, "млн. души"), false},
		{"own-number", number("a", "Колко процента от хората на 16–74 години ползват интернет?", 22, 7, "%"), false},
		{"present", &Clues{Head: Head{ID: "a", Type: "clues", Text: "Кой е този боец?"}, Answer: "Багата", Wrong: []string{"А", "Б", "В"},
			Clues: []string{"Роден е в София.", "Бие се в тежка категория на UFC.", "Трета."}}, true},
		{"present", func() Question {
			q := choice("a", "В коя сграда се записва шоуто?", "НДК", "БНТ", "Дворецът", "Арена")
			q.Fact = "Студиото е в зала 12, а шоуто се записва всяка делнична вечер."
			return q
		}(), true},
		{"present", func() Question {
			q := choice("a", "В коя сграда се записва шоуто?", "НДК", "БНТ", "Дворецът", "Арена")
			q.Fact = "От 2000 до 2019 г. шоуто се записва всяка делнична вечер."
			return q
		}(), false},
		{"present", func() Question {
			q := choice("a", "Кой е президент на Франция?", "Макрон", "Оланд", "Саркози", "Ширак")
			q.ReviewBy = "2027-05-01"
			return q
		}(), false},
		{"present", choice("a", "Кой е президент на Франция?", "Макрон", "Оланд", "Саркози", "Ширак"), true},
		{"present", choice("a", "Колко години Роналд Рейгън е президент на САЩ?", "8", "4", "6", "12"), false},
		{"present", choice("a", "Кой е първият президент на САЩ?", "Вашингтон", "Адамс", "Джеферсън", "Линкълн"), false},
		{"present", &TrueFalse{Head: Head{ID: "a", Type: "truefalse", Text: "Серина Уилямс се състезава за Великобритания."}}, false},
		{"present", func() Question {
			q := choice("a", "За кой клуб играе Джордж Бест?", "Манчестър Юнайтед", "Ливърпул", "Челси", "Арсенал")
			q.Fact = "Бест умира през 2005 г. в Лондон."
			return q
		}(), false},
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

// A small number (28) gives a value away too, shown with its unit in another word („килограма“ for „кг“) next to the
// same subject; with another unit, or about something else, it doesn't.
func TestGiveawayOfASmallNumber(t *testing.T) {
	asks := number("mov-1", "С около колко килограма отслабва Кристиан Бейл за ролята си в „Механикът“?", 28, 8, "кг")
	var qs []Question
	for i := range 1500 {
		qs = append(qs, choice(fmt.Sprintf("gen-%d", i+10), fmt.Sprintf("Въпрос номер %d за нещо?", i), "Едно", "Друго", "Трето", "Четвърто"))
	}
	shows := func(fact string) Question {
		q := choice("mov-2", "Кой играе Батман в „Черният рицар“?", "Кристиан Бейл", "Джордж Клуни", "Вал Килмър", "Бен Афлек")
		q.Fact = fact
		return q
	}
	for fact, want := range map[string]bool{
		"За ролята си в „Механикът“ Кристиан Бейл отслабва с около 28 килограма.": true,
		"За ролята си в „Механикът“ Кристиан Бейл отслабва с около 28 кг.":        true,
		"На 28 години Кристиан Бейл отслабва за ролята си в „Механикът“.":         false,
		"Кристиан Бейл е роден в Уелс, а Батман играе в три филма.":               false,
	} {
		got := found(bankOf(append([]Question{asks, shows(fact)}, qs...)...))
		if (len(got) == 1 && strings.HasPrefix(got[0], "giveaway ")) != want || len(got) > 1 {
			t.Errorf("%q: found %v", fact, got)
		}
	}
	for _, c := range []struct {
		a, b string
		same bool
	}{{"кг", "килограма", true}, {"км", "километра", true}, {"км", "килограма", false}, {"м", "метра", true},
		{"точки", "точка", true}, {"пъти", "път", true}, {"°C", "°C", true}, {"%", "процента", true}, {"години", "дни", false},
		{"", "", false}} {
		if sameUnit(c.a, c.b) != c.same {
			t.Errorf("sameUnit(%q, %q) = %v", c.a, c.b, !c.same)
		}
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

// A rule added later is an error only for the questions added from its own day (Rule.From): one added between
// StrictFrom and then is warned of, so that the bank that loaded yesterday loads today.
func TestRuleStrictFromItsDay(t *testing.T) {
	between := number("gen-1", "Колко опери пише Джоакино Росини?", 39, 12, "опери")
	between.Added = StrictFrom
	after := number("gen-2", "Колко симфонии пише Хайдн?", 104, 31, "симфонии")
	after.Added = AuditFrom
	if got := found(bankOf(between, after)); !slices.Equal(got, []string{"countable gen-1", "!countable gen-2"}) {
		t.Errorf("found %v", got)
	}
}

// A count of a list is no estimate for the day's hard number either (Bank.Estimate), unless the bank waives it for its
// anchor.
func TestEstimateOfACount(t *testing.T) {
	operas := number("gen-1", "Колко опери пише Джоакино Росини?", 39, 12, "опери")
	books := number("gen-2", "Колко книги има Библията в протестантския канон?", 66, 20, "книги")
	height := number("gen-3", "Колко метра е висок Мусала?", 2925, 880, "м")
	year := number("gen-4", "През коя година е Освобождението?", 1878, 16, "")
	b := bankOf(operas, books, height, year)
	got := found(b, Waiver{"gen-2", "countable", "известен сбор: 39 книги в Стария и 27 в Новия завет"})
	if !slices.Equal(got, []string{"countable gen-1"}) {
		t.Errorf("found %v", got)
	}
	for q, want := range map[Question]bool{operas: false, books: true, height: true, year: false} {
		if b.Estimate(q) != want {
			t.Errorf("%s: estimate %v", q.Base().ID, !want)
		}
	}
}

// Two choices over one set of rare options ask one thing twice: mirrored (each one's answer the other's wrong
// option), or the same answer; over the options of a whole kind (the countries), or sharing two, they don't.
func TestTwin(t *testing.T) {
	karloff := choice("mov-1", "Кой играе чудовището във „Франкенщайн“ (1931)?", "Борис Карлоф", "Бела Лугоши", "Лон Чейни", "Питър Лоре")
	lugosi := choice("mov-2", "Кой играе граф Дракула във филма от 1931 г.?", "Бела Лугоши", "Борис Карлоф", "Лон Чейни", "Питър Лоре")
	same := choice("mov-3", "Кой актьор е чудовището на Франкенщайн в киното от 1931 г.?", "Борис Карлоф", "Бела Лугоши", "Лон Чейни", "Клод Рейнс")
	other := choice("mov-4", "Кой играе Невидимия човек (1933)?", "Клод Рейнс", "Бела Лугоши", "Конрад Фейт", "Фредрик Марч")
	twins := func(qs ...Question) []string {
		return slices.DeleteFunc(found(bankOf(qs...)), func(s string) bool { return !strings.HasPrefix(s, "twin") })
	}
	if got := twins(karloff, lugosi); len(got) != 1 {
		t.Errorf("mirrored: %v", got)
	}
	if got := twins(karloff, same); len(got) != 1 {
		t.Errorf("the same answer: %v", got)
	}
	if got := twins(karloff, other); len(got) != 0 {
		t.Errorf("two options shared: %v", got)
	}
	// Countries every geography question offers: a kind's list, no twins.
	var qs []Question
	for i, c := range []string{"Франция", "Германия", "Италия", "Испания", "Франция", "Германия"} {
		rest := slices.DeleteFunc([]string{"Франция", "Германия", "Италия", "Испания"}, func(s string) bool { return s == c })
		qs = append(qs, choice(fmt.Sprintf("geo-%d", i), fmt.Sprintf("Въпрос %d за държава?", i), c, rest...))
	}
	if got := twins(qs...); len(got) != 0 {
		t.Errorf("a kind's list: %v", got)
	}
}

// The answers of choices of numbers sit evenly across the four ranks, or the rule says which to move.
func TestNumberRank(t *testing.T) {
	for opts, want := range map[[4]string]int{
		{"15%", "10%", "18%", "25%"}:                   2,
		{"1 600 км", "900 км", "1 200 км", "2 000 км"}: 3,
		{"1 млн.", "500 000", "2 млн.", "3 млн."}:      0, // not one shape
		{"Около 7", "7", "9", "12"}:                    0,
		{"Париж", "Рим", "Мадрид", "Берлин"}:           0,
	} {
		if got := numberRank(choice("gen-1", "Колко?", opts[0], opts[1:]...)); got != want {
			t.Errorf("numberRank(%v) = %d, want %d", opts, got, want)
		}
	}
	ranked := func(ranks ...int) []string {
		var qs []Question
		for i, r := range ranks {
			opts := []string{"10", "20", "30", "40"}
			q := choice(fmt.Sprintf("gen-%d", i), fmt.Sprintf("Колко %d?", i), opts[r-1], slices.Delete(slices.Clone(opts), r-1, r)...)
			q.Added = fmt.Sprintf("2026-10-%02d", 1+i*30/len(ranks))
			qs = append(qs, q)
		}
		return slices.DeleteFunc(found(bankOf(qs...)), func(s string) bool { return !strings.HasPrefix(s, "number-rank") })
	}
	var even, middle []int
	for i := range 80 {
		even, middle = append(even, i%4+1), append(middle, i%2+2)
	}
	if got := ranked(even...); len(got) != 0 {
		t.Errorf("even: %v", got)
	}
	// The bank and its one topic, both skewed: a warning each, at the newest question of the most common rank.
	if got := ranked(middle...); len(got) != 2 || got[0] != "number-rank gen-78" {
		t.Errorf("all in the middle: %v", got)
	}
	if got := ranked(middle[:NumberRankAt-1]...); len(got) != 0 {
		t.Errorf("too few to judge: %v", got)
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
		"Около 2% от тях, после 15 %":       "Около 2 % от тях, после 15 %",
		"Романът „18% сиво“ — 18% от":       "Романът „18% сиво“ — 18 % от",
		"На 90 ° с.ш., при 25 °C":           "На 90° с.ш., при 25 °C",
		"https://x.org/wiki/Ch%C3%A2teau":   "https://x.org/wiki/Ch%C3%A2teau",
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

// A share glued to its number, or an angle apart from its degree, is a typography finding (bank fmt sets both).
func TestTypographyOfShares(t *testing.T) {
	q := choice("gen-1", "Колко?", "15 %", "10 %", "20 %", "25 %")
	if got := ruleTypography(q); len(got) != 0 {
		t.Errorf("as the game writes it: %v", got)
	}
	q.Fact = "Около 2% от тях."
	if got := ruleTypography(q); len(got) != 1 {
		t.Errorf("a glued share: %v", got)
	}
	q.Fact = "Романът „18% сиво“ е за един фотограф."
	if got := ruleTypography(q); len(got) != 0 {
		t.Errorf("a quoted title keeps its spelling: %v", got)
	}
}
