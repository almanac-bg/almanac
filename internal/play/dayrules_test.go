package play

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

// The days ahead are drawn again only when DayRules changes (ahead.go), so a change to how a day is drawn that leaves it
// as it was reaches the day's ten up to Ahead days late. DayRules ends with what the draw does to a fixed bank, on
// fixed days and seeds: a change to the draw changes that, fails here, and gets a new DayRules with it.
func TestDayRulesNameTheDraw(t *testing.T) {
	got := drawFingerprint(t)
	if again := drawFingerprint(t); again != got {
		t.Fatalf("the draw isn't the same twice on the same bank and seeds (%s, %s): it must be, for this to tell", got, again)
	}
	if !strings.HasSuffix(DayRules, " draw "+got) {
		t.Fatalf("drawDay draws differently from what DayRules names: set DayRules to \"<today> <what changed>; draw %s\", "+
			"so that the days drawn ahead are drawn again by the new rules", got)
	}
}

// drawFingerprint is what drawDay makes of a fixed bank (dayRulesBank) on a few days, one after the other as the days
// ahead are drawn (each barring the questions of those before), with a few questions answered: a hash of each day's
// picks and of the places it fell short.
func drawFingerprint(t *testing.T) string {
	b := dayRulesBank(t)
	answered := map[string]bool{}
	for i, q := range b.Questions {
		if i%3 == 0 {
			answered[q.Base().ID] = true
		}
	}
	used := map[string]bool{}
	h := sha256.New()
	for i, day := range []string{"2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"} {
		picks, short := drawDay(b, day, used, answered, rand.New(rand.NewPCG(uint64(i)+1, 7)))
		fmt.Fprintf(h, "%s", day)
		for _, p := range picks { // what drawDay draws, field by field: a field Pick gains isn't the draw's
			fmt.Fprintf(h, " %s:%d", p.ID, p.Seed)
			used[p.ID] = true
		}
		fmt.Fprintf(h, " short %q\n", short)
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// dayRulesBank is a bank written out here, never to change: ten topics, each with every type at every difficulty,
// pictures, estimates and years, questions about Bulgaria, questions of a date, one due for review, one retired, and
// two topics' questions naming one subject.
func dayRulesBank(t *testing.T) *bank.Bank {
	t.Helper()
	var categories []bank.Category
	var questions []bank.Question
	n := 0
	add := func(category string, q map[string]any) {
		n++
		q["id"] = fmt.Sprintf("%s-%d", category, n)
		if n%4 == 0 {
			q["bg"] = true
		}
		data, _ := json.Marshal(q)
		decoded, err := bank.Decode(data, category)
		if err != nil {
			t.Fatal(err)
		}
		questions = append(questions, decoded)
	}
	picture := func(k int) map[string]any {
		return map[string]any{"file": fmt.Sprintf("p%d.webp", k), "w": 600, "h": 400, "alt": "Снимка", "credit": "Някой",
			"license": "PD", "source": "https://commons.wikimedia.org/p"}
	}
	for c := range 10 {
		category := string(rune('a'+c)) + "topic"
		categories = append(categories, bank.Category{ID: category, Name: fmt.Sprintf("Тема %d", c+1)})
		for _, level := range []string{"easy", "medium", "hard"} {
			for k := range 2 {
				text := func(what string) string { return fmt.Sprintf("%s %s %s %d?", what, category, level, k) }
				answer := fmt.Sprintf("Отговор %s %s %d", category, level, k)
				if c < 2 && level == "medium" && k == 0 {
					answer = "„Титаник“" // two topics, one subject
				}
				wrong := []string{"Едно", "Друго", "Трето"}
				add(category, map[string]any{"type": "choice", "difficulty": level, "text": text("Кое"), "answer": answer, "wrong": wrong})
				add(category, map[string]any{"type": "choice", "difficulty": level, "text": text("Кое на снимката"),
					"answer": answer + " с", "wrong": wrong, "image": picture(n)})
				add(category, map[string]any{"type": "choice", "difficulty": level, "text": text("Коя снимка"),
					"answer": answer + " п", "wrong": wrong, "pictures": []any{picture(n), picture(n + 1), picture(n + 2), picture(n + 3)}})
				add(category, map[string]any{"type": "truefalse", "difficulty": level, "text": text("Вярно ли е") + ".", "answer": k == 0})
				add(category, map[string]any{"type": "order", "difficulty": level, "text": text("Подреди"), "direction": "asc",
					"items": []any{map[string]any{"text": "А", "value": 1}, map[string]any{"text": "Б", "value": 2},
						map[string]any{"text": "В", "value": 3}, map[string]any{"text": "Г", "value": 4}}})
				add(category, map[string]any{"type": "match", "difficulty": level, "text": text("Свържи"),
					"pairs": []any{map[string]any{"left": "1", "right": "А"}, map[string]any{"left": "2", "right": "Б"},
						map[string]any{"left": "3", "right": "В"}, map[string]any{"left": "4", "right": "Г"}}})
				add(category, map[string]any{"type": "split", "difficulty": level, "text": text("Раздели"), "groups": []string{"Ляво", "Дясно"},
					"items": []any{map[string]any{"text": "А", "group": 0}, map[string]any{"text": "Б", "group": 1},
						map[string]any{"text": "В", "group": 0}, map[string]any{"text": "Г", "group": 1}}})
				add(category, map[string]any{"type": "clues", "difficulty": level, "text": text("Кой е"),
					"clues": []string{"Първо.", "Второ.", "Трето."}, "answer": answer + " к", "wrong": wrong})
				add(category, map[string]any{"type": "number", "difficulty": level, "text": text("Колко метра"),
					"answer": 100 + n, "unit": "м", "step": 1, "scale": "linear", "tolerance": 0.1})
				add(category, map[string]any{"type": "number", "difficulty": level, "text": text("В коя година"),
					"answer": 1800 + n, "step": 1, "scale": "linear", "tolerance": 0})
			}
		}
		if c == 2 {
			add(category, map[string]any{"type": "choice", "difficulty": "medium", "text": "Какво стана на 3 март?",
				"answer": "Освобождението", "wrong": []string{"А", "Б", "В"}, "on": []string{"03-03"}, "day": "На 3 март 1878 г."})
			add(category, map[string]any{"type": "choice", "difficulty": "easy", "text": "Какво е на 4 март 2026 г.?",
				"answer": "Нещо", "wrong": []string{"А", "Б", "В"}, "on": []string{"2026-03-04"}, "day": "На 4 март 2026 г."})
		}
		if c == 3 {
			add(category, map[string]any{"type": "choice", "difficulty": "easy", "text": "Кой е рекордът?",
				"answer": "Рекорд", "wrong": []string{"А", "Б", "В"}, "reviewBy": "2026-03-02"})
			add(category, map[string]any{"type": "choice", "difficulty": "easy", "text": "Кой беше?",
				"answer": "Бивш", "wrong": []string{"А", "Б", "В"}, "retired": true, "retiredWhy": "wrong"})
		}
	}
	return bank.Of(categories, questions)
}
