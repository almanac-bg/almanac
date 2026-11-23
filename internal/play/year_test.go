package play

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"slices"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A year of days, drawn one after the other from a bank that has questions for every place (yearBank), each holds the
// day's whole shape: ten questions, one from each chapter, none a day before had; easy, then medium, then hard, the
// first a plain easy choice; among the easy ones a picture and a true-or-not, among the medium ones a picture and one
// puzzle (an order, a match or a split, in turn day by day), among the hard ones a number, the day's last, and an
// estimate; at least BGFloor about Bulgaria; no subject twice; nothing retired, of a kind switched off, or due for
// review; a question of a date only on its date, and on it. TestAYearOfDays holds the same over the real bank, where
// it's there; this one runs wherever the tests do.
func TestAYearOfShapes(t *testing.T) {
	t.Parallel()
	b, dated := yearBank(t)
	used := map[string]bool{}
	drawn := map[string][]Pick{}
	r := rand.New(rand.NewPCG(3, 4))
	start := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	var puzzles []string
	onTheirDay := 0
	for n := range 365 {
		day := start.AddDate(0, 0, n).Format(time.DateOnly)
		picks, short := drawDay(b, day, used, nil, recentSubjects(b, drawn, day), r)
		drawn[day] = picks
		if len(short) > 0 || len(picks) != Length {
			t.Fatalf("%s: %d questions, short of %v", day, len(picks), short)
		}
		chapters, subjects := map[string]bool{}, map[string]string{}
		kinds := map[string]int{}
		bg := 0
		for i, p := range picks {
			q, ok := b.Get(p.ID)
			if !ok || !bank.Playable(q) || overdue(q, day) {
				t.Fatalf("%s: %s can't be dealt (retired, of a kind off, or due for review)", day, p.ID)
			}
			if used[p.ID] {
				t.Fatalf("%s: %s again: a day before had it", day, p.ID)
			}
			used[p.ID] = true
			h, tail := q.Base(), q.Extra()
			if chapters[h.Category] {
				t.Fatalf("%s: two questions of %s", day, h.Category)
			}
			chapters[h.Category] = true
			for _, k := range bank.Subjects(q) {
				if other, twice := subjects[k]; twice {
					t.Fatalf("%s: %s and %s both name %q", day, other, p.ID, k)
				}
				subjects[k] = p.ID
			}
			if len(tail.On) > 0 {
				if !tail.OnDay(day) {
					t.Fatalf("%s: %s is of %v, another day's", day, p.ID, tail.On)
				}
				onTheirDay++
			}
			bg += b2i(tail.BG)
			want := []bank.Difficulty{bank.Easy, bank.Easy, bank.Easy, bank.Medium, bank.Medium, bank.Medium, bank.Medium,
				bank.Hard, bank.Hard, bank.Hard}[i]
			if h.Difficulty != want {
				t.Fatalf("%s, place %d: %s is %s, not %s: a day goes from easy to hard", day, i+1, p.ID, h.Difficulty, want)
			}
			kind := h.Type
			if bank.HasPictures(q) {
				kind += " with a picture"
			}
			if slices.Contains(puzzleKinds, h.Type) {
				puzzles = append(puzzles, h.Type)
				kind = puzzle
			}
			kinds[string(h.Difficulty)+" "+kind]++
			if i == 0 && kind != "choice" {
				t.Fatalf("%s opens on %s, a %s: a day opens on a plain choice", day, p.ID, kind)
			}
			if i == Length-1 && (h.Type != "number" || !b.Estimate(q)) {
				t.Fatalf("%s ends on %s (%s): a day ends on its hard number, an estimate", day, p.ID, h.Type)
			}
		}
		shape := map[string]int{"easy choice": 1, "easy choice with a picture": 1, "easy truefalse": 1, "medium choice": 2,
			"medium choice with a picture": 1, "medium " + puzzle: 1, "hard choice": 2, "hard number": 1}
		for place, n := range shape {
			if kinds[place] != n {
				t.Fatalf("%s: %d of %q, want %d (the day: %v)", day, kinds[place], place, n, kinds)
			}
		}
		if bg < BGFloor {
			t.Fatalf("%s: %d questions about Bulgaria, under %d", day, bg, BGFloor)
		}
		if on := dated[day[5:]]; on != "" && !slices.ContainsFunc(picks, func(p Pick) bool { return p.ID == on }) {
			t.Fatalf("%s: without %s, the question of its date", day, on)
		}
	}
	if onTheirDay != len(dated) {
		t.Fatalf("%d questions of a date dealt on their dates, of %d", onTheirDay, len(dated))
	}
	// One puzzle a day, its kinds in turn: any three days in a row have one of each.
	for i := 0; i+len(puzzleKinds) <= len(puzzles); i++ {
		three := slices.Clone(puzzles[i : i+len(puzzleKinds)])
		slices.Sort(three)
		if len(slices.Compact(three)) != len(puzzleKinds) {
			t.Fatalf("days %d–%d: puzzles %v, not one of each kind", i+1, i+len(puzzleKinds), puzzles[i:i+len(puzzleKinds)])
		}
	}
}

// yearBank is a bank with more than a year of questions for every place of a day (daySlots), in ten chapters, a third
// of them about Bulgaria; and what a day must pass by: clues (off), retired questions, questions due for review, hard
// numbers that are years (no estimate). A few questions belong to dates (dated: by MM-DD, each a hard choice).
func yearBank(t *testing.T) (b *bank.Bank, dated map[string]string) {
	t.Helper()
	var categories []bank.Category
	var questions []bank.Question
	dated = map[string]string{}
	n := 0
	add := func(category string, q map[string]any) string {
		n++
		q["id"] = fmt.Sprintf("%s-%d", category, n)
		if _, set := q["bg"]; !set && n%3 == 0 {
			q["bg"] = true
		}
		data, _ := json.Marshal(q)
		decoded, err := bank.Decode(data, category)
		if err != nil {
			t.Fatal(err)
		}
		questions = append(questions, decoded)
		return q["id"].(string)
	}
	picture := map[string]any{"file": "0123456789abcdef.webp", "w": 600, "h": 400, "alt": "Снимка", "credit": "Някой",
		"license": "PD", "source": "https://commons.wikimedia.org/p"}
	wrong := []string{"Едно", "Друго", "Трето"}
	four := []any{map[string]any{"text": "А", "value": 1}, map[string]any{"text": "Б", "value": 2},
		map[string]any{"text": "В", "value": 3}, map[string]any{"text": "Г", "value": 4}}
	const each = 45 // of a place taking one a day, in each of ten chapters: 450 for 365 days
	for c := range 10 {
		category := string(rune('a'+c)) + "chapter"
		categories = append(categories, bank.Category{ID: category, Name: fmt.Sprintf("Тема %d", c+1)})
		text := func(what string) string { return fmt.Sprintf("%s %d?", what, n) }
		answer := func() string { return fmt.Sprintf("Отговор %d", n) }
		choice := func(level string, more map[string]any) string {
			q := map[string]any{"type": "choice", "difficulty": level, "text": text("Кое"), "answer": answer(), "wrong": wrong}
			for k, v := range more {
				q[k] = v
			}
			return add(category, q)
		}
		for k := range each {
			choice("easy", nil)
			choice("easy", map[string]any{"image": picture})
			add(category, map[string]any{"type": "truefalse", "difficulty": "easy", "text": fmt.Sprintf("Твърдение %d.", n), "answer": k%2 == 0})
			choice("medium", nil)
			choice("medium", nil)
			choice("medium", map[string]any{"image": picture})
			choice("hard", nil)
			choice("hard", nil)
			add(category, map[string]any{"type": "number", "difficulty": "hard", "text": text("Колко метра"),
				"answer": 100 + n, "unit": "м", "step": 1, "scale": "linear", "tolerance": 30})
			switch k % 3 {
			case 0:
				add(category, map[string]any{"type": "order", "difficulty": "medium", "text": text("Подреди"), "direction": "asc", "items": four})
			case 1:
				add(category, map[string]any{"type": "match", "difficulty": "medium", "text": text("Свържи"), "decoy": "Д",
					"pairs": []any{map[string]any{"left": "1", "right": "А"}, map[string]any{"left": "2", "right": "Б"},
						map[string]any{"left": "3", "right": "В"}, map[string]any{"left": "4", "right": "Г"}}})
			default:
				add(category, map[string]any{"type": "split", "difficulty": "medium", "text": text("Раздели"), "groups": []string{"Ляво", "Дясно"},
					"items": []any{map[string]any{"text": "А", "group": 0}, map[string]any{"text": "Б", "group": 1},
						map[string]any{"text": "В", "group": 0}, map[string]any{"text": "Г", "group": 1},
						map[string]any{"text": "Д", "group": 0}, map[string]any{"text": "Е", "group": 1}}})
			}
		}
		// What no day takes: a kind switched off, a retired question, one due for review before the year, and years
		// in the hard number's place (never while an estimate is left).
		for range 5 {
			add(category, map[string]any{"type": "clues", "difficulty": "medium", "text": text("Кой е"),
				"clues": []string{"Първо.", "Второ.", "Трето."}, "answer": answer(), "wrong": wrong})
			choice("easy", map[string]any{"retired": true, "retiredWhy": "wrong"})
			choice("hard", map[string]any{"reviewBy": "2026-12-31"})
			add(category, map[string]any{"type": "number", "difficulty": "hard", "text": text("През коя година"),
				"answer": 1800 + n%200, "step": 1, "scale": "linear", "tolerance": 10})
		}
		// Each chapter has the question of one date of each month.
		for m := 1; m <= 12; m++ {
			on := fmt.Sprintf("%02d-%02d", m, c+2)
			dated[on] = choice("hard", map[string]any{"on": []string{on}, "day": "На този ден.", "bg": false})
		}
	}
	return bank.Of(categories, questions), dated
}

// „Близо“ is the number's alone (DECISIONS.md, „Right or not“): in a game, a number within its tolerance but short of
// right is marked close, and counts as not right; a match with a pair left out, a split with an item left where it
// is, an order with two swapped, a choice and a true-or-not missed are wrong and nothing more, whatever part of them
// was right. Games are played until each kind has been met so.
func TestOnlyANumberIsClose(t *testing.T) {
	w := setup(t)
	user := w.user()
	met := map[string]bool{}
	almost := func(runID int64, n int) json.RawMessage {
		var r map[string]any
		_ = json.Unmarshal(w.right(runID, n), &r)
		q := w.question(runID, n)
		switch q := q.(type) {
		case *bank.Number:
			if q.Scale == "log" {
				r["value"] = q.Answer * math.Sqrt(q.Tolerance) // half the tolerance away
			} else {
				r["value"] = q.Answer + q.Tolerance/2
			}
		case *bank.Match:
			pairs := r["pairs"].([]any)
			pairs[0] = -1 // three joined right, one left out
		case *bank.Split:
			sides := r["sides"].([]any)
			sides[0] = -1 // five sent right, one left where it is
		case *bank.Order:
			order := r["order"].([]any)
			order[0], order[1] = order[1], order[0]
		default:
			return w.wrong(runID, n)
		}
		out, _ := json.Marshal(r)
		return out
	}
	for range 6 {
		s, err := w.g.startChapter(t.Context(), user, MixChapter)
		if err != nil {
			t.Fatal(err)
		}
		state := w.play(user, s.ID, repeat(almost, Length)...)
		if state.Rights != 0 {
			t.Fatalf("%d right answers, of none: almost isn't right", state.Rights)
		}
		for n, m := range state.Trail {
			q := w.question(s.ID, n)
			kind := q.Base().Type
			met[kind] = true
			if m.Right || m.Close != (kind == "number") {
				t.Fatalf("%s, a %s answered almost: marked %+v", q.Base().ID, kind, m)
			}
		}
		w.wait(time.Minute)
	}
	for _, kind := range []string{"choice", "truefalse", "number", "order", "match", "split"} {
		if !met[kind] {
			t.Errorf("no %s met in six games", kind)
		}
	}
}
