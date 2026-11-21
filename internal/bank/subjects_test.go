package bank

import (
	"slices"
	"testing"
)

// namedIn is every subject a question names, by key.
func namedIn(q Question) []string {
	var out []string
	named(q, func(k, _ string) {
		if !slices.Contains(out, k) {
			out = append(out, k)
		}
	})
	slices.Sort(out)
	return out
}

// A question's subjects for the day are its answer and the titles it quotes, compared without quotes or case.
func TestSubjects(t *testing.T) {
	choice := &Choice{Head: Head{Type: "choice", Text: "Кой филм печели 11 награди „Оскар“?"},
		Answer: "„Титаник“", Wrong: []string{"„Аватар“", "„Бен Хур“", "„Гладиатор“"}}
	if got := Subjects(choice); !slices.Equal(got, []string{"титаник", "оскар", "аватар", "бен хур", "гладиатор"}) {
		t.Errorf("choice: %q", got)
	}
	tf := &TrueFalse{Head: Head{Type: "truefalse", Text: "„Титаник“ е заснет през 1997 г."}, Answer: true}
	if got := Subjects(tf); !slices.Equal(got, []string{"титаник"}) {
		t.Errorf("true or not: %q", got)
	}
	n := &Number{Head: Head{Type: "number", Text: "През коя година потъва корабът?"}, Answer: 1912, Step: 1}
	if got := Subjects(n); len(got) != 1 || got[0] != subjectKey(AnswerText(n)) {
		t.Errorf("number: %q", got)
	}
}

// The report reads names from what a player sees: capitals in a row, but for a sentence's first; quoted titles; the
// options whole; never a number or a Roman figure alone.
func TestNamed(t *testing.T) {
	for _, c := range []struct {
		q    Question
		want []string
	}{
		{&TrueFalse{Head: Head{Text: "Наполеон Бонапарт е роден на Корсика."}}, []string{"бонапарт", "корсика"}},
		{&TrueFalse{Head: Head{Text: "През 1804 г. Наполеон Бонапарт става император. Коронясва го папа Пий VII."}},
			[]string{"наполеон бонапарт", "пий vii"}},
		{&TrueFalse{Head: Head{Text: "„Мона Лиза“ е рисувана от Леонардо да Винчи в Ню Йорк."}},
			[]string{"леонардо да винчи", "лиза", "мона лиза", "ню йорк"}},
		{&Choice{Head: Head{Text: "Кой цар е наследник на Симеон I?"}, Answer: "Петър I", Wrong: []string{"Борис II", "10", "Иван Асен II"}},
			[]string{"борис ii", "иван асен ii", "петър i", "симеон i"}},
		{&Choice{Head: Head{Text: "Кой, роден в Калофер, пише „Хаджи Димитър“?"},
			Answer: "Христо Ботев", Wrong: []string{"Иван Вазов", "Васил Левски", "Пейо Яворов"}},
			[]string{"васил левски", "иван вазов", "калофер", "пейо яворов", "хаджи димитър", "христо ботев"}},
	} {
		if got := namedIn(c.q); !slices.Equal(got, c.want) {
			t.Errorf("%q: %q, want %q", c.q.Base().Text, got, c.want)
		}
	}
}

// Repeats lists the subjects more than so many live questions name (a question once however often it names one),
// the most first; SameIdentity the "who is this" questions (picture choices) that share an answer.
func TestRepeatsAndIdentities(t *testing.T) {
	pic := &Image{File: "a.webp"}
	qs := []Question{
		&Choice{Head: Head{ID: "his-1", Type: "choice", Text: "Кой е този човек?", Category: "history"}, Answer: "Наполеон",
			Wrong: []string{"Нелсън", "Уелингтън", "Кутузов"}, Tail: Tail{Image: pic}},
		&Choice{Head: Head{ID: "his-2", Type: "choice", Text: "Кой е този човек, роден на Корсика?", Category: "history"},
			Answer: "наполеон", Wrong: []string{"Нелсън", "Цезар", "Петър I"}, Tail: Tail{Image: pic}},
		&Choice{Head: Head{ID: "his-3", Type: "choice", Text: "Къде умира Наполеон?", Category: "history"}, Answer: "Света Елена",
			Wrong: []string{"Корсика", "Елба", "Нелсън"}},
		&Choice{Head: Head{ID: "his-4", Type: "choice", Text: "Кой губи при Ватерло?", Category: "history"}, Answer: "Наполеон",
			Wrong: []string{"Нелсън", "Уелингтън", "Блюхер"}, Tail: Tail{Retired: true}},
		&TrueFalse{Head: Head{ID: "geo-1", Type: "truefalse", Text: "Островът Корсика е на Франция.", Category: "geography"}},
	}
	b := &Bank{Categories: []Category{{"history", "История"}, {"geography", "География"}}, Questions: qs, byID: map[string]Question{}}
	for _, q := range qs {
		b.byID[q.Base().ID] = q
	}
	got := map[string][]string{}
	for _, s := range b.Repeats(2) {
		got[s.Name] = s.IDs
	}
	if len(got) != 3 || !slices.Equal(got["Наполеон"], []string{"his-1", "his-2", "his-3"}) ||
		!slices.Equal(got["Нелсън"], []string{"his-1", "his-2", "his-3"}) ||
		!slices.Equal(got["Корсика"], []string{"his-2", "his-3", "geo-1"}) {
		t.Errorf("repeats: %v", got)
	}
	if r := b.Repeats(2); r[0].Name != "Корсика" || b.Spread(r[0])[0] != (CategoryCount{"history", 2}) {
		t.Errorf("the first repeat %+v, spread %v", r[0], b.Spread(r[0]))
	}
	same := b.SameIdentity()
	if len(same) != 1 || same[0].Name != "Наполеон" || !slices.Equal(same[0].IDs, []string{"his-1", "his-2"}) {
		t.Errorf("same identity: %+v", same)
	}
}
